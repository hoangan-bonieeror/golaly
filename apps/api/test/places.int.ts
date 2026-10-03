/** Explore → Places: taxonomy, browsing around a destination or a point, place detail and "Add to trip". */
import type { PlaceBrowse, PlaceDetail, PlaceView, TripTarget } from "@triply/shared";
import { seedId } from "../prisma/seed-data/ids";
import { createTestContext, demoTrip, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const place = (key: string) => seedId(`place:${key}`);
const browse = async (qs: string) => {
  const res = await t.anon().get(`/places/browse?${qs}`);
  expect(res.status).toBe(200);
  return res.body as PlaceBrowse;
};

describe("categories", () => {
  it("serves the two-level taxonomy", async () => {
    const tree = (await t.anon().get("/places/categories")).body;
    expect(tree.length).toBeGreaterThanOrEqual(10);
    const food = tree.find((g: { key: string }) => g.key === "food");
    expect(food).toMatchObject({ label: "Food", labelVi: "Ăn uống", itemType: "RESTAURANT" });
    expect(food.children.map((c: { key: string }) => c.key)).toContain("food.street_food");
  });

  it("every seed place has a category, exposed on PlaceView", async () => {
    expect(await t.prisma.place.count({ where: { categoryId: null } })).toBe(0);
    const p = (await t.anon().get(`/places/${place("banh-mi-phuong")}`)).body as PlaceView;
    expect(p).toMatchObject({ categoryKey: "food.street_food", categoryLabel: "Street food" });
  });
});

describe("browse", () => {
  it("lists places around a destination, nearest first, with group counts", async () => {
    const r = await browse("destination=hoi-an&sort=distance&limit=48");
    expect(r.center).toMatchObject({ label: "Hội An" });
    expect(r.radiusKm).toBe(10);
    expect(r.items.length).toBeGreaterThan(5);
    const d = r.items.map((p) => p.distanceM!);
    expect(d.every((m) => m <= 10_000)).toBe(true);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(r.items.map((p) => p.name)).not.toContain("Hoàn Kiếm Lake");
    expect(r.total).toBe(r.items.length);
    const facet = Object.fromEntries(r.facets.map((f) => [f.key, f.count]));
    expect(facet.drink).toBeGreaterThanOrEqual(2);
    expect(Object.values(facet).reduce((a, b) => a + b, 0)).toBe(r.total);
  });

  it("'recommended' blends rating with closeness (a far 4.8 doesn't beat a central 4.7)", async () => {
    const r = await browse("destination=hoi-an&limit=3");
    expect(r.items[0].distanceM).toBeLessThan(1000);
    expect(r.items.map((p) => p.name)).not.toContain("Four Seasons Resort The Nam Hai");
  });

  it("filters by group, by category and by text", async () => {
    const drinks = await browse("destination=hoi-an&group=drink");
    expect(drinks.items.length).toBeGreaterThanOrEqual(2);
    expect(drinks.items.every((p) => p.categoryKey?.startsWith("drink."))).toBe(true);
    // Facets ignore the group filter, so the other chips keep their counts.
    expect(drinks.facets.find((f) => f.key === "food")?.count).toBeGreaterThan(0);

    const noodles = await browse("destination=hoi-an&category=food.noodles");
    expect(noodles.items.map((p) => p.name)).toEqual(["Cao Lầu Thanh"]);

    const text = await browse("destination=hoi-an&q=cao lau");
    expect(text.items.map((p) => p.name)).toEqual(["Cao Lầu Thanh"]);
  });

  it("searches around a point with a radius (Near me)", async () => {
    const r = await browse("near=21.0288,105.8525&radius=2&sort=distance");
    expect(r.center).toMatchObject({ label: "your location", lat: 21.0288 });
    expect(r.items[0].name).toBe("Hoàn Kiếm Lake");
    expect(r.items.every((p) => p.destinationName === "Hanoi")).toBe(true);
  });

  it("pages with an offset cursor without repeats", async () => {
    const a = await browse("destination=hoi-an&limit=4");
    expect(a.items).toHaveLength(4);
    expect(a.nextCursor).toBe("4");
    const b = await browse(`destination=hoi-an&limit=4&cursor=${a.nextCursor}`);
    expect(b.items.some((p) => a.items.some((x) => x.id === p.id))).toBe(false);
  });

  it("without an area it ranks globally and ignores sort=distance", async () => {
    const r = await browse("sort=distance&limit=5");
    expect(r.center).toBeNull();
    expect(r.items[0].distanceM).toBeUndefined();
    expect(r.items[0].rating).toBeGreaterThanOrEqual(r.items[4].rating ?? 0);
  });

  it("rejects bad input cleanly", async () => {
    expect((await t.anon().get("/places/browse?near=nowhere")).status).toBe(422);
    expect((await t.anon().get("/places/browse?near=95,10")).status).toBe(422);
    expect((await t.anon().get("/places/browse?cursor=abc")).status).toBe(422);
    expect((await t.anon().get("/places/browse?group=x';drop")).status).toBe(422);
    expect((await t.anon().get("/places/browse?destination=atlantis")).status).toBe(404);
  });

  it("hides closed places from browsing but keeps their page", async () => {
    const id = place("white-marble");
    await t.prisma.place.update({ where: { id }, data: { status: "CLOSED" } });
    try {
      expect((await browse("destination=hoi-an&limit=48")).items.map((p) => p.id)).not.toContain(id);
      expect((await t.anon().get(`/places/${id}`)).body.status).toBe("CLOSED");
    } finally {
      await t.prisma.place.update({ where: { id }, data: { status: "ACTIVE" } });
    }
  });
});

describe("place detail", () => {
  it("has category, area, nearby places and the public trips that use it", async () => {
    const p = (await t.anon().get(`/places/${place("banh-mi-phuong")}`)).body as PlaceDetail;
    expect(p).toMatchObject({ groupKey: "food", groupLabel: "Food", destinationSlug: "hoi-an", status: "ACTIVE" });
    expect(p.nearby.length).toBeGreaterThan(0);
    expect(p.nearby.map((n) => n.id)).not.toContain(p.id);
    expect(p.nearby.every((n) => n.distanceM! <= 1500)).toBe(true);
    expect(p.inTrips.map((x) => x.title)).toContain("Vietnam — 10 Days, North to South");
    expect(p.tripCount).toBeGreaterThanOrEqual(1);
  });

  it("never reveals private trips", async () => {
    // Ichiran is only in An's private "Japan — 7 Days".
    const p = (await t.anon().get(`/places/${place("ichiran")}`)).body as PlaceDetail;
    expect(p.inTrips.map((x) => x.title)).not.toContain("Japan — 7 Days");
    expect(p.tripCount).toBe(0);
  });

  it("follows merges and hides HIDDEN places", async () => {
    const from = place("cocobox-merge-test");
    await t.prisma.place.create({ data: { id: from, name: "Duplicate Roastery", category: "RESTAURANT", address: "", lat: 15.8771, lng: 108.3301, mergedIntoId: place("roastery") } });
    try {
      expect((await t.anon().get(`/places/${from}`)).body.id).toBe(place("roastery"));
      await t.prisma.place.update({ where: { id: from }, data: { mergedIntoId: null, status: "HIDDEN" } });
      expect((await t.anon().get(`/places/${from}`)).status).toBe(404);
    } finally {
      await t.prisma.place.delete({ where: { id: from } });
    }
  });
});

describe("add to trip", () => {
  it("offers only trips the viewer can edit, nearby ones first", async () => {
    const u = await t.register("explorer");
    const dests = (await t.anon().get("/destinations")).body as { id: string; slug: string }[];
    const id = (slug: string) => dests.find((d) => d.slug === slug)!.id;
    const tokyo = (await u.post("/trips", { title: "Tokyo later", destinationIds: [id("tokyo")], startDate: "2027-05-01", endDate: "2027-05-02" })).body;
    const hoian = (await u.post("/trips", { title: "Hội An soon", destinationIds: [id("hoi-an")], startDate: "2027-01-10", endDate: "2027-01-12" })).body;

    const targets = (await u.get(`/places/${place("roastery")}/trip-targets`)).body as TripTarget[];
    expect(targets.map((x) => x.id)).toEqual([hoian.id, tokyo.id]);
    expect(targets[0]).toMatchObject({ role: "OWNER", nearby: true, destinations: ["Hội An"] });
    expect(targets[0].days.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
    expect(targets[1].nearby).toBe(false);

    // Adding goes through the normal itinerary endpoint; the target then shows it on that day.
    const day2 = targets[0].days[1];
    const item = await u.post(`/days/${day2.id}/items`, { type: "RESTAURANT", title: "Hoi An Roastery", placeId: place("roastery"), startTime: "08:30" });
    expect(item.status).toBe(201);
    const again = (await u.get(`/places/${place("roastery")}/trip-targets`)).body as TripTarget[];
    expect(again[0].days[1]).toMatchObject({ hasPlace: true, itemCount: 1 });
  });

  it("editors see the trip, viewers and outsiders don't", async () => {
    const japan = await demoTrip(t.prisma, "Japan — 7 Days");
    const minh = await t.as("minh@triply.dev");
    const linh = await t.as("linh@triply.dev");
    const forMinh = (await minh.get(`/places/${place("sensoji")}/trip-targets`)).body as TripTarget[];
    expect(forMinh.find((x) => x.id === japan.id)).toMatchObject({ role: "EDITOR", nearby: true });
    const forLinh = (await linh.get(`/places/${place("sensoji")}/trip-targets`)).body as TripTarget[];
    expect(forLinh.map((x) => x.id)).not.toContain(japan.id);
    // …and the write path enforces it regardless of what the client was offered.
    const res = await linh.post(`/days/${japan.days[0].id}/items`, { type: "PLACE", title: "Sensō-ji", placeId: place("sensoji") });
    expect(res.status).toBe(403);
    expect((await t.anon().get(`/places/${place("sensoji")}/trip-targets`)).status).toBe(401);
  });
});
