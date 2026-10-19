/**
 * Regression tests for the 2026-10 security review (claude/triply-security-review.md). Each one reproduces the
 * problem as it was, so a regression fails here. S1 (open redirect) is covered by safe-next.spec.ts.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import type { ExpensesView, TripDetail } from "@triply/shared";
import { io, type Socket } from "socket.io-client";
import { env } from "../src/config/env";
import { BreachedPasswords } from "../src/modules/auth/breached";
import { MediaService } from "../src/modules/media/media";
import { createTestContext, type Agent, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const idOf = async (a: Agent) => (await a.get("/users/me")).body.id as string;

async function joinWithLink(owner: Agent, tripId: string, who: Agent, role: "EDITOR" | "VIEWER" = "EDITOR") {
  const inv = (await owner.post(`/trips/${tripId}/invitations`, { role })).body;
  expect((await who.post(`/invitations/${inv.token}/accept`)).status).toBe(200);
  return inv.token as string;
}

describe("S4 · a removed member can't walk back in", () => {
  it("removing someone cancels the trip's open invite links and their pending e-mail invitation", async () => {
    const owner = await t.register("s4o", { verified: true });
    const x = await t.register("s4x", { verified: true });
    const other = await t.register("s4y", { verified: true });
    const trip = (await owner.post("/trips", { title: "S4" })).body;
    const token = await joinWithLink(owner, trip.id, x);
    const xId = await idOf(x);
    const xEmail = (await x.get("/users/me")).body.email as string;
    const emailInv = await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER", email: xEmail });

    const res = await owner.delete(`/trips/${trip.id}/members/${xId}`);
    expect(res.status).toBe(200);
    expect(res.body.invitationsRevoked).toBeGreaterThanOrEqual(emailInv.status === 201 ? 2 : 1);

    // The old link no longer works — for them or anyone else.
    const back = await x.post(`/invitations/${token}/accept`);
    expect(back.status).toBe(422);
    expect((await other.post(`/invitations/${token}/accept`)).status).toBe(422);
    expect((await x.get(`/trips/${trip.id}`)).status).toBe(403);

    // A new link works for someone new.
    await joinWithLink(owner, trip.id, other, "VIEWER");
  });

  it("leaving by yourself keeps the group's links", async () => {
    const owner = await t.register("s4l", { verified: true });
    const x = await t.register("s4m", { verified: true });
    const trip = (await owner.post("/trips", { title: "S4 leave" })).body;
    const token = await joinWithLink(owner, trip.id, x);
    const res = await x.delete(`/trips/${trip.id}/members/${await idOf(x)}`);
    expect(res.body.invitationsRevoked).toBe(0);
    expect((await x.post(`/invitations/${token}/accept`)).status).toBe(200);
  });
});

describe("S5 · outsiders see a public plan, not the people on it", () => {
  it("hides who added, edited, voted, is going or uploaded — except the (public) owner", async () => {
    const owner = await t.register("s5o", { verified: true });
    const editor = await t.register("s5e", { verified: true });
    const trip = (await owner.post("/trips", { title: "S5", startDate: "2027-07-01", endDate: "2027-07-01" })).body;
    await joinWithLink(owner, trip.id, editor);
    const editorId = await idOf(editor);
    const ownerId = await idOf(owner);
    const day = (await owner.get(`/trips/${trip.id}/days`)).body[0];
    const byEditor = (await editor.post(`/days/${day.id}/items`, { type: "NOTE", title: "Editor's stop" })).body;
    const byOwner = (await owner.post(`/days/${day.id}/items`, { type: "NOTE", title: "Owner's stop" })).body;
    await editor.put(`/items/${byEditor.id}/vote`, { level: "LOVE" });
    await owner.put(`/items/${byEditor.id}/vote`, { level: "OK" });
    await owner.put(`/items/${byEditor.id}/assignees`, { userIds: [editorId] });
    expect((await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" })).status).toBe(200);

    const check = async (who: Agent) => {
      const detail = (await who.get(`/trips/${trip.id}`)).body as TripDetail;
      const days = (await who.get(`/trips/${trip.id}/days`)).body as TripDetail["days"];
      for (const d of [detail.days, days]) {
        const e = d[0].items.find((i) => i.id === byEditor.id)!;
        const o = d[0].items.find((i) => i.id === byOwner.id)!;
        expect(e.addedBy).toBeNull();
        expect(e.assignees).toEqual([]);
        expect(e.votes).toHaveLength(2); // how much the group wants it stays visible…
        expect(e.votes.map((v) => v.userId)).not.toContain(editorId); // …but not who
        expect(e.votes.map((v) => v.userId)).toContain(ownerId);
        expect(o.addedBy?.id).toBe(ownerId);
      }
      expect(JSON.stringify(detail)).not.toContain(editorId);
    };
    await check(t.anon());
    await check(await t.register("s5x", { verified: true }));

    // Members still see everyone.
    const mine = (await editor.get(`/trips/${trip.id}`)).body as TripDetail;
    const e = mine.days[0].items.find((i) => i.id === byEditor.id)!;
    expect(e.addedBy?.id).toBe(editorId);
    expect(e.assignees).toEqual([editorId]);
  });
});

describe("S10 · only the people in a repayment (or the owner) record it", () => {
  it("refuses a third member, allows payer, payee and owner", async () => {
    const owner = await t.register("s10o", { verified: true });
    const a = await t.register("s10a", { verified: true });
    const b = await t.register("s10b", { verified: true });
    const viewer = await t.register("s10v", { verified: true });
    const trip = (await owner.post("/trips", { title: "S10" })).body;
    await joinWithLink(owner, trip.id, a);
    await joinWithLink(owner, trip.id, b);
    await joinWithLink(owner, trip.id, viewer, "VIEWER");
    const [aId, bId] = [await idOf(a), await idOf(b)];
    const body = { fromId: aId, toId: bId, amount: 10_000 };

    const refused = await viewer.post(`/trips/${trip.id}/settlements`, body).set({ "X-Golaly-Locale": "vi" });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe("Chỉ người trả, người nhận hoặc chủ chuyến đi mới ghi được khoản trả lại.");
    expect((await a.post(`/trips/${trip.id}/settlements`, body)).status).toBe(201);
    expect((await b.post(`/trips/${trip.id}/settlements`, body)).status).toBe(201);
    const v = (await owner.post(`/trips/${trip.id}/settlements`, body)).body as ExpensesView;
    expect(v.settlements).toHaveLength(3);
  });
});

// ── Realtime ──────────────────────────────────────────────────────────────────────────────────────────────
async function socketFor(cookie: string, origin?: string): Promise<Socket> {
  await t.app.listen(0).catch(() => undefined);
  const port = (t.app.getHttpServer().address() as AddressInfo).port;
  const s = io(`http://localhost:${port}`, { path: "/socket.io", transports: ["websocket"], reconnection: false, extraHeaders: { cookie, ...(origin ? { origin } : {}) } });
  await new Promise<void>((resolve, reject) => {
    s.on("connect", () => resolve());
    s.on("connect_error", reject);
  });
  return s;
}
const collect = (s: Socket, event: string) => {
  const got: unknown[] = [];
  s.on(event, (e: unknown) => got.push(e));
  return got;
};
const settle = () => new Promise((r) => setTimeout(r, 400));

describe("S11 · outsiders watching a public trip hear plan changes only", () => {
  it("no presence, no money, no member ids; members don't see the outsider either", async () => {
    const owner = await t.register("s11o", { verified: true });
    const outsider = await t.register("s11x", { verified: true });
    const trip = (await owner.post("/trips", { title: "S11", startDate: "2027-08-01", endDate: "2027-08-01" })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const ownerId = await idOf(owner);
    const outsiderId = await idOf(outsider);
    const day = (await owner.get(`/trips/${trip.id}/days`)).body[0];

    const o = await socketFor(owner.cookies());
    const x = await socketFor(outsider.cookies());
    try {
      expect(await o.emitWithAck("trip.join", { tripId: trip.id })).toEqual({ ok: true, member: true });
      const ownerPresence = collect(o, "trip.presence");
      expect(await x.emitWithAck("trip.join", { tripId: trip.id })).toEqual({ ok: true, member: false });
      const xEvents = collect(x, "trip.event") as { event: string; actorId: string }[];
      const xPresence = collect(x, "trip.presence");
      await o.emitWithAck("trip.activity", { tripId: trip.id, editingDay: 1 });
      await owner.post(`/days/${day.id}/items`, { type: "NOTE", title: "Seen by all" });
      const spent = await owner.post(`/trips/${trip.id}/expenses`, { description: "Taxi", amount: 50_000, paidById: ownerId, category: "TRANSPORT", split: { mode: "equal", userIds: [ownerId] } });
      expect(spent.status).toBe(201);
      await settle();

      expect(xEvents.map((e) => e.event)).toContain("trip.item.created");
      expect(xEvents.map((e) => e.event)).not.toContain("trip.expenses.updated");
      expect(xEvents.every((e) => e.actorId === "")).toBe(true);
      expect(xPresence).toEqual([]);
      expect(await x.emitWithAck("trip.activity", { tripId: trip.id, editingDay: 1 })).toEqual({ ok: false });
      expect(JSON.stringify(ownerPresence)).not.toContain(outsiderId);
    } finally {
      o.close();
      x.close();
    }
  });
});

describe("S12 · a socket can't flood the server", () => {
  it("refuses past the burst and drops a client far past it", async () => {
    const owner = await t.register("s12o", { verified: true });
    const trip = (await owner.post("/trips", { title: "S12" })).body;
    const s = await socketFor(owner.cookies());
    try {
      expect(await s.emitWithAck("trip.join", { tripId: trip.id })).toMatchObject({ ok: true });
      const acks = await Promise.all(Array.from({ length: 60 }, (_, i) => s.emitWithAck("trip.activity", { tripId: trip.id, editingDay: (i % 2) + 1 })));
      expect(acks.some((a) => (a as { error?: string }).error === "rate_limited")).toBe(true);
      const gone = new Promise<string>((resolve) => s.on("disconnect", (reason) => resolve(reason)));
      for (let i = 0; i < 200; i++) s.emit("trip.activity", { tripId: trip.id, editingDay: 1 });
      expect(await gone).toBe("io server disconnect");
    } finally {
      s.close();
    }
  });
});

describe("S13 · WebSocket handshakes from other sites are refused", () => {
  it("checks Origin on the upgrade", async () => {
    const owner = await t.register("s13o", { verified: true });
    await expect(socketFor(owner.cookies(), "https://evil.example")).rejects.toBeTruthy();
    const ok = await socketFor(owner.cookies(), env.WEB_ORIGIN);
    ok.close();
  });
});

describe("S14 · a signed-in session can't be used to guess the password", () => {
  it("wrong current passwords count like failed sign-ins; the lock signs that session out", async () => {
    const user = await t.register("s14a", { verified: true });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await user.post("/auth/password", { currentPassword: `wrong-${i}-password`, newPassword: "a-new-password-123" })).status);
    expect(statuses).toEqual([403, 403, 403, 403, 429]);
    expect((await user.get("/users/me")).status).toBe(401);
  });

  it("…and so do wrong passwords when deleting the account", async () => {
    const user = await t.register("s14b", { verified: true });
    const id = await idOf(user);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await user.delete("/users/me", { password: `wrong-${i}-password` })).status);
    expect(statuses).toEqual([403, 403, 403, 403, 429]);
    expect((await user.get("/users/me")).status).toBe(401);
    expect(await t.prisma.user.count({ where: { id, deletedAt: null } })).toBe(1); // not deleted
  });
});

describe("S9 · invitations can't be used to spam an inbox", () => {
  it("e-mail invites need a confirmed sender and stay within a daily limit per address", async () => {
    const unconfirmed = await t.register("s9u");
    const trip = (await unconfirmed.post("/trips", { title: "S9" })).body;
    expect((await unconfirmed.post(`/trips/${trip.id}/invitations`, { role: "VIEWER", email: "friend-s9@example.com" })).status).toBe(403);
    expect((await unconfirmed.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).status).toBe(201); // links still work

    const sender = await t.register("s9s", { verified: true });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const tr = (await sender.post("/trips", { title: `S9 ${i}` })).body;
      statuses.push((await sender.post(`/trips/${tr.id}/invitations`, { role: "VIEWER", email: "inbox-s9@example.com" })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});

describe("S3 · guessing someone's password doesn't lock them out", () => {
  const lockOut = async (email: string) => {
    for (let i = 0; i < 5; i++) expect((await t.anon().post("/auth/login", { email, password: `guess-${i}-guess` })).status).toBe(401);
  };

  it("sign-in hands the browser a known-device cookie, scoped to the auth routes", async () => {
    const u = await t.register("s3c");
    const res = await t.anon().post("/auth/login", { email: u.email, password: "harbor-lantern-58" });
    const dev = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("golaly_dev="));
    expect(dev).toMatch(/Path=\/api\/v1\/auth/);
    expect(dev).toMatch(/HttpOnly/);
  });

  it("a stranger's guesses lock strangers out; the owner's own browser still gets in", async () => {
    const owner = await t.register("s3o"); // signed up here, so this browser is known
    await lockOut(owner.email);
    expect((await t.anon().post("/auth/login", { email: owner.email, password: "harbor-lantern-58" })).status).toBe(429);
    expect((await owner.post("/auth/login", { email: owner.email, password: "harbor-lantern-58" })).status).toBe(200);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).failedLoginCount).toBe(0);
  });

  it("another account's device cookie doesn't count, and a known device is held back past the hard limit", async () => {
    const owner = await t.register("s3h");
    const other = await t.register("s3x");
    await lockOut(owner.email);
    expect((await other.post("/auth/login", { email: owner.email, password: "harbor-lantern-58" })).status).toBe(429);

    await t.prisma.user.update({ where: { id: owner.id }, data: { failedLoginCount: 20 } });
    expect((await owner.post("/auth/login", { email: owner.email, password: "harbor-lantern-58" })).status).toBe(429);
  });
});

describe("S15 · sign-in doesn't reveal whether an account exists", () => {
  it("an unknown address locks after the same number of guesses, with the same answers", async () => {
    const real = await t.register("s15r");
    const ghost = `nobody-${Date.now().toString(36)}@example.com`;
    const run = async (email: string) => {
      const out: [number, string][] = [];
      for (let i = 0; i < 6; i++) {
        const r = await t.anon().post("/auth/login", { email, password: `guess-${i}-guess` });
        out.push([r.status, String(r.body.message).replace(/\d+ minutes?/, "N minutes")]);
      }
      return out;
    };
    const a = await run(real.email);
    const b = await run(ghost);
    expect(a.map(([s]) => s)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(b).toEqual(a);
  });
});

// ─────────────────────────────────────────── Batch C ───────────────────────────────────────────

async function upload(a: Agent, color = "#2f6f5e") {
  const img = await sharp({ create: { width: 320, height: 240, channels: 3, background: color } }).jpeg().toBuffer();
  const res = await a.raw.post("/api/v1/media").set("X-Requested-With", "golaly").attach("file", img, { filename: "p.jpg", contentType: "image/jpeg" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const fileOf = (key: string) => path.resolve(env.MEDIA_DIR, key);
const mediaFiles = async (id: string) => {
  const m = await t.prisma.media.findUniqueOrThrow({ where: { id } });
  return [m.storageKey, m.mediumKey!, m.thumbKey!].map(fileOf);
};

describe("S17 · a removed photo stops being reachable", () => {
  it("taking a photo off a stop deletes the upload and its files", async () => {
    const owner = await t.register("s17o", { verified: true });
    const trip = (await owner.post("/trips", { title: "S17", startDate: "2026-08-14", endDate: "2026-08-14" })).body;
    const day = ((await owner.get(`/trips/${trip.id}`)).body as TripDetail).days[0];
    const item = (await owner.post(`/days/${day.id}/items`, { type: "NOTE", title: "Lunch" })).body;
    const mediaId = await upload(owner);
    const files = await mediaFiles(mediaId);
    const photo = (await owner.post(`/items/${item.id}/photos`, { mediaId })).body.photos[0];
    expect(files.every(existsSync)).toBe(true);

    expect((await owner.delete(`/item-photos/${photo.id}`)).status).toBe(200);
    expect(await t.prisma.media.count({ where: { id: mediaId } })).toBe(0);
    expect(files.some(existsSync)).toBe(false);
  });

  it("the sweep removes old uploads nothing shows; avatars and fresh uploads stay", async () => {
    const u = await t.register("s17s");
    const [orphan, fresh, avatar] = [await upload(u, "#111111"), await upload(u, "#222222"), await upload(u, "#333333")];
    await t.prisma.userProfile.update({ where: { userId: u.id }, data: { avatarMediaId: avatar } });
    const old = new Date(Date.now() - 2 * 86_400_000);
    await t.prisma.media.updateMany({ where: { id: { in: [orphan, avatar] } }, data: { createdAt: old } });
    const orphanFiles = await mediaFiles(orphan);

    await t.app.get(MediaService).sweep();
    const left = (await t.prisma.media.findMany({ where: { ownerId: u.id }, select: { id: true } })).map((m) => m.id);
    expect(left.sort()).toEqual([fresh, avatar].sort());
    expect(orphanFiles.some(existsSync)).toBe(false);
  });

  it("deleting an account deletes its uploads", async () => {
    const u = await t.register("s17d");
    const id = await upload(u);
    const files = await mediaFiles(id);
    expect((await u.delete("/users/me", { password: "harbor-lantern-58" })).status).toBe(200);
    expect(await t.prisma.media.count({ where: { ownerId: u.id } })).toBe(0);
    expect(files.some(existsSync)).toBe(false);
  });
});

describe("S19 · daily limits on what others see", () => {
  it("an unconfirmed account posts a few times a day; confirming raises the limit", async () => {
    const u = await t.register("s19p");
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await u.post("/posts", { title: `Post ${i}`, body: "hi" })).status);
    expect(statuses).toEqual([201, 201, 201, 429]);
    await t.verifyEmail(u.id);
    expect((await u.post("/posts", { title: "Post 4", body: "hi" })).status).toBe(201);
  });
});

describe("S20 · passwords attackers try first are refused", () => {
  it("common, repetitive and name-based passwords", async () => {
    const reg = (password: string, n: string) => t.anon().post("/auth/register", { email: `${n}@example.com`, username: n, password });
    const named = `s20e${Date.now().toString(36)}`;
    for (const [pw, n] of [["password123", "s20a"], ["12345678", "s20b"], ["aaaaaaaa", "s20c"], ["qwertyuiop", "s20d"], [`${named}-rocks`, named]]) {
      const res = await reg(pw, n === named ? n : `${n}${Date.now().toString(36)}`);
      expect(res.status).toBe(422);
      expect(res.body.fields.password).toBeTruthy();
    }
  });

  it("breached passwords (k-anonymity: only 5 hex characters leave the server); the check fails open", async () => {
    const breached = t.app.get(BreachedPasswords);
    const before = env.PASSWORD_BREACH_CHECK;
    const original = breached.fetcher;
    const asked: string[] = [];
    // SHA-1("harbor-lantern-58") — reply as if it had been seen 42 times, among padding rows.
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha1").update("harbor-lantern-58").digest("hex").toUpperCase();
    const u = await t.register("s20h");
    (env as { PASSWORD_BREACH_CHECK: string }).PASSWORD_BREACH_CHECK = "on";
    try {
      breached.fetcher = (async (url: string) => {
        asked.push(String(url));
        return new Response(`0000000000000000000000000000000000A:0\r\n${sha.slice(5)}:42\r\n`);
      }) as typeof fetch;
      const res = await u.post("/auth/password", { currentPassword: "harbor-lantern-58", newPassword: "harbor-lantern-58" });
      expect(res.status).toBe(422);
      expect(res.body.fields.newPassword).toMatch(/data breach/);
      expect(asked.at(-1)).toBe(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`);

      breached.fetcher = (async () => {
        throw new Error("offline");
      }) as typeof fetch;
      expect((await u.post("/auth/password", { currentPassword: "harbor-lantern-58", newPassword: "quiet-meadow-7310" })).status).toBe(200);
    } finally {
      breached.fetcher = original;
      (env as { PASSWORD_BREACH_CHECK: string }).PASSWORD_BREACH_CHECK = before;
    }
  });
});

describe("S23 · a remix doesn't hand out a link-only original", () => {
  it("credit stays, the link and the original group's results go once the source isn't public", async () => {
    const owner = await t.register("s23o", { verified: true });
    const fan = await t.register("s23f", { verified: true });
    const trip = (await owner.post("/trips", { title: "S23 original" })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC", allowFork: true });
    const fork = (await fan.post(`/trips/${trip.id}/fork`)).body;
    expect((await fan.get(`/trips/${fork.id}`)).body.forkedFrom.tripId).toBe(trip.id);

    await owner.patch(`/trips/${trip.id}`, { visibility: "LINK_ONLY" });
    const after = (await fan.get(`/trips/${fork.id}`)).body;
    expect(after.forkedFrom).toMatchObject({ tripId: "", title: "S23 original" });
  });
});
