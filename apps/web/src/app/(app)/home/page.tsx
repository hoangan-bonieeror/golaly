"use client";

import type { TripSummary } from "@triply/shared";
import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PostCard } from "@/components/social/PostCard";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { Button, EmptyState, ErrorState, formatDateRange, SectionTitle, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { useExplore, useFeed, useMe, useMyTrips } from "@/lib/api/queries";

export default function HomePage() {
  const me = useMe().data;
  const [mode, setMode] = useState<"for-you" | "following">("for-you");
  const feed = useFeed(mode);
  const explore = useExplore();
  const mine = useMyTrips("all", !!me);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (mine.items ?? []).find((t) => !t.endDate || t.endDate >= today);
  const recommended = (explore.data?.trips ?? []).filter((t) => !t.myRole).slice(0, 4);
  const trending = (explore.data?.destinations ?? []).slice(0, 6);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <header>
          <p className="text-sm text-muted">
            {greeting()}
            {me ? `, ${me.displayName}` : ""}
          </p>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">Where to next?</h1>
        </header>

        {upcoming && <ContinuePlanning trip={upcoming} />}
        {!me && (
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-ink-2">Plan trips with friends and remix itineraries from real travelers.</p>
            <Button href="/register">Get started</Button>
          </div>
        )}

        <section className="lg:hidden">
          <SectionTitle
            action={
              <Link href="/explore" className="text-sm font-semibold text-lagoon">
                See all
              </Link>
            }
          >
            Trending destinations
          </SectionTitle>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {explore.isLoading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[3/4] w-32 shrink-0" />)
              : trending.map((d) => <DestinationTile key={d.id} dest={d} count={d.tripCount} className="w-32 shrink-0" />)}
          </div>
        </section>

        <section>
          <h2 className="sr-only">Feed</h2>
          <Tabs
            id="feed-tabs"
            label="Feed"
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "for-you", label: "For You" },
              { value: "following", label: "Following" },
            ]}
            className="mb-5"
          />
          <TabPanel tabsId="feed-tabs" value={mode} className="mx-auto max-w-xl space-y-6">
            {feed.isLoading ? (
              [0, 1].map((i) => <Skeleton key={i} className="h-96" />)
            ) : feed.isError ? (
              <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
            ) : posts.length === 0 ? (
              <EmptyState
                icon={<Users className="size-7" />}
                title={mode === "following" ? "Nothing here yet" : "Share your first journey."}
                body={mode === "following" ? "Follow travelers whose trips you love and their stories will show up here." : "Posts from travelers will appear here."}
                action={<Button href={mode === "following" ? "/explore" : "/posts/new"}>{mode === "following" ? "Find travelers" : "New post"}</Button>}
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
            {feed.hasNextPage && (
              <Button variant="secondary" className="w-full" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {feed.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            )}
          </TabPanel>
        </section>
      </div>

      <aside className="hidden space-y-8 lg:block">
        <section>
          <SectionTitle>Recommended trips</SectionTitle>
          <div className="space-y-5">
            {explore.isLoading ? <Skeleton className="aspect-[4/3]" /> : recommended.slice(0, 3).map((t) => <TripCard key={t.id} trip={t} compact />)}
          </div>
        </section>
        <section>
          <SectionTitle
            action={
              <Link href="/explore" className="text-sm font-semibold text-lagoon">
                All
              </Link>
            }
          >
            Trending
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2.5">
            {trending.map((d) => (
              <DestinationTile key={d.id} dest={d} />
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function ContinuePlanning({ trip }: { trip: TripSummary }) {
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-3 pr-5 shadow-card transition-colors hover:border-lagoon"
    >
      <span className="size-16 shrink-0 overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg, ${trip.cover[0]}, ${trip.cover[1]})` }} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-sunset-700">Continue planning</div>
        <div className="truncate font-semibold">{trip.title}</div>
        <div className="truncate text-sm text-muted">
          {trip.route || "Destination TBD"} · {formatDateRange(trip.startDate ?? undefined, trip.endDate ?? undefined)} · {trip.stats.travelers} travelers
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
