/** The mobile app: token sign-in (password, Google, Apple), refresh rotation, sign-out, push devices. */
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import request from "supertest";
import type { AppSession } from "@golaly/shared";
import { env } from "../src/config/env";
import { AppleClient } from "../src/modules/auth/apple";
import { GoogleClient, type GoogleProfile } from "../src/modules/auth/google";
import { ExpoPushSender, type PushMessage, type PushTicket } from "../src/modules/push/push";
import { createTestContext, DEMO_PASSWORD, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const API = "/api/v1";
const server = () => t.app.getHttpServer();
/** A phone: no cookie jar — every call is a fresh request, with the CSRF header on writes like @golaly/client. */
const post = (url: string, body: object, token?: string) => {
  const r = request(server()).post(API + url).set("X-Requested-With", "golaly");
  return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body);
};
const get = (url: string, token?: string) => {
  const r = request(server()).get(API + url);
  return token ? r.set("Authorization", `Bearer ${token}`) : r;
};
const login = async (email: string, password = DEMO_PASSWORD) => {
  const res = await post("/auth/app/login", { email, password });
  expect(res.status).toBe(200);
  return res.body as AppSession;
};

describe("app sign-in with a password", () => {
  it("answers tokens in the body (no cookies) that work as Bearer tokens", async () => {
    const res = await post("/auth/app/login", { email: "minh@golaly.dev", password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const s = res.body as AppSession;
    expect(s).toMatchObject({ user: { username: expect.any(String), email: "minh@golaly.dev" }, isNew: false, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
    expect(s.refreshToken.length).toBeGreaterThan(20);
    expect((await get("/users/me", s.accessToken)).body.email).toBe("minh@golaly.dev");
    expect((await get("/users/me")).status).toBe(401);
  });

  it("registers a new account", async () => {
    const n = `app${Date.now().toString(36)}`;
    const res = await post("/auth/app/register", { email: `${n}@example.com`, username: n, password: "harbor-lantern-58" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ isNew: true, user: { username: n, emailVerified: false } });
  });

  it("gives the API's friendly errors", async () => {
    const res = await post("/auth/app/login", { email: "minh@golaly.dev", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("That email and password don't match.");
    expect((await request(server()).post(`${API}/auth/app/login`).send({ email: "minh@golaly.dev", password: DEMO_PASSWORD })).status).toBe(403); // no CSRF header
  });
});

describe("app refresh tokens", () => {
  it("rotate: each works once; a replay right away (lost answer) gets a fresh pair", async () => {
    const s = await login("sarah@golaly.dev");
    const r1 = await post("/auth/app/refresh", { refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    expect((await get("/users/me", r1.body.accessToken)).status).toBe(200);

    // The phone never got r1 (connection dropped) and retries with the old token: still signed in.
    const r2 = await post("/auth/app/refresh", { refreshToken: s.refreshToken });
    expect(r2.status).toBe(200);
    // The pair it never received is dead; the new one rotates on.
    expect((await post("/auth/app/refresh", { refreshToken: r1.body.refreshToken })).status).toBe(401);
    const r3 = await post("/auth/app/refresh", { refreshToken: r2.body.refreshToken });
    expect(r3.status).toBe(200);
    expect((await get("/users/me", r3.body.accessToken)).status).toBe(200);
  });

  it("a replay after the grace window is theft: the session ends", async () => {
    const s = await login("sarah@golaly.dev");
    const r1 = await post("/auth/app/refresh", { refreshToken: s.refreshToken });
    const sessionId = (await t.prisma.session.findFirstOrThrow({ where: { prevTokenHash: createHash("sha256").update(s.refreshToken).digest("hex") } })).id;
    await t.prisma.session.update({ where: { id: sessionId }, data: { rotatedAt: new Date(Date.now() - 120_000) } });
    expect((await post("/auth/app/refresh", { refreshToken: s.refreshToken })).status).toBe(401);
    expect((await post("/auth/app/refresh", { refreshToken: r1.body.refreshToken })).status).toBe(401);
    expect((await get("/users/me", r1.body.accessToken)).status).toBe(401);
  });

  it("sign-out ends the session", async () => {
    const s = await login("sarah@golaly.dev");
    expect((await post("/auth/app/logout", { refreshToken: s.refreshToken }, s.accessToken)).status).toBe(200);
    expect((await get("/users/me", s.accessToken)).status).toBe(401);
    expect((await post("/auth/app/refresh", { refreshToken: s.refreshToken })).status).toBe(401);
  });
});

describe("app sign-in with Google and Apple", () => {
  let nextGoogle: GoogleProfile;
  let apple: AppleClient;
  let appleKey: KeyObject;
  const KID = "test-kid";
  const AUD = "com.golaly.test";

  beforeAll(() => {
    const google = t.app.get(GoogleClient);
    google.appProfile = async (idToken) => {
      if (idToken !== "google-id-token-from-the-app") throw new Error("bad token");
      return nextGoogle;
    };
    env.APPLE_CLIENT_IDS.push(AUD);
    apple = t.app.get(AppleClient);
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    appleKey = pair.privateKey;
    // Apple's published keys, as if just fetched.
    Object.assign(apple, { keys: new Map([[KID, pair.publicKey]]), keysAt: Date.now() });
  });
  afterAll(() => env.APPLE_CLIENT_IDS.splice(env.APPLE_CLIENT_IDS.indexOf(AUD), 1));

  const nonce = "a-random-nonce-made-by-the-app";
  function appleToken(claims: Record<string, unknown>, key = appleKey) {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const body = {
      iss: "https://appleid.apple.com",
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: createHash("sha256").update(nonce).digest("hex"),
      email_verified: "true",
      ...claims,
    };
    const head = `${enc({ alg: "RS256", kid: KID })}.${enc(body)}`;
    return `${head}.${sign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
  }

  it("advertises the providers the app can show", async () => {
    expect((await get("/auth/app/providers")).body).toEqual({ google: expect.any(Boolean), apple: true });
  });

  it("Google: verifies the ID token, creates the account, then reuses it", async () => {
    nextGoogle = { sub: "g-app-1", email: "lan.pham@gmail.com", emailVerified: true, name: "Lan Phạm" };
    Object.defineProperty(t.app.get(GoogleClient), "appConfigured", { get: () => true });
    const first = await post("/auth/app/google", { idToken: "google-id-token-from-the-app" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ isNew: true, user: { email: "lan.pham@gmail.com", displayName: "Lan Phạm", providers: ["google"], hasPassword: false } });
    const again = await post("/auth/app/google", { idToken: "google-id-token-from-the-app" });
    expect(again.body).toMatchObject({ isNew: false, user: { id: first.body.user.id } });
    const bad = await post("/auth/app/google", { idToken: "something-else-entirely-forged" });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe("We couldn't sign you in with Google. Please try again.");
  });

  it("Apple: a signed identity token with our nonce signs in; Apple's name is used once", async () => {
    const res = await post("/auth/app/apple", { identityToken: appleToken({ sub: "apple-001", email: "x7k2@privaterelay.appleid.com", is_private_email: "true" }), nonce, name: "Bảo Ngọc" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isNew: true, user: { email: "x7k2@privaterelay.appleid.com", displayName: "Bảo Ngọc", providers: ["apple"], emailVerified: true } });
    // Later sign-ins: same account, even if the token carries no email.
    const again = await post("/auth/app/apple", { identityToken: appleToken({ sub: "apple-001", email: undefined }), nonce });
    expect(again.body).toMatchObject({ isNew: false, user: { id: res.body.user.id } });
  });

  it("Apple: links to an existing account with the same verified email", async () => {
    const existing = await t.register("applelink", { verified: true });
    const res = await post("/auth/app/apple", { identityToken: appleToken({ sub: "apple-link", email: existing.email }), nonce });
    expect(res.body.user).toMatchObject({ id: existing.id, hasPassword: true, providers: ["apple"] });
  });

  it("Apple: rejects forged, replayed and foreign tokens", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const cases = [
      appleToken({ sub: "apple-x", email: "x@example.com" }, other), // not signed by Apple
      appleToken({ sub: "apple-x", email: "x@example.com", nonce: "f".repeat(64) }), // another sign-in's token
      appleToken({ sub: "apple-x", email: "x@example.com", aud: "com.someone.else" }),
      appleToken({ sub: "apple-x", email: "x@example.com", exp: Math.floor(Date.now() / 1000) - 3600 }),
      appleToken({ sub: "apple-x", email: "x@example.com", iss: "https://evil.example" }),
    ];
    for (const identityToken of cases) {
      const res = await post("/auth/app/apple", { identityToken, nonce });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("We couldn't sign you in with Apple. Please try again.");
    }
    const unverified = await post("/auth/app/apple", { identityToken: appleToken({ sub: "apple-y", email: "y@example.com", email_verified: "false" }), nonce });
    expect(unverified.status).toBe(401);
    expect(await t.prisma.user.count({ where: { email: { in: ["x@example.com", "y@example.com"] } } })).toBe(0);
  });
});

describe("push notifications", () => {
  const sent: PushMessage[] = [];
  let answer: (m: PushMessage) => PushTicket = () => ({ status: "ok" });
  const token = (s: string) => `ExponentPushToken[${s.padEnd(22, "x")}]`;
  const flush = () => new Promise((r) => setTimeout(r, 300));

  beforeAll(() => {
    t.app.get(ExpoPushSender).send = async (messages) => {
      sent.push(...messages);
      return messages.map((m) => answer(m));
    };
    (env as { PUSH_DRIVER: string }).PUSH_DRIVER = "expo";
  });
  afterAll(() => ((env as { PUSH_DRIVER: string }).PUSH_DRIVER = "disabled"));
  beforeEach(() => (sent.length = 0));

  async function follow(follower: AppSession, username: string) {
    const r = await request(server()).post(`${API}/users/${username}/follow`).set("X-Requested-With", "golaly").set("Authorization", `Bearer ${follower.accessToken}`).send({});
    expect(r.status).toBeLessThan(300);
    await flush();
  }

  it("registers a phone and pushes new notifications to it, in the recipient's language", async () => {
    const author = await t.register("pushauthor");
    const phone = await login(author.email, "harbor-lantern-58");
    await t.prisma.userProfile.update({ where: { userId: author.id }, data: { locale: "vi" } });
    const put = await request(server()).put(`${API}/push/devices`).set("X-Requested-With", "golaly").set("Authorization", `Bearer ${phone.accessToken}`).send({ token: token("author1"), platform: "ios" });
    expect(put.body).toEqual({ ok: true, enabled: true });

    await follow(await login("minh@golaly.dev"), author.username);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: token("author1"), title: "Golaly", data: { notificationId: expect.any(String) } });
    expect(sent[0].body).toMatch(/đã bắt đầu theo dõi bạn$/);
  });

  it("stops after sign-out, and forgets uninstalled apps", async () => {
    const author = await t.register("pushauthor2");
    const phone = await login(author.email, "harbor-lantern-58");
    const tablet = await login(author.email, "harbor-lantern-58");
    for (const [s, tok] of [[phone, token("phone2")], [tablet, token("tablet2")]] as const)
      await request(server()).put(`${API}/push/devices`).set("X-Requested-With", "golaly").set("Authorization", `Bearer ${s.accessToken}`).send({ token: tok, platform: "android" });

    await post("/auth/app/logout", { refreshToken: tablet.refreshToken }, tablet.accessToken);
    expect(await t.prisma.pushDevice.count({ where: { token: token("tablet2") } })).toBe(0);

    answer = (m) => (m.to === token("phone2") ? { status: "error", error: "DeviceNotRegistered" } : { status: "ok" });
    await follow(await login("sarah@golaly.dev"), author.username);
    answer = () => ({ status: "ok" });
    expect(sent.map((m) => m.to)).toEqual([token("phone2")]);
    expect(await t.prisma.pushDevice.count({ where: { userId: author.id } })).toBe(0);
  });

  it("validates tokens and needs a signed-in user", async () => {
    const s = await login("minh@golaly.dev");
    const bad = await request(server()).put(`${API}/push/devices`).set("X-Requested-With", "golaly").set("Authorization", `Bearer ${s.accessToken}`).send({ token: "not-a-token", platform: "ios" });
    expect(bad.status).toBe(422);
    const anon = await request(server()).put(`${API}/push/devices`).set("X-Requested-With", "golaly").send({ token: token("anon"), platform: "ios" });
    expect(anon.status).toBe(401);
  });
});
