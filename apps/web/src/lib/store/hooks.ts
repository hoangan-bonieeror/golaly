"use client";

import { can, roleFor, type TripAction, type UUID } from "@triply/shared";
import { useMemo } from "react";
import { useStore } from "./store";

/** usePermissions(tripId) — UI hint only; the mock API re-checks on every mutation. */
export function usePermissions(tripId: UUID | undefined) {
  const { db, me } = useStore();
  return useMemo(() => {
    const trip = db.trips.find((t) => t.id === tripId);
    if (!trip) return { role: null, can: (_: TripAction) => false };
    return {
      role: roleFor(trip, db.members, me),
      can: (action: TripAction) => can(action, { trip, members: db.members, userId: me }),
    };
  }, [db, me, tripId]);
}

export function useTrip(tripId: UUID | undefined) {
  const { db } = useStore();
  return db.trips.find((t) => t.id === tripId && !t.deletedAt) ?? null;
}

export function useUnreadCount() {
  const { db, me } = useStore();
  return db.notifications.filter((n) => n.userId === me && !n.readAt).length;
}
