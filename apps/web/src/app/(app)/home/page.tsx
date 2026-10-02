"use client";

import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PostCard } from "@/components/social/PostCard";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { EmptyState, SectionTitle, Tabs, Button, formatDateRange } from "@/components/ui";
import { discoverableTrips, feedPosts, myTrips, routeLabel, tripStats } from "@/lib/mock/selectors";
import { useMe, useStore } from "@/lib/store/store";

export default function HomePage() {
  const { db, me } = useStore();
  const user = useMe();
  const [mode, setMode] = useState<"for-you" | "following">("for-you");
  const posts = feedPosts(db, me, mode);
  const upcoming = myTrips(db, me).filter((t) => !t.endDate || t.endDate >= new Date().toISOString().slice(0, 10))[0];
  const recommended = discoverableTrips(db)
    .filter((t) => t.ownerId !== me)
    .sort((a, b) => b.saveCount - a.saveCount)
    .slice(0, 4);
  const trending = [...db.destinations]
    .map((d) => ({ d, n: discoverableTrips(db).filter((t) => t.destinationIds.includes(d.id)).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <header>
          <p className="text-sm text-muted">{greeting()}{user ? `, ${user.displayName}` : ""}</p>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">Where to next?</h1>
        </header>

        {upcoming && <ContinuePlanning tripId={upcoming.id} />}

        {/* Mobile: trending destinations as a horizontal scroller */}
        <section className="lg:hidden">
          <SectionTitle action={<Link href="/explore" className="text-sm font-semibold text-lagoon">See all</Link>}>Trending destinations</SectionTitle>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {trending.map(({ d, n }) => (
              <DestinationTile key={d.id} dest={d} count={n} className="w-32 shrink-0" />
            ))}
          </div>
        </section>

        <section>
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "for-you", label: "For You" },
              { value: "following", label: "Following" },
            ]}
            className="mb-5"
          />
          <div className="mx-auto max-w-xl space-y-6">
            {posts.length === 0 ? (
              <EmptyState
                icon={<Users className="size-7" />}
                title="Nothing here yet"
                body="Follow travelers whose trips you love and their stories will show up here."
                action={<Button href="/explore">Find travelers</Button>}
              />
            ) : (
              posts.map((p, i) => (
                <div key={p.id} className="space-y-6">
                  <PostCard post={p} />
                  {i === 0 && recommended.length > 0 && (
                    <section className="lg:hidden">
                      <SectionTitle>Recommended trips</SectionTitle>
                      <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
                        {recommended.map((t) => (
                          <div key={t.id} className="w-64 shrink-0">
                            <TripCard trip={t} compact />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Desktop right rail */}
      <aside className="hidden space-y-8 lg:block">
        <section>
          <SectionTitle>Recommended trips</SectionTitle>
          <div className="space-y-5">
            {recommended.slice(0, 3).map((t) => (
              <TripCard key={t.id} trip={t} compact />
            ))}
          </div>
        </section>
        <section>
          <SectionTitle action={<Link href="/explore" className="text-sm font-semibold text-lagoon">All</Link>}>Trending</SectionTitle>
          <div className="grid grid-cols-3 gap-2.5">
            {trending.map(({ d }) => (
              <DestinationTile key={d.id} dest={d} />
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function ContinuePlanning({ tripId }: { tripId: string }) {
  const { db } = useStore();
  const trip = db.trips.find((t) => t.id === tripId)!;
  const s = tripStats(db, trip);
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-3 pr-5 shadow-card transition-colors hover:border-lagoon"
    >
      <span className="size-16 shrink-0 overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg, ${trip.cover[0]}, ${trip.cover[1]})` }} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-sunset">Continue planning</div>
        <div className="truncate font-semibold">{trip.title}</div>
        <div className="truncate text-sm text-muted">
          {routeLabel(db, trip)} · {formatDateRange(trip.startDate, trip.endDate)} · {s.travelers} travelers
        </div>
      </div>
      <ArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-lagoon" />
    </Link>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
