/** Explore → Places: taxonomy, browsing around a destination or a point, place detail and "Add to trip". */
import type { DestinationPage, DestinationView, GeoAreaOption, PlaceBrowse, PlaceDetail, PlaceView, TripTarget } from "@triply/shared";
import { PlacesService } from "../src/modules/places/places";
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

  it("text search matches word starts and honours accents typed by the user", async () => {
    const names = async (qs: string) => (await browse(`${qs}&limit=48`)).items.map((p) => p.name);
    // Plain "ca" matches any word starting with "ca"; "cà" only the accented one.
    expect(await names("destination=hoi-an&q=ca")).toContain("Cao Lầu Thanh");
    const accented = await names("q=cà");
    expect(accented).toContain("Cộng Cà Phê Nhà Thờ");
    expect(accented).not.toContain("Cao Lầu Thanh");
    // Word starts, not substrings: "an" is not inside "Hoàn Kiếm".
    expect(await names("destination=hanoi&q=an")).not.toContain("Hoàn Kiếm Lake");
    // Accent-free still works, and the best name match comes first.
    expect((await browse("q=hoi an museum")).items[0].name).toBe("Hội An Museum");
    expect((await browse("q=bánh mì phượng")).items[0].name).toBe("Bánh Mì Phượng");
  });

  it("filters by province/city (geo area), including its sub-areas", async () => {
    const country = await t.prisma.geoArea.create({ data: { level: "COUNTRY", countryCode: "VN", name: "Việt Nam", slug: "test-vn", source: "test", externalId: "test-vn" } });
    const city = await t.prisma.geoArea.create({
      data: { parentId: country.id, level: "REGION", countryCode: "VN", name: "Thành phố Đà Nẵng", slug: "test-vn-da-nang", source: "test", externalId: "test-dn", minLat: 15.7, maxLat: 16.2, minLng: 107.8, maxLng: 108.6 },
    });
    await t.prisma.place.updateMany({ where: { destination: { slug: "hoi-an" } }, data: { areaId: city.id } });
    try {
      const r = await browse("area=test-vn-da-nang&limit=48");
      expect(r.area).toEqual({ slug: "test-vn-da-nang", name: "Thành phố Đà Nẵng" });
      expect(r.center).toMatchObject({ label: "Đà Nẵng" });
      expect(r.items.length).toBeGreaterThan(5);
      expect(r.items.every((p) => p.destinationName === "Hội An")).toBe(true);
      expect(r.items[0].distanceM).toBeUndefined();
      expect((await browse("area=test-vn&limit=1")).total).toBe(r.total); // a country includes its provinces

      // The areas list rolls counts up to the country and drops the "Thành phố" prefix.
      (t.app.get(PlacesService) as unknown as { areaCache: null }).areaCache = null;
      const areas = (await t.anon().get("/places/areas")).body as GeoAreaOption[];
      expect(areas.find((a) => a.slug === "test-vn-da-nang")).toMatchObject({ shortName: "Đà Nẵng", kind: "city", parentSlug: "test-vn", placeCount: r.total });
      expect(areas.find((a) => a.slug === "test-vn")).toMatchObject({ kind: "country", placeCount: r.total });
      expect((await t.anon().get("/places/browse?area=atlantis")).status).toBe(404);

      // A destination created for the whole city covers its area, not a circle around its centre.
      await t.prisma.destination.create({
        data: { slug: "test-da-nang", name: "Da Nang", country: "Vietnam", lat: 16.05, lng: 108.2, paletteA: "#000000", paletteB: "#ffffff", areaId: city.id, representsAreaId: city.id, autoCreated: true },
      });
      const viaDest = await browse("destination=test-da-nang&limit=48");
      expect(viaDest).toMatchObject({ total: r.total, radiusKm: null, area: { slug: "test-vn-da-nang" }, center: { label: "Da Nang" } });
      const page = (await t.anon().get("/destinations/test-da-nang")).body as DestinationPage;
      expect(page.places.length).toBeGreaterThan(0);
      expect(page.places.every((p) => p.destinationName === "Hội An")).toBe(true);
      // Listed after the hand-picked ones (all have no trips here), marked as an area destination.
      const list = (await t.anon().get("/destinations")).body as DestinationView[];
      expect(list.find((d) => d.slug === "test-da-nang")?.kind).toBe("area");
      expect(list.findIndex((d) => d.slug === "test-da-nang")).toBeGreaterThan(list.findIndex((d) => d.kind === "curated" && d.tripCount === 0));
    } finally {
      await t.prisma.destination.deleteMany({ where: { slug: "test-da-nang" } });
      await t.prisma.place.updateMany({ where: { areaId: city.id }, data: { areaId: null } });
      await t.prisma.geoArea.deleteMany({ where: { source: "test" } });
    }
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
    const minh = await t.as("minh@golaly.dev");
    const linh = await t.as("linh@golaly.dev");
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

describe("place names in the viewer's language", () => {
  const id = place("banh-mi-phuong");
  beforeAll(async () => {
    await t.prisma.placeName.createMany({
      data: [
        { placeId: id, lang: "en", kind: "primary", name: "Phuong Banh Mi Shop", source: "test" },
        { placeId: id, lang: "ja", kind: "primary", name: "バインミー・フーン", source: "test" },
      ],
      skipDuplicates: true,
    });
  });
  afterAll(() => t.prisma.placeName.deleteMany({ where: { placeId: id, source: "test" } }));

  it("follows Accept-Language with fallbacks and keeps the local name next to a translation", async () => {
    const get = async (lang?: string) => {
      const req = t.anon().get(`/places/${id}`);
      const res = await (lang ? req.set("Accept-Language", lang) : req);
      expect(res.status).toBe(200);
      return res.body as PlaceDetail;
    };
    const local = await get();
    expect(local.localName).toBeNull();
    const en = await get("en-GB,en;q=0.9");
    expect(en.name).toBe("Phuong Banh Mi Shop");
    expect(en.localName).toBe(local.name);
    expect(en.names.map((n) => n.name)).not.toContain("Phuong Banh Mi Shop"); // shown as the title, not "also known as"
    expect((await get("fr,ja;q=0.5")).name).toBe("バインミー・フーン"); // no French name → next language
    expect((await get("de")).name).toBe(local.name); // nothing in German → local name, never machine-translated
    expect((await get("und")).name).toBe(local.name); // Settings → "Local names"
  });
});

describe("text search at catalog scale", () => {
  it("ranks a very broad query on a bounded sample (totals become 'at least'), keeps exact names, and falls back to close spellings", async () => {
    const food = await t.prisma.category.findUniqueOrThrow({ where: { key: "food.street_food" } });
    // 1,700 places sharing a word: more than one query ranks in full.
    await t.prisma.$executeRaw`
      INSERT INTO places (id, name, name_norm, category, category_id, lat, lng, address, search_text, search_accent, updated_at)
      SELECT gen_random_uuid(), 'Zebrafruit Stall ' || n, 'zebrafruit stall ' || n, 'RESTAURANT', ${food.id}::uuid, 10.7 + n / 100000.0, 106.7, '',
             'zebrafruit stall ' || n, 'zebrafruit stall ' || n, now()
      FROM generate_series(1, 1700) n`;
    const exact = await t.prisma.place.create({
      data: { name: "Zebrafruit", nameNorm: "zebrafruit", category: "RESTAURANT", categoryId: food.id, lat: 10.69, lng: 106.7, searchText: "zebrafruit", searchAccent: "zebrafruit" },
    });
    try {
      const wide = await browse("q=zebrafruit&limit=5");
      expect(wide.totalIsEstimate).toBe(true);
      expect(wide.total).toBeGreaterThan(1500);
      expect(wide.items[0].id).toBe(exact.id); // the exact name comes first even though most matches weren't ranked

      const narrow = await browse("q=zebrafruit%20stall%201234");
      expect(narrow.totalIsEstimate).toBe(false);
      expect(narrow.items[0].name).toBe("Zebrafruit Stall 1234");

      // Nothing starts with "zebrafriut": close spellings are tried only then.
      const typo = (await t.anon().get("/search?q=zebrafriut&type=places")).body as { places: PlaceView[] };
      expect(typo.places.length).toBeGreaterThan(0);
      expect(typo.places[0].name).toMatch(/^Zebrafruit/);
    } finally {
      await t.prisma.$executeRaw`DELETE FROM places WHERE name_norm LIKE 'zebrafruit%'`;
    }
  });
});
