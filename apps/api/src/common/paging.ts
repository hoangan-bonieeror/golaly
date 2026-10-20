import type { Paged } from "@golaly/shared";

/** Rows were fetched with `take: limit + 1`; the extra row only tells us whether there's a next page. */
export function pageOf<R extends { id: string }, T>(rows: R[], limit: number, map: (r: R) => T): Paged<T> {
  const page = rows.slice(0, limit);
  return { items: page.map(map), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}
