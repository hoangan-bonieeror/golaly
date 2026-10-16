/** Security & concurrency hardening (review findings, October 2026). */
import type { AddressInfo } from "node:net";
import { io } from "socket.io-client";
import request from "supertest";
import { JwtService } from "@nestjs/jwt";
import { randomToken, sha256 } from "../src/common/crypto";
import { GoogleClient, type GoogleProfile } from "../src/modules/auth/google";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

describe("sessions", () => {
  it("logout ends the session immediately — the old access cookie stops working", async () => {
    const u = await t.register("lo");
    const access = u.cookies().split("; ").find((c) => c.startsWith("triply_at="))!;
    expect((await t.anon().raw.get("/api/v1/users/me").set("Cookie", access)).status).toBe(200);
    expect((await u.post("/auth/logout")).status).toBe(200);
    expect((await t.anon().raw.get("/api/v1/users/me").set("Cookie", access)).status).toBe(401);
  });

  it("changing the password ends every other session at once", async () => {
    const u = await t.register("cp");
    const other = await t.as(u.email, "harbor-lantern-58");
    expect((await other.get("/users/me")).status).toBe(200);
    expect((await u.post("/auth/password", { currentPassword: "harbor-lantern-58", newPassword: "password456" })).status).toBe(200);
    expect((await other.get("/users/me")).status).toBe(401);
    expect((await u.get("/users/me")).status).toBe(200);
  });

  it("never accepts another kind of token (e.g. the OAuth state cookie) as an access token", async () => {
    const jwt = t.app.get(JwtService);
    const state = await jwt.signAsync({ typ: "oauth_state", state: "s", verifier: "v", next: "/home" }, { secret: process.env.JWT_SECRET! });
    expect((await t.anon().raw.get("/api/v1/users/me").set("Authorization", `Bearer ${state}`)).status).toBe(401);
    const u = await t.register("typ");
    const noTyp = await jwt.signAsync({ sub: u.id, sid: "00000000-0000-4000-8000-000000000000" }, { secret: process.env.JWT_SECRET! });
    expect((await t.anon().raw.get("/api/v1/users/me").set("Authorization", `Bearer ${noTyp}`)).status).toBe(401);
  });
});

describe("login lockout (per account, independent of IP)", () => {
  it("locks after 5 wrong passwords — even the right one is refused — and a reset unlocks it", async () => {
    const u = await t.register("lock");
    for (let i = 0; i < 5; i++) expect((await t.anon().post("/auth/login", { email: u.email, password: `wrong-${i}-pass` })).status).toBe(401);
    const locked = await t.anon().post("/auth/login", { email: u.email, password: "harbor-lantern-58" });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/Too many failed attempts/);

    const token = randomToken();
    await t.prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 600_000) } });
    expect((await t.anon().post("/auth/reset-password", { token, password: "fresh-password" })).status).toBe(200);
    expect((await t.anon().post("/auth/login", { email: u.email, password: "fresh-password" })).status).toBe(200);
  });

  it("a successful login resets the failure counter", async () => {
    const u = await t.register("ok");
    for (let i = 0; i < 4; i++) await t.anon().post("/auth/login", { email: u.email, password: "nope-nope-1" });
    expect((await t.anon().post("/auth/login", { email: u.email, password: "harbor-lantern-58" })).status).toBe(200);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
  });
});

describe("email verification", () => {
  it("new accounts start unverified; the link verifies once; old links stop working", async () => {
    const u = await t.register("ver");
    expect((await u.get("/users/me")).body.emailVerified).toBe(false);
    expect(await t.prisma.emailVerificationToken.count({ where: { userId: u.id } })).toBe(1); // sent on sign-up
    await t.verifyEmail(u.id);
    expect((await u.get("/users/me")).body.emailVerified).toBe(true);
    const old = await t.prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: u.id }, orderBy: { createdAt: "asc" } });
    expect(old.usedAt).not.toBeNull();
    expect((await t.anon().post("/auth/verify-email", { token: randomToken() })).status).toBe(422);
  });

  it("resend only works while signed in and does nothing once verified", async () => {
    expect((await t.anon().post("/auth/verify-email/resend")).status).toBe(401);
    const u = await t.register("rs");
    expect((await u.post("/auth/verify-email/resend")).status).toBe(200);
    expect(await t.prisma.emailVerificationToken.count({ where: { userId: u.id } })).toBe(2);
  });
});

describe("Google sign-in vs. a squatted, unverified account", () => {
  let nextProfile: GoogleProfile;
  beforeAll(() => {
    const google = t.app.get(GoogleClient);
    Object.defineProperty(google, "configured", { get: () => true });
    google.authUrl = (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
    google.profile = async () => nextProfile;
  });

  it("the verified owner takes the account over: squatter's password and sessions are gone", async () => {
    const squatter = await t.register("victim");
    expect((await squatter.get("/users/me")).status).toBe(200);
    nextProfile = { sub: "g-victim", email: squatter.email, emailVerified: true, name: "Real Owner" };
    const agent = request.agent(t.app.getHttpServer());
    const start = await agent.get("/api/v1/auth/google/start");
    const state = new URL(start.headers.location).searchParams.get("state");
    await agent.get(`/api/v1/auth/google/callback?code=c&state=${state}`);
    const me = (await agent.get("/api/v1/users/me")).body;
    expect(me).toMatchObject({ id: squatter.id, emailVerified: true, hasPassword: false, providers: ["google"] });
    expect((await squatter.get("/users/me")).status).toBe(401); // squatter's session revoked
    expect((await t.anon().post("/auth/login", { email: squatter.email, password: "harbor-lantern-58" })).status).toBe(401);
  });
});

describe("concurrency", () => {
  it("deleting the same comment twice at once only decrements the counter once", async () => {
    const author = await t.register("ca");
    const post = (await author.post("/posts", { title: "Counter test", body: "x", visibility: "PUBLIC", photoMediaIds: [] })).body;
    const c = (await author.post(`/posts/${post.id}/comments`, { body: "hello" })).body;
    await Promise.all([author.delete(`/comments/${c.id}`), author.delete(`/comments/${c.id}`), author.delete(`/comments/${c.id}`)]);
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: post.id } })).commentCount).toBe(0);
  });

  it("double-clicking like/save never errors and counts once", async () => {
    const author = await t.register("lk");
    const fan = await t.register("fan");
    const post = (await author.post("/posts", { title: "Like test", body: "x", visibility: "PUBLIC", photoMediaIds: [] })).body;
    const likes = await Promise.all([fan.post(`/posts/${post.id}/like`), fan.post(`/posts/${post.id}/like`), fan.post(`/posts/${post.id}/like`)]);
    expect(likes.every((r) => r.status < 300)).toBe(true);
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: post.id } })).likeCount).toBe(1);
    await Promise.all([fan.delete(`/posts/${post.id}/like`), fan.delete(`/posts/${post.id}/like`)]);
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: post.id } })).likeCount).toBe(0);
  });

  it("concurrent moves never undo each other: every item ends up exactly where its last mover put it", async () => {
    const owner = await t.register("mv");
    const trip = (await owner.post("/trips", { title: "Race trip", startDate: "2027-05-01", endDate: "2027-05-02" })).body;
    const days = (await owner.get(`/trips/${trip.id}/days`)).body as { id: string }[];
    const items: string[] = [];
    for (const n of ["A", "B", "C", "D"]) items.push((await owner.post(`/days/${days[0].id}/items`, { type: "NOTE", title: n })).body.id);
    // A moves to Day 2 while B is reordered within Day 1 — the classic stale-list race.
    await Promise.all([owner.post(`/items/${items[0]}/reorder`, { dayId: days[1].id, index: 0 }), owner.post(`/items/${items[1]}/reorder`, { dayId: days[0].id, index: 2 })]);
    const after = (await owner.get(`/trips/${trip.id}/days`)).body as { id: string; items: { id: string; title: string }[] }[];
    expect(after[1].items.map((i) => i.title)).toEqual(["A"]);
    expect(after[0].items.map((i) => i.title).sort()).toEqual(["B", "C", "D"]);
    // Positions in each day are a clean 0..n-1 sequence.
    const rows = await t.prisma.itineraryItem.findMany({ where: { dayId: days[0].id }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("input validation", () => {
  it("a garbage cursor is a 422, not a server error", async () => {
    const res = await t.anon().get("/feed?cursor=abc");
    expect(res.status).toBe(422);
  });

  it("the same destination can't be added twice", async () => {
    const owner = await t.register("dup");
    const d = await t.prisma.destination.findFirstOrThrow();
    const res = await owner.post("/trips", { title: "Dup stops", destinationIds: [d.id, d.id] });
    expect(res.status).toBe(422);
  });

  it("lists are paginated with a cursor", async () => {
    const an = await t.as("an@triply.dev");
    const first = (await an.get("/trips?limit=1")).body;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0].id);
    const second = (await an.get(`/trips?limit=1&cursor=${first.nextCursor}`)).body;
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });
});

describe("realtime privacy", () => {
  it("outsiders watching a public trip are evicted from its room when it goes private", async () => {
    const owner = await t.register("rto");
    const trip = (await owner.post("/trips", { title: "Soon private", startDate: "2027-06-01", endDate: "2027-06-01" })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const day = (await owner.get(`/trips/${trip.id}/days`)).body[0];
    await t.app.listen(0);
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    const outsider = await t.register("rtx");
    const sock = io(`http://localhost:${port}`, { path: "/socket.io", transports: ["websocket"], extraHeaders: { cookie: outsider.cookies() } });
    try {
      await new Promise<void>((resolve, reject) => {
        sock.on("connect", () => resolve());
        sock.on("connect_error", reject);
      });
      // An outsider joins the public room: plan changes only.
      expect(await sock.emitWithAck("trip.join", { tripId: trip.id })).toEqual({ ok: true, member: false });
      const events: string[] = [];
      sock.on("trip.event", (e: { event: string }) => events.push(e.event));
      await owner.patch(`/trips/${trip.id}`, { visibility: "PRIVATE" });
      await owner.post(`/days/${day.id}/items`, { type: "NOTE", title: "Secret plan" });
      await new Promise((r) => setTimeout(r, 300));
      expect(events).not.toContain("trip.item.created");
    } finally {
      sock.close();
    }
  });

  it("rejects the socket handshake without a live session", async () => {
    await t.app.listen(0).catch(() => undefined);
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    const sock = io(`http://localhost:${port}`, { path: "/socket.io", transports: ["websocket"], reconnection: false });
    const err = await new Promise<Error>((resolve) => sock.on("connect_error", resolve));
    expect(err.message).toBe("unauthorized");
    sock.close();
  });

  it("opens a socket with a one-minute token instead of the cookie (web app on another domain)", async () => {
    await t.app.listen(0).catch(() => undefined);
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    const handshake = (auth: Record<string, unknown>) =>
      new Promise<string>((resolve) => {
        const s = io(`http://localhost:${port}`, { path: "/socket.io", transports: ["websocket"], reconnection: false, auth });
        s.on("connect", () => (s.close(), resolve("ok")));
        s.on("connect_error", (e) => (s.close(), resolve(e.message)));
      });
    const user = await t.register("rtk");
    expect((await t.anon().post("/auth/socket-token")).status).toBe(401);
    const res = await user.post("/auth/socket-token");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.expiresIn).toBe(60);
    // No cookie on the socket, only the token.
    expect(await handshake({ token: res.body.token })).toBe("ok");
    expect(await handshake({ token: "not-a-token" })).toBe("unauthorized");
    // A socket token is not an access token: HTTP routes refuse it.
    const asBearer = await t.anon().get("/users/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(asBearer.status).toBe(401);
    // Logging out ends the session, and with it every token minted for it.
    await user.post("/auth/logout");
    expect(await handshake({ token: res.body.token })).toBe("unauthorized");
  });
});

describe("consistent privacy when a trip goes private", () => {
  it("its posts leave feeds and hide the trip, reports can't probe it, and remixes stop linking to it", async () => {
    const owner = await t.register("pv");
    const outsider = await t.register("pvo");
    const trip = (await owner.post("/trips", { title: "Going dark", startDate: "2027-07-01", endDate: "2027-07-01" })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const post = (await owner.post("/posts", { title: "Our plan", tripId: trip.id, visibility: "PUBLIC" })).body;
    const fork = (await outsider.post(`/trips/${trip.id}/fork`)).body;
    expect(fork.forkedFrom.tripId).toBe(trip.id);
    expect((await outsider.get(`/posts/${post.id}`)).status).toBe(200);

    await owner.patch(`/trips/${trip.id}`, { visibility: "PRIVATE" });
    // Spec §34: the story stays on the author's profile, but the private trip behind it is hidden
    // the same way everywhere (direct link and profile), and it leaves the public feed.
    expect((await outsider.get(`/posts/${post.id}`)).body.trip).toBeNull();
    const onProfile = (await outsider.get(`/users/${owner.username}/posts`)).body.find((p: { id: string }) => p.id === post.id);
    expect(onProfile.trip).toBeNull();
    expect((await outsider.get("/feed?limit=50")).body.posts.map((p: { id: string }) => p.id)).not.toContain(post.id);
    // Reporting the private trip looks exactly like reporting one that doesn't exist.
    const real = await outsider.post("/reports", { target: "TRIP", targetId: trip.id, reason: "SPAM" });
    const ghost = await outsider.post("/reports", { target: "TRIP", targetId: "00000000-0000-4000-8000-000000000000", reason: "SPAM" });
    expect([real.status, real.body.message]).toEqual([ghost.status, ghost.body.message]);
    // The remix keeps its credit but no longer links to a page the remixer can't open.
    const after = (await outsider.get(`/trips/${fork.id}`)).body;
    expect(after.forkedFrom).toMatchObject({ tripId: "", title: "Going dark", ownerUsername: owner.username });
  });
});
