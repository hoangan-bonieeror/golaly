"use client";

import type { TripSummary } from "@golaly/shared";
import { GitFork, Users } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { NowCard, YourTrips, focusTrip } from "@/components/home/NowCard";
import { PostCard } from "@/components/social/PostCard";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { useQueryClient } from "@tanstack/react-query";
import { FoldedMap } from "@/components/art/EmptyArt";
import { Button, EmptyState, ErrorState, SectionTitle, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { useT } from "@/i18n/client";
import { useExplore, useFeed, useHydrated, useMe, useMyTrips } from "@/lib/api/queries";
import { todayIso } from "@/lib/plan";

export default function HomePage() {
  const me = useMe().data;
  const [mode, setMode] = useState<"for-you" | "following">("for-you");
  const feed = useFeed(mode);
  const explore = useExplore();
  const mine = useMyTrips("all", !!me);
  const hydrated = useHydrated();
  const myTrips = mine.items ?? [];
  // Which trip leads depends on today's date on this device, so it's picked after hydration.
  const focus = hydrated ? focusTrip(myTrips, todayIso()) : null;
  const recommended = (explore.data?.trips ?? []).filter((x) => !x.myRole).slice(0, 4);
  const trending = (explore.data?.destinations ?? []).slice(0, 6);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
  const t = useT();
  // The device's own clock: the server can't know the visitor's time zone, so it renders no greeting.
  const pod = useSyncExternalStore(noop, partOfDay, () => null);
  const greeting = pod ? t.home.greeting[pod] : null;
  const empty = mode === "following" ? t.home.emptyFollowing : t.home.emptyForYou;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <header>
          <p className="text-sm text-muted">
            {greeting ? (me ? t.home.greetingName(greeting, me.displayName) : greeting) : "\u00a0"}
          </p>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">{t.home.title}</h1>
        </header>

        {me && <NowCard trips={myTrips} />}
        {me && <YourTrips trips={myTrips} exclude={focus?.trip.id} />}
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
            {explore.isLoading ? <FoldedMap className="aspect-[4/3]" /> : recommended.slice(0, 1).map((r) => <TripCard key={r.id} trip={r} compact morph />)}
          </div>
          {recommended.length > 1 && (
            <ul className="mt-3 divide-y divide-line">
              {recommended.slice(1, 4).map((r) => (
                <RailTrip key={r.id} trip={r} />
              ))}
            </ul>
          )}
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

/** A recommended trip as one compact line in the right rail: swatch, title, route, remixes. */
function RailTrip({ trip }: { trip: TripSummary }) {
  const t = useT();
  const qc = useQueryClient();
  return (
    <li>
      <Link href={`/trips/${trip.id}`} onClick={() => qc.setQueryData(["trip-preview", trip.id], trip)} className="group flex items-center gap-3 py-2.5">
        <span
          aria-hidden
          className="size-11 shrink-0 rounded-xl bg-cover bg-center"
          style={trip.coverImage || trip.coverUrl ? { backgroundImage: `url(${trip.coverImage?.thumbUrl ?? trip.coverUrl})` } : { background: `linear-gradient(135deg, ${trip.cover[0]}, ${trip.cover[1]})` }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold group-hover:underline">{trip.title}</span>
          <span className="block truncate text-xs text-muted">
            {trip.route || t.home.destinationTbd} · {t.format.days(trip.stats.days)}
          </span>
        </span>
        {trip.forkCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted" title={t.home.forks(trip.forkCount)}>
            <GitFork className="size-3.5" aria-hidden /> <span aria-hidden>{trip.forkCount}</span>
            <span className="sr-only">{t.home.forks(trip.forkCount)}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

const noop = () => () => {};
function partOfDay(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
