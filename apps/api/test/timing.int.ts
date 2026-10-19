/** Per-request timing (common/timing.ts): Server-Timing header, kept off auth routes, and the admin summary. */
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const parse = (h: string | undefined) => {
  const m = /app;dur=([\d.]+), db;dur=([\d.]+);desc="(\d+) queries"/.exec(h ?? "");
  return m ? { app: Number(m[1]), db: Number(m[2]), queries: Number(m[3]) } : null;
};

describe("request timing", () => {
  it("reports total time, database time and query count", async () => {
    const res = await t.anon().get("/destinations");
    const timing = parse(res.headers["server-timing"]);
    expect(timing).not.toBeNull();
    expect(timing!.queries).toBeGreaterThan(0);
    expect(timing!.db).toBeLessThanOrEqual(timing!.app + 1); // wall-clock busy time, never a sum of parallel queries
    expect(res.headers["timing-allow-origin"]).toBe(process.env.WEB_ORIGIN ?? "http://localhost:3000");
  });

  it("stays off auth routes (query counts there could tell whether an account exists)", async () => {
    const res = await t.anon().post("/auth/login", { email: "nobody@example.com", password: "whatever-123" });
    expect(res.status).toBe(401);
    expect(res.headers["server-timing"]).toBeUndefined();
  });

  it("admins see recent timings per route pattern — no ids or search terms", async () => {
    await t.anon().get("/search?q=secret-term");
    const user = await t.register("timing");
    expect((await user.get("/admin/diagnostics/timings")).status).toBe(403);
    const an = await t.as("an@golaly.dev");
    const body = (await an.get("/admin/diagnostics/timings")).body as { routes: { route: string; count: number; p95: number }[] };
    const routes = body.routes.map((r) => r.route);
    expect(routes).toContain("GET /api/v1/destinations");
    expect(routes).toContain("GET /api/v1/search");
    expect(JSON.stringify(body)).not.toContain("secret-term");
  });
});
