"use client";

import { Bookmark } from "lucide-react";
import { useState } from "react";
import { PlaceRow } from "@/components/social/PlaceRow";
import { PostCard } from "@/components/social/PostCard";
import { TripCard } from "@/components/trip/TripCard";
import { Button, EmptyState, Skeleton, Tabs } from "@/components/ui";
import { useSavedPlaces, useSavedPosts, useSavedTrips } from "@/lib/api/queries";

type Tab = "trips" | "posts" | "places";

export default function SavedPage() {
  const [tab, setTab] = useState<Tab>("trips");
  const trips = useSavedTrips();
  const posts = useSavedPosts();
  const places = useSavedPlaces();
  const current = { trips, posts, places }[tab];
  const empty = {
    trips: "Save trips you want to explore later.",
    posts: "Save posts that inspire your next trip.",
    places: "Save places you don't want to forget.",
  }[tab];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-semibold md:text-4xl">Saved</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "trips", label: `Trips · ${trips.data?.length ?? "…"}` },
          { value: "posts", label: `Posts · ${posts.data?.length ?? "…"}` },
          { value: "places", label: `Places · ${places.data?.length ?? "…"}` },
        ]}
      />
      {current.isLoading && <Skeleton className="h-64" />}
      {tab === "trips" && !!trips.data?.length && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trips.data.map((t) => (
            <TripCard key={t.id} trip={t} />
          ))}
        </div>
      )}
      {tab === "posts" && !!posts.data?.length && (
        <div className="grid gap-6 md:grid-cols-2">
          {posts.data.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
      {tab === "places" && !!places.data?.length && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {places.data.map((p) => (
            <PlaceRow key={p.id} place={p} />
          ))}
        </div>
      )}
      {current.data && current.data.length === 0 && <EmptyState icon={<Bookmark className="size-7" />} title={empty} action={<Button href="/explore">Explore</Button>} />}
    </div>
  );
}
