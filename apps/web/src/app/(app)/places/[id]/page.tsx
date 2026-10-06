"use client";

import type { PlaceView } from "@triply/shared";
import { ArrowLeft, Bookmark, Clock, ExternalLink, Globe, MapPin, Navigation, Phone, Share2, Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PlacesMap } from "@/components/map/PlacesMap";
import { AddToTripButton } from "@/components/place/AddToTripSheet";
import { CategoryIcon, formatOpeningHours } from "@/components/place/categoryMeta";
import { PlaceGallery } from "@/components/place/PlacePhotos";
import { PlaceRow } from "@/components/social/PlaceRow";
import { TripCard } from "@/components/trip/TripCard";
import { Badge, Button, ErrorState, PageLoader, SectionTitle, cx } from "@/components/ui";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe, usePlace } from "@/lib/api/queries";
import { useToast } from "@/lib/toast";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const languageName = (tag: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
};

export default function PlacePage() {
  const { id } = useParams<{ id: string }>();
  const q = usePlace(id);
  const me = useMe().data;
  const toast = useToast();
  const p = q.data;
  useDocumentTitle(p ? `${p.name}${p.destinationName ? `, ${p.destinationName}` : ""}` : null);
  const save = useAction((on: boolean) => (on ? api.post<PlaceView>(`/places/${id}/save`) : api.delete<PlaceView>(`/places/${id}/save`)), {
    invalidate: [keys.place(id), ["places"]],
    success: (r) => (r.savedByMe ? "Place saved" : "Removed from saved"),
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
        toast("Link copied");
      }
    } catch {
      /* share sheet dismissed */
    }
  };
  const hours = p.openingHours ? formatOpeningHours(p.openingHours) : [];
  const where = [p.address, p.areaName && p.areaName !== p.destinationName ? p.areaName : null].filter(Boolean).join(", ");

  return (
    <div className="space-y-10">
      <div className="space-y-5">
        <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> {p.destinationName ? `Places in ${p.destinationName}` : "Explore places"}
        </Link>

        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4">
            <CategoryIcon categoryKey={p.categoryKey} size="lg" />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {p.groupLabel && <Badge tone="primary">{p.groupLabel}</Badge>}
                {p.status === "CLOSED" && <Badge tone="gold">Permanently closed</Badge>}
              </div>
              <h1 className="font-display text-3xl font-bold leading-tight md:text-4xl">{p.name}</h1>
              {p.localName && (
                <p className="text-base text-ink-2">
                  {p.localName} <span className="text-xs text-muted">· local name</span>
                </p>
              )}
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
                <span>{p.categoryLabel}</span>
                {p.destinationName && (
                  <>
                    <span aria-hidden>·</span>
                    {p.destinationSlug ? (
                      <Link href={`/explore/${p.destinationSlug}`} className="font-semibold text-primary hover:underline">
                        {p.destinationName}
                      </Link>
                    ) : (
                      <span>{p.destinationName}</span>
                    )}
                  </>
                )}
                {p.rating && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-4 fill-gold text-gold" aria-hidden />
                      <span className="sr-only">Rated</span> {p.rating}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AddToTripButton place={p} size="lg" />
            {me && (
              <Button variant="secondary" size="lg" aria-pressed={p.savedByMe} onClick={() => save.run(!p.savedByMe)} disabled={save.isPending}>
                <Bookmark className={cx("size-4", p.savedByMe && "fill-accent text-accent-700")} aria-hidden /> {p.savedByMe ? "Saved" : "Save"}
              </Button>
            )}
            <Button variant="secondary" size="lg" onClick={share}>
              <Share2 className="size-4" aria-hidden /> Share
            </Button>
          </div>
        </header>
        {p.status === "CLOSED" && (
          <p className="rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-700">
            Our sources say this place has closed. It stays in the trips that already include it, but it can’t be added again.
          </p>
        )}
      </div>

      <PlaceGallery place={p} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,480px)]">
        <section aria-labelledby="details" className="space-y-1 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
          <h2 id="details" className="font-display text-[22px] font-semibold">
            Details
          </h2>
          <dl className="divide-y divide-line">
            {where && (
              <Row icon={MapPin} label="Address">
                {where}
              </Row>
            )}
            {hours.length > 0 && (
              <Row icon={Clock} label="Opening hours">
                <ul>
                  {hours.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </Row>
            )}
            {p.phone && (
              <Row icon={Phone} label="Phone">
                <a href={`tel:${p.phone}`} className="font-semibold text-primary hover:underline">
                  {p.phone}
                </a>
              </Row>
            )}
            {p.website && (
              <Row icon={Globe} label="Website">
                <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all font-semibold text-primary hover:underline">
                  {p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Row>
            )}
            <Row icon={Navigation} label="Getting there">
              <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                Directions in Google Maps <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Row>
          </dl>
          {p.names.length > 0 && (
            <div className="pt-3">
              <h3 className="text-sm font-semibold text-ink-2">Also known as</h3>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {p.names.map((n) => (
                  <li key={n.lang} className="rounded-full bg-sand-2 px-3 py-1 text-sm" lang={n.lang}>
                    {n.name} <span className="text-xs text-muted">· {languageName(n.lang)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <PlacesMap places={[p, ...p.nearby]} focusId={p.id} label={`Map of ${p.name} and places nearby`} />
      </div>

      {p.nearby.length > 0 && (
        <section>
          <SectionTitle
            action={
              p.destinationSlug ? (
                <Link href={`/explore?tab=places&dest=${p.destinationSlug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                  More in {p.destinationName}
                </Link>
              ) : undefined
            }
          >
            Nearby
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
            In {p.tripCount} traveler{p.tripCount === 1 ? "’s trip" : "s’ trips"}
          </SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {p.inTrips.map((t) => (
              <TripCard key={t.id} trip={t} compact />
            ))}
          </div>
        </section>
      )}

      {p.attribution.length > 0 && <p className="text-xs text-muted">Place data: {p.attribution.join(" · ")}</p>}
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
