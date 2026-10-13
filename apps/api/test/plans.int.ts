/** Flexible plans (roadmap phases 0–1): place pool, parts of the day, votes, members' dates, the activity log. */
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const place = (name: string) => t.prisma.place.findFirstOrThrow({ where: { name }, select: { id: true } }).then((p) => p.id);
const VI = { "X-Triply-Locale": "vi" };

async function groupTrip() {
  const owner = await t.register("plo");
  const trip = (await owner.post("/trips", { title: "Pool trip", startDate: "2027-04-01", endDate: "2027-04-03" })).body;
  const editor = await t.register("ple");
  const viewer = await t.register("plv");
  for (const [who, role] of [[editor, "EDITOR"], [viewer, "VIEWER"]] as const) {
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role })).body;
    expect((await who.post(`/invitations/${inv.token}/accept`)).status).toBe(200);
  }
  const days = (await owner.get(`/trips/${trip.id}`)).body.days as { id: string; dayNumber: number }[];
  return { owner, editor, viewer, trip, days };
}

const events = (tripId: string) => t.prisma.tripEvent.findMany({ where: { tripId }, orderBy: { id: "asc" } });

describe("place pool", () => {
  it("editors add ideas to the pool; viewers can't; the trip shows it with who added each idea", async () => {
    const { owner, editor, viewer, trip } = await groupTrip();
    const kiyomizu = await place("Kiyomizu-dera");
    const res = await editor.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Kiyomizu-dera", placeId: kiyomizu, startTime: "09:00", slot: "MORNING" });
    expect(res.status).toBe(201);
    // In the pool an item has no day, part of the day or time yet.
    expect(res.body).toMatchObject({ tripId: trip.id, dayId: null, slot: "ANY", startTime: null, status: "PLANNED", votes: [], addedBy: { id: editor.id } });

    expect((await viewer.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Nope" })).status).toBe(403);
    expect((await t.anon().post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Nope" })).status).toBe(401);
    const dup = await owner.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Again", placeId: kiyomizu }).set(VI);
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe("Địa điểm này đã có trong kho ý tưởng.");
    expect((await owner.post(`/trips/${trip.id}/pool`, { type: "NOTE", title: "A note" })).status).toBe(422);

    const detail = (await viewer.get(`/trips/${trip.id}`)).body;
    expect(detail.pool.map((i: { title: string }) => i.title)).toEqual(["Kiyomizu-dera"]);
    expect(detail.permissions).toEqual(expect.arrayContaining(["itinerary.view", "itinerary.vote"]));
    expect(detail.permissions).not.toContain("itinerary.add");
    expect((await viewer.get(`/trips/${trip.id}/pool`)).body).toHaveLength(1);

    const note = (await owner.get("/notifications").set(VI)).body.items[0];
    expect(note.text).toBe("đã gợi ý “Kiyomizu-dera” cho Pool trip");
    expect((await events(trip.id)).map((e) => e.type)).toEqual(["item.pooled"]);
  });

  it("moves between the pool and days: a part of the day on the way in, no clock time on the way out", async () => {
    const { owner, trip, days } = await groupTrip();
    const [kiyo, gion] = await Promise.all([place("Kiyomizu-dera"), place("Gion & Hanamikoji")]);
    const a = (await owner.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Kiyomizu", placeId: kiyo })).body;
    const b = (await owner.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Gion", placeId: gion })).body;

    // A flight on day 1 at 18:00 is an anchor: its time puts it in the evening.
    const flight = (await owner.post(`/days/${days[0].id}/items`, { type: "FLIGHT", title: "Land", startTime: "18:00" })).body;
    expect(flight.slot).toBe("EVENING");

    expect((await owner.post(`/items/${a.id}/reorder`, { dayId: days[0].id, index: 0, slot: "AFTERNOON" })).status).toBe(200);
    expect((await owner.post(`/items/${b.id}/reorder`, { dayId: days[0].id, index: 0, slot: "MORNING" })).status).toBe(200);
    let day = (await owner.get(`/trips/${trip.id}`)).body.days[0].items as { id: string; slot: string }[];
    expect(day.map((i) => [i.id, i.slot])).toEqual([[b.id, "MORNING"], [a.id, "AFTERNOON"], [flight.id, "EVENING"]]);

    // An anchor keeps the part of the day its time says, whatever slot the move asked for.
    await owner.post(`/items/${flight.id}/reorder`, { dayId: days[0].id, index: 0, slot: "MORNING" });
    day = (await owner.get(`/trips/${trip.id}`)).body.days[0].items;
    expect(day.map((i) => i.id)).toEqual([b.id, a.id, flight.id]);

    // Back to the pool: the time goes, the idea stays.
    await owner.post(`/items/${flight.id}/reorder`, { dayId: null, index: 0 });
    const back = (await owner.get(`/trips/${trip.id}`)).body;
    expect(back.pool[0]).toMatchObject({ id: flight.id, dayId: null, slot: "ANY", startTime: null });
    expect(back.days[0].items).toHaveLength(2);

    // Changing a time on a day re-slots and re-orders.
    await owner.patch(`/items/${b.id}`, { startTime: "20:00" });
    expect((await owner.get(`/trips/${trip.id}`)).body.days[0].items.map((i: { id: string; slot: string }) => [i.id, i.slot])).toEqual([[a.id, "AFTERNOON"], [b.id, "EVENING"]]);

    const moves = (await events(trip.id)).filter((e) => e.type === "item.moved").map((e) => e.payload);
    expect(moves[0]).toMatchObject({ fromDay: null, toDay: 1, fromSlot: "ANY", toSlot: "AFTERNOON" });
    expect(moves.at(-1)).toMatchObject({ fromDay: 1, toDay: null, toSlot: "ANY" });
  });

  it("deleting a day returns its places to the pool", async () => {
    const { owner, trip, days } = await groupTrip();
    const kiyo = await place("Kiyomizu-dera");
    await owner.post(`/days/${days[2].id}/items`, { type: "PLACE", title: "Kiyomizu", placeId: kiyo, startTime: "10:00" });
    await owner.post(`/days/${days[2].id}/items`, { type: "NOTE", title: "Rest" });
    expect((await owner.delete(`/trips/${trip.id}/days/${days[2].id}`)).status).toBe(200);
    const after = (await owner.get(`/trips/${trip.id}`)).body;
    expect(after.days).toHaveLength(2);
    expect(after.pool).toEqual([expect.objectContaining({ title: "Kiyomizu", dayId: null, startTime: null })]);
  });

  it("a fork copies the pool but not the group's votes", async () => {
    const { owner, trip } = await groupTrip();
    const idea = (await owner.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Yasaka", placeId: await place("Yasaka Pagoda") })).body;
    await owner.put(`/items/${idea.id}/vote`, { level: "LOVE" });
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const other = await t.register("plf");
    const fork = (await other.post(`/trips/${trip.id}/fork`)).body;
    const copy = (await other.get(`/trips/${fork.id}`)).body;
    expect(copy.pool).toEqual([expect.objectContaining({ title: "Yasaka", votes: [], addedBy: expect.objectContaining({ id: other.id }) })]);
  });
});

describe("votes", () => {
  it("every member votes once per item (viewers too); voting again changes it; outsiders can't", async () => {
    const { owner, editor, viewer, trip } = await groupTrip();
    const idea = (await owner.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Ninenzaka", placeId: await place("Ninenzaka & Sannenzaka") })).body;
    expect((await viewer.put(`/items/${idea.id}/vote`, { level: "LOVE" })).body.votes).toEqual([{ userId: viewer.id, level: "LOVE" }]);
    await editor.put(`/items/${idea.id}/vote`, { level: "OK" });
    const changed = (await viewer.put(`/items/${idea.id}/vote`, { level: "SKIP" })).body;
    expect(changed.votes).toEqual(expect.arrayContaining([{ userId: viewer.id, level: "SKIP" }, { userId: editor.id, level: "OK" }]));
    expect(changed.votes).toHaveLength(2);
    expect((await viewer.put(`/items/${idea.id}/vote`, { level: "MAYBE" })).status).toBe(422);

    const stranger = await t.register("pls");
    expect((await stranger.put(`/items/${idea.id}/vote`, { level: "LOVE" })).status).toBe(403);
    expect((await t.anon().put(`/items/${idea.id}/vote`, { level: "LOVE" })).status).toBe(401);

    expect((await viewer.delete(`/items/${idea.id}/vote`)).body.votes).toEqual([{ userId: editor.id, level: "OK" }]);
    const log = (await events(trip.id)).filter((e) => e.type.startsWith("item.vot") || e.type === "item.unvoted");
    expect(log.map((e) => [e.type, (e.payload as { level?: string }).level ?? null])).toEqual([
      ["item.voted", "LOVE"],
      ["item.voted", "OK"],
      ["item.voted", "SKIP"],
      ["item.unvoted", null],
    ]);
  });
});

describe("members' dates", () => {
  it("members set their own; the owner sets anyone's; the order is checked", async () => {
    const { owner, editor, viewer, trip } = await groupTrip();
    const mine = await viewer.patch(`/trips/${trip.id}/members/${viewer.id}/dates`, { arriveOn: "2027-04-02", leaveOn: null });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ arriveOn: "2027-04-02", leaveOn: null });
    expect((await editor.patch(`/trips/${trip.id}/members/${viewer.id}/dates`, { arriveOn: null, leaveOn: null })).status).toBe(403);
    expect((await owner.patch(`/trips/${trip.id}/members/${editor.id}/dates`, { arriveOn: null, leaveOn: "2027-04-02" })).status).toBe(200);
    const bad = await owner.patch(`/trips/${trip.id}/members/${editor.id}/dates`, { arriveOn: "2027-04-03", leaveOn: "2027-04-01" }).set(VI);
    expect(bad.status).toBe(422);
    expect(bad.body.fields.leaveOn).toBe("Ngày rời đi phải cùng hoặc sau ngày đến.");

    const members = (await owner.get(`/trips/${trip.id}`)).body.members as { user: { id: string }; arriveOn: string | null; leaveOn: string | null }[];
    expect(members.find((m) => m.user.id === viewer.id)).toMatchObject({ arriveOn: "2027-04-02", leaveOn: null });
    expect(members.find((m) => m.user.id === editor.id)).toMatchObject({ arriveOn: null, leaveOn: "2027-04-02" });
    expect((await events(trip.id)).filter((e) => e.type === "member.dates")).toHaveLength(2);
  });
});

describe("activity log and consent", () => {
  it("records the plan's activity as facts, and analytics stays opt-in", async () => {
    const { owner, trip, days } = await groupTrip();
    const item = (await owner.post(`/days/${days[0].id}/items`, { type: "PLACE", title: "Secret plans 🤫", notes: "private note", startTime: "09:30" })).body;
    await owner.patch(`/items/${item.id}`, { status: "VISITED" });
    await owner.delete(`/items/${item.id}`);
    const log = await events(trip.id);
    expect(log.map((e) => e.type)).toEqual(["item.added", "item.status", "item.deleted"]);
    expect(log[0].payload).toEqual({ day: 1, slot: "MORNING", itemType: "PLACE", timed: true });
    expect(log[1].payload).toEqual({ from: "PLANNED", to: "VISITED" });
    // Free text (titles, notes) never goes into the log.
    expect(JSON.stringify(log.map((e) => e.payload))).not.toMatch(/Secret|private note/);

    expect((await owner.get("/users/me")).body.analyticsConsent).toBe(false);
    expect((await owner.patch("/users/me", { analyticsConsent: true })).body.analyticsConsent).toBe(true);
  });

  it("the demo trip comes with a voted pool and members who are only there for part of it", async () => {
    const an = await t.as("an@triply.dev");
    const japan = (await an.get("/trips?limit=50")).body.items.find((x: { title: string }) => x.title === "Japan — 7 Days");
    const trip = (await an.get(`/trips/${japan.id}`)).body;
    expect(trip.pool.length).toBeGreaterThanOrEqual(5);
    expect(trip.pool.find((i: { title: string }) => i.title === "Kiyomizu-dera").votes).toHaveLength(3);
    expect(trip.members.find((m: { user: { username: string } }) => m.user.username === "nam.le").arriveOn).toBe("2027-03-12");
    expect(trip.days[0].items.map((i: { slot: string }) => i.slot)).toEqual(["MORNING", "MORNING", "AFTERNOON", "AFTERNOON", "EVENING"]);
  });
});
