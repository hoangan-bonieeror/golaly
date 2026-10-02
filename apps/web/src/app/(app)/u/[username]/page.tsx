"use client";

import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { Bookmark, Flag, Luggage, MapPin, PenLine, Settings } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PostCard } from "@/components/social/PostCard";
import { ReportSheet } from "@/components/social/ReportSheet";
import { TripCard } from "@/components/trip/TripCard";
import { INTERESTS, TRAVELER_TYPES } from "@triply/shared";
import Link from "next/link";
import { Avatar, Badge, Button, EmptyState, ErrorState, IconButton, PageLoader, Sheet, Skeleton, TabPanel, Tabs } from "@/components/ui";
import { api } from "@/lib/api/client";
import { keys, useAction, useFollowList, useMe, useProfile, useUserPosts, useUserTrips } from "@/lib/api/queries";

type Tab = "trips" | "posts" | "saved";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const handle = decodeURIComponent(username);
  const me = useMe().data;
  const router = useRouter();
  const profile = useProfile(handle);
  useDocumentTitle(profile.data ? `${profile.data.user.displayName} (@${profile.data.user.username})` : null);
  const trips = useUserTrips(handle);
  const posts = useUserPosts(handle);
  const [tab, setTab] = useState<Tab>("trips");
  const [reportOpen, setReportOpen] = useState(false);
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const follow = useAction((on: boolean) => (on ? api.post(`/users/${handle}/follow`) : api.delete(`/users/${handle}/follow`)), {
    invalidate: [keys.profile(handle), ["feed"]],
  });

  if (profile.isLoading) return <PageLoader />;
  if (profile.isError || !profile.data) return <ErrorState page error={profile.error} />;
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
          <p className="flex items-center justify-center gap-2 text-sm text-muted md:justify-start">
            @{u.username}
            {p.followsMe && <span className="rounded-full bg-sand-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">Follows you</span>}
          </p>
          {u.bio && <p className="mt-2 max-w-md text-[15px] text-ink-2">{u.bio}</p>}
          {u.homeBase && (
            <p className="mt-1 flex items-center justify-center gap-1 text-sm text-muted md:justify-start">
              <MapPin className="size-3.5" /> {u.homeBase}
            </p>
          )}
          {(u.travelerType || u.interests.length > 0) && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5 md:justify-start">
              {u.travelerType && <Badge tone="lagoon">{TRAVELER_TYPES.find((x) => x.value === u.travelerType)?.label} traveler</Badge>}
              {u.interests.map((i) => (
                <Badge key={i}>{INTERESTS.find((x) => x.value === i)?.label ?? i}</Badge>
              ))}
            </div>
          )}
          <ul aria-label="Profile stats" className="mt-4 flex justify-center gap-6 md:justify-start">
            <Stat label="Trips" value={p.trips} />
            <Stat label="Countries" value={p.countries} />
            <Stat label="Followers" value={p.followers} onClick={() => setList("followers")} />
            <Stat label="Following" value={p.following} onClick={() => setList("following")} />
          </ul>
          <p className="mt-2 text-xs text-muted">Joined {new Date(u.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
        </div>
      </header>

      <Tabs
        id="profile-tabs"
        label="Profile content"
        value={tab}
        onChange={setTab}
        tabs={[{ value: "trips" as const, label: "Trips" }, { value: "posts" as const, label: "Posts" }, ...(p.isMe ? [{ value: "saved" as const, label: "Saved" }] : [])]}
      />

      <TabPanel tabsId="profile-tabs" value={tab}>
      {tab === "trips" &&
        (trips.isLoading ? (
          <Skeleton className="aspect-[5/4] max-w-sm" />
        ) : trips.data?.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.data.map((t) => (
              <TripCard key={t.id} trip={t} level="h2" />
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
                <PostCard post={post} level="h2" />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<PenLine className="size-7" />} title={p.isMe ? "Share your first journey." : "No posts yet"} action={p.isMe ? <Button href="/posts/new">New post</Button> : undefined} />
        ))}

      {tab === "saved" && p.isMe && <EmptyState icon={<Bookmark className="size-7" />} title="Everything you've saved lives in Saved" action={<Button href="/saved">Open Saved</Button>} />}
      </TabPanel>

      {reportOpen && <ReportSheet open onClose={() => setReportOpen(false)} target="USER" targetId={u.id} />}
      <FollowSheet handle={handle} which={list} onClose={() => setList(null)} />
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const inner = (
    <span className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </span>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className="min-h-11 rounded-lg text-left hover:opacity-80" aria-label={`${value} ${label}. Show list`}>
          {inner}
        </button>
      ) : (
        <span aria-label={`${value} ${label}`}>{inner}</span>
      )}
    </li>
  );
}

function FollowSheet({ handle, which, onClose }: { handle: string; which: "followers" | "following" | null; onClose: () => void }) {
  const me = useMe().data;
  const q = useFollowList(handle, which);
  const follow = useAction((a: { username: string; on: boolean }) => (a.on ? api.post(`/users/${a.username}/follow`) : api.delete(`/users/${a.username}/follow`)), {
    invalidate: [["profile"], ["feed"]],
  });
  return (
    <Sheet open={!!which} onClose={onClose} title={which === "followers" ? "Followers" : "Following"}>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : !q.data?.length ? (
        <p className="py-6 text-center text-sm text-muted">{which === "followers" ? "No followers yet." : "Not following anyone yet."}</p>
      ) : (
        <ul className="-mx-2 max-h-[60vh] overflow-y-auto">
          {q.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-sand-2">
              <Link href={`/u/${p.username}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar user={p} size={40} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.displayName}</span>
                  <span className="block truncate text-xs text-muted">
                    @{p.username}
                    {p.homeBase && ` · ${p.homeBase}`}
                  </span>
                </span>
              </Link>
              {me && !p.isMe && (
                <Button size="sm" variant={p.followedByMe ? "secondary" : "primary"} disabled={follow.isPending} onClick={() => follow.run({ username: p.username, on: !p.followedByMe })}>
                  {p.followedByMe ? "Following" : "Follow"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
