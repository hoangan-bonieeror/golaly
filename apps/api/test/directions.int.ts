/** Directions proxy: login required, key stays server-side, ORS errors become friendly messages, answers cached. */
import { env } from "../src/config/env";
import { DirectionsService } from "../src/modules/directions/directions";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
let svc: DirectionsService;
const calls: { url: string; body: unknown; auth: string | null }[] = [];
let reply: () => Response;

beforeAll(async () => {
  t = await createTestContext();
  svc = t.app.get(DirectionsService);
  svc.fetchImpl = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    return reply();
  };
});
afterAll(() => t.app.close());
beforeEach(() => {
  calls.length = 0;
  (env as { ORS_API_KEY?: string }).ORS_API_KEY = "test-key";
});

const ok = () =>
  new Response(
    JSON.stringify({
      type: "FeatureCollection",
      features: [{ geometry: { type: "LineString", coordinates: [[139.70012345, 35.6595], [139.7012, 35.6601], [139.7036, 35.6614]] }, properties: { summary: { distance: 812.4, duration: 601.2 } } }],
    }),
    { status: 200, headers: { "Content-Type": "application/geo+json" } },
  );

describe("directions", () => {
  it("needs a signed-in user", async () => {
    expect((await t.anon().get("/directions?from=35.6595,139.7001&to=35.6614,139.7036")).status).toBe(401);
  });

  it("asks OpenRouteService for the mode's profile with [lng,lat] and returns a compact route; repeats come from the cache", async () => {
    reply = ok;
    const u = await t.register("dir");
    const r = await u.get("/directions?from=35.6595,139.7001&to=35.6614,139.7036&mode=walk");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: "walk", distanceM: 812, durationS: 601 });
    expect(r.body.geometry[0]).toEqual([139.70012, 35.6595]);
    expect(r.body.attribution).toMatch(/openrouteservice/);
    expect(calls[0].url).toMatch(/\/v2\/directions\/foot-walking\/geojson$/);
    expect(calls[0].body).toMatchObject({ coordinates: [[139.7001, 35.6595], [139.7036, 35.6614]] });
    expect(calls[0].auth).toBe("test-key");
    // Same trip ~5 m away: served from the cache.
    expect((await u.get("/directions?from=35.65952,139.70012&to=35.6614,139.7036&mode=walk")).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect((await u.get("/directions?from=35.6595,139.7001&to=35.6614,139.7036&mode=car")).status).toBe(200);
    expect(calls[1].url).toMatch(/driving-car/);
  });

  it("validates coordinates and modes", async () => {
    const u = await t.register("dirv");
    expect((await u.get("/directions?from=abc&to=35.6,139.7")).status).toBe(422);
    expect((await u.get("/directions?from=95,10&to=35.6,139.7")).status).toBe(422);
    expect((await u.get("/directions?from=35.6,139.7&to=35.7,139.8&mode=plane")).status).toBe(422);
  });

  it("turns OpenRouteService errors into friendly, translated messages", async () => {
    const u = await t.register("dire");
    reply = () => new Response(JSON.stringify({ error: { code: 2010, message: "Could not find routable point" } }), { status: 404 });
    const none = await u.get("/directions?from=10.1,106.1&to=10.2,106.2");
    expect(none.status).toBe(422);
    expect(none.body.message).toMatch(/No route found/);
    reply = () => new Response(JSON.stringify({ error: { code: 2004, message: "Request parameters exceed the server configuration limits" } }), { status: 400 });
    const far = await u.get("/directions?from=10.3,106.1&to=21.0,105.8&mode=walk").set("X-Golaly-Locale", "vi");
    expect(far.status).toBe(422);
    expect(far.body.message).toBe("Quãng đường quá xa cho cách di chuyển này. Hãy thử cách khác.");
    (env as { ORS_API_KEY?: string }).ORS_API_KEY = undefined;
    expect((await u.get("/directions?from=10.4,106.1&to=10.5,106.2")).status).toBe(503);
  });
});
