"use client";

import type { PostView } from "@golaly/shared";
import { Bookmark, CalendarDays, Heart, MapPin, MessageCircle, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormat, useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { useAction, useMe } from "@/lib/api/queries";
import { useToast } from "@/lib/toast";
import { Cover } from "../trip/Cover";
import { Avatar, Button, cx } from "../ui";

export function useShare() {
  const toast = useToast();
  const t = useT();
  return async (path: string, title?: string) => {
    const url = typeof window !== "undefined" ? window.location.origin + path : path;
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ url, title });
      else {
        await navigator.clipboard.writeText(url);
        toast(t.common.linkCopied);
      }
    } catch {
      /* user cancelled share sheet */
    }
  };
}

/** Like / save toggles for a post, refreshing every list it may appear in. */
export function usePostActions(post: PostView) {
  const t = useT();
  const invalidate = [["feed"], ["post", post.id], ["posts"], ["profile"], ["destination"]];
  const like = useAction((on: boolean) => (on ? api.post<PostView>(`/posts/${post.id}/like`) : api.delete<PostView>(`/posts/${post.id}/like`)), { invalidate });
  const save = useAction((on: boolean) => (on ? api.post<PostView>(`/posts/${post.id}/save`) : api.delete<PostView>(`/posts/${post.id}/save`)), {
    invalidate,
    success: (r) => (r.savedByMe ? t.social.post.saved : t.social.post.unsaved),
  });
  return { like, save };
}

export function PostCard({ post, level = "h3" }: { post: PostView; level?: "h2" | "h3" }) {
  const H = level;
  const me = useMe().data;
  const router = useRouter();
  const t = useT();
  const f = useFormat();
  const share = useShare();
  const { like, save } = usePostActions(post);
  const trip = post.trip;
  const requireLogin = (fn: () => void) => (me ? fn() : router.push("/login"));
  const photo = post.photos[0] ?? { palette: ["#1f5e52", "#d9481c"] as [string, string], url: null, image: null };

  return (
    <article className="animate-rise overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
      <header className="flex items-center gap-3 px-4 py-3">
        <Link href={`/u/${post.author.username}`} aria-label={t.social.post.profileOf(post.author.displayName)} tabIndex={-1}>
          <Avatar user={post.author} size={38} />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link href={`/u/${post.author.username}`} className="text-sm font-semibold hover:underline">
            {post.author.displayName}
          </Link>
          <div className="truncate text-xs text-muted">
            {post.destination ? `${post.destination.name}, ${post.destination.country}` : t.social.post.travelStory} · {f.timeAgo(post.createdAt)}
          </div>
        </div>
      </header>

      <Link href={`/posts/${post.id}`} className="block">
        <Cover palette={photo.palette} image={photo.image} imageUrl={photo.url} sizes="(min-width: 640px) 576px, 100vw" seed={post.id} rounded={false} className="aspect-[16/10] w-full">
          <div className="flex h-full items-end p-4">
            {trip && (
              <div className="text-white">
                <div className="font-display text-2xl font-semibold leading-tight drop-shadow">{trip.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-sm text-white/90">
                  <MapPin className="size-3.5" />
                  {trip.route}
                </div>
              </div>
            )}
          </div>
        </Cover>
      </Link>

      <div className="px-4 pt-3">
        {trip && (
          <div className="mb-2 flex flex-wrap gap-2 text-xs font-semibold text-ink-2">
            <span className="flex items-center gap-1 rounded-full bg-sand-2 px-2.5 py-1">
              <CalendarDays className="size-3.5" /> {t.format.days(trip.stats.days)}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-sand-2 px-2.5 py-1">
              <MapPin className="size-3.5" /> {t.format.places(trip.stats.places)}
            </span>
          </div>
        )}
        <Link href={`/posts/${post.id}`}>
          <H className="font-semibold leading-snug">{post.title}</H>
          {post.body && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{post.body}</p>}
        </Link>
      </div>

      <footer className="flex items-center gap-1 px-2 py-2">
        <ActionBtn label={post.likedByMe ? t.social.post.unlike : t.social.post.like} onClick={() => requireLogin(() => like.run(!post.likedByMe))} active={post.likedByMe}>
          <Heart className={cx("size-5", post.likedByMe && "fill-accent text-accent")} />
          {f.count(post.likeCount)}
        </ActionBtn>
        <ActionBtn label={t.social.post.comments} href={`/posts/${post.id}#comments`}>
          <MessageCircle className="size-5" />
          {f.count(post.commentCount)}
        </ActionBtn>
        <ActionBtn label={post.savedByMe ? t.social.post.unsave : t.social.post.save} onClick={() => requireLogin(() => save.run(!post.savedByMe))} active={post.savedByMe}>
          <Bookmark className={cx("size-5", post.savedByMe && "fill-ink")} />
        </ActionBtn>
        <ActionBtn label={t.common.share} onClick={() => share(`/posts/${post.id}`, post.title)}>
          <Share2 className="size-5" />
        </ActionBtn>
        {trip && (
          <Button href={`/trips/${trip.id}`} variant="secondary" size="sm" className="ml-auto mr-2">
            {t.social.post.viewTrip}
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
