"use client";

import type { ItemView } from "@golaly/shared";
import { ArrowLeft, CalendarDays, CheckCheck, Heart, ImageIcon, MapPin, PenSquare, Route, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ItemPhotos, ReviewSheet } from "@/components/itinerary/AfterTrip";
import { ItemTypeIcon } from "@/components/itinerary/ItemTypeIcon";
import { TripMap } from "@/components/map/TripMap";
import { PassportStamps } from "@/components/social/PassportStamps";
import { Cover } from "@/components/trip/Cover";
import { Button, ErrorState, PageLoader, cx } from "@/components/ui";
import { useFormat, useI18n } from "@/i18n/client";
import { useExpenses, useTrip } from "@/lib/api/queries";
import { formatMoney } from "@/lib/money";
import { markable, visitedOnly } from "@/lib/plan";
import { dayColor, dayStats, formatKm } from "@/lib/trip-geo";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/**
 * The trip recap (roadmap phase 3): what the group actually did — the places marked as visited on a
 * map and day by day with everyone's photos, the stops most people loved, the stamps it earned and,
 * for members, what it cost. Until something is marked it shows the whole plan and asks to mark it.
 */
export default function TripRecapPage() {
  const { id } = useParams<{ id: string }>();
  const { m, locale } = useI18n();
  const f = useFormat();
  const t = m.after;
  const q = useTrip(id);
  const trip = q.data;
  const canSpend = !!trip?.permissions.includes("expenses.manage");
  const spend = useExpenses(id, canSpend);
  const [reviewOpen, setReviewOpen] = useState(false);
  useDocumentTitle(trip ? `${trip.title} · ${t.recap.eyebrow}` : q.isError ? t.recap.notAvailable : null);

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !trip)
    return (
      <div className="px-4 pt-4 md:px-8 md:pt-8">
        <ErrorState page error={q.error} onRetry={() => q.refetch()} />
      </div>
    );

  const canEdit = trip.permissions.includes("itinerary.edit");
  const { trip: went, marked } = visitedOnly(trip);
  const allItems = trip.days.flatMap((d) => d.items);
  const stops = allItems.filter(markable);
  const visited = marked ? stops.filter((i) => i.status === "VISITED") : stops;
  const km = went.days.reduce((sum, d) => sum + dayStats(d).km, 0);
  const photos = allItems.reduce((n, i) => n + i.photos.length, 0);
  const loves = (i: ItemView) => i.votes.filter((v) => v.level === "LOVE").length;
  const favorites = [...visited].filter((i) => loves(i) > 0).sort((a, b) => loves(b) - loves(a)).slice(0, 3);
  const spent = spend.data && spend.data.total > 0 ? formatMoney(spend.data.total, spend.data.currency, locale) : null;

  const tiles = [
    { icon: MapPin, label: t.recap.tiles.places, value: marked ? t.recap.went(visited.length, stops.length) : String(stops.length) },
    { icon: CalendarDays, label: t.recap.tiles.days, value: String(trip.days.length) },
    ...(km > 0 ? [{ icon: Route, label: t.recap.tiles.distance, value: formatKm(km, locale) }] : []),
    { icon: ImageIcon, label: t.recap.tiles.photos, value: String(photos) },
    { icon: Users, label: t.recap.tiles.travelers, value: String(trip.members.length) },
    ...(spent ? [{ icon: Wallet, label: t.recap.tiles.spent, value: spent }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 md:px-8 md:pt-8">
      <Link href={`/trips/${trip.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t.recap.back}
      </Link>

      <header className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <Cover palette={trip.cover} seed={trip.id} image={trip.coverImage} imageUrl={trip.coverUrl} sizes="(min-width: 896px) 896px, 100vw" className="aspect-[3/1] w-full md:aspect-[4/1]" />
        <div className="p-4 sm:p-5 md:p-6">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-accent-700">{t.recap.eyebrow}</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold leading-tight md:text-4xl">{trip.title}</h1>
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-sm text-ink-2">
            <span>{trip.route || m.trips.destinationTbd}</span>
            {(trip.startDate || trip.endDate) && <span className="font-mono text-[13px]">{f.dateRange(trip.startDate, trip.endDate)}</span>}
          </p>
          <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {tiles.map((x) => (
              <li key={x.label} className="rounded-2xl bg-sand-2 px-3 py-3 sm:px-4">
                <x.icon className="size-4 text-muted" aria-hidden />
                <div className="mt-1 break-words font-display text-base font-extrabold leading-tight tabular-nums sm:text-xl">{x.value}</div>
                <div className="text-xs text-ink-2">{x.label}</div>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {!marked && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-2">
          <span className="min-w-0 flex-1">{t.recap.notMarked}</span>
          {canEdit && (
            <Button size="sm" onClick={() => setReviewOpen(true)}>
              <CheckCheck className="size-4" /> {t.recap.markNow}
            </Button>
          )}
        </div>
      )}

      {visited.some((i) => i.place) && (
        <section aria-labelledby="recap-map" className="mt-8">
          <h2 id="recap-map" className="mb-3 font-display text-2xl font-bold">
            {t.recap.map}
          </h2>
          <TripMap trip={went} day="all" className="h-[340px] md:h-[420px]" />
        </section>
      )}

      {favorites.length > 0 && (
        <section aria-labelledby="recap-fav" className="mt-8">
          <h2 id="recap-fav" className="font-display text-2xl font-bold">
            {t.recap.favorites}
          </h2>
          <p className="mb-3 text-sm text-muted">{t.recap.favoritesHint}</p>
          <ol className="grid gap-3 sm:grid-cols-3">
            {favorites.map((i, n) => (
              <li key={i.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                {i.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.photos[0].image.thumbUrl} alt="" className="aspect-[4/3] w-full object-cover" style={{ backgroundColor: i.photos[0].image.color ?? undefined }} />
                ) : (
                  <div className="flex h-20 items-center justify-center bg-sand-2" aria-hidden>
                    <ItemTypeIcon type={i.type} />
                  </div>
                )}
                <div className="flex items-center gap-2 p-3">
                  <span className="font-mono text-xs font-semibold text-muted">#{n + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{i.title}</span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-accent-700">
                    <Heart className="size-3.5 fill-current" aria-hidden />
                    <span className="sr-only">{t.recap.loves(loves(i))}</span>
                    <span aria-hidden>{loves(i)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="recap-days" className="mt-8">
        <h2 id="recap-days" className="mb-3 font-display text-2xl font-bold">
          {t.recap.timeline}
        </h2>
        <ol className="space-y-6">
          {trip.days.map((d) => {
            const shown = d.items.filter((i) => markable(i) && (!marked || i.status === "VISITED"));
            const skipped = marked ? d.items.filter((i) => i.status === "SKIPPED") : [];
            if (shown.length === 0 && skipped.length === 0) return null;
            return (
              <li key={d.id} className="relative border-l-2 pl-5" style={{ borderColor: dayColor(d.dayNumber) }}>
                <span aria-hidden className="absolute -left-[7px] top-1.5 size-3 rounded-full" style={{ background: dayColor(d.dayNumber) }} />
                <h3 className="font-display text-lg font-bold">
                  {m.trips.day(d.dayNumber)}
                  {d.date && <span className="font-semibold text-ink-2"> · {f.day(d.date, { weekday: "short", day: "numeric", month: "short" })}</span>}
                  {d.title && <span className="font-semibold text-ink-2"> · {d.title}</span>}
                </h3>
                {shown.length === 0 && <p className="mt-1 text-sm text-muted">{t.recap.nothingThatDay}</p>}
                <ul className="mt-2 space-y-4">
                  {shown.map((i) => (
                    <li key={i.id} className="rounded-2xl border border-line bg-surface p-3.5">
                      <div className="flex items-center gap-3">
                        <ItemTypeIcon type={i.type} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{i.title}</div>
                          {i.place && i.place.name !== i.title && <div className="truncate text-[13px] text-muted">{i.place.name}</div>}
                        </div>
                        {loves(i) > 0 && (
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-accent-700" title={t.recap.loves(loves(i))}>
                            <Heart className="size-3.5 fill-current" aria-hidden />
                            <span className="sr-only">{t.recap.loves(loves(i))}</span>
                            <span aria-hidden>{loves(i)}</span>
                          </span>
                        )}
                      </div>
                      <ItemPhotos trip={trip} item={i} />
                    </li>
                  ))}
                </ul>
                {skipped.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[13px] text-muted">
                    <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      {t.recap.skipped(skipped.length)} — {skipped.map((i) => i.title).join(", ")}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {trip.destinations.length > 0 && (marked ? visited.length > 0 : true) && (
        <div className="mt-8">
          <PassportStamps trips={[trip]} title={t.recap.stamps} />
        </div>
      )}

      {trip.myRole && (
        <section className={cx("mt-8 flex flex-wrap items-center gap-4 rounded-2xl bg-primary-50 p-5")}>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold">{t.recap.post}</h2>
            <p className="text-sm text-ink-2">{t.recap.postHint}</p>
          </div>
          <Button href={`/posts/new?trip=${trip.id}`}>
            <PenSquare className="size-4" /> {t.recap.post}
          </Button>
        </section>
      )}

      {canEdit && <ReviewSheet open={reviewOpen} onClose={() => setReviewOpen(false)} trip={trip} />}
    </div>
  );
}
