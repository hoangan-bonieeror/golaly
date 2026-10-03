"use client";

import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AroundDestination } from "@/components/place/AroundDestination";
import { PostCard } from "@/components/social/PostCard";
import { Cover } from "@/components/trip/Cover";
import { TripCard } from "@/components/trip/TripCard";
import { ErrorState, PageLoader, SectionTitle } from "@/components/ui";
import { useDestination } from "@/lib/api/queries";

export default function DestinationPage() {
  const { slug } = useParams<{ slug: string }>();
  const q = useDestination(slug);
  useDocumentTitle(q.data ? `${q.data.destination.name}, ${q.data.destination.country}` : null);
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState page error={q.error} onRetry={() => q.refetch()} />;
  const { destination: dest, popularTrips, remixable, posts } = q.data;

  return (
    <div className="space-y-10">
      <Cover palette={dest.palette} seed={dest.id} className="-mx-4 aspect-[16/9] md:mx-0 md:aspect-[21/8]" rounded>
        <div className="flex h-full flex-col justify-between p-5 text-white md:p-8">
          <Link href="/explore" className="flex size-10 items-center justify-center rounded-full bg-black/30 backdrop-blur" aria-label="Back">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-white/80">{dest.country}</p>
            <h1 className="font-display text-4xl font-bold md:text-6xl">{dest.name}</h1>
            <p className="mt-1 max-w-lg text-white/90">{dest.blurb}</p>
          </div>
        </div>
      </Cover>

      <section>
        <SectionTitle>Popular trips</SectionTitle>
        {popularTrips.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {popularTrips.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No public trips here yet — be the first to share one.</p>
        )}
      </section>

      <AroundDestination slug={dest.slug} name={dest.name} />

      {posts.length > 0 && (
        <section>
          <SectionTitle>Recent travel posts</SectionTitle>
          <div className="grid gap-6 md:grid-cols-2">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>
      )}

      {remixable.length > 0 && (
        <section>
          <SectionTitle>Suggested itineraries to remix</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {remixable.map((t) => (
              <TripCard key={t.id} trip={t} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
