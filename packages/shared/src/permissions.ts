import type { Trip, TripMember, TripRole, UUID } from "./types";

/**
 * Single source of truth for trip permissions (spec §6 Collaboration, §28).
 *
 * In the prototype the UI calls these to decide what to render AND the mock
 * store calls them again before mutating — mimicking how the NestJS API will
 * enforce them server-side. Never trust a role supplied by the client.
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
    "members.view",
  ]),
  VIEWER: new Set<TripAction>(["trip.view", "trip.fork", "itinerary.view", "members.view"]),
};

/** Actions a non-member may perform on a PUBLIC / LINK_ONLY trip. */
const PUBLIC_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  "trip.view",
  "itinerary.view",
]);

export function roleFor(
  trip: Pick<Trip, "id" | "ownerId">,
  members: TripMember[],
  userId: UUID | null | undefined,
): TripRole | null {
  if (!userId) return null;
  if (trip.ownerId === userId) return "OWNER";
  return members.find((m) => m.tripId === trip.id && m.userId === userId)?.role ?? null;
}

export function can(
  action: TripAction,
  ctx: {
    trip: Pick<Trip, "id" | "ownerId" | "visibility" | "allowFork" | "deletedAt">;
    members: TripMember[];
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
