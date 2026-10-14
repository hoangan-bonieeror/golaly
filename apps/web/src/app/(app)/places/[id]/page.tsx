"use client";

import type { Locale, PlaceView } from "@triply/shared";
import { ArrowLeft, Bookmark, Check, ExternalLink, Globe, MapPin, Navigation, Phone, Share2, Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PlacesMap } from "@/components/map/PlacesMap";
import { AddToTripButton } from "@/components/place/AddToTripSheet";
import { OpenNowPill, WeekHours } from "@/components/place/OpenNow";
import { PlaceGallery } from "@/components/place/PlacePhotos";
import { PlaceRow } from "@/components/social/PlaceRow";
import { TripCard } from "@/components/trip/TripCard";
import { Badge, Button, ErrorState, PageLoader, SectionTitle, cx } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/catalog";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe, usePlace } from "@/lib/api/queries";
import { useToast } from "@/lib/toast";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const languageName = (tag: string, locale: Locale) => {
  try {
    return new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
};

export default function PlacePage() {
  const { id } = useParams<{ id: string }>();
  const q = usePlace(id);
  const me = useMe().data;
  const toast = useToast();
  const { locale, m: t } = useI18n();
  const pl = t.explore.place;
  const p = q.data;
  useDocumentTitle(p ? `${p.name}${p.destinationName ? `, ${p.destinationName}` : ""}` : null);
  const save = useAction((on: boolean) => (on ? api.post<PlaceView>(`/places/${id}/save`) : api.delete<PlaceView>(`/places/${id}/save`)), {
    invalidate: [keys.place(id), ["places"]],
    success: (r) => (r.savedByMe ? pl.saved : pl.unsaved),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !p) return <ErrorState page error={q.error} onRetry={() => q.refetch()} />;

  const back = p.destinationSlug ? `/explore?tab=places&dest=${p.destinationSlug}` : "/explore?tab=places";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t.common.linkCopied);
      }
    } catch {
      /* share sheet dismissed */
    }
  };
  const where = [p.address, p.areaName && p.areaName !== p.destinationName ? p.areaName : null].filter(Boolean).join(", ");
  const hasPhotos = p.photos.length > 0;
  const map = <PlacesMap places={[p, ...p.nearby]} focusId={p.id} label={pl.mapLabel(p.name)} className={hasPhotos ? undefined : "h-[280px]! md:h-[400px]!"} />;

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> {p.destinationName ? pl.placesIn(p.destinationName) : pl.explorePlaces}
        </Link>

        {/* Atlas header: an eyebrow (kind · where), the name, then what matters right now — open?, rating, did people go. */}
        <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs font-semibold uppercase tracking-wider text-accent-700">
              <span>{p.categoryLabel}</span>
              {p.destinationName && (
                <>
                  <span aria-hidden>·</span>
                  {p.destinationSlug ? (
                    <Link href={`/explore/${p.destinationSlug}`} className="hover:underline">
                      {p.destinationName}
                    </Link>
                  ) : (
                    <span>{p.destinationName}</span>
                  )}
                </>
              )}
            </p>
            <h1 className="mt-1.5 font-display text-3xl font-extrabold leading-tight md:text-[44px]">{p.name}</h1>
            {p.localName && (
              <p className="mt-1 text-base text-ink-2">
                {p.localName} <span className="text-xs text-muted">· {pl.localName}</span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {p.status === "CLOSED" ? <Badge tone="gold">{pl.permanentlyClosed}</Badge> : <OpenNowPill place={p} />}
              {p.rating && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sand-2 px-2.5 py-1 text-[13px] font-semibold">
                  <Star className="size-3.5 fill-gold text-gold" aria-hidden />
                  <span className="sr-only">{pl.rated}</span> {p.rating}
                </span>
              )}
              {p.visits.visited > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sand-2 px-2.5 py-1 text-[13px] font-semibold text-ink-2" title={pl.visits.hint}>
                  <Check className="size-3.5 text-primary" aria-hidden /> {pl.visits.went(p.visits.visited)}
                  {p.visits.skipped > 0 && <span className="font-normal text-muted"> · {pl.visits.skipped(p.visits.skipped)}</span>}
                </span>
              )}
              {p.groupLabel && <span className="text-[13px] text-muted">{p.groupLabel}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AddToTripButton place={p} size="lg" />
            {me && (
              <Button variant="secondary" size="lg" aria-pressed={p.savedByMe} onClick={() => save.run(!p.savedByMe)} disabled={save.isPending}>
                <Bookmark className={cx("size-4", p.savedByMe && "fill-accent text-accent-700")} aria-hidden /> {p.savedByMe ? t.common.saved : t.common.save}
              </Button>
            )}
            <Button variant="secondary" size="lg" onClick={share}>
              <Share2 className="size-4" aria-hidden /> {t.common.share}
            </Button>
          </div>
        </header>
        {p.status === "CLOSED" && <p className="rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-700">{pl.closedNotice}</p>}
      </div>

      {/* Photos lead when there are some; otherwise the map does, with a slim "add a photo" strip under it. */}
      {/* The gallery keeps its place in the tree either way: the first photo arriving mustn't remount it
          (that would close the "add a photo" sheet mid-way). */}
      <div className="space-y-2">
        {!hasPhotos && map}
        <PlaceGallery place={p} slimEmpty />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
        <section aria-labelledby="details" className="space-y-1 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
          <h2 id="details" className="font-display text-[22px] font-semibold">
            {pl.details}
          </h2>
          <dl className="divide-y divide-line">
            {where && (
              <Row icon={MapPin} label={pl.address}>
                {where}
              </Row>
            )}
            {p.phone && (
              <Row icon={Phone} label={pl.phone}>
                <a href={`tel:${p.phone}`} className="font-semibold text-primary hover:underline">
                  {p.phone}
                </a>
              </Row>
            )}
            {p.website && (
              <Row icon={Globe} label={pl.website}>
                <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all font-semibold text-primary hover:underline">
                  {p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">{pl.newTab}</span>
                </a>
              </Row>
            )}
            <Row icon={Navigation} label={pl.gettingThere}>
              <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                {pl.directions} <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">{pl.newTab}</span>
              </a>
            </Row>
          </dl>
          {p.names.length > 0 && (
            <div className="pt-3">
              <h3 className="text-sm font-semibold text-ink-2">{pl.alsoKnownAs}</h3>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {p.names.map((n) => (
                  <li key={n.lang} className="rounded-full bg-sand-2 px-3 py-1 text-sm" lang={n.lang}>
                    {n.name} <span className="text-xs text-muted">· {languageName(n.lang, locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <div className="space-y-6">
          <WeekHours place={p} />
          {hasPhotos && map}
        </div>
      </div>

      {p.nearby.length > 0 && (
        <section>
          <SectionTitle
            action={
              p.destinationSlug ? (
                <Link href={`/explore?tab=places&dest=${p.destinationSlug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                  {pl.moreIn(p.destinationName ?? "")}
                </Link>
              ) : undefined
            }
          >
            {pl.nearby}
          </SectionTitle>
          <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {p.nearby.map((n, i) => (
              <li key={n.id} className="min-w-0">
                <PlaceRow place={n} index={i + 1} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.inTrips.length > 0 && (
        <section>
          <SectionTitle>
            {pl.inTrips(p.tripCount)}
          </SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {p.inTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} compact />
            ))}
          </div>
        </section>
      )}

      {p.attribution.length > 0 && <p className="text-xs text-muted">{pl.placeData(p.attribution.join(" · "))}</p>}
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3 text-sm">
      <dt className="mt-0.5 shrink-0">
        <Icon className="size-4 text-muted" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
