/**
 * Query keys, centralised so mutations and realtime events can invalidate precisely. A plain module (not
 * "use client"), so server components can prefetch under the same keys (lib/api/server.ts).
 */
export const keys = {
  me: ["me"] as const,
  trip: (id: string) => ["trip", id] as const,
  /** Under the trip's key, so realtime events and trip invalidations refresh it too. */
  expenses: (id: string) => ["trip", id, "expenses"] as const,
  myTrips: (filter: string) => ["trips", "mine", filter] as const,
  savedTrips: ["trips", "saved"] as const,
  feed: (mode: string) => ["feed", mode] as const,
  explore: ["explore"] as const,
  destinations: ["destinations"] as const,
  destination: (slug: string) => ["destination", slug] as const,
  search: (q: string, type: string) => ["search", q, type] as const,
  places: (q: string, tripId?: string) => ["places", q, tripId ?? ""] as const,
  savedPlaces: ["places", "saved"] as const,
  categories: ["places", "categories"] as const,
  geoAreas: ["places", "areas"] as const,
  placeBrowse: (params: Record<string, string | number | undefined>) => ["places", "browse", params] as const,
  place: (id: string) => ["places", "detail", id] as const,
  tripTargets: (placeId: string) => ["places", "targets", placeId] as const,
  post: (id: string) => ["post", id] as const,
  comments: (id: string) => ["post", id, "comments"] as const,
  savedPosts: ["posts", "saved"] as const,
  profile: (handle: string) => ["profile", handle] as const,
  userTrips: (handle: string) => ["profile", handle, "trips"] as const,
  userPosts: (handle: string) => ["profile", handle, "posts"] as const,
  follows: (handle: string, which: string) => ["profile", handle, which] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  invitation: (by: string) => ["invitation", by] as const,
};
