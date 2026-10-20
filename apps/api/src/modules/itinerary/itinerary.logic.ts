/**
 * Pure ordering rules for itinerary items — unit tested in isolation. Day ordering by part of the
 * day (`orderBySlot`) and the other flexible-planning rules live in @golaly/shared (plan.ts), so the
 * web app applies exactly the same rules to its optimistic updates.
 */

/** Moves `id` to `index` within `targetIds` (which must not already contain it). */
export function insertAt(targetIds: string[], id: string, index: number): string[] {
  const without = targetIds.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), id, ...without.slice(at)];
}
