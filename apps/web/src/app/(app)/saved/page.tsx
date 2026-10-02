"use client";

import { Bookmark } from "lucide-react";
import { useState } from "react";
import { PlaceRow } from "@/components/social/PlaceRow";
import { PostCard } from "@/components/social/PostCard";
import { TripCard } from "@/components/trip/TripCard";
import { Button, EmptyState, Tabs } from "@/components/ui";
import { canView } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

type Tab = "trips" | "posts" | "places";

export default function SavedPage() {
  const { db, me } = useStore();
  const [tab, setTab] = useState<Tab>("trips");
  // A saved trip that later went private disappears from Saved for non-members.
  const trips = db.savedTrips
    .filter((s) => s.userId === me)
    .map((s) => db.trips.find((t) => t.id === s.tripId && !t.deletedAt))
    .filter((t): t is NonNullable<typeof t> => !!t && canView(db, t, me));
  const posts = db.savedPosts.filter((s) => s.userId === me).map((s) => db.posts.find((p) => p.id === s.postId)!).filter(Boolean);
  const places = db.savedPlaces.filter((s) => s.userId === me).map((s) => db.places.find((p) => p.id === s.placeId)!).filter(Boolean);

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
          { value: "trips", label: `Trips · ${trips.length}` },
          { value: "posts", label: `Posts · ${posts.length}` },
          { value: "places", label: `Places · ${places.length}` },
        ]}
      />
      {tab === "trips" && trips.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} />
          ))}
        </div>
      )}
      {tab === "posts" && posts.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
      {tab === "places" && places.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {places.map((p) => (
            <PlaceRow key={p.id} place={p} />
          ))}
        </div>
      )}
      {((tab === "trips" && !trips.length) || (tab === "posts" && !posts.length) || (tab === "places" && !places.length)) && (
        <EmptyState icon={<Bookmark className="size-7" />} title={empty} action={<Button href="/explore">Explore</Button>} />
      )}
    </div>
  );
}
