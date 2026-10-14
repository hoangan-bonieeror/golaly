"use client";

import { ITEM_SLOTS, type ItemView, type TripDetail, type TripSummary } from "@triply/shared";
import { ArrowRight, Check, Compass, MapPin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { NextSheet } from "@/components/trip/NextSheet";
import { RouteThumb } from "@/components/trip/RouteThumb";
import { Button, Skeleton, cx } from "@/components/ui";
import { useFormat, useI18n } from "@/i18n/client";
import { useHydrated, useTrip } from "@/lib/api/queries";
import { useNow } from "@/lib/hooks";
import { dayProgress, markable, todayIso, tripNow, tripPhase, type TripPhase } from "@/lib/plan";

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The trip that matters today, in priority order: one under way; one that just ended and still has stops to mark
 * (within a week); the next one coming up; otherwise the most recently touched draft. null when there's none.
 */
export function focusTrip(trips: TripSummary[], today: string): { trip: TripSummary; phase: TripPhase } | null {
  const mine = trips.filter((t) => t.myRole);
  const during = mine.find((t) => tripPhase(t, today) === "during");
  if (during) return { trip: during, phase: "during" };
  const unmarked = (t: TripSummary) => !t.outcome || t.outcome.visited + t.outcome.skipped < t.outcome.planned;
  const back = mine
    .filter((t) => tripPhase(t, today) === "after" && t.endDate && daysBetween(t.endDate, today) <= 7 && unmarked(t))
    .sort((a, b) => b.endDate!.localeCompare(a.endDate!))[0];
  if (back) return { trip: back, phase: "after" };
  const next = mine.filter((t) => tripPhase(t, today) === "before").sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0];
  if (next) return { trip: next, phase: "before" };
  const draft = mine.find((t) => tripPhase(t, today) === "undated");
  return draft ? { trip: draft, phase: "undated" } : null;
}

/**
 * Home's "now" block. During a trip: today's day, the next stop and the day's progress, with "Where to now?".
 * Before: a countdown next to the route sketch (tinted for the time of day there). Just back: mark or recap.
 * Rendered only after hydration — it depends on the device's date.
 */
export function NowCard({ trips }: { trips: TripSummary[] }) {
  const hydrated = useHydrated();
  const now = useNow();
  if (!hydrated) return null;
  const today = todayIso(now);
  const focus = focusTrip(trips, today);
  if (!focus) return null;
  return <NowBody summary={focus.trip} phase={focus.phase} today={today} now={now} />;
}

function NowBody({ summary, phase, today, now }: { summary: TripSummary; phase: TripPhase; today: string; now: Date }) {
  const { m } = useI18n();
  const t = m.home.now;
  const f = useFormat();
  const q = useTrip(summary.id);
  const trip = q.data;
  const href = `/trips/${summary.id}`;

  const eyebrow =
    phase === "during" && trip
      ? (() => {
          const at = tripNow(trip, now);
          return at ? `${t.during(at.dayNumber, trip.days.length)} · ${m.trips.plan.slots[at.slot]}` : m.home.phase.during;
        })()
      : phase === "before"
        ? `${t.before} · ${t.countdown(daysBetween(today, summary.startDate!))}`
        : phase === "after"
          ? t.after
          : t.undated;

  return (
    <section aria-labelledby="now-title" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
      <h2 className="sr-only">{t.label}</h2>
      <div className="flex gap-4 p-4 sm:p-5">
        <Link href={href} className="shrink-0" tabIndex={-1} aria-hidden>
          {trip ? <RouteThumb trip={trip} width={112} height={112} sky={phase === "before" || phase === "during"} className="rounded-2xl" /> : <Skeleton className="size-28" />}
        </Link>
        <div className="min-w-0 flex-1">
          <p className={cx("font-mono text-xs font-semibold uppercase tracking-wider", phase === "during" ? "text-primary" : "text-accent-700")}>
            {phase === "during" && <span aria-hidden className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-primary align-middle" />}
            {eyebrow}
          </p>
          <h3 id="now-title" className="mt-1 font-display text-xl font-semibold leading-snug sm:text-2xl">
            <Link href={href} className="hover:underline">
              {summary.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted">
            {summary.route || m.home.destinationTbd}
            {summary.startDate && <> · {f.dateRange(summary.startDate, summary.endDate)}</>}
            {" · "}
            {m.format.travelers(summary.stats.travelers)}
          </p>
          {phase !== "during" && <Actions phase={phase} summary={summary} />}
        </div>
      </div>
      {phase === "during" && (trip ? <Today trip={trip} now={now} /> : <Skeleton className="mx-5 mb-5 h-20" />)}
    </section>
  );
}

function Actions({ phase, summary }: { phase: TripPhase; summary: TripSummary }) {
  const { m } = useI18n();
  const href = `/trips/${summary.id}`;
  const o = summary.outcome;
  const left = o ? o.planned - o.visited - o.skipped : summary.stats.places;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {phase === "after" ? (
        <>
          <p className="w-full text-sm text-ink-2">{left > 0 ? m.after.banner.review(left) : m.home.now.allMarked}</p>
          <Button href={href} size="sm">
            <Check className="size-4" aria-hidden /> {m.after.banner.reviewAction}
          </Button>
          {o && o.visited > 0 && (
            <Button href={`${href}/recap`} size="sm" variant="secondary">
              {m.after.banner.recap}
            </Button>
          )}
        </>
      ) : (
        <Button href={href} size="sm" variant="secondary">
          {m.home.continuePlanning} <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}

const slotRank = (i: ItemView) => ITEM_SLOTS.indexOf(i.slot);

/** Today's next stops and progress, under the header while the trip is on. */
function Today({ trip, now }: { trip: TripDetail; now: Date }) {
  const { m } = useI18n();
  const t = m.home.now;
  const [nextOpen, setNextOpen] = useState(false);
  const at = tripNow(trip, now);
  const day = at ? trip.days.find((d) => d.id === at.dayId) : null;
  const items = (day?.items ?? []).filter(markable);
  const p = dayProgress(items);
  const current = at ? ITEM_SLOTS.indexOf(at.slot) : 0;
  // Still to do, in plan order; anything from an earlier part of the day that's still open comes after what's now.
  const open = items.filter((i) => i.status === "PLANNED");
  const ahead = [...open.filter((i) => slotRank(i) >= current), ...open.filter((i) => slotRank(i) < current)];
  const [next, ...later] = ahead;

  return (
    <div className="border-t border-line bg-sand-2/40 px-4 py-4 sm:px-5">
      {next ? (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
            <MapPin className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t.nextUp}
              {next.startTime ? ` · ${next.startTime}` : next.slot !== "ANY" ? ` · ${m.trips.plan.slots[next.slot]}` : ""}
            </p>
            <p className="truncate font-semibold">
              {next.place ? (
                <Link href={`/places/${next.place.id}`} className="hover:underline">
                  {next.title}
                </Link>
              ) : (
                next.title
              )}
            </p>
            {later.length > 0 && (
              <p className="truncate text-sm text-muted">
                {t.then}: {later.slice(0, 3).map((i) => i.title).join(" → ")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-2">{t.doneToday}</p>
      )}
      {p.total > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className="flex h-2 flex-1 overflow-hidden rounded-full bg-line"
            role="img"
            aria-label={m.during.progressLabel(p.visited, p.skipped, p.total)}
          >
            <span className="bg-primary" style={{ width: `${(p.visited / p.total) * 100}%` }} />
            <span className="bg-muted/50" style={{ width: `${(p.skipped / p.total) * 100}%` }} />
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{m.during.progress(p.done, p.total)}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setNextOpen(true)}>
          <Compass className="size-4" aria-hidden /> {m.during.next.open}
        </Button>
        <Button href={`/trips/${trip.id}`} size="sm" variant="secondary">
          {t.openToday} <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
      <NextSheet open={nextOpen} onClose={() => setNextOpen(false)} trip={trip} />
    </div>
  );
}

/** A row of the other trips you're on: a cover swatch, title, dates and where each one is at. */
export function YourTrips({ trips, exclude }: { trips: TripSummary[]; exclude?: string }) {
  const { m } = useI18n();
  const f = useFormat();
  const hydrated = useHydrated();
  const today = todayIso();
  const list = trips.filter((t) => t.myRole && t.id !== exclude).slice(0, 8);
  if (!list.length) return null;
  return (
    <section aria-labelledby="your-trips">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="your-trips" className="font-display text-xl font-semibold">
          {m.home.yourTrips}
        </h2>
        <Link href="/trips" className="text-sm font-semibold text-primary">
          {m.home.allTrips}
        </Link>
      </div>
      <ul className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {list.map((t) => {
          const phase = tripPhase(t, today);
          return (
            <li key={t.id} className="w-60 shrink-0">
              <Link href={`/trips/${t.id}`} className="flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 pr-3 transition-colors hover:border-primary">
                <span
                  aria-hidden
                  className="size-12 shrink-0 rounded-xl bg-cover bg-center"
                  style={t.coverImage || t.coverUrl ? { backgroundImage: `url(${t.coverImage?.thumbUrl ?? t.coverUrl})` } : { background: `linear-gradient(135deg, ${t.cover[0]}, ${t.cover[1]})` }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{t.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {/* Phase depends on today's date: shown after hydration only. */}
                    {hydrated && <span className={cx("font-semibold", phase === "during" ? "text-primary" : "text-ink-2")}>{m.home.phase[phase]} · </span>}
                    {t.startDate ? f.dateRange(t.startDate, t.endDate) : m.format.datesNotSet}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
