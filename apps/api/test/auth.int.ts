import { randomToken, sha256 } from "../src/common/crypto";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

describe("auth", () => {
  it("registers, sets HTTP-only cookies and returns the profile", async () => {
    const agent = t.anon();
    const res = await agent.post("/auth/register", { email: "New.Person@Example.com", username: "new.person", password: "harbor-lantern-58" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "new.person@example.com", username: "new.person", onboarded: false });
    expect(res.body.passwordHash).toBeUndefined();
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("triply_at=") && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith("triply_rt=") && /Path=\/api\/v1\/auth/.test(c))).toBe(true);
    expect((await agent.get("/users/me")).body.username).toBe("new.person");
  });

  it("sets a readable session hint with the session, and clears it on logout", async () => {
    const u = await t.register("hint");
    const login = await t.anon().post("/auth/login", { email: u.email, password: "harbor-lantern-58" });
    const hint = (login.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("triply_si="));
    expect(hint).toMatch(/^triply_si=1;/);
    expect(hint).toMatch(/Path=\//);
    expect(hint).not.toMatch(/HttpOnly/i); // the web app reads it to skip "who am I?" for visitors
    const out = await u.post("/auth/logout");
    expect((out.headers["set-cookie"] as unknown as string[]).some((c) => c.startsWith("triply_si=;"))).toBe(true);
  });

  it("rejects duplicate usernames and invalid input with friendly 4xx errors", async () => {
    const dup = await t.anon().post("/auth/register", { email: "other@example.com", username: "an.nguyen", password: "harbor-lantern-58" });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe("That username is taken.");
    const bad = await t.anon().post("/auth/register", { email: "x", username: "!", password: "1" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.fields).sort()).toEqual(["email", "password", "username"]);
  });

  it("uses the same message for unknown email and wrong password", async () => {
    const a = await t.anon().post("/auth/login", { email: "nobody@example.com", password: "whatever1" });
    const b = await t.anon().post("/auth/login", { email: "an@triply.dev", password: "wrong-password" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it("requires login for protected routes", async () => {
    expect((await t.anon().get("/users/me")).status).toBe(401);
    expect((await t.anon().get("/trips")).status).toBe(401);
  });

  it("blocks state-changing requests without the CSRF header", async () => {
    const an = await t.as("an@triply.dev");
    const res = await an.raw.post("/api/v1/trips").send({ title: "No header" });
    expect(res.status).toBe(403);
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const agent = t.anon();
    await agent.post("/auth/login", { email: "linh@triply.dev", password: "demo1234" });
    const first = await agent.post("/auth/refresh");
    expect(first.status).toBe(200);
    const rotated = (first.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("triply_rt="))!.split(";")[0];
    expect((await agent.post("/auth/refresh")).status).toBe(200);
    // Replaying the just-rotated token right away is a benign multi-tab race: no new cookies, no logout.
    const race = await t.anon().raw.post("/api/v1/auth/refresh").set("X-Requested-With", "triply").set("Cookie", rotated);
    expect(race.status).toBe(200);
    expect(race.body).toEqual({ ok: true, raced: true });
    expect(race.headers["set-cookie"]).toBeUndefined();
    // Replaying it later means it was copied: rejected, and the whole session is revoked.
    await t.prisma.session.updateMany({ where: { prevTokenHash: sha256(rotated.slice("triply_rt=".length)) }, data: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await t.anon().raw.post("/api/v1/auth/refresh").set("X-Requested-With", "triply").set("Cookie", rotated);
    expect(replay.status).toBe(401);
    expect((await agent.post("/auth/refresh")).status).toBe(401);
    expect((await agent.get("/users/me")).status).toBe(401);
  });

  it("logout revokes the session", async () => {
    const agent = t.anon();
    const login = await agent.post("/auth/login", { email: "nam@triply.dev", password: "demo1234" });
    const rt = (login.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("triply_rt="))!.split(";")[0];
    expect((await agent.post("/auth/logout")).status).toBe(200);
    const after = await t.anon().raw.post("/api/v1/auth/refresh").set("X-Requested-With", "triply").set("Cookie", rt);
    expect(after.status).toBe(401);
  });

  it("forgot-password never reveals whether an account exists", async () => {
    const a = await t.anon().post("/auth/forgot-password", { email: "an@triply.dev" });
    const b = await t.anon().post("/auth/forgot-password", { email: "ghost@example.com" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  it("resets a password with a single-use token and logs out other sessions", async () => {
    const user = await t.register("reset");
    const token = randomToken();
    await t.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) } });
    expect((await t.anon().post("/auth/reset-password", { token, password: "brand-new-pass" })).status).toBe(200);
    expect((await t.anon().post("/auth/reset-password", { token, password: "again-new-pass" })).status).toBe(422);
    expect((await t.anon().post("/auth/login", { email: user.email, password: "brand-new-pass" })).status).toBe(200);
    expect((await user.post("/auth/refresh")).status).toBe(401);
  });

  it("deletes an account only with the right password", async () => {
    const user = await t.register("bye");
    expect((await user.delete("/users/me", { password: "nope" })).status).toBe(403);
    expect((await user.delete("/users/me", { password: "harbor-lantern-58" })).status).toBe(200);
    expect((await t.anon().post("/auth/login", { email: user.email, password: "harbor-lantern-58" })).status).toBe(401);
    expect((await t.anon().get(`/users/${user.username}`)).status).toBe(404);
  });
});
