/** P1: fuzzy search, Google sign-in, profile improvements, responsive media. */
import sharp from "sharp";
import request from "supertest";
import { GoogleClient, type GoogleProfile } from "../src/modules/auth/google";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

describe("search (pg_trgm, accent-insensitive)", () => {
  const search = async (q: string, type = "all") => (await t.anon().get(`/search?q=${encodeURIComponent(q)}&type=${type}`)).body;

  it("ignores accents: 'hoi an' finds Hội An", async () => {
    const r = await search("hoi an");
    expect(r.destinations[0].name).toBe("Hội An");
    expect(r.trips.map((x: { title: string }) => x.title)).toContain("Vietnam — 10 Days, North to South");
  });

  it("tolerates typos: 'tokio' finds Tokyo, 'kyotto' finds Kyoto", async () => {
    expect((await search("tokio", "destinations")).destinations[0].name).toBe("Tokyo");
    expect((await search("kyotto", "destinations")).destinations[0].name).toBe("Kyoto");
  });

  it("matches places without macrons and ranks exact substrings first", async () => {
    const r = await search("senso", "places");
    expect(r.places[0].name).toBe("Sensō-ji");
  });

  it("finds people by name or home base", async () => {
    expect((await search("lisbon", "people")).people.map((p: { username: string }) => p.username)).toContain("sarahwanders");
  });

  it("never returns private trips, even on an exact title match", async () => {
    const japan = await t.prisma.trip.findFirstOrThrow({ where: { title: "Japan — 7 Days" } });
    const r = await search("Japan — 7 Days", "trips");
    expect(r.trips.map((x: { id: string }) => x.id)).not.toContain(japan.id);
  });

  it("requires every word to match (multi-word precision)", async () => {
    const titles = (await search("kyoto shrines", "trips")).trips.map((x: { title: string }) => x.title);
    expect(titles).toEqual(["Kyoto Slow Weekend"]);
  });

  it("indexes trips when they are created or renamed", async () => {
    const u = await t.register("idx");
    const trip = (await u.post("/trips", { title: "Zanzibar spice route" })).body;
    await u.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    expect((await search("zanzibar", "trips")).trips.map((x: { id: string }) => x.id)).toContain(trip.id);
    await u.patch(`/trips/${trip.id}`, { title: "Đà Lạt flower week" });
    expect((await search("da lat", "trips")).trips.map((x: { id: string }) => x.id)).toContain(trip.id);
    expect((await search("zanzibar", "trips")).trips.map((x: { id: string }) => x.id)).not.toContain(trip.id);
  });

  it("treats LIKE wildcards in queries literally", async () => {
    expect((await search("%", "places")).places).toHaveLength(0);
  });

  it("place search for the itinerary editor is fuzzy too", async () => {
    const r = (await t.anon().get("/places/search?q=fushimi%20inari")).body;
    expect(r[0].name).toBe("Fushimi Inari Taisha");
  });
});

describe("Google sign-in", () => {
  let google: GoogleClient;
  let nextProfile: GoogleProfile;
  const server = () => t.app.getHttpServer();

  beforeAll(() => {
    google = t.app.get(GoogleClient);
    Object.defineProperty(google, "configured", { get: () => true });
    google.authUrl = (state, challenge) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&code_challenge=${challenge}`;
    google.profile = async (code, verifier) => {
      if (code !== "good-code" || verifier.length < 43) throw new Error("bad exchange");
      return nextProfile;
    };
  });

  async function signIn(profile: GoogleProfile, opts: { tamperState?: boolean } = {}) {
    nextProfile = profile;
    const agent = request.agent(server());
    const start = await agent.get("/api/v1/auth/google/start?next=/explore");
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.location);
    expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = opts.tamperState ? "forged" : loc.searchParams.get("state");
    const cb = await agent.get(`/api/v1/auth/google/callback?code=good-code&state=${state}`);
    return { agent, cb };
  }

  it("advertises the provider", async () => {
    expect((await t.anon().get("/auth/providers")).body).toEqual({ google: true });
  });

  it("creates a new account (no password) and sends them to onboarding", async () => {
    const { agent, cb } = await signIn({ sub: "g-new-1", email: "Mai.Tran@gmail.com", emailVerified: true, name: "Mai Trần" });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe("http://localhost:3000/onboarding");
    expect((cb.headers["set-cookie"] as unknown as string[]).some((c) => c.startsWith("golaly_at="))).toBe(true);
    const me = (await agent.get("/api/v1/users/me")).body;
    expect(me).toMatchObject({ email: "mai.tran@gmail.com", displayName: "Mai Trần", hasPassword: false, providers: ["google"] });
    expect(me.username).toMatch(/^mai\.tran/);
    // Signing in again with the same Google account reuses it.
    const again = await signIn({ sub: "g-new-1", email: "mai.tran@gmail.com", emailVerified: true });
    expect((await again.agent.get("/api/v1/users/me")).body.id).toBe(me.id);
  });

  it("links Google to an existing account with the same verified email and honours ?next", async () => {
    const { agent, cb } = await signIn({ sub: "g-an", email: "an@golaly.dev", emailVerified: true, name: "An" });
    expect(cb.headers.location).toBe("http://localhost:3000/explore");
    const me = (await agent.get("/api/v1/users/me")).body;
    expect(me).toMatchObject({ username: "an.nguyen", hasPassword: true, providers: ["google"] });
  });

  it("rejects forged state, unverified emails and missing cookies", async () => {
    expect((await signIn({ sub: "x", email: "x@example.com", emailVerified: true }, { tamperState: true })).cb.headers.location).toBe("http://localhost:3000/login?error=google_state");
    expect((await signIn({ sub: "y", email: "y@example.com", emailVerified: false })).cb.headers.location).toBe("http://localhost:3000/login?error=google_unverified");
    const noCookie = await request(server()).get("/api/v1/auth/google/callback?code=good-code&state=abc");
    expect(noCookie.headers.location).toBe("http://localhost:3000/login?error=google_expired");
    expect(await t.prisma.user.count({ where: { email: { in: ["x@example.com", "y@example.com"] } } })).toBe(0);
  });

  it("lets a Google-only user set a password, then log in with it", async () => {
    const { agent } = await signIn({ sub: "g-pw", email: "pw.user@gmail.com", emailVerified: true });
    const set = await agent.post("/api/v1/auth/password").set("X-Requested-With", "golaly").send({ newPassword: "brand-new-pass" });
    expect(set.status).toBe(200);
    expect((await t.anon().post("/auth/login", { email: "pw.user@gmail.com", password: "brand-new-pass" })).status).toBe(200);
    // Changing it now requires the current password.
    const bad = await agent.post("/api/v1/auth/password").set("X-Requested-With", "golaly").send({ newPassword: "another-pass-1" });
    expect(bad.status).toBe(403);
  });

  it("Google-only accounts confirm deletion by typing their username", async () => {
    const { agent } = await signIn({ sub: "g-del", email: "del.me@gmail.com", emailVerified: true });
    const me = (await agent.get("/api/v1/users/me")).body;
    const del = (body: object) => agent.delete("/api/v1/users/me").set("X-Requested-With", "golaly").send(body);
    expect((await del({ username: "wrong" })).status).toBe(403);
    expect((await del({ username: me.username })).status).toBe(200);
    // The Google link is removed with the account, so signing in again starts a brand-new account.
    const again = await signIn({ sub: "g-del", email: "del.me@gmail.com", emailVerified: true });
    expect(again.cb.headers.location).toBe("http://localhost:3000/onboarding");
    expect((await again.agent.get("/api/v1/users/me")).body.id).not.toBe(me.id);
  });
});

describe("profiles", () => {
  it("shows follower lists, follows-you, interests and countries", async () => {
    const a = await t.register("pa");
    const b = await t.register("pb");
    await a.post(`/users/${b.username}/follow`);
    await b.post(`/users/${a.username}/follow`);
    const followers = (await a.get(`/users/${b.username}/followers`)).body;
    expect(followers).toEqual([expect.objectContaining({ username: a.username, isMe: true })]);
    const following = (await b.get(`/users/${b.username}/following`)).body;
    expect(following[0]).toMatchObject({ username: a.username, followedByMe: true });
    const prof = (await a.get(`/users/${b.username}`)).body;
    expect(prof).toMatchObject({ followedByMe: true, followsMe: true, isMe: false });

    const sarah = (await t.anon().get("/users/sarahwanders")).body;
    expect(sarah.countries).toBe(2); // Vietnam + Japan (public trips only)
    expect(sarah.user.interests).toEqual(expect.arrayContaining(["FOOD"]));
    expect(sarah.user.joinedAt).toBeTruthy();
  });
});

describe("media optimisation", () => {
  it("stores thumb / medium / full variants with a placeholder colour", async () => {
    const u = await t.register("img");
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const res = await u.raw.post("/api/v1/media").set("X-Requested-With", "golaly").attach("file", png, { filename: "red.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ width: 2000, height: 1000 });
    expect(res.body.url).toMatch(/_1280\.webp$/);
    expect(res.body.thumbUrl).toMatch(/_thumb\.webp$/);
    expect(res.body.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(res.body.color.slice(1, 3), 16)).toBeGreaterThan(0xe0); // red-ish
    const medium = await u.raw.get(res.body.url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect((await sharp(medium.body as Buffer).metadata()).width).toBe(1280);
  });
});
