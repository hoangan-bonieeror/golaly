/** After the trip (roadmap phase 3): what happened, photos of stops, forks with evidence, and the group's expenses. */
import type { ExpensesView, TripDetail } from "@triply/shared";
import sharp from "sharp";
import { createTestContext, type Agent, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const VI = { "X-Triply-Locale": "vi" };
const place = (name: string) => t.prisma.place.findFirstOrThrow({ where: { name }, select: { id: true } }).then((p) => p.id);
async function upload(a: Agent) {
  const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#1f5e52" } }).jpeg().toBuffer();
  const res = await a.raw.post("/api/v1/media").set("X-Requested-With", "triply").attach("file", img, { filename: "p.jpg", contentType: "image/jpeg" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function crew() {
  const owner = await t.register("ato", { verified: true });
  const trip = (await owner.post("/trips", { title: "Hội An crew", startDate: "2026-08-14", endDate: "2026-08-15" }).set(VI)).body;
  const editor = await t.register("ate", { verified: true });
  const viewer = await t.register("atv", { verified: true });
  for (const [who, role] of [[editor, "EDITOR"], [viewer, "VIEWER"]] as const) {
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role })).body;
    expect((await who.post(`/invitations/${inv.token}/accept`)).status).toBe(200);
  }
  const detail = (await owner.get(`/trips/${trip.id}`)).body as TripDetail;
  return { owner, editor, viewer, trip, days: detail.days };
}

describe("what happened", () => {
  it("marks many stops at once; the trip's outcome counts places only", async () => {
    const { owner, viewer, trip, days } = await crew();
    const a = (await owner.post(`/days/${days[0].id}/items`, { type: "PLACE", title: "Old town", placeId: await place("Hội An Ancient Town") })).body;
    const b = (await owner.post(`/days/${days[0].id}/items`, { type: "RESTAURANT", title: "Coffee", placeId: await place("Hoi An Roastery") })).body;
    const note = (await owner.post(`/days/${days[1].id}/items`, { type: "NOTE", title: "Rest" })).body;
    expect((await owner.get(`/trips/${trip.id}`)).body.outcome).toBeNull();

    const res = await owner.patch(`/trips/${trip.id}/items/status`, { items: [{ id: a.id, status: "VISITED" }, { id: b.id, status: "SKIPPED" }, { id: note.id, status: "VISITED" }] });
    expect(res.body).toEqual({ changed: 3 });
    expect((await owner.patch(`/trips/${trip.id}/items/status`, { items: [{ id: a.id, status: "VISITED" }] })).body).toEqual({ changed: 0 });
    const detail = (await owner.get(`/trips/${trip.id}`)).body as TripDetail;
    expect(detail.outcome).toEqual({ planned: 2, visited: 1, skipped: 1 });
    expect(detail.days[0].items.map((i) => i.status)).toEqual(["VISITED", "SKIPPED"]);

    // Viewers can't edit the plan; items of another trip are refused.
    expect((await viewer.patch(`/trips/${trip.id}/items/status`, { items: [{ id: a.id, status: "PLANNED" }] })).status).toBe(403);
    const other = await t.register("ato2");
    const otherTrip = (await other.post("/trips", { title: "Other" })).body;
    const bad = await other.patch(`/trips/${otherTrip.id}/items/status`, { items: [{ id: a.id, status: "VISITED" }] }).set(VI);
    expect(bad.status).toBe(422);
    expect(bad.body.message).toBe("Một vài mục không còn trong chuyến đi này. Hãy tải lại rồi thử lại.");
    expect(await t.prisma.tripEvent.count({ where: { tripId: trip.id, type: "item.status" } })).toBe(3);
  });

  it("members (viewers too) add photos of stops; only the uploader or the owner removes them", async () => {
    const { owner, editor, viewer, trip, days } = await crew();
    const item = (await owner.post(`/days/${days[0].id}/items`, { type: "PLACE", title: "Old town", placeId: await place("Hội An Ancient Town") })).body;
    const mine = await upload(viewer);
    const res = await viewer.post(`/items/${item.id}/photos`, { mediaId: mine });
    expect(res.status).toBe(201);
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.photos[0]).toMatchObject({ uploadedBy: { id: viewer.id }, image: { url: expect.stringMatching(/^\/media\//) } });
    expect((await viewer.post(`/items/${item.id}/photos`, { mediaId: mine })).status).toBe(409);
    // Someone else's upload can't be attached.
    expect((await editor.post(`/items/${item.id}/photos`, { mediaId: mine })).status).toBe(422);
    const stranger = await t.register("ats", { verified: true });
    expect((await stranger.post(`/items/${item.id}/photos`, { mediaId: await upload(stranger) })).status).toBe(403);

    const photoId = res.body.photos[0].id;
    expect((await editor.delete(`/item-photos/${photoId}`)).status).toBe(403);
    expect((await owner.delete(`/item-photos/${photoId}`)).status).toBe(200);
    expect((await owner.get(`/trips/${trip.id}`)).body.days[0].items[0].photos).toEqual([]);
  });
});

describe("forks carry evidence", () => {
  it("a remix shows what the original group did, counts only, while the original is viewable", async () => {
    const { owner, editor, trip, days } = await crew();
    const went = (await owner.post(`/days/${days[0].id}/items`, { type: "PLACE", title: "Old town", placeId: await place("Hội An Ancient Town") })).body;
    const meh = (await owner.post(`/days/${days[0].id}/items`, { type: "PLACE", title: "Market", placeId: await place("Hội An Central Market") })).body;
    await owner.put(`/items/${went.id}/vote`, { level: "LOVE" });
    await editor.put(`/items/${went.id}/vote`, { level: "LOVE" });
    await owner.patch(`/trips/${trip.id}/items/status`, { items: [{ id: went.id, status: "VISITED" }, { id: meh.id, status: "SKIPPED" }] });
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });

    const fan = await t.register("atf");
    const fork = (await fan.post(`/trips/${trip.id}/fork`)).body;
    const copy = (await fan.get(`/trips/${fork.id}`)).body as TripDetail;
    const [a, b] = copy.days[0].items;
    expect(a).toMatchObject({ status: "PLANNED", votes: [], evidence: { status: "VISITED", loves: 2, votes: 2 } });
    expect(b.evidence).toEqual({ status: "SKIPPED", loves: 0, votes: 0 });
    expect(JSON.stringify(a.evidence)).not.toContain(owner.id);
    // The original's summary says how it went.
    expect((await t.anon().get(`/trips/${trip.id}`)).body.outcome).toEqual({ planned: 2, visited: 1, skipped: 1 });

    // Once the original goes private, the fork no longer shows it.
    await owner.patch(`/trips/${trip.id}`, { visibility: "PRIVATE" });
    expect(((await fan.get(`/trips/${fork.id}`)).body as TripDetail).days[0].items[0].evidence).toBeNull();
  });
});

describe("expenses", () => {
  it("splits equally or by amounts, nets balances and settles with the fewest transfers", async () => {
    const { owner, editor, viewer, trip, days } = await crew();
    // A Vietnamese-language trip starts in đồng.
    expect(trip.currency).toBe("VND");
    const dinner = (await owner.post(`/days/${days[0].id}/items`, { type: "RESTAURANT", title: "Dinner", placeId: await place("Mót Hội An") })).body;

    let v: ExpensesView = (
      await owner.post(`/trips/${trip.id}/expenses`, {
        description: "Dinner",
        amount: 900_001,
        category: "FOOD",
        paidById: owner.id,
        spentOn: "2026-08-14",
        itemId: dinner.id,
        split: { mode: "equal", userIds: [owner.id, editor.id, viewer.id] },
      })
    ).body;
    expect(v.digits).toBe(0);
    expect(v.expenses[0].shares.map((s) => s.amount).sort()).toEqual([300_000, 300_000, 300_001]);
    expect(v.expenses[0].item).toEqual({ id: dinner.id, title: "Dinner" });

    // A viewer (also on the trip) adds the taxi they paid, split by amounts.
    v = (
      await viewer.post(`/trips/${trip.id}/expenses`, {
        description: "Taxi",
        amount: 300_000,
        category: "TRANSPORT",
        paidById: viewer.id,
        split: { mode: "custom", shares: [{ userId: owner.id, amount: 200_000 }, { userId: viewer.id, amount: 100_000 }] },
      })
    ).body;
    expect(v.total).toBe(1_200_001);
    const net = Object.fromEntries(v.balances.map((b) => [b.user.id, b.net]));
    // Owner: paid 900 001, owes 300 001 + 200 000. Editor owes 300 000. Viewer: paid 300 000, owes 300 000 + 100 000.
    expect(net).toEqual({ [owner.id]: 400_000, [editor.id]: -300_000, [viewer.id]: -100_000 });
    expect(v.transfers.map((x) => [x.from.id, x.to.id, x.amount])).toEqual([
      [editor.id, owner.id, 300_000],
      [viewer.id, owner.id, 100_000],
    ]);
    expect(v.byCategory).toEqual([{ category: "FOOD", amount: 900_001 }, { category: "TRANSPORT", amount: 300_000 }]);
    expect(v.byDay).toEqual([{ date: "2026-08-14", amount: 900_001 }]);
    expect(v.currencyLocked).toBe(true);

    // Repayment: the editor pays the owner back; the plan shrinks to one transfer.
    v = (await editor.post(`/trips/${trip.id}/settlements`, { fromId: editor.id, toId: owner.id, amount: 300_000 })).body;
    expect(v.transfers.map((x) => [x.from.id, x.amount])).toEqual([[viewer.id, 100_000]]);
    expect(v.settlements[0]).toMatchObject({ canDelete: true });
  });

  it("checks the split, who's on it and who may change it", async () => {
    const { owner, editor, viewer, trip } = await crew();
    const body = { description: "Room", amount: 1000, category: "LODGING", paidById: owner.id, split: { mode: "custom", shares: [{ userId: owner.id, amount: 600 }, { userId: editor.id, amount: 300 }] } };
    const bad = await owner.post(`/trips/${trip.id}/expenses`, body).set(VI);
    expect(bad.status).toBe(422);
    expect(bad.body.fields.split).toBe("Tổng các phần phải bằng số tiền của khoản chi.");
    const outsider = await t.register("ato3");
    expect((await owner.post(`/trips/${trip.id}/expenses`, { ...body, split: { mode: "equal", userIds: [owner.id, outsider.id] } })).status).toBe(422);
    expect((await owner.post(`/trips/${trip.id}/expenses`, { ...body, amount: 0, split: { mode: "equal", userIds: [owner.id] } })).status).toBe(422);

    const v = (await owner.post(`/trips/${trip.id}/expenses`, { ...body, split: { mode: "equal", userIds: [owner.id, editor.id] } })).body as ExpensesView;
    const id = v.expenses[0].id;
    expect((await viewer.get(`/trips/${trip.id}/expenses`)).body.expenses[0].canEdit).toBe(false);
    expect((await viewer.delete(`/expenses/${id}`)).status).toBe(403);
    // The payer and the owner may edit.
    expect((await owner.patch(`/expenses/${id}`, { ...body, amount: 1200, split: { mode: "equal", userIds: [owner.id, editor.id, viewer.id] } })).body.expenses[0].shares).toHaveLength(3);
    // Outsiders and visitors of a public trip never see the money.
    await owner.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    expect((await outsider.get(`/trips/${trip.id}/expenses`)).status).toBe(403);
    expect((await t.anon().get(`/trips/${trip.id}/expenses`)).status).toBe(401);
    // A fork doesn't take the expenses along.
    const fork = (await outsider.post(`/trips/${trip.id}/fork`)).body;
    expect((await outsider.get(`/trips/${fork.id}/expenses`)).body.expenses).toEqual([]);

    // The currency is fixed once there's money on the trip.
    const change = await owner.patch(`/trips/${trip.id}`, { currency: "USD" }).set(VI);
    expect(change.status).toBe(422);
    expect(change.body.message).toBe("Không đổi được loại tiền khi chuyến đi đã có khoản chi.");
    expect((await owner.delete(`/expenses/${id}`)).status).toBe(200);
    expect((await owner.patch(`/trips/${trip.id}`, { currency: "USD" })).body.currency).toBe("USD");
    expect((await owner.patch(`/trips/${trip.id}`, { currency: "ABC" })).status).toBe(422);
    const types = (await t.prisma.tripEvent.findMany({ where: { tripId: trip.id, type: { startsWith: "expense." } }, select: { type: true, payload: true } })).map((e) => e.type);
    expect(types).toEqual(["expense.added", "expense.updated", "expense.deleted"]);
  });
});
