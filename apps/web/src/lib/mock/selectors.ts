/**
 * Read-side queries. Each enforces the same privacy rules the API's GET
 * endpoints will (spec §34): private trips never leak into Explore, search,
 * feeds or public profiles unless the viewer is a member.
 */
import { can, roleFor, type Trip, type UUID } from "@triply/shared";
import type { DB } from "./seed";

export function canView(db: DB, trip: Trip, me: UUID | null) {
  return can("trip.view", { trip, members: db.members, userId: me });
}

/** Trips eligible for discovery surfaces — PUBLIC only (LINK_ONLY is unlisted). */
export function discoverableTrips(db: DB) {
  return db.trips.filter((t) => !t.deletedAt && t.visibility === "PUBLIC");
}

export function myTrips(db: DB, me: UUID | null) {
  if (!me) return [];
  return db.trips
    .filter((t) => !t.deletedAt && roleFor(t, db.members, me))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function tripDays(db: DB, tripId: UUID) {
  return db.days.filter((d) => d.tripId === tripId).sort((a, b) => a.dayNumber - b.dayNumber);
}

export function dayItems(db: DB, dayId: UUID) {
  return db.items.filter((i) => i.dayId === dayId).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function tripItems(db: DB, tripId: UUID) {
  const dayIds = new Set(tripDays(db, tripId).map((d) => d.id));
  return db.items.filter((i) => dayIds.has(i.dayId));
}

export function tripStats(db: DB, trip: Trip) {
  const days = tripDays(db, trip.id);
  const items = tripItems(db, trip.id);
  const places = new Set(items.map((i) => i.placeId).filter(Boolean));
  const travelers = db.members.filter((m) => m.tripId === trip.id).length;
  return { days: days.length, items: items.length, places: places.size, travelers };
}

export function tripMembers(db: DB, tripId: UUID) {
  const order = { OWNER: 0, EDITOR: 1, VIEWER: 2 } as const;
  return db.members
    .filter((m) => m.tripId === tripId)
    .map((m) => ({ ...m, user: db.users.find((u) => u.id === m.userId)! }))
    .sort((a, b) => order[a.role] - order[b.role]);
}

export function routeLabel(db: DB, trip: Trip) {
  return trip.destinationIds.map((id) => db.destinations.find((d) => d.id === id)?.name).filter(Boolean).join(" → ");
}

export function userById(db: DB, id: UUID) {
  return db.users.find((u) => u.id === id);
}

export function userByUsername(db: DB, username: string) {
  return db.users.find((u) => u.username === username);
}

/** Posts visible in feeds: public posts, and only if their trip (if any) is viewable. */
export function feedPosts(db: DB, me: UUID | null, mode: "for-you" | "following") {
  const following = new Set(db.follows.filter((f) => f.followerId === me).map((f) => f.followingId));
  return db.posts
    .filter((p) => p.visibility === "PUBLIC")
    .filter((p) => {
      if (!p.tripId) return true;
      const t = db.trips.find((x) => x.id === p.tripId);
      return t && !t.deletedAt && t.visibility !== "PRIVATE";
    })
    .filter((p) => (mode === "following" ? following.has(p.userId) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function search(db: DB, q: string) {
  const s = q.trim().toLowerCase();
  const match = (...fields: (string | undefined)[]) => !s || fields.some((f) => f?.toLowerCase().includes(s));
  return {
    trips: discoverableTrips(db).filter((t) => match(t.title, t.description, routeLabel(db, t))),
    places: db.places.filter((p) => match(p.name, p.address, db.destinations.find((d) => d.id === p.destinationId)?.name)),
    people: db.users.filter((u) => match(u.displayName, u.username, u.homeBase)),
    destinations: db.destinations.filter((d) => match(d.name, d.country)),
  };
}
