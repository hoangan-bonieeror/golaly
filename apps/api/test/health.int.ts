/** Health endpoints: the plain one must not touch the database (host health checks would keep it awake). */
import request from "supertest";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

describe("health", () => {
  it("GET /health answers without a database query", async () => {
    const res = await request(t.app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["server-timing"]).toContain('desc="0 queries"');
  });

  it("GET /health/db checks the database", async () => {
    const res = await request(t.app.getHttpServer()).get("/health/db");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok" });
    expect(res.headers["server-timing"]).toContain('desc="1 queries"');
  });
});
