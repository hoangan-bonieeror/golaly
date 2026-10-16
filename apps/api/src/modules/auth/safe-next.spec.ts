import { safeNext } from "@triply/shared";

describe("safeNext (where to go after signing in)", () => {
  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/ /evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    "/%5Cevil.com\\",
  ])("refuses %j", (next) => {
    expect(safeNext(next)).toBe("/home");
  });

  it("keeps our own paths, with query and hash", () => {
    expect(safeNext("/trips/1?tab=members#day-2")).toBe("/trips/1?tab=members#day-2");
    expect(safeNext("/explore?tab=places&dest=hoi-an")).toBe("/explore?tab=places&dest=hoi-an");
    // An encoded backslash stays an encoded character in the path: still this site.
    expect(safeNext("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(new URL(safeNext("/%5Cevil.com"), "https://triply.app").origin).toBe("https://triply.app");
  });

  it("uses the fallback for anything that isn't a string", () => {
    expect(safeNext(null, "/x")).toBe("/x");
    expect(safeNext(42)).toBe("/home");
  });
});
