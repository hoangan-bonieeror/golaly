"use client";

import type { TripSummary } from "@triply/shared";
import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PostCard } from "@/components/social/PostCard";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { Button, EmptyState, ErrorState, SectionTitle, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { useFormat, useT } from "@/i18n/client";
import { useExplore, useFeed, useMe, useMyTrips } from "@/lib/api/queries";

export default function HomePage() {
  const me = useMe().data;
  const [mode, setMode] = useState<"for-you" | "following">("for-you");
  const feed = useFeed(mode);
  const explore = useExplore();
  const mine = useMyTrips("all", !!me);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (mine.items ?? []).find((x) => !x.endDate || x.endDate >= today);
  const recommended = (explore.data?.trips ?? []).filter((x) => !x.myRole).slice(0, 4);
  const trending = (explore.data?.destinations ?? []).slice(0, 6);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
  const t = useT();
  const greeting = t.home.greeting[partOfDay()];
  const empty = mode === "following" ? t.home.emptyFollowing : t.home.emptyForYou;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <header>
          <p className="text-sm text-muted">
            {me ? t.home.greetingName(greeting, me.displayName) : greeting}
          </p>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">{t.home.title}</h1>
        </header>

        {upcoming && <ContinuePlanning trip={upcoming} />}
        {!me && (
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-ink-2">{t.home.guestPitch}</p>
            <Button href="/register">{t.home.getStarted}</Button>
          </div>
        )}

        <section className="lg:hidden">
          <SectionTitle
            action={
              <Link href="/explore" className="text-sm font-semibold text-primary">
                {t.common.seeAll}
              </Link>
            }
          >
            {t.home.trendingDestinations}
          </SectionTitle>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {explore.isLoading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[3/4] w-32 shrink-0" />)
              : trending.map((d) => <DestinationTile key={d.id} dest={d} count={d.tripCount} className="w-32 shrink-0" />)}
          </div>
        </section>

        <section>
          <h2 className="sr-only">{t.home.feed}</h2>
          <Tabs
            id="feed-tabs"
            label={t.home.feed}
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "for-you", label: t.home.forYou },
              { value: "following", label: t.home.following },
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
                title={empty.title}
                body={empty.body}
                action={<Button href={mode === "following" ? "/explore" : "/posts/new"}>{empty.action}</Button>}
              />
            ) : (
              posts.map((p, i) => (
                <div key={p.id} className="space-y-6">
                  <PostCard post={p} />
                  {i === 0 && recommended.length > 0 && (
                    <section className="lg:hidden">
                      <SectionTitle>{t.home.recommendedTrips}</SectionTitle>
                      <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
                        {recommended.map((r) => (
                          <div key={r.id} className="w-64 shrink-0">
                            <TripCard trip={r} compact />
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
                {feed.isFetchingNextPage ? t.common.loading : t.common.loadMore}
              </Button>
            )}
          </TabPanel>
        </section>
      </div>

      <aside className="hidden space-y-8 lg:block">
        <section>
          <SectionTitle>{t.home.recommendedTrips}</SectionTitle>
          <div className="space-y-5">
            {explore.isLoading ? <Skeleton className="aspect-[4/3]" /> : recommended.slice(0, 3).map((r) => <TripCard key={r.id} trip={r} compact morph />)}
          </div>
        </section>
        <section>
          <SectionTitle
            action={
              <Link href="/explore" className="text-sm font-semibold text-primary">
                {t.home.all}
              </Link>
            }
          >
            {t.home.trending}
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
  const t = useT();
  const f = useFormat();
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-3 pr-5 shadow-card transition-colors hover:border-primary"
    >
      <span className="size-16 shrink-0 overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg, ${trip.cover[0]}, ${trip.cover[1]})` }} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent-700">{t.home.continuePlanning}</div>
        <div className="truncate font-semibold">{trip.title}</div>
        <div className="truncate text-sm text-muted">
          {trip.route || t.home.destinationTbd} · {f.dateRange(trip.startDate, trip.endDate)} · {t.format.travelers(trip.stats.travelers)}
        </div>
      </div>
      <ArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

function partOfDay() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
