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

  it("measures use during the trip: opened by members while it's under way, once a day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const before = await overview(7);
    const owner = await t.register("otu1", { verified: true });
    const friend = await t.register("otu2", { verified: true });
    const outsider = await t.register("otu3", { verified: true });
    const trip = (await owner.post("/trips", { title: "Under way", startDate: today, endDate: today })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const later = (await owner.post("/trips", { title: "Next year", startDate: "2027-09-01", endDate: "2027-09-03" })).body;
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).body;
    await friend.post(`/invitations/${inv.token}/accept`);

    await owner.get(`/trips/${trip.id}`);
    await owner.get(`/trips/${trip.id}`); // same day: not counted twice
    await outsider.get(`/trips/${trip.id}`); // public, but not a member
    await owner.get(`/trips/${later.id}`); // not under way
    await new Promise((r) => setTimeout(r, 200));
    const opened = () => t.prisma.productEvent.findMany({ where: { type: "trip.opened_on_trip", tripId: { in: [trip.id, later.id] } } });
    expect(await opened()).toHaveLength(1);

    let o = await overview(7);
    expect(step(o, "usedOnTrip")).toBe(step(before, "usedOnTrip") + 1);
    expect(kpi(o, "onTripUse").value).toBeLessThan(100); // one traveler of two so far

    // The friend asks "where to now?" during the trip: two travelers used it.
    expect((await friend.get(`/trips/${trip.id}/next?date=${today}&time=10:00`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await opened()).toHaveLength(2);
    o = await overview(7);
    expect(step(o, "usedOnTrip")).toBe(step(before, "usedOnTrip") + 2);
    expect(kpi(o, "onTripUse").value).toBeGreaterThan(0);
    expect(kpi(o, "onTripUse").series).toBeNull();
  });

  it("records product events: facts only, after the change commits", async () => {
    const since = new Date();
    const owner = await t.register("pev1", { verified: true });
    const friend = await t.register("pev2", { verified: true });
    const ownerId = (await owner.get("/users/me")).body.id as string;
    const trip = (await owner.post("/trips", { title: "Events trip", startDate: "2027-06-01", endDate: "2027-06-02" })).body;
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).body;
    await friend.post(`/invitations/${inv.token}/accept`);
    await friend.post(`/trips/${trip.id}/fork`);
    await owner.post("/posts", { title: "Hello", body: "A secret body text", tripId: trip.id, visibility: "PUBLIC" });
    await t.anon().post("/auth/login").send({ email: "nobody@example.com", password: "wrong-password" }); // refused: no event
    await new Promise((r) => setTimeout(r, 200)); // events are written after commit, out of band

    const rows = await t.prisma.productEvent.findMany({ where: { at: { gte: since } }, orderBy: { id: "asc" } });
    const types = rows.map((r) => r.type);
    expect(types.filter((x) => x === "user.registered")).toHaveLength(2);
    for (const type of ["trip.created", "trip.published", "invite.accepted", "trip.forked", "post.created"]) expect(types).toContain(type);
    expect(types).not.toContain("user.login");
    const created = rows.find((r) => r.type === "trip.created")!;
    expect(created.userId).toBe(ownerId);
    expect(created.tripId).toBe(trip.id);
    // Facts only: no titles, bodies or e-mails in props.
    const raw = JSON.stringify(rows.map((r) => r.props));
    for (const secret of ["Events trip", "Hello", "secret body", "@"]) expect(raw).not.toContain(secret);
  });

  it("serves the nightly cohorts, or says the pipeline hasn't run", async () => {
    const minh = await t.as("minh@triply.dev");
    expect((await minh.get("/admin/analytics/cohorts")).status).toBe(403);
    const res = await an.get("/admin/analytics/cohorts?days=30");
    expect(res.status).toBe(200);
    // The test database is built from the migrations only: no dbt marts.
    expect(res.body).toEqual({ builtAt: null, stickiness: [], retention: [], activation: [] });
  });
});

