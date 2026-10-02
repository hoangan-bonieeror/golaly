import { insertAt, orderByTime } from "./itinerary.logic";

const item = (id: string, sortOrder: number, startTime: string | null = null) => ({ id, sortOrder, startTime });

describe("orderByTime", () => {
  it("sorts timed items chronologically", () => {
    expect(orderByTime([item("c", 0, "15:00"), item("a", 1, "09:00"), item("b", 2, "11:00")])).toEqual(["a", "b", "c"]);
  });

  it("keeps untimed items where the user put them", () => {
    expect(orderByTime([item("lunch", 0, "13:00"), item("note", 1), item("breakfast", 2, "08:00")])).toEqual(["breakfast", "note", "lunch"]);
  });

  it("a newly added timed item slots into place", () => {
    const existing = [item("a", 0, "09:00"), item("b", 1, "15:00")];
    expect(orderByTime([...existing, item("new", 2, "11:00")])).toEqual(["a", "new", "b"]);
  });

  it("is stable for equal times", () => {
    expect(orderByTime([item("x", 0, "10:00"), item("y", 1, "10:00")])).toEqual(["x", "y"]);
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
