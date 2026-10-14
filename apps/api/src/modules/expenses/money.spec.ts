import { balances, currencyDigits, isCurrency, parseAmount, settleUp, splitEqually } from "@triply/shared";

describe("currencies", () => {
  it("knows each currency's smallest unit", () => {
    expect(["VND", "JPY", "USD", "EUR", "KWD"].map(currencyDigits)).toEqual([0, 0, 2, 2, 3]);
    expect(isCurrency("VND")).toBe(true);
    expect(isCurrency("XXQ")).toBe(false);
    expect(isCurrency("usd")).toBe(false);
  });

  it("reads amounts as typed, in minor units", () => {
    expect(parseAmount("350000", 0)).toBe(350000);
    expect(parseAmount("350.000", 0)).toBe(350000); // Vietnamese thousands separator
    expect(parseAmount("350 000", 0)).toBe(350000);
    expect(parseAmount("12.5", 2)).toBe(1250);
    expect(parseAmount("12,50", 2)).toBe(1250);
    expect(parseAmount("1,234.56", 2)).toBe(123456);
    expect(parseAmount("1.234,56", 2)).toBe(123456);
    expect(parseAmount("0", 0)).toBeNull();
    expect(parseAmount("abc", 2)).toBeNull();
    expect(parseAmount("", 2)).toBeNull();
  });
});

describe("splitEqually", () => {
  it("always adds up, leftovers one unit each to the first people", () => {
    expect(splitEqually(100, ["a", "b", "c"])).toEqual([
      { userId: "a", amount: 34 },
      { userId: "b", amount: 33 },
      { userId: "c", amount: 33 },
    ]);
    const s = splitEqually(1_000_001, ["a", "b", "c", "d", "e", "f", "g"]);
    expect(s.reduce((x, y) => x + y.amount, 0)).toBe(1_000_001);
    expect(Math.max(...s.map((x) => x.amount)) - Math.min(...s.map((x) => x.amount))).toBeLessThanOrEqual(1);
    expect(splitEqually(5, [])).toEqual([]);
  });
});

describe("balances and settling up", () => {
  const trip = {
    expenses: [
      // An pays dinner 900 for all three; Minh pays taxi 300 for An and Minh.
      { paidById: "an", amount: 900, shares: splitEqually(900, ["an", "minh", "nam"]) },
      { paidById: "minh", amount: 300, shares: splitEqually(300, ["an", "minh"]) },
    ],
    settlements: [] as { fromId: string; toId: string; amount: number }[],
  };

  it("nets what each person paid against their shares", () => {
    const b = balances(trip);
    expect(Object.fromEntries([...b].map(([k, v]) => [k, v.net]))).toEqual({ an: 450, minh: -150, nam: -300 });
    expect(b.get("an")).toMatchObject({ paid: 900, owed: 450 });
  });

  it("settles with the fewest transfers, and repayments bring everyone to zero", () => {
    const net = new Map([...balances(trip)].map(([k, v]) => [k, v.net]));
    const plan = settleUp(net);
    expect(plan).toEqual([
      { fromId: "nam", toId: "an", amount: 300 },
      { fromId: "minh", toId: "an", amount: 150 },
    ]);
    const after = balances({ ...trip, settlements: plan });
    expect([...after.values()].every((v) => v.net === 0)).toBe(true);
    expect(settleUp(new Map([...after].map(([k, v]) => [k, v.net])))).toEqual([]);
  });

  it("never needs more transfers than people minus one", () => {
    const net = { a: 70, b: -20, c: -20, d: -20, e: -10 };
    const plan = settleUp(net);
    expect(plan.length).toBeLessThanOrEqual(4);
    const sum = new Map(Object.entries(net));
    plan.forEach((t) => {
      sum.set(t.fromId, sum.get(t.fromId)! + t.amount);
      sum.set(t.toId, sum.get(t.toId)! - t.amount);
    });
    expect([...sum.values()].every((v) => v === 0)).toBe(true);
  });
});
