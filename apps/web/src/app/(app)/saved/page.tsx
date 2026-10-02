"use client";

import { Bookmark } from "lucide-react";
import { useState } from "react";
import { PlaceRow } from "@/components/social/PlaceRow";
import { PostCard } from "@/components/social/PostCard";
import { TripCard } from "@/components/trip/TripCard";
import { Button, EmptyState, LoadMore, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { useSavedPlaces, useSavedPosts, useSavedTrips } from "@/lib/api/queries";

type Tab = "trips" | "posts" | "places";

export default function SavedPage() {
  const [tab, setTab] = useState<Tab>("trips");
  const trips = useSavedTrips();
  const posts = useSavedPosts();
  const places = useSavedPlaces();
  const count = (items: unknown[] | undefined, more?: boolean) => (items ? `${items.length}${more ? "+" : ""}` : "…");
  const current = { trips: { isLoading: trips.isLoading, items: trips.items }, posts: { isLoading: posts.isLoading, items: posts.items }, places: { isLoading: places.isLoading, items: places.data } }[tab];
  const empty = {
    trips: "Save trips you want to explore later.",
    posts: "Save posts that inspire your next trip.",
    places: "Save places you don't want to forget.",
  }[tab];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-semibold md:text-4xl">Saved</h1>
      <Tabs
        id="saved-tabs"
        label="Saved items"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "trips", label: `Trips · ${count(trips.items, trips.hasNextPage)}` },
          { value: "posts", label: `Posts · ${count(posts.items, posts.hasNextPage)}` },
          { value: "places", label: `Places · ${count(places.data)}` },
        ]}
      />
      <TabPanel tabsId="saved-tabs" value={tab} className="space-y-6">
      {current.isLoading && <Skeleton className="h-64" />}
      {tab === "trips" && !!trips.items?.length && (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.items.map((t) => (
              <TripCard key={t.id} trip={t} level="h2" />
            ))}
          </div>
          <LoadMore hasMore={trips.hasNextPage} loading={trips.isFetchingNextPage} onClick={() => trips.fetchNextPage()} />
        </>
      )}
      {tab === "posts" && !!posts.items?.length && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            {posts.items.map((p) => (
              <PostCard key={p.id} post={p} level="h2" />
            ))}
          </div>
          <LoadMore hasMore={posts.hasNextPage} loading={posts.isFetchingNextPage} onClick={() => posts.fetchNextPage()} />
        </>
      )}
      {tab === "places" && !!places.data?.length && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {places.data.map((p) => (
            <PlaceRow key={p.id} place={p} />
          ))}
        </div>
      )}
      {current.items && current.items.length === 0 && <EmptyState icon={<Bookmark className="size-7" />} title={empty} action={<Button href="/explore">Explore</Button>} />}
      </TabPanel>
    </div>
  );
}
