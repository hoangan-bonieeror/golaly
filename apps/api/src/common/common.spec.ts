import { createInvitationSchema, createItemSchema, createTripSchema, registerSchema } from "@triply/shared";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { addDays, dayCount } from "./dates";

describe("crypto", () => {
  it("hashes passwords with argon2id and verifies them", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
  });

  it("generates unguessable url-safe tokens and stores only hashes", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(sha256(a)).toHaveLength(64);
    expect(sha256(a)).not.toContain(a);
  });
});

describe("dates", () => {
  it("counts inclusive days and shifts dates across months", () => {
    expect(dayCount("2027-03-10", "2027-03-16")).toBe(7);
    expect(addDays("2027-02-27", 2)).toBe("2027-03-01");
  });
});

describe("shared validation (same schemas the web forms use)", () => {
  it("rejects bad registration input", () => {
    const r = registerSchema.safeParse({ email: "nope", username: "a", password: "short" });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(["email", "password", "username"]);
  });

  it("normalises email and username", () => {
    expect(registerSchema.parse({ email: " An@Example.COM ", username: "An.Nguyen", password: "12345678" })).toMatchObject({ email: "an@example.com", username: "an.nguyen" });
  });

  it("rejects trips that end before they start", () => {
    expect(createTripSchema.safeParse({ title: "Trip", startDate: "2027-03-10", endDate: "2027-03-01" }).success).toBe(false);
  });

  it("rejects items whose end time is before the start time", () => {
    expect(createItemSchema.safeParse({ type: "PLACE", title: "x", startTime: "10:00", endTime: "09:00" }).success).toBe(false);
    expect(createItemSchema.safeParse({ type: "PLACE", title: "x", startTime: "25:00" }).success).toBe(false);
  });

  it("never lets a client invite someone as OWNER", () => {
    expect(createInvitationSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });
});

describe("search normalisation", () => {
  it("strips accents (incl. Vietnamese đ) and splits words safely", () => {
    const { normalizeSearch } = jest.requireActual("@triply/shared");
    const { queryWords } = jest.requireActual("../modules/search/ranker");
    expect(normalizeSearch("  Đà Lạt — Hội An  ")).toBe("da lat — hoi an");
    expect(queryWords(normalizeSearch("Sensō-ji, Tokyo!! a"))).toEqual(["senso", "ji", "tokyo"]);
    expect(queryWords("%_%")).toEqual([]);
  });
});
