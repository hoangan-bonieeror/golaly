/** The search backfill (SearchIndexService) — run on every start, so it must be cheap when there's nothing to do. */
import { SearchIndexService } from "../src/modules/search/search-index";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

describe("search backfill", () => {
  it("fills places with empty search text, and stops on one that has no text at all", async () => {
    const named = await t.prisma.place.create({ data: { name: "Backfill Bakery", category: "RESTAURANT", lat: 1.1, lng: 1.1, address: "9 Flour Lane", searchText: "", searchAccent: "" } });
    const blank = await t.prisma.place.create({ data: { name: "", category: "PLACE", lat: 1.2, lng: 1.2, address: "", searchText: "", searchAccent: "" } });
    const n = await t.app.get(SearchIndexService).backfill();
    expect(n).toBeGreaterThanOrEqual(2);
    const after = await t.prisma.place.findUniqueOrThrow({ where: { id: named.id } });
    expect(after.searchText).toContain("backfill bakery");
    expect(after.searchAccent).toContain("flour lane");
    expect(after.nameNorm).toBe("backfill bakery");
    // Nothing left to do: the next run reads only the (empty-text) place it can't fill.
    expect(await t.app.get(SearchIndexService).backfill()).toBeLessThanOrEqual(1);
    await t.prisma.place.deleteMany({ where: { id: { in: [named.id, blank.id] } } });
  });

  it("fills a missing name_norm (places created outside the pipeline), which the name tiers of the ranking need", async () => {
    // Search text present, only the normalised name missing.
    const p = await t.prisma.place.create({ data: { name: "Chùa Cầu Backfill", category: "PLACE", lat: 1.3, lng: 1.3, address: "", searchText: "chua cau backfill", searchAccent: "chùa cầu backfill", nameNorm: "" } });
    await t.app.get(SearchIndexService).backfill();
    expect((await t.prisma.place.findUniqueOrThrow({ where: { id: p.id } })).nameNorm).toBe("chua cau backfill");
    await t.prisma.place.delete({ where: { id: p.id } });
  });

  it("finds unfilled places through the partial index, not a scan of the catalog", async () => {
    // The test catalog is tiny (a scan is cheaper there), so ask whether the index *can* serve the query.
    const plan = await t.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>("EXPLAIN SELECT id FROM places WHERE search_text = '' OR search_accent = '' OR (name_norm = '' AND name <> '') LIMIT 500");
    });
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toContain("places_search_unfilled_idx");
    expect(text).not.toContain("Seq Scan");
  });
});
