"use client";

import { ArrowLeft, MapPinOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PlaceRow } from "@/components/social/PlaceRow";
import { PostCard } from "@/components/social/PostCard";
import { Cover } from "@/components/trip/Cover";
import { TripCard } from "@/components/trip/TripCard";
import { EmptyState, SectionTitle } from "@/components/ui";
import { discoverableTrips, feedPosts } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

export default function DestinationPage() {
  const { slug } = useParams<{ slug: string }>();
  const { db, me } = useStore();
  const dest = db.destinations.find((d) => d.slug === slug);

  if (!dest)
    return <EmptyState icon={<MapPinOff className="size-7" />} title="Destination not found" action={<Link href="/explore" className="font-semibold text-lagoon">Back to Explore</Link>} />;

  const trips = discoverableTrips(db).filter((t) => t.destinationIds.includes(dest.id));
  const popular = [...trips].sort((a, b) => b.saveCount - a.saveCount);
  const suggested = [...trips].sort((a, b) => b.forkCount - a.forkCount).filter((t) => t.allowFork);
  const places = db.places.filter((p) => p.destinationId === dest.id).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const posts = feedPosts(db, me, "for-you").filter((p) => p.destinationId === dest.id || trips.some((t) => t.id === p.tripId));

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
        {popular.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No public trips here yet — be the first to share one.</p>
        )}
      </section>

      {places.length > 0 && (
        <section>
          <SectionTitle>Trending places</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {places.map((p) => (
              <PlaceRow key={p.id} place={p} />
            ))}
          </div>
        </section>
      )}

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

      {suggested.length > 0 && (
        <section>
          <SectionTitle>Suggested itineraries to remix</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {suggested.map((t) => (
              <TripCard key={t.id} trip={t} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
