"use client";

import { Bookmark, Flag, Luggage, MapPin, PenLine, Settings, UserX } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PostCard } from "@/components/social/PostCard";
import { ReportSheet } from "@/components/social/ReportSheet";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Button, EmptyState, IconButton, Tabs } from "@/components/ui";
import { userByUsername } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

type Tab = "trips" | "posts" | "saved";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { db, me, actions, ready } = useStore();
  const [tab, setTab] = useState<Tab>("trips");
  const [reportOpen, setReportOpen] = useState(false);
  const user = userByUsername(db, decodeURIComponent(username));

  if (!ready) return null;
  if (!user) return <EmptyState icon={<UserX className="size-7" />} title="Traveler not found" action={<Button href="/explore">Explore</Button>} />;

  const isMe = user.id === me;
  // Public profile never exposes private or link-only trips (spec §21, §34).
  const trips = db.trips
    .filter((t) => t.ownerId === user.id && !t.deletedAt && (isMe || t.visibility === "PUBLIC"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const posts = db.posts.filter((p) => p.userId === user.id && (isMe || p.visibility === "PUBLIC"));
  const followers = db.follows.filter((f) => f.followingId === user.id).length;
  const following = db.follows.filter((f) => f.followerId === user.id).length;
  const iFollow = db.follows.some((f) => f.followerId === me && f.followingId === user.id);

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-center gap-5 text-center md:flex-row md:items-start md:text-left">
        <Avatar user={user} size={104} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-center gap-3 md:flex-row md:items-center">
            <h1 className="font-display text-3xl font-semibold">{user.displayName}</h1>
            <div className="flex gap-2">
              {isMe ? (
                <Button variant="secondary" size="sm" href="/settings">
                  <Settings className="size-4" /> Edit profile
                </Button>
              ) : me ? (
                <>
                  <Button size="sm" variant={iFollow ? "secondary" : "primary"} onClick={() => actions.toggleFollow(user.id)}>
                    {iFollow ? "Following" : "Follow"}
                  </Button>
                  <IconButton label="Report user" onClick={() => setReportOpen(true)} className="size-8">
                    <Flag className="size-4" />
                  </IconButton>
                </>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-muted">@{user.username}</p>
          {user.bio && <p className="mt-2 max-w-md text-[15px] text-ink-2">{user.bio}</p>}
          {user.homeBase && (
            <p className="mt-1 flex items-center justify-center gap-1 text-sm text-muted md:justify-start">
              <MapPin className="size-3.5" /> {user.homeBase}
            </p>
          )}
          <dl className="mt-4 flex justify-center gap-8 md:justify-start">
            {[
              ["Trips", trips.length],
              ["Followers", followers],
              ["Following", following],
            ].map(([l, n]) => (
              <div key={l}>
                <dt className="text-xs text-muted">{l}</dt>
                <dd className="text-lg font-semibold">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "trips", label: "Trips" },
          { value: "posts", label: "Posts" },
          ...(isMe ? [{ value: "saved" as const, label: "Saved" }] : []),
        ]}
      />

      {tab === "trips" &&
        (trips.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Luggage className="size-7" />}
            title={isMe ? "Your next adventure starts here." : "No public trips yet"}
            action={isMe ? <Button href="/trips/new">Create trip</Button> : undefined}
          />
        ))}

      {tab === "posts" &&
        (posts.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {posts.map((p) => (
              <div key={p.id} className="relative">
                {p.visibility === "DRAFT" && <span className="absolute left-3 top-3 z-10 rounded-full bg-gold px-2.5 py-1 text-xs font-bold text-white">Draft</span>}
                <PostCard post={p} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<PenLine className="size-7" />}
            title={isMe ? "Share your first journey." : "No posts yet"}
            action={isMe ? <Button href="/posts/new">New post</Button> : undefined}
          />
        ))}

      {tab === "saved" && isMe && (
        <EmptyState icon={<Bookmark className="size-7" />} title="Everything you've saved lives in Saved" action={<Button href="/saved">Open Saved</Button>} />
      )}

      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} target="USER" targetId={user.id} />
    </div>
  );
}
