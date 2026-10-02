"use client";

import { Bookmark, Flag, Luggage, MapPin, PenLine, Settings } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PostCard } from "@/components/social/PostCard";
import { ReportSheet } from "@/components/social/ReportSheet";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Button, EmptyState, ErrorState, IconButton, PageLoader, Skeleton, Tabs } from "@/components/ui";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe, useProfile, useUserPosts, useUserTrips } from "@/lib/api/queries";

type Tab = "trips" | "posts" | "saved";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const handle = decodeURIComponent(username);
  const me = useMe().data;
  const router = useRouter();
  const profile = useProfile(handle);
  const trips = useUserTrips(handle);
  const posts = useUserPosts(handle);
  const [tab, setTab] = useState<Tab>("trips");
  const [reportOpen, setReportOpen] = useState(false);
  const follow = useAction((on: boolean) => (on ? api.post(`/users/${handle}/follow`) : api.delete(`/users/${handle}/follow`)), {
    invalidate: [keys.profile(handle), ["feed"]],
  });

  if (profile.isLoading) return <PageLoader />;
  if (profile.isError || !profile.data) return <ErrorState error={profile.error} />;
  const p = profile.data;
  const u = p.user;

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-center gap-5 text-center md:flex-row md:items-start md:text-left">
        <Avatar user={u} size={104} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-center gap-3 md:flex-row md:items-center">
            <h1 className="font-display text-3xl font-semibold">{u.displayName}</h1>
            <div className="flex gap-2">
              {p.isMe ? (
                <Button variant="secondary" size="sm" href="/settings">
                  <Settings className="size-4" /> Edit profile
                </Button>
              ) : (
                <>
                  <Button size="sm" variant={p.followedByMe ? "secondary" : "primary"} disabled={follow.isPending} onClick={() => (me ? follow.run(!p.followedByMe) : router.push(`/login?next=/u/${handle}`))}>
                    {p.followedByMe ? "Following" : "Follow"}
                  </Button>
                  {me && (
                    <IconButton label="Report user" onClick={() => setReportOpen(true)} className="size-8">
                      <Flag className="size-4" />
                    </IconButton>
                  )}
                </>
              )}
            </div>
          </div>
          <p className="text-sm text-muted">@{u.username}</p>
          {u.bio && <p className="mt-2 max-w-md text-[15px] text-ink-2">{u.bio}</p>}
          {u.homeBase && (
            <p className="mt-1 flex items-center justify-center gap-1 text-sm text-muted md:justify-start">
              <MapPin className="size-3.5" /> {u.homeBase}
            </p>
          )}
          <dl className="mt-4 flex justify-center gap-8 md:justify-start">
            {(
              [
                ["Trips", p.trips],
                ["Followers", p.followers],
                ["Following", p.following],
              ] as const
            ).map(([l, n]) => (
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
        tabs={[{ value: "trips" as const, label: "Trips" }, { value: "posts" as const, label: "Posts" }, ...(p.isMe ? [{ value: "saved" as const, label: "Saved" }] : [])]}
      />

      {tab === "trips" &&
        (trips.isLoading ? (
          <Skeleton className="aspect-[5/4] max-w-sm" />
        ) : trips.data?.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.data.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Luggage className="size-7" />}
            title={p.isMe ? "Your next adventure starts here." : "No public trips yet"}
            action={p.isMe ? <Button href="/trips/new">Create trip</Button> : undefined}
          />
        ))}

      {tab === "posts" &&
        (posts.isLoading ? (
          <Skeleton className="h-80 max-w-md" />
        ) : posts.data?.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {posts.data.map((post) => (
              <div key={post.id} className="relative">
                {post.visibility === "DRAFT" && <span className="absolute left-3 top-3 z-10 rounded-full bg-gold px-2.5 py-1 text-xs font-bold text-white">Draft</span>}
                <PostCard post={post} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<PenLine className="size-7" />} title={p.isMe ? "Share your first journey." : "No posts yet"} action={p.isMe ? <Button href="/posts/new">New post</Button> : undefined} />
        ))}

      {tab === "saved" && p.isMe && <EmptyState icon={<Bookmark className="size-7" />} title="Everything you've saved lives in Saved" action={<Button href="/saved">Open Saved</Button>} />}

      {reportOpen && <ReportSheet open onClose={() => setReportOpen(false)} target="USER" targetId={u.id} />}
    </div>
  );
}
