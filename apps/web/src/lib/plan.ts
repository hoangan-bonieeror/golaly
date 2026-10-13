/**
 * Flexible plans on the client: the same rules the API applies (from @triply/shared), used for
 * optimistic updates so a drop, a vote or a move shows at once and the server only confirms.
 */
import { ITEM_SLOTS, orderBySlot, presentOn, SLOT_RANK, slotForTime, type ItemSlot, type ItemView, type MemberView, type TripDetail, type VoteLevel } from "@triply/shared";

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
