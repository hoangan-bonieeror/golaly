/** Trip service + itinerary service behaviour through the HTTP API. */
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
let tokyoId: string;
let kyotoId: string;
beforeAll(async () => {
  t = await createTestContext();
  tokyoId = (await t.prisma.destination.findUniqueOrThrow({ where: { slug: "tokyo" } })).id;
  kyotoId = (await t.prisma.destination.findUniqueOrThrow({ where: { slug: "kyoto" } })).id;
});
afterAll(() => t.app.close());

async function newTrip(agent: Awaited<ReturnType<TestContext["register"]>>, body: object = {}) {
  const res = await agent.post("/trips", { title: "Test trip", destinationIds: [tokyoId], startDate: "2027-04-01", endDate: "2027-04-03", ...body });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe("trips", () => {
  it("creates a PRIVATE trip owned by the caller with one day per date", async () => {
    const u = await t.register("trip");
    const trip = await newTrip(u);
    const detail = (await u.get(`/trips/${trip.id}`)).body;
    expect(detail).toMatchObject({ visibility: "PRIVATE", myRole: "OWNER", route: "Tokyo", stats: { days: 3, travelers: 1 } });
    expect(detail.days.map((d: { date: string }) => d.date)).toEqual(["2027-04-01", "2027-04-02", "2027-04-03"]);
  });

  it("ignores an owner_id supplied by the client", async () => {
    const u = await t.register("spoof");
    const res = await u.post("/trips", { title: "Spoof", ownerId: "db8d2360-b642-4614-aeff-b6b1420920ab" });
    expect(res.body.owner.id).toBe(u.id);
  });

  it("validates titles and date ranges", async () => {
    const u = await t.register("val");
    expect((await u.post("/trips", { title: "x" })).status).toBe(422);
    expect((await u.post("/trips", { title: "Bad dates", startDate: "2027-05-10", endDate: "2027-05-01" })).status).toBe(422);
    expect((await u.post("/trips", { title: "Bad dest", destinationIds: ["9e6f4b1e-0000-4000-a000-000000000000"] })).status).toBe(422);
  });

  it("extends days when dates grow and refuses to drop days that still have plans", async () => {
    const u = await t.register("dates");
    const trip = await newTrip(u);
    const days = (await u.get(`/trips/${trip.id}`)).body.days;
    await u.post(`/days/${days[2].id}/items`, { type: "NOTE", title: "Last day plan" });
    expect((await u.patch(`/trips/${trip.id}`, { endDate: "2027-04-05" })).body.stats.days).toBe(5);
    const shrink = await u.patch(`/trips/${trip.id}`, { endDate: "2027-04-02" });
    expect(shrink.status).toBe(422);
    expect(shrink.body.message).toMatch(/Day 3 still has plans/);
  });

  it("only the owner can edit details, change visibility or delete", async () => {
    const owner = await t.register("own");
    const trip = await newTrip(owner);
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "EDITOR" })).body;
    const editor = await t.register("ed");
    await editor.post(`/invitations/${inv.token}/accept`);
    expect((await editor.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" })).status).toBe(403);
    expect((await editor.delete(`/trips/${trip.id}`)).status).toBe(403);
    expect((await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" })).body.visibility).toBe("PUBLIC");
    expect((await owner.delete(`/trips/${trip.id}`)).status).toBe(200);
    expect((await owner.get(`/trips/${trip.id}`)).status).toBe(404);
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: trip.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["trip.visibility_changed", "trip.deleted", "trip.member.joined"]));
  });
});

describe("itinerary", () => {
  it("keeps timed items in order, supports duplicate, reorder across days and delete", async () => {
    const u = await t.register("iti");
    const trip = await newTrip(u, { destinationIds: [tokyoId, kyotoId] });
    const [d1, d2] = (await u.get(`/trips/${trip.id}`)).body.days;
    const place = await t.prisma.place.findFirstOrThrow({ where: { name: "Shibuya Crossing" } });
    const late = (await u.post(`/days/${d1.id}/items`, { type: "PLACE", title: "Dinner", startTime: "19:00" })).body;
    const early = (await u.post(`/days/${d1.id}/items`, { type: "PLACE", title: "Shibuya", placeId: place.id, startTime: "09:00" })).body;
    expect(early.place.name).toBe("Shibuya Crossing");
    let day1 = (await u.get(`/trips/${trip.id}/days`)).body[0];
    expect(day1.items.map((i: { title: string }) => i.title)).toEqual(["Shibuya", "Dinner"]);

    const dup = (await u.post(`/items/${early.id}/duplicate`)).body;
    expect(dup.title).toBe("Shibuya (copy)");
    expect((await u.post(`/items/${late.id}/reorder`, { dayId: d2.id, index: 0 })).status).toBe(200);
    const days = (await u.get(`/trips/${trip.id}/days`)).body;
    expect(days[0].items.map((i: { title: string }) => i.title)).toEqual(["Shibuya", "Shibuya (copy)"]);
    expect(days[1].items.map((i: { title: string }) => i.title)).toEqual(["Dinner"]);

    expect((await u.delete(`/items/${dup.id}`)).status).toBe(200);
    day1 = (await u.get(`/trips/${trip.id}/days`)).body[0];
    expect(day1.items.map((i: { sortOrder: number }) => i.sortOrder)).toEqual([0]);
  });

  it("validates item times and rejects moving items into another trip", async () => {
    const u = await t.register("iti2");
    const a = await newTrip(u);
    const b = await newTrip(u);
    const dayA = (await u.get(`/trips/${a.id}`)).body.days[0];
    const dayB = (await u.get(`/trips/${b.id}`)).body.days[0];
    expect((await u.post(`/days/${dayA.id}/items`, { type: "ACTIVITY", title: "x", startTime: "10:00", endTime: "09:00" })).status).toBe(422);
    const item = (await u.post(`/days/${dayA.id}/items`, { type: "ACTIVITY", title: "Museum" })).body;
    expect((await u.post(`/items/${item.id}/reorder`, { dayId: dayB.id, index: 0 })).status).toBe(422);
  });

  it("adds and deletes days, renumbering and re-dating the rest", async () => {
    const u = await t.register("days");
    const trip = await newTrip(u);
    const added = (await u.post(`/trips/${trip.id}/days`)).body;
    expect(added).toMatchObject({ dayNumber: 4, date: "2027-04-04" });
    const days = (await u.get(`/trips/${trip.id}`)).body.days;
    expect((await u.delete(`/trips/${trip.id}/days/${days[1].id}`)).status).toBe(200);
    const after = (await u.get(`/trips/${trip.id}`)).body;
    expect(after.days.map((d: { dayNumber: number; date: string }) => [d.dayNumber, d.date])).toEqual([
      [1, "2027-04-01"],
      [2, "2027-04-02"],
      [3, "2027-04-03"],
    ]);
    expect(after.endDate).toBe("2027-04-03");
  });
});
