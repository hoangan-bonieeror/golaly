/** Admin analytics (phase 1): live aggregates, admin-only, with an audit trail. */
import type { AnalyticsOverview } from "@triply/shared";
import { AnalyticsService } from "../src/modules/admin/analytics";
import { createTestContext, type Agent, type TestContext } from "./helpers";

let t: TestContext;
let an: Agent;
beforeAll(async () => {
  t = await createTestContext();
  an = await t.as("an@triply.dev"); // ADMIN in the demo seed
});
afterAll(() => t.app.close());

const overview = async (days = 30) => {
  t.app.get(AnalyticsService).clearCache();
  const res = await an.get(`/admin/analytics/overview?days=${days}`);
  expect(res.status).toBe(200);
  return res.body as AnalyticsOverview;
};
const kpi = (o: AnalyticsOverview, key: string) => o.kpis.find((k) => k.key === key)!;
const step = (o: AnalyticsOverview, s: string) => o.funnel.find((f) => f.step === s)!.users;

describe("admin analytics", () => {
  it("is for admins only and validates the range", async () => {
    expect((await t.anon().get("/admin/analytics/overview")).status).toBe(401);
    const minh = await t.as("minh@triply.dev");
    expect((await minh.get("/admin/analytics/overview")).status).toBe(403);
    expect((await an.get("/admin/analytics/overview?days=12")).status).toBe(422);
  });

  it("counts sign-ups, trips, collaboration and the funnel; one value per day; logs who looked", async () => {
    const before = await overview(7);
    expect(before.range.days).toBe(7);
    expect(before.daily).toHaveLength(7);
    expect(kpi(before, "newUsers").series).toHaveLength(7);
    expect(before.range.to).toBe(new Date().toISOString().slice(0, 10));

    // Two new people plan a trip together.
    const owner = await t.register("anl1", { verified: true });
    const friend = await t.register("anl2", { verified: true });
    const trip = (await owner.post("/trips", { title: "Analytics trip", startDate: "2027-05-01", endDate: "2027-05-02" })).body;
    const day = (await owner.get(`/trips/${trip.id}/days`)).body[0];
    await owner.post(`/days/${day.id}/items`, { type: "NOTE", title: "Plan" });
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "EDITOR" })).body;
    expect((await friend.post(`/invitations/${inv.token}/accept`)).status).toBe(200);

    const after = await overview(7);
    expect(kpi(after, "newUsers").value).toBe(kpi(before, "newUsers").value + 2);
    expect(kpi(after, "tripsCreated").value).toBe(kpi(before, "tripsCreated").value + 1);
    expect(kpi(after, "activeUsers").value).toBeGreaterThanOrEqual(kpi(before, "activeUsers").value + 2);
    expect(after.daily.at(-1)!.signups).toBe(before.daily.at(-1)!.signups + 2);
    expect(step(after, "registered")).toBe(step(before, "registered") + 2);
    expect(step(after, "createdTrip")).toBe(step(before, "createdTrip") + 1);
    expect(step(after, "plannedStop")).toBe(step(before, "plannedStop") + 1);
    expect(step(after, "collaborated")).toBe(step(before, "collaborated") + 2);
    expect(kpi(after, "collabRate").value).toBeGreaterThan(0);
    expect(after.catalog.places).toBeGreaterThan(0);

    // Aggregates only: no e-mails or usernames anywhere in the payload.
    const raw = JSON.stringify(after);
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("anl1");

    const me = (await an.get("/users/me")).body;
    expect(await t.prisma.auditLog.count({ where: { action: "admin.analytics.viewed", actorId: me.id } })).toBeGreaterThanOrEqual(2);
  });
});
