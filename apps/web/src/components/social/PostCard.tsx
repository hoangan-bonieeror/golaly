"use client";

import type { Post } from "@triply/shared";
import { Bookmark, CalendarDays, Heart, MapPin, MessageCircle, Share2 } from "lucide-react";
import Link from "next/link";
import { routeLabel, tripStats, userById } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";
import { Cover } from "../trip/Cover";
import { Avatar, Button, cx, formatCount, timeAgo } from "../ui";

export function useShare() {
  const { toast } = useStore();
  return async (path: string) => {
    const url = typeof window !== "undefined" ? window.location.origin + path : path;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Link: " + url);
    }
  };
}

export function PostCard({ post }: { post: Post }) {
  const { db, me, actions } = useStore();
  const share = useShare();
  const author = userById(db, post.userId);
  const trip = post.tripId ? db.trips.find((t) => t.id === post.tripId && !t.deletedAt) : undefined;
  const stats = trip ? tripStats(db, trip) : null;
  const liked = db.likes.some((l) => l.userId === me && l.postId === post.id);
  const saved = db.savedPosts.some((l) => l.userId === me && l.postId === post.id);
  const dest = db.destinations.find((d) => d.id === post.destinationId);

  return (
    <article className="animate-rise overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link href={`/u/${author?.username}`}>
          <Avatar user={author} size={38} />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link href={`/u/${author?.username}`} className="text-sm font-semibold hover:underline">
            {author?.displayName}
          </Link>
          <div className="truncate text-xs text-muted">
            {dest ? `${dest.name}, ${dest.country}` : "Travel story"} · {timeAgo(post.createdAt)}
          </div>
        </div>
      </header>

      <Link href={`/posts/${post.id}`} className="block">
        <Cover palette={post.photos[0]} seed={post.id} rounded={false} className="aspect-[16/10] w-full">
          <div className="flex h-full items-end p-4">
            {trip && (
              <div className="text-white">
                <div className="font-display text-2xl font-semibold leading-tight drop-shadow">{trip.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-sm text-white/90">
                  <MapPin className="size-3.5" />
                  {routeLabel(db, trip)}
                </div>
              </div>
            )}
          </div>
        </Cover>
      </Link>

      <div className="px-4 pt-3">
        {stats && (
          <div className="mb-2 flex flex-wrap gap-2 text-xs font-semibold text-ink-2">
            <span className="flex items-center gap-1 rounded-full bg-sand-2 px-2.5 py-1">
              <CalendarDays className="size-3.5" /> {stats.days} days
            </span>
            <span className="flex items-center gap-1 rounded-full bg-sand-2 px-2.5 py-1">
              <MapPin className="size-3.5" /> {stats.places} places
            </span>
          </div>
        )}
        <Link href={`/posts/${post.id}`}>
          <h3 className="font-semibold leading-snug">{post.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-ink-2">{post.body}</p>
        </Link>
      </div>

      <footer className="flex items-center gap-1 px-2 py-2">
        <ActionBtn label={liked ? "Unlike" : "Like"} onClick={() => actions.toggleLike(post.id)} active={liked}>
          <Heart className={cx("size-5", liked && "fill-sunset text-sunset")} />
          {formatCount(post.likeCount)}
        </ActionBtn>
        <ActionBtn label="Comments" href={`/posts/${post.id}#comments`}>
          <MessageCircle className="size-5" />
          {formatCount(post.commentCount)}
        </ActionBtn>
        <ActionBtn label={saved ? "Unsave" : "Save"} onClick={() => actions.toggleSavePost(post.id)} active={saved}>
          <Bookmark className={cx("size-5", saved && "fill-ink")} />
        </ActionBtn>
        <ActionBtn label="Share" onClick={() => share(`/posts/${post.id}`)}>
          <Share2 className="size-5" />
        </ActionBtn>
        {trip && (
          <Button href={`/trips/${trip.id}`} variant="secondary" size="sm" className="ml-auto mr-2">
            View trip
          </Button>
        )}
      </footer>
    </article>
  );
}

function ActionBtn({ label, onClick, href, active, children }: { label: string; onClick?: () => void; href?: string; active?: boolean; children: React.ReactNode }) {
  const cls = cx("flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-sand-2", active ? "text-ink" : "text-ink-2");
  if (href)
    return (
      <Link href={href} aria-label={label} className={cls}>
        {children}
      </Link>
    );
  return (
    <button aria-label={label} aria-pressed={active} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
