/** During the trip (roadmap phase 2): "Where to now?", splitting the group up, the meet-up point. */
import type { ItemView, NextSuggestions, TripDetail } from "@triply/shared";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const VI = { "X-Golaly-Locale": "vi" };
const place = (name: string) => t.prisma.place.findFirstOrThrow({ where: { name }, select: { id: true } }).then((p) => p.id);
// 2026-10-14 is a Wednesday.
const DAY = "2026-10-14";
// District 1, by the Opera House.
const HERE = "10.7760,106.7009";

async function crew() {
  const owner = await t.register("dto");
  const trip = (await owner.post("/trips", { title: "Saigon test", startDate: "2026-10-13", endDate: "2026-10-15" })).body;
  const editor = await t.register("dte");
  const viewer = await t.register("dtv");
  for (const [who, role] of [[editor, "EDITOR"], [viewer, "VIEWER"]] as const) {
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role })).body;
    expect((await who.post(`/invitations/${inv.token}/accept`)).status).toBe(200);
  }
  const days = ((await owner.get(`/trips/${trip.id}`)).body as TripDetail).days;
  return { owner, editor, viewer, trip, days };
}

describe("where to now", () => {
  it("ranks what's left today — open before closed, nearest first — and suggests open places nearby", async () => {
    const { owner, viewer, trip, days } = await crew();
    const today = days[1];
    const add = (title: string, placeId: string, startTime?: string) => owner.post(`/days/${today.id}/items`, { type: "PLACE", title, placeId, ...(startTime ? { startTime } : {}) }).then((r) => r.body as ItemView);
    const museum = await add("Museum", await place("War Remnants Museum"), "14:00");
    const skydeck = await add("Skydeck", await place("Saigon Skydeck"), "18:00");
    const done = await add("Cathedral", await place("Notre-Dame Cathedral Basilica"));
    await add("Phở", await place("Phở Hòa Pasteur"));
    await owner.patch(`/trips/${trip.id}/items/status`, { items: [{ id: done.id, status: "VISITED" }] });
    await owner.post(`/trips/${trip.id}/pool`, { type: "PLACE", title: "Pagoda", placeId: await place("Jade Emperor Pagoda") });
    // Another day's stop doesn't count as today.
    await owner.post(`/days/${days[2].id}/items`, { type: "PLACE", title: "Market", placeId: await place("Bến Thành Market") });

    // 08:00 local: the Skydeck (09:30-21:30) is closed, the museum (07:30-17:30) and phở (06:00-22:00) open.
    const r = await viewer.get(`/trips/${trip.id}/next?date=${DAY}&time=08:00&near=${HERE}`);
    expect(r.status).toBe(200);
    const s = r.body as NextSuggestions;
    expect(s).toMatchObject({ date: DAY, slot: "MORNING", dayId: today.id, located: true });
    // Closed last; the visited cathedral and other days' stops are left out.
    expect(s.plan.at(-1)!.item!.id).toBe(skydeck.id);
    expect(s.plan.at(-1)!.open).toEqual({ state: "closed", opensAt: "09:30" });
    expect(s.plan.map((c) => c.item!.title).sort()).toEqual(["Museum", "Phở", "Skydeck"]);
    // Any-time phở fits the morning; the museum's anchor is this afternoon; the closed Skydeck goes last.
    expect(s.plan.map((c) => c.item!.title)).toEqual(["Phở", "Museum", "Skydeck"]);
    expect(s.plan[0].walkMin).toBe(Math.round((s.plan[0].distanceM! * 1.3) / 80));
    expect(s.pool.map((c) => c.item!.title)).toEqual(["Pagoda"]);
    // Nearby: rated, open (or unknown), not in the trip, within a short walk.
    const inTrip = new Set([...s.plan, ...s.pool].map((c) => c.place.id));
    expect(s.nearby.length).toBeGreaterThan(0);
    for (const c of s.nearby) {
      expect(c.item).toBeNull();
      expect(inTrip.has(c.place.id)).toBe(false);
      expect(c.open.state).not.toBe("closed");
      expect(c.distanceM).toBeLessThanOrEqual(1200);
    }
    expect(s.nearby.map((c) => c.place.name)).toContain("L'Usine Lê Lợi");
    // The Opera House (09:00-17:00) is just round the corner but not open yet.
    expect(s.nearby.map((c) => c.place.name)).not.toContain("Saigon Opera House");

    // At 18:00 the museum has closed; without a location: plan order, no distances, nothing nearby.
    const evening = (await owner.get(`/trips/${trip.id}/next?date=${DAY}&time=18:00`)).body as NextSuggestions;
    expect(evening.located).toBe(false);
    expect(evening.nearby).toEqual([]);
    expect(evening.plan.every((c) => c.distanceM === null && c.walkMin === null)).toBe(true);
    expect(evening.plan.at(-1)!.item!.id).toBe(museum.id);
    // A date outside the trip: no plan for today, ideas still there.
    const outside = (await owner.get(`/trips/${trip.id}/next?date=2026-12-01&time=10:00`)).body as NextSuggestions;
    expect(outside.dayId).toBeNull();
    expect(outside.plan).toEqual([]);
    expect(outside.pool).toHaveLength(1);
  });

  it("is for people who can see the trip, and checks its input", async () => {
    const { owner, trip } = await crew();
    const stranger = await t.register("dts");
    expect((await stranger.get(`/trips/${trip.id}/next?date=${DAY}&time=10:00`)).status).toBe(403);
    const bad = await owner.get(`/trips/${trip.id}/next?date=${DAY}&time=25:00`).set(VI);
    expect(bad.status).toBe(422);
    expect((await owner.get(`/trips/${trip.id}/next?date=${DAY}&time=10:00&near=999,1`)).status).toBe(422);
  });
});

describe("splitting up", () => {
  it("sets who's going (members only; everyone = nobody singled out) and the meet-up point", async () => {
    const { owner, editor, viewer, trip, days } = await crew();
    const item = (await owner.post(`/days/${days[1].id}/items`, { type: "PLACE", title: "Museum", placeId: await place("War Remnants Museum") })).body as ItemView;
    expect(item).toMatchObject({ assignees: [], meetup: false });

    const r = await editor.put(`/items/${item.id}/assignees`, { userIds: [owner.id, editor.id] });
    expect(r.status).toBe(200);
    expect([...r.body.assignees].sort()).toEqual([owner.id, editor.id].sort());
    // Everyone ticked is stored as "everyone".
    expect((await owner.put(`/items/${item.id}/assignees`, { userIds: [owner.id, editor.id, viewer.id] })).body.assignees).toEqual([]);
    const stranger = await t.register("dtx");
    const bad = await owner.put(`/items/${item.id}/assignees`, { userIds: [stranger.id] }).set(VI);
    expect(bad.status).toBe(422);
    expect(bad.body.message).toBe("Chỉ những người trong chuyến đi mới có thể được chọn.");
    expect((await viewer.put(`/items/${item.id}/assignees`, { userIds: [viewer.id] })).status).toBe(403);

    // The meet-up point is an ordinary item edit.
    expect((await editor.patch(`/items/${item.id}`, { meetup: true })).body.meetup).toBe(true);

    // Leaving the trip takes you off its stops.
    await owner.put(`/items/${item.id}/assignees`, { userIds: [viewer.id] });
    expect((await viewer.delete(`/trips/${trip.id}/members/${viewer.id}`)).status).toBe(200);
    const after = ((await owner.get(`/trips/${trip.id}`)).body as TripDetail).days[1].items[0];
    expect(after.assignees).toEqual([]);

    // A remix keeps the meet-up point but not who goes where.
    await owner.put(`/items/${item.id}/assignees`, { userIds: [editor.id] });
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const fan = await t.register("dtf");
    const fork = (await fan.post(`/trips/${trip.id}/fork`)).body;
    const copy = ((await fan.get(`/trips/${fork.id}`)).body as TripDetail).days[1].items[0];
    expect(copy).toMatchObject({ meetup: true, assignees: [] });
    expect(await t.prisma.tripEvent.count({ where: { tripId: trip.id, type: "item.assignees" } })).toBe(4);
  });
});
