/** Visitors' public reads are cached briefly (common/public-cache.ts); signed-in views and writes are never stale. */
import { env } from "../src/config/env";
import { clearPublicCache } from "../src/common/public-cache";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
const setCache = (v: "on" | "off") => ((env as { PUBLIC_CACHE: string }).PUBLIC_CACHE = v);
beforeAll(async () => {
  t = await createTestContext();
  setCache("on");
});
afterAll(async () => {
  setCache("off");
  await t.app.close();
});
beforeEach(() => clearPublicCache());

describe("public cache", () => {
  it("serves a visitor's second read from memory, with the same body", async () => {
    const a = await t.anon().get("/destinations");
    const b = await t.anon().get("/destinations");
    expect(a.headers["x-cache"]).toBe("MISS");
    expect(b.headers["x-cache"]).toBe("HIT");
    expect(b.body).toEqual(a.body);
  });

  it("keys on the query and the languages", async () => {
    await t.anon().get("/search?q=hoi");
    expect((await t.anon().get("/search?q=hoi").set("X-Golaly-Locale", "vi")).headers["x-cache"]).toBe("MISS");
    expect((await t.anon().get("/search?q=hoi").set("Accept-Language", "und")).headers["x-cache"]).toBe("MISS");
    expect((await t.anon().get("/search?q=hue")).headers["x-cache"]).toBe("MISS");
    expect((await t.anon().get("/search?q=hoi")).headers["x-cache"]).toBe("HIT");
  });

  it("never caches for signed-in people, nor errors", async () => {
    const u = await t.register("pcache");
    await u.get("/explore");
    expect((await u.get("/explore")).headers["x-cache"]).toBeUndefined();
    const missing = "/destinations/no-such-place-anywhere";
    expect((await t.anon().get(missing)).status).toBe(404);
    expect((await t.anon().get(missing)).headers["x-cache"]).toBe("MISS");
  });

  it("a successful write empties it, so nobody sees an old copy after a change", async () => {
    const owner = await t.register("pcache2", { verified: true });
    const trip = (await owner.post("/trips", { title: "Cache me if you can zq" })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const before = await t.anon().get("/search?q=Cache me if you can zq");
    expect(before.body.trips.map((x: { id: string }) => x.id)).toContain(trip.id);
    expect((await t.anon().get("/search?q=Cache me if you can zq")).headers["x-cache"]).toBe("HIT");
    expect((await owner.patch(`/trips/${trip.id}`, { visibility: "PRIVATE" })).status).toBe(200);
    const after = await t.anon().get("/search?q=Cache me if you can zq");
    expect(after.headers["x-cache"]).toBe("MISS");
    expect(after.body.trips.map((x: { id: string }) => x.id)).not.toContain(trip.id);
  });
});
