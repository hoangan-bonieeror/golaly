import type { Tx } from "../prisma/prisma.service";

/**
 * Serialises every structural edit of one trip (days, item order) by taking a row lock on the
 * trip inside the caller's transaction. Concurrent edits to the same trip queue up for a few
 * milliseconds instead of interleaving reads and writes — so a reorder can never act on a stale
 * list and silently move an item back. Different trips never block each other.
 */
export async function lockTrip(tx: Tx, tripId: string) {
  await tx.$queryRaw`SELECT 1 FROM trips WHERE id = ${tripId}::uuid FOR UPDATE`;
}

/** Writes `sort_order` = position for the given ids in one statement. Only touches ordering. */
export async function writeSortOrder(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE itinerary_items AS i SET sort_order = (v.ord - 1)::int
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS v(id, ord)
    WHERE i.id = v.id`;
}
