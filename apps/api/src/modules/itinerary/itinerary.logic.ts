/**
 * Pure ordering rules for itinerary items — unit tested in isolation.
 */
export interface Orderable {
  id: string;
  startTime: string | null;
  sortOrder: number;
}

/**
 * Timed items are kept in chronological order; untimed items (notes, "free afternoon")
 * keep the slot the user put them in. Returns ids in their new order.
 */
export function orderByTime<T extends Orderable>(items: T[]): string[] {
  const list = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const timed = list.filter((i) => i.startTime).sort((a, b) => a.startTime!.localeCompare(b.startTime!) || a.sortOrder - b.sortOrder);
  let t = 0;
  return list.map((i) => (i.startTime ? timed[t++] : i).id);
}

/** Moves `id` to `index` within `targetIds` (which must not already contain it). */
export function insertAt(targetIds: string[], id: string, index: number): string[] {
  const without = targetIds.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), id, ...without.slice(at)];
}
