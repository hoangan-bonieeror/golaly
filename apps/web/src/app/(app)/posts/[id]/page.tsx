"use client";

import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { CommentView } from "@triply/shared";
import { ArrowLeft, Bookmark, Flag, GitFork, Heart, MapPin, MessageCircle, Send, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { usePostActions, useShare } from "@/components/social/PostCard";
import { ReportSheet } from "@/components/social/ReportSheet";
import { Cover } from "@/components/trip/Cover";
import { ForkSheet } from "@/components/trip/ForkSheet";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Button, cx, ErrorState, formatCount, IconButton, inputCls, LoadMore, PageLoader, timeAgo } from "@/components/ui";
import { api } from "@/lib/api/client";
import { keys, useAction, useComments, useMe, usePost } from "@/lib/api/queries";
import type { PostView } from "@triply/shared";

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = usePost(id);
  useDocumentTitle(q.data?.title);
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState page error={q.error} onRetry={() => q.refetch()} />;
  return <PostDetail post={q.data} />;
}

function PostDetail({ post }: { post: PostView }) {
  const me = useMe().data;
  const router = useRouter();
  const share = useShare();
  const { like, save } = usePostActions(post);
  const comments = useComments(post.id);
  const [photo, setPhoto] = useState(0);
  const [comment, setComment] = useState("");
  const [forkOpen, setForkOpen] = useState(false);
  const [report, setReport] = useState<{ target: "POST" | "COMMENT"; id: string } | null>(null);
  const trip = post.trip;
  const canFork = !!me && !!trip && trip.visibility === "PUBLIC" && trip.allowFork && trip.owner.id !== me.id;
  const commentsAllowed = !trip || trip.allowComments;
  const invalidate = [keys.comments(post.id), keys.post(post.id), ["feed"]];
  const addComment = useAction((body: string) => api.post<CommentView>(`/posts/${post.id}/comments`, { body }), { invalidate });
  const delComment = useAction((cid: string) => api.delete(`/comments/${cid}`), { invalidate, success: "Comment deleted" });
  const delPost = useAction(() => api.delete(`/posts/${post.id}`), { invalidate: [["feed"], ["profile"]], success: "Post deleted" });
  const requireLogin = (fn: () => void) => (me ? fn() : router.push(`/login?next=/posts/${post.id}`));
  const current = post.photos[photo] ?? { palette: ["#1f5e52", "#d9481c"] as [string, string], url: null, image: null };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <IconButton label="Back" onClick={() => router.back()}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <Link href={`/u/${post.author.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar user={post.author} size={40} />
          <div className="leading-tight">
            <div className="font-semibold">{post.author.displayName}</div>
            <div className="text-xs text-muted">
              @{post.author.username} · {timeAgo(post.createdAt)}
              {post.visibility === "DRAFT" && " · Draft"}
            </div>
          </div>
        </Link>
        {me && me.id !== post.author.id && (
          <IconButton label="Report post" onClick={() => setReport({ target: "POST", id: post.id })}>
            <Flag className="size-4" />
          </IconButton>
        )}
        {me?.id === post.author.id && (
          <IconButton
            label="Delete post"
            onClick={async () => {
              if (await delPost.run(undefined)) router.push(`/u/${post.author.username}`);
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>

      <div>
        <Cover palette={current.palette} image={current.image} imageUrl={current.url} priority sizes="(min-width: 768px) 768px, 100vw" seed={`${post.id}-${photo}`} className="aspect-[4/3] w-full md:aspect-[16/10]" />
        {post.photos.length > 1 && (
          <div className="mt-2 flex justify-center gap-1.5">
            {post.photos.map((_, i) => (
              <button key={i} onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1}`} className={cx("h-1.5 rounded-full transition-all", i === photo ? "w-6 bg-ink" : "w-1.5 bg-line")} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h1 className="font-display text-3xl font-semibold leading-tight">{post.title}</h1>
        {post.destination && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <MapPin className="size-4" />
            <Link href={`/explore/${post.destination.slug}`} className="hover:underline">
              {post.destination.name}
            </Link>
          </p>
        )}
        {post.body && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{post.body}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => requireLogin(() => like.run(!post.likedByMe))} aria-pressed={post.likedByMe}>
          <Heart className={cx("size-4", post.likedByMe && "fill-accent text-accent")} /> {formatCount(post.likeCount)}
        </Button>
        <Button variant="secondary" href="#comments">
          <MessageCircle className="size-4" /> {post.commentCount}
        </Button>
        <Button variant="secondary" onClick={() => requireLogin(() => save.run(!post.savedByMe))} aria-pressed={post.savedByMe}>
          <Bookmark className={cx("size-4", post.savedByMe && "fill-ink")} /> {post.savedByMe ? "Saved" : "Save"}
        </Button>
        <Button variant="secondary" onClick={() => share(`/posts/${post.id}`, post.title)}>
          <Share2 className="size-4" /> Share
        </Button>
      </div>

      {trip && (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <h2 className="mb-3 font-display text-xl font-semibold">The trip behind this post</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <TripCard trip={trip} compact />
            <div className="flex flex-col gap-2 sm:w-48">
              <Button href={`/trips/${trip.id}`} variant="secondary">
                View trip
              </Button>
              {canFork && (
                <Button variant="accent" onClick={() => setForkOpen(true)}>
                  <GitFork className="size-4" /> Use this trip
                </Button>
              )}
              {!me && trip.allowFork && (
                <Button variant="accent" href={`/login?next=/posts/${post.id}`}>
                  <GitFork className="size-4" /> Log in to remix
                </Button>
              )}
              {me && trip.owner.id !== me.id && !trip.allowFork && <p className="text-center text-xs text-muted">The creator turned off remixing.</p>}
            </div>
          </div>
        </section>
      )}

      <section id="comments" className="scroll-mt-20 space-y-4">
        <h2 className="font-display text-xl font-semibold">Comments · {post.commentCount}</h2>
        {comments.items?.length === 0 && <p className="text-sm text-muted">No comments yet. Ask {post.author.displayName} something about the trip!</p>}
        <ul className="space-y-4">
          {comments.items?.map((c) => (
            <li key={c.id} className="group flex gap-3">
              <Link href={`/u/${c.author.username}`} aria-label={`${c.author.displayName}'s profile`} tabIndex={-1}>
                <Avatar user={c.author} size={34} />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="rounded-2xl rounded-tl-sm bg-surface px-3.5 py-2.5">
                  <span className="text-sm font-semibold">{c.author.displayName}</span>
                  <p className="whitespace-pre-line text-sm text-ink-2">{c.body}</p>
                </div>
                <div className="mt-1 flex gap-3 px-1 text-xs text-muted">
                  {timeAgo(c.createdAt)}
                  {c.canDelete ? (
                    <button onClick={() => delComment.run(c.id)} className="flex items-center gap-1 hover:text-danger">
                      <Trash2 className="size-3" /> Delete
                    </button>
                  ) : (
                    me && (
                      <button onClick={() => setReport({ target: "COMMENT", id: c.id })} className="hover:text-ink">
                        Report
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <LoadMore hasMore={comments.hasNextPage} loading={comments.isFetchingNextPage} onClick={() => comments.fetchNextPage()} label="Show more comments" />
        {me && commentsAllowed && post.visibility !== "DRAFT" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await addComment.run(comment)) setComment("");
            }}
            className="flex items-center gap-2"
          >
            <Avatar user={me} size={34} />
            <input className={cx(inputCls, "rounded-full")} placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} aria-label="Add a comment" />
            <IconButton label="Send" type="submit" className="bg-primary text-white hover:bg-primary-600" disabled={!comment.trim() || addComment.isPending}>
              <Send className="size-4" />
            </IconButton>
          </form>
        ) : !commentsAllowed ? (
          <p className="text-sm text-muted">Comments are turned off for this trip.</p>
        ) : !me ? (
          <p className="text-sm text-muted">
            <Link href={`/login?next=/posts/${post.id}`} className="font-semibold text-primary">
              Log in
            </Link>{" "}
            to join the conversation.
          </p>
        ) : null}
      </section>

      {trip && canFork && <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} trip={trip} />}
      {report && <ReportSheet open onClose={() => setReport(null)} target={report.target} targetId={report.id} />}
    </div>
  );
}
