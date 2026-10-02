"use client";

import type { Trip } from "@triply/shared";
import { Bookmark, GitFork, Lock, Link2, MapPin } from "lucide-react";
import Link from "next/link";
import { routeLabel, tripStats, userById } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";
import { Avatar, cx, formatCount } from "../ui";
import { Cover } from "./Cover";

/**
 * "Understand a trip in < 5 seconds" (spec §36): destination, duration,
 * creator, places and cover are all visible without interaction.
 */
export function TripCard({ trip, compact, showRole }: { trip: Trip; compact?: boolean; showRole?: string | null }) {
  const { db, me, actions, toast } = useStore();
  const s = tripStats(db, trip);
  const owner = userById(db, trip.ownerId);
  const saved = db.savedTrips.some((x) => x.userId === me && x.tripId === trip.id);

  return (
    <article className="group relative">
      <Link href={`/trips/${trip.id}`} className="block">
        <Cover palette={trip.cover} seed={trip.id} className={cx("w-full transition-transform duration-300 group-hover:scale-[1.01]", compact ? "aspect-[4/3]" : "aspect-[5/4]")}>
          <div className="flex h-full flex-col justify-between p-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="rounded-full bg-black/35 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                {s.days} {s.days === 1 ? "day" : "days"}
              </span>
              {trip.visibility !== "PUBLIC" && (
                <span className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                  {trip.visibility === "PRIVATE" ? <Lock className="size-3" /> : <Link2 className="size-3" />}
                  {trip.visibility === "PRIVATE" ? "Private" : "Link"}
                </span>
              )}
            </div>
            <div className="text-white">
              <h3 className="font-display text-xl font-semibold leading-tight drop-shadow-sm">{trip.title}</h3>
              <p className="mt-0.5 flex items-center gap-1 text-[13px] text-white/90">
                <MapPin className="size-3.5" /> {routeLabel(db, trip) || "Destination TBD"}
              </p>
            </div>
          </div>
        </Cover>
      </Link>
      {me && trip.ownerId !== me && trip.visibility !== "PRIVATE" && (
        <button
          onClick={() => {
            const r = actions.toggleSaveTrip(trip.id);
            if (r !== undefined) toast(r ? "Saved to your trips" : "Removed from saved");
          }}
          aria-label={saved ? "Remove from saved" : "Save trip"}
          aria-pressed={saved}
          className="absolute right-3 top-12 flex size-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm backdrop-blur hover:bg-white"
        >
          <Bookmark className={cx("size-4", saved && "fill-sunset text-sunset")} />
        </button>
      )}
      <div className="mt-2.5 flex items-center gap-2 px-0.5 text-[13px] text-muted">
        <Avatar user={owner} size={22} />
        <span className="truncate font-medium text-ink-2">{owner?.displayName}</span>
        {showRole && <span className="rounded-full bg-sand-2 px-2 py-px text-[11px] font-semibold text-ink-2">{showRole}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span>{s.places} places</span>
          {trip.visibility === "PUBLIC" && trip.forkCount > 0 && (
            <span className="flex items-center gap-1">
              <GitFork className="size-3.5" />
              {formatCount(trip.forkCount)}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

