"use client";

import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PlacesMap } from "@/components/map/PlacesMap";
import { AroundDestination } from "@/components/place/AroundDestination";
import { PostCard } from "@/components/social/PostCard";
import { Cover } from "@/components/trip/Cover";
import { TripCard } from "@/components/trip/TripCard";
import { ErrorState, PageLoader, SectionTitle } from "@/components/ui";
import { useT } from "@/i18n/client";
import { useDestination } from "@/lib/api/queries";

export default function DestinationPage() {
  const { slug } = useParams<{ slug: string }>();
  const t = useT();
  const d = t.explore.destination;
  const q = useDestination(slug);
  useDocumentTitle(q.data ? `${q.data.destination.name}, ${q.data.destination.country}` : null);
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState page error={q.error} onRetry={() => q.refetch()} />;
  const { destination: dest, popularTrips, remixable, posts, places } = q.data;

  return (
    <div className="space-y-10">
      {places.length > 0 ? (
        // Atlas header: the name and blurb, then the map of what's there (pins open the places).
        <div className="space-y-5">
          <Link href="/explore" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> {t.explore.search.title}
          </Link>
          <header className="max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-accent-700">
              {dest.country}
            </p>
            <h1 className="mt-1.5 font-display text-4xl font-extrabold leading-tight md:text-6xl">{dest.name}</h1>
            {dest.blurb && <p className="mt-2 text-base text-ink-2 md:text-lg">{dest.blurb}</p>}
          </header>
          <PlacesMap places={places} label={d.around(dest.name)} className="h-[280px]! md:h-[420px]!" />
        </div>
      ) : (
        <Cover palette={dest.palette} seed={dest.id} className="-mx-4 aspect-[16/9] md:mx-0 md:aspect-[21/8]" rounded>
          <div className="flex h-full flex-col justify-between p-5 text-white md:p-8">
            <Link href="/explore" className="flex size-10 items-center justify-center rounded-full bg-black/30 backdrop-blur" aria-label={t.common.back}>
              <ArrowLeft className="size-5" />
            </Link>
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-white/80">{dest.country}</p>
              <h1 className="font-display text-4xl font-bold md:text-6xl">{dest.name}</h1>
              <p className="mt-1 max-w-lg text-white/90">{dest.blurb}</p>
            </div>
          </div>
        </Cover>
      )}

      <section>
        <SectionTitle>{d.popularTrips}</SectionTitle>
        {popularTrips.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {popularTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{d.noTrips}</p>
        )}
      </section>

      <AroundDestination slug={dest.slug} name={dest.name} />

      {posts.length > 0 && (
        <section>
          <SectionTitle>{d.posts}</SectionTitle>
          <div className="grid gap-6 md:grid-cols-2">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>
      )}

      {remixable.length > 0 && (
        <section>
          <SectionTitle>{d.remixable}</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {remixable.map((trip) => (
              <TripCard key={trip.id} trip={trip} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
