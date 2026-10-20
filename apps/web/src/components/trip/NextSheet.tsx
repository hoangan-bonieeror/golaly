"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NextCandidate, NextSuggestions, OpenState, TripDetail } from "@golaly/shared";
import { Clock, Lightbulb, LocateFixed, MapPin, Navigation, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { api, qs } from "@/lib/api/client";
import { keys, useAction } from "@/lib/api/queries";
import { nowHm, todayIso } from "@/lib/plan";
import { formatKm } from "@/lib/trip-geo";
import { ItemTypeIcon } from "../itinerary/ItemTypeIcon";
import { mapsLinks, useGeolocation } from "../map/Directions";
import { Button, EmptyState, ErrorState, Sheet, Skeleton, cx } from "../ui";

const isApple = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

/**
 * "Where to now?" (roadmap phase 2): asks for one position fix, then shows what's left of today's plan,
 * the ideas, and well-rated places open nearby — open first, nearest first — each with a walk estimate and
 * a one-tap hand-off to the phone's maps. Works without location too (then in plan order).
 */
export function NextSheet({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDetail }) {
  const { m } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={m.during.next.title} wide>
      {open && <NextBody trip={trip} />}
    </Sheet>
  );
}

function NextBody({ trip }: { trip: TripDetail }) {
  const { m, locale } = useI18n();
  const t = m.during.next;
  const geo = useGeolocation();
  const qc = useQueryClient();
  const [clock, setClock] = useState(() => ({ date: todayIso(), time: nowHm() }));
  // One fix when the sheet opens.
  useEffect(() => geo.request(), [geo.request]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = geo.state.status === "ok" ? geo.state.at : null;
  const waiting = geo.state.status === "locating" || geo.state.status === "idle";
  const near = at ? `${at.lat.toFixed(5)},${at.lng.toFixed(5)}` : undefined;
  const q = useQuery({
    queryKey: [...keys.trip(trip.id), "next", clock.date, clock.time, near ?? ""],
    queryFn: () => api.get<NextSuggestions>(`/trips/${trip.id}/next${qs({ date: clock.date, time: clock.time, near })}`),
    // Don't wait for the location (a permission prompt can sit unanswered): show the plan now, distances when they come.
    placeholderData: (prev) => prev,
    retry: false,
  });
  const canAdd = trip.permissions.includes("itinerary.add");
  const canMove = trip.permissions.includes("itinerary.reorder");
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.trip(trip.id) });
  // Into today, in the part of the day it is now: an idea moves; a nearby place is added.
  const addNow = useAction(
    async (c: NextCandidate) => {
      const s = q.data!;
      if (c.item) return api.post(`/items/${c.item.id}/reorder`, { dayId: s.dayId, index: 9_999, slot: s.slot });
      return api.post(`/days/${s.dayId}/items`, { type: c.place.category, title: c.place.name, placeId: c.place.id, slot: s.slot });
    },
    { success: t.added },
  );

  const geoNote =
    geo.state.status === "error"
      ? geo.state.error === "denied"
        ? t.denied
        : geo.state.error === "insecure"
          ? t.insecure
          : t.noLocation
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        {q.data && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sand-2 px-3 py-1 font-medium">
            <Clock className="size-3.5" aria-hidden /> {t.slotNow(m.trips.plan.slots[q.data.slot])} · <span className="font-mono">{clock.time}</span>
          </span>
        )}
        <span className="ml-auto flex gap-2">
          {geo.state.status === "error" && geo.state.error !== "insecure" && geo.state.error !== "unsupported" && (
            <Button size="sm" variant="secondary" onClick={geo.request}>
              <LocateFixed className="size-4" /> {t.useLocation}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setClock({ date: todayIso(), time: nowHm() });
              if (at) geo.request();
            }}
          >
            <RefreshCw className="size-4" /> {t.refresh}
          </Button>
        </span>
      </div>
      {waiting && (
        <p className="flex items-center gap-2 text-sm text-ink-2" role="status">
          <LocateFixed className="size-4 animate-pulse motion-reduce:animate-none" aria-hidden /> {t.locating}
        </p>
      )}
      {geoNote && <p className="rounded-xl bg-sand-2 px-4 py-3 text-sm text-ink-2">{geoNote}</p>}

      {q.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl" />
          ))}
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          {q.data.plan.length + q.data.pool.length + q.data.nearby.length === 0 && <EmptyState icon={<Sparkles className="size-7" />} title={t.title} body={t.nothing} />}
          <Section title={t.fromPlan} icon={<MapPin className="size-4" aria-hidden />} list={q.data.plan} locale={locale} />
          <Section
            title={t.fromPool}
            icon={<Lightbulb className="size-4" aria-hidden />}
            list={q.data.pool}
            locale={locale}
            onAdd={canMove && q.data.dayId ? (c) => addNow.run(c).then(invalidate) : undefined}
            busy={addNow.isPending}
          />
          <Section
            title={t.nearby}
            hint={t.nearbyHint}
            icon={<Sparkles className="size-4" aria-hidden />}
            list={q.data.nearby}
            locale={locale}
            onAdd={canAdd && q.data.dayId ? (c) => addNow.run(c).then(invalidate) : undefined}
            busy={addNow.isPending}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  icon,
  list,
  locale,
  onAdd,
  busy,
}: {
  title: string;
  hint?: string;
  icon: React.ReactNode;
  list: NextCandidate[];
  locale: "en" | "vi";
  onAdd?: (c: NextCandidate) => void;
  busy?: boolean;
}) {
  const { m } = useI18n();
  const t = m.during.next;
  if (list.length === 0) return null;
  const id = `next-${title.replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-1 flex items-center gap-2 font-display text-lg font-bold">
        <span className="text-muted">{icon}</span> {title}
      </h3>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <ul className="space-y-2">
        {list.map((c) => {
          const links = mapsLinks(c.place, null, "walk");
          const name = c.item?.title ?? c.place.name;
          return (
            <li key={c.item?.id ?? c.place.id} className={cx("flex items-center gap-3 rounded-2xl border border-line bg-surface p-3", c.open.state === "closed" && "opacity-70")}>
              <ItemTypeIcon type={c.place.category} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{name}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
                  <OpenBadge open={c.open} />
                  {c.walkMin !== null && c.distanceM !== null && (
                    <span className="font-mono text-xs text-muted">
                      {c.distanceM > 3000 ? t.far(formatKm(c.distanceM / 1000, locale)) : t.walk(c.walkMin)}
                    </span>
                  )}
                  {c.item?.startTime && <span className="font-mono text-xs text-muted">{c.item.startTime}</span>}
                </div>
              </div>
              {onAdd && (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAdd(c)} aria-label={t.planLabel(name)} className="w-9 px-0 sm:w-auto sm:px-3">
                  <Plus className="size-4" /> <span className="sr-only sm:not-sr-only">{t.plan}</span>
                </Button>
              )}
              <a
                href={isApple() ? links.apple : links.google}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t.goLabel(name)}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-on-primary hover:bg-primary-600"
              >
                <Navigation className="size-4" aria-hidden /> {t.go}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OpenBadge({ open }: { open: OpenState }) {
  const t = useI18n().m.during.next;
  if (open.state === "open")
    return <span className="font-semibold text-primary">{open.until ? t.openUntil(open.until) : t.open24}</span>;
  if (open.state === "closed") return <span className="font-semibold text-accent-700">{open.opensAt ? `${t.closed} · ${t.opensAt(open.opensAt)}` : t.closed}</span>;
  return <span className="text-muted">{t.hoursUnknown}</span>;
}
