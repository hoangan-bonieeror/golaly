/** Type-ahead under the navbar search (GET /search/suggest): places and destinations only, a few of each. */
import type { SearchSuggestions } from "@triply/shared";
import { createTestContext, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());
const suggest = async (q: string) => (await t.anon().get(`/search/suggest?q=${encodeURIComponent(q)}`)).body as SearchSuggestions;

describe("search suggestions", () => {
  it("returns the best few places and destinations for a partial word", async () => {
    const r = await suggest("hoi");
    expect(r.destinations.map((d) => d.slug)).toContain("hoi-an");
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.places.length).toBeLessThanOrEqual(6);
    expect(r.destinations.length).toBeLessThanOrEqual(3);
    expect(Object.keys(r).sort()).toEqual(["destinations", "places"]); // no trips or people
  });

  it("matches as the word grows, with or without accents", async () => {
    const plain = await suggest("hoi an");
    const accented = await suggest("Hội An");
    expect(plain.destinations[0]?.slug).toBe("hoi-an");
    expect(accented.destinations[0]?.slug).toBe("hoi-an");
    // A place named after the search comes before one that only lies there.
    expect(plain.places[0]?.name).toBe("Hội An Ancient Town");
  });

  it("needs two characters, and finds nothing for nonsense", async () => {
    expect(await suggest("h")).toEqual({ places: [], destinations: [] });
    expect(await suggest("   ")).toEqual({ places: [], destinations: [] });
    const none = await suggest("zzqxv");
    expect(none.places).toHaveLength(0);
    expect(none.destinations).toHaveLength(0);
  });
});
