import type { TripRole, TripVisibility, UUID } from "./types";

/** Minimal shapes so both DB rows (Date) and API objects (string) can be checked. */
export interface PermissionTrip {
  id: UUID;
  ownerId: UUID;
  visibility: TripVisibility;
  allowFork: boolean;
  deletedAt?: unknown;
}
export interface PermissionMember {
  tripId: UUID;
  userId: UUID;
  role: TripRole;
}

/**
 * Single source of truth for trip permissions (spec §6 Collaboration, §28).
 *
 * The API's TripAccessService enforces these on every request using roles read
 * from the database; the web app only receives the resulting `permissions` list
 * as UI hints. Never trust a role supplied by the client.
 */

export type TripAction =
  | "trip.view"
  | "trip.edit_details"
  | "trip.delete"
  | "trip.change_visibility"
  | "trip.fork"
  | "itinerary.view"
  | "itinerary.add"
  | "itinerary.edit"
  | "itinerary.delete"
  | "itinerary.reorder"
  /** Say how much you want to go somewhere (every member, viewers included: it changes nothing by itself). */
  | "itinerary.vote"
  /** Add photos of the trip's stops (every member: they're the group's memories). */
  | "itinerary.photo"
  /** See and add the group's expenses (members only — never public, whatever the trip's visibility). */
  | "expenses.manage"
  | "members.view"
  | "members.invite"
  | "members.change_role"
  | "members.remove";

const ROLE_ACTIONS: Record<TripRole, ReadonlySet<TripAction>> = {
  OWNER: new Set<TripAction>([
    "trip.view",
    "trip.edit_details",
    "trip.delete",
    "trip.change_visibility",
    "trip.fork",
    "itinerary.view",
    "itinerary.add",
    "itinerary.edit",
    "itinerary.delete",
    "itinerary.reorder",
    "itinerary.vote",
    "itinerary.photo",
    "expenses.manage",
    "members.view",
    "members.invite",
    "members.change_role",
    "members.remove",
  ]),
  EDITOR: new Set<TripAction>([
    "trip.view",
    "trip.fork",
    "itinerary.view",
    "itinerary.add",
    "itinerary.edit",
    "itinerary.delete",
    "itinerary.reorder",
    "itinerary.vote",
    "itinerary.photo",
    "expenses.manage",
    "members.view",
  ]),
  VIEWER: new Set<TripAction>(["trip.view", "trip.fork", "itinerary.view", "itinerary.vote", "itinerary.photo", "expenses.manage", "members.view"]),
};

/** Actions a non-member may perform on a PUBLIC / LINK_ONLY trip. */
const PUBLIC_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  "trip.view",
  "itinerary.view",
]);

export function roleFor(
  trip: Pick<PermissionTrip, "id" | "ownerId">,
  members: PermissionMember[],
  userId: UUID | null | undefined,
): TripRole | null {
  if (!userId) return null;
  if (trip.ownerId === userId) return "OWNER";
  return members.find((m) => m.tripId === trip.id && m.userId === userId)?.role ?? null;
}

export function can(
  action: TripAction,
  ctx: {
    trip: PermissionTrip;
    members: PermissionMember[];
    userId: UUID | null | undefined;
  },
): boolean {
  const { trip, members, userId } = ctx;
  if (trip.deletedAt) return false;
  const role = roleFor(trip, members, userId);

  if (action === "trip.fork") {
    // Must be logged in, trip must be discoverable/allowed, and you can't fork your own.
    if (!userId || trip.ownerId === userId) return false;
    const visible = role !== null || trip.visibility !== "PRIVATE";
    return visible && trip.allowFork && trip.visibility === "PUBLIC";
  }

  if (role) return ROLE_ACTIONS[role].has(action);
  if (trip.visibility !== "PRIVATE") return PUBLIC_ACTIONS.has(action);
  return false;
}

/** Members list rules: OWNER cannot be demoted/removed; roles assignable by owner. */
export const ASSIGNABLE_ROLES: Exclude<TripRole, "OWNER">[] = ["EDITOR", "VIEWER"];

export class PermissionError extends Error {
  constructor(public readonly action: TripAction) {
    super("You no longer have permission to do this.");
    this.name = "PermissionError";
  }
}

export function assertCan(...args: Parameters<typeof can>): void {
  if (!can(...args)) throw new PermissionError(args[0]);
}
