"use client";

import { ROLE_LABEL, type TripSummary } from "@triply/shared";
import { Bookmark, GitFork, Link2, Lock, MapPin } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { useAction, useMe } from "@/lib/api/queries";
import { Avatar, cx, formatCount } from "../ui";
import { Cover } from "./Cover";

/**
 * "Understand a trip in < 5 seconds" (spec §36): destination, duration,
 * creator, places and cover are all visible without interaction.
 */
export function TripCard({ trip, compact, showRole }: { trip: TripSummary; compact?: boolean; showRole?: boolean }) {
  const me = useMe().data;
  const save = useAction((on: boolean) => (on ? api.post<TripSummary>(`/trips/${trip.id}/save`) : api.delete<TripSummary>(`/trips/${trip.id}/save`)), {
    invalidate: [["trips"], ["explore"], ["search"], ["destination"], ["profile"], ["trip", trip.id]],
    success: (r) => (r.savedByMe ? "Saved to your trips" : "Removed from saved"),
  });
  const s = trip.stats;
  const role = showRole && trip.myRole && trip.myRole !== "OWNER" ? ROLE_LABEL[trip.myRole] : null;

  return (
    <article className="group relative">
      <Link href={`/trips/${trip.id}`} className="block" aria-label={`${trip.title} — ${s.days} days, ${trip.route || "destination TBD"}`}>
        <Cover palette={trip.cover} seed={trip.id} image={trip.coverImage} imageUrl={trip.coverUrl} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className={cx("w-full transition-transform duration-300 group-hover:scale-[1.01]", compact ? "aspect-[4/3]" : "aspect-[5/4]")}>
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
                <MapPin className="size-3.5" /> {trip.route || "Destination TBD"}
              </p>
            </div>
          </div>
        </Cover>
      </Link>
      {me && !trip.myRole && trip.visibility !== "PRIVATE" && (
        <button
          onClick={() => save.run(!trip.savedByMe)}
          disabled={save.isPending}
          aria-label={trip.savedByMe ? "Remove from saved" : "Save trip"}
          aria-pressed={trip.savedByMe}
          className="absolute right-3 top-12 flex size-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm backdrop-blur hover:bg-white"
        >
          <Bookmark className={cx("size-4", trip.savedByMe && "fill-sunset text-sunset")} />
        </button>
      )}
      <div className="mt-2.5 flex items-center gap-2 px-0.5 text-[13px] text-muted">
        <Avatar user={trip.owner} size={22} />
        <span className="truncate font-medium text-ink-2">{trip.owner.displayName}</span>
        {role && <span className="rounded-full bg-sand-2 px-2 py-px text-[11px] font-semibold text-ink-2">{role}</span>}
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
