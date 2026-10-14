/**
 * Flexible plans on the client: the same rules the API applies (from @triply/shared), used for
 * optimistic updates so a drop, a vote or a move shows at once and the server only confirms.
 */
import { ITEM_SLOTS, orderBySlot, presentOn, SLOT_RANK, slotForTime, type ItemSlot, type ItemStatus, type ItemView, type MemberView, type TripDetail, type VoteLevel } from "@triply/shared";

export { ITEM_SLOTS };

/** A drag-and-drop list in the planner: the pool, or one part of one day. */
export type ListId = "pool" | `${string}|${ItemSlot}`;
export const listId = (dayId: string, slot: ItemSlot): ListId => `${dayId}|${slot}`;
export function parseList(id: string): { dayId: string | null; slot: ItemSlot } {
  if (id === "pool") return { dayId: null, slot: "ANY" };
  const [dayId, slot] = id.split("|");
  return { dayId, slot: slot as ItemSlot };
}

/** Where an item lands within a whole day when dropped at `index` of one part of it. */
export function dayIndexFor(dayItems: ItemView[], slot: ItemSlot, index: number, movingId: string) {
  const others = dayItems.filter((i) => i.id !== movingId);
  return others.filter((i) => SLOT_RANK[i.slot] < SLOT_RANK[slot]).length + index;
}

/** The trip with one item moved (to a day + part of the day, or back to the pool). */
export function applyMove(trip: TripDetail, id: string, toDayId: string | null, index: number, slot?: ItemSlot): TripDetail {
  const item = [...trip.pool, ...trip.days.flatMap((d) => d.items)].find((i) => i.id === id);
  if (!item) return trip;
  const toPool = toDayId === null;
  const moved: ItemView = toPool
    ? { ...item, dayId: null, slot: "ANY", startTime: null, endTime: null }
    : { ...item, dayId: toDayId, slot: item.startTime ? slotForTime(item.startTime) : (slot ?? (item.dayId ? item.slot : "ANY")) };
  const insert = (list: ItemView[]) => {
    const out = list.filter((i) => i.id !== id);
    out.splice(Math.min(index, out.length), 0, moved);
    return out;
  };
  const ordered = (list: ItemView[]) => {
    const withOrder = list.map((i, n) => ({ ...i, sortOrder: n }));
    const order = orderBySlot(withOrder);
    return order.map((x) => withOrder.find((i) => i.id === x)!);
  };
  return {
    ...trip,
    pool: toPool ? insert(trip.pool) : trip.pool.filter((i) => i.id !== id),
    days: trip.days.map((d) => (d.id === toDayId ? { ...d, items: ordered(insert(d.items)) } : { ...d, items: d.items.filter((i) => i.id !== id) })),
  };
}

/** The trip with the viewer's vote on an item set (or cleared with null). */
export function applyVote(trip: TripDetail, itemId: string, userId: string, level: VoteLevel | null): TripDetail {
  const set = (i: ItemView) => (i.id !== itemId ? i : { ...i, votes: [...i.votes.filter((v) => v.userId !== userId), ...(level ? [{ userId, level }] : [])] });
  return { ...trip, pool: trip.pool.map(set), days: trip.days.map((d) => ({ ...d, items: d.items.map(set) })) };
}

/** Members who aren't on the trip on `date` (YYYY-MM-DD); none when the day has no date. */
export function absentOn(members: MemberView[], date: string | null): MemberView[] {
  return date ? members.filter((m) => !presentOn(m, date)) : [];
}

export const firstName = (m: { displayName: string }) => m.displayName.split(" ")[0];

/** "Linh", "Linh & Nam", "Linh, Nam & Minh". */
export function nameList(names: string[], and = "&") {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

// ── After the trip (phase 3) ───────────────────────────────────────────

/** Today on this device, as YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Where a trip is in time: not started, under way, over — or undated. */
export type TripPhase = "before" | "during" | "after" | "undated";
export function tripPhase(trip: { startDate: string | null; endDate: string | null }, today = todayIso()): TripPhase {
  const start = trip.startDate ?? trip.endDate;
  const end = trip.endDate ?? trip.startDate;
  if (!start || !end) return "undated";
  if (today < start) return "before";
  return today > end ? "after" : "during";
}

/** Stops whose outcome is worth recording: anything but a note. */
export const markable = (i: ItemView) => i.type !== "NOTE";

/** The trip with some items' statuses set (optimistic). */
export function applyStatuses(trip: TripDetail, changes: Map<string, ItemStatus>): TripDetail {
  const set = (i: ItemView) => (changes.has(i.id) ? { ...i, status: changes.get(i.id)! } : i);
  return { ...trip, pool: trip.pool.map(set), days: trip.days.map((d) => ({ ...d, items: d.items.map(set) })) };
}

/** A trip where the group actually went: places that were visited (or every place, if nothing is marked yet). */
export function visitedOnly(trip: TripDetail): { trip: TripDetail; marked: boolean } {
  const marked = trip.days.some((d) => d.items.some((i) => i.status !== "PLANNED"));
  if (!marked) return { trip: { ...trip, pool: [] }, marked };
  return { trip: { ...trip, pool: [], days: trip.days.map((d) => ({ ...d, items: d.items.filter((i) => i.status === "VISITED") })) }, marked };
}

/** Did the traveller go on this trip? Marked trips need a visited stop; unmarked ones need to be over. */
export function wentOn(trip: { outcome: { visited: number } | null; startDate: string | null; endDate: string | null }, today = todayIso()) {
  return trip.outcome ? trip.outcome.visited > 0 : tripPhase(trip, today) === "after";
}
