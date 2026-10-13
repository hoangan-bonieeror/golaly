"use client";

import type { TripSummary } from "@triply/shared";
import { Bookmark, GitFork, Link2, Lock, MapPin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ViewTransition } from "react";
import { api } from "@/lib/api/client";
import { useAction, useMe } from "@/lib/api/queries";
import { useFormat, useT } from "@/i18n/client";
import { Avatar, cx } from "../ui";
import { Cover } from "./Cover";

/**
 * "Understand a trip in < 5 seconds" (spec §36): destination, duration,
 * creator, places and cover are all visible without interaction.
 */
/** `level`: the card title's heading level — h2 when the page has no section headings above the grid. */
/**
 * `morph`: the cover and title morph into the planner header when opened (shared-element view transition).
 * Only one card per trip may have it on a page — leave it off for copies hidden at some breakpoints.
 */
export function TripCard({ trip, compact, showRole, level = "h3", morph }: { trip: TripSummary; compact?: boolean; showRole?: boolean; level?: "h2" | "h3"; morph?: boolean }) {
  const H = level;
  const qc = useQueryClient();
  const me = useMe().data;
  const t = useT();
  const f = useFormat();
  const save = useAction((on: boolean) => (on ? api.post<TripSummary>(`/trips/${trip.id}/save`) : api.delete<TripSummary>(`/trips/${trip.id}/save`)), {
    invalidate: [["trips"], ["explore"], ["search"], ["destination"], ["profile"], ["trip", trip.id]],
    success: (r) => (r.savedByMe ? t.trips.save.added : t.trips.save.removed),
  });
  const s = trip.stats;
  const role = showRole && trip.myRole && trip.myRole !== "OWNER" ? t.labels.role[trip.myRole] : null;

  return (
    <article className="group relative">
      <Link
        href={`/trips/${trip.id}`}
        // The planner renders its header from this while the full trip loads, so the morph has a target.
        onClick={() => qc.setQueryData(["trip-preview", trip.id], trip)}
        className="block" aria-label={t.trips.card.label(trip.title, s.days, trip.route || t.trips.card.destinationTbd)}>
        <Morph name={morph ? `trip-cover-${trip.id}` : undefined}>
        <Cover palette={trip.cover} seed={trip.id} image={trip.coverImage} imageUrl={trip.coverUrl} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className={cx("w-full transition-transform duration-300 group-hover:scale-[1.01]", compact ? "aspect-[4/3]" : "aspect-[5/4]")}>
          <div className="flex h-full flex-col justify-between p-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="rounded-full bg-black/35 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                {t.format.days(s.days)}
              </span>
              {trip.visibility !== "PUBLIC" && (
                <span className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                  {trip.visibility === "PRIVATE" ? <Lock className="size-3" /> : <Link2 className="size-3" />}
                  {trip.visibility === "PRIVATE" ? t.labels.visibility.PRIVATE.label : t.trips.card.linkOnly}
                </span>
              )}
            </div>
            <div className="text-white">
              <Morph name={morph ? `trip-title-${trip.id}` : undefined}>
                <H className="font-display text-xl font-semibold leading-tight drop-shadow-sm">{trip.title}</H>
              </Morph>
              <p className="mt-0.5 flex items-center gap-1 text-[13px] text-white/90">
                <MapPin className="size-3.5" /> {trip.route || t.trips.destinationTbd}
              </p>
            </div>
          </div>
        </Cover>
        </Morph>
      </Link>
      {me && !trip.myRole && trip.visibility !== "PRIVATE" && (
        <button
          onClick={() => save.run(!trip.savedByMe)}
          disabled={save.isPending}
          aria-label={trip.savedByMe ? t.trips.save.unsave : t.trips.save.saveTrip}
          aria-pressed={trip.savedByMe}
          className="absolute right-3 top-12 flex size-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm backdrop-blur hover:bg-white"
        >
          <Bookmark className={cx("size-4", trip.savedByMe && "fill-accent text-accent")} />
        </button>
      )}
      <div className="mt-2.5 flex items-center gap-2 px-0.5 text-[13px] text-muted">
        <Avatar user={trip.owner} size={22} />
        <span className="truncate font-medium text-ink-2">{trip.owner.displayName}</span>
        {role && <span className="rounded-full bg-sand-2 px-2 py-px text-[11px] font-semibold text-ink-2">{role}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span>{t.format.places(s.places)}</span>
          {trip.visibility === "PUBLIC" && trip.forkCount > 0 && (
            <span className="flex items-center gap-1">
              <GitFork className="size-3.5" />
              {f.count(trip.forkCount)}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

/** A named shared element for the card ↔ planner morph; a no-op without a name. */
export function Morph({ name, children }: { name?: string; children: React.ReactElement }) {
  if (!name) return children;
  return (
    <ViewTransition name={name} share="trip-morph" default="none">
      {children}
    </ViewTransition>
  );
}
