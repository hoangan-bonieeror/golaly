import { clusterByArea, groupScore, orderBySlot, presentOn, slotForTime, type ItemSlot } from "@triply/shared";
import { insertAt } from "./itinerary.logic";

const item = (id: string, sortOrder: number, startTime: string | null = null, slot: ItemSlot = startTime ? slotForTime(startTime) : "ANY") => ({ id, sortOrder, startTime, slot });

describe("slotForTime", () => {
  it("splits the day at noon and 17:00", () => {
    expect(["06:30", "11:59", "12:00", "16:59", "17:00", "23:30"].map(slotForTime)).toEqual(["MORNING", "MORNING", "AFTERNOON", "AFTERNOON", "EVENING", "EVENING"]);
  });
});

describe("orderBySlot", () => {
  it("groups by part of the day, any-time last", () => {
    expect(orderBySlot([item("any", 0, null, "ANY"), item("eve", 1, null, "EVENING"), item("morn", 2, null, "MORNING"), item("aft", 3, null, "AFTERNOON")])).toEqual(["morn", "aft", "eve", "any"]);
  });

  it("sorts anchors chronologically within their part of the day", () => {
    expect(orderBySlot([item("c", 0, "11:00"), item("a", 1, "08:00"), item("b", 2, "09:30")])).toEqual(["a", "b", "c"]);
  });

  it("keeps untimed items where the user put them", () => {
    expect(orderBySlot([item("lunch", 0, "11:30"), item("museum", 1, null, "MORNING"), item("breakfast", 2, "08:00")])).toEqual(["breakfast", "museum", "lunch"]);
  });

  it("is stable for equal times", () => {
    expect(orderBySlot([item("x", 0, "10:00"), item("y", 1, "10:00")])).toEqual(["x", "y"]);
  });
});

describe("insertAt", () => {
  it("moves within a list", () => {
    expect(insertAt(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });
  it("inserts into another list and clamps the index", () => {
    expect(insertAt(["a", "b"], "z", 99)).toEqual(["a", "b", "z"]);
    expect(insertAt(["a", "b"], "z", -5)).toEqual(["z", "a", "b"]);
  });
});

describe("groupScore", () => {
  it("weighs love over fine and counts skips against", () => {
    expect(groupScore([{ level: "LOVE" }, { level: "OK" }, { level: "SKIP" }])).toBe(2);
    expect(groupScore([])).toBe(0);
  });
});

describe("presentOn", () => {
  it("treats missing dates as open-ended", () => {
    expect(presentOn({ arriveOn: null, leaveOn: null }, "2027-01-10")).toBe(true);
    expect(presentOn({ arriveOn: "2027-01-12", leaveOn: null }, "2027-01-10")).toBe(false);
    expect(presentOn({ arriveOn: "2027-01-08", leaveOn: "2027-01-10" }, "2027-01-10")).toBe(true);
    expect(presentOn({ arriveOn: null, leaveOn: "2027-01-09" }, "2027-01-10")).toBe(false);
    expect(presentOn({ arriveOn: "2027-01-12", leaveOn: null }, null)).toBe(true);
  });
});

describe("clusterByArea", () => {
  // Hội An old town (three places a few hundred metres apart), An Bàng beach (two, ~4 km away), and a lone place.
  const pts = [
    { id: "p1", lat: 15.8771, lng: 108.3262, areaName: "Hội An" },
    { id: "p2", lat: 15.8794, lng: 108.3283, areaName: "Hội An" },
    { id: "p3", lat: 15.8768, lng: 108.3301, areaName: "Minh An" },
    { id: "b1", lat: 15.9128, lng: 108.3399, areaName: "Cẩm An" },
    { id: "b2", lat: 15.9141, lng: 108.3407, areaName: null },
    { id: "far", lat: 16.0544, lng: 108.2022, areaName: "Đà Nẵng" },
  ];

  it("groups nearby places, names each area by its most common district, largest first", () => {
    const areas = clusterByArea(pts);
    expect(areas.map((a) => a.ids)).toEqual([["p1", "p2", "p3"], ["b1", "b2"]]);
    expect(areas.map((a) => a.label)).toEqual(["Hội An", "Cẩm An"]);
    expect(areas[0].radiusKm).toBeLessThan(1);
  });

  it("chains through neighbours and respects the minimum size", () => {
    const line = [0, 1, 2, 3].map((i) => ({ id: `l${i}`, lat: 10, lng: 106 + i * 0.012 })); // ~1.3 km hops
    expect(clusterByArea(line)).toHaveLength(1);
    expect(clusterByArea(line, 1.5, 5)).toEqual([]);
  });
});
