"use client";

import { ArrowLeft, Bookmark, Flag, GitFork, Heart, MapPin, MessageCircle, Send, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ReportSheet } from "@/components/social/ReportSheet";
import { useShare } from "@/components/social/PostCard";
import { Cover } from "@/components/trip/Cover";
import { ForkSheet } from "@/components/trip/ForkSheet";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Button, EmptyState, IconButton, cx, formatCount, inputCls, timeAgo } from "@/components/ui";
import { canView, userById } from "@/lib/mock/selectors";
import { usePermissions } from "@/lib/store/hooks";
import { useMe, useStore } from "@/lib/store/store";

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { db, me, actions, ready } = useStore();
  const user = useMe();
  const router = useRouter();
  const share = useShare();
  const [photo, setPhoto] = useState(0);
  const [comment, setComment] = useState("");
  const [forkOpen, setForkOpen] = useState(false);
  const [report, setReport] = useState<{ target: "POST" | "COMMENT"; id: string } | null>(null);
  const post = db.posts.find((p) => p.id === id);
  const perm = usePermissions(post?.tripId);

  if (!ready) return null;
  if (!post) return <EmptyState icon={<MessageCircle className="size-7" />} title="This post was removed" action={<Button href="/home">Back home</Button>} />;

  const author = userById(db, post.userId)!;
  const trip = post.tripId ? db.trips.find((t) => t.id === post.tripId && !t.deletedAt) : undefined;
  const tripVisible = trip && canView(db, trip, me);
  const comments = db.comments.filter((c) => c.postId === post.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const liked = db.likes.some((l) => l.userId === me && l.postId === post.id);
  const saved = db.savedPosts.some((l) => l.userId === me && l.postId === post.id);
  const commentsAllowed = !trip || trip.allowComments;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <IconButton label="Back" onClick={() => router.back()}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <Link href={`/u/${author.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar user={author} size={40} />
          <div className="leading-tight">
            <div className="font-semibold">{author.displayName}</div>
            <div className="text-xs text-muted">
              @{author.username} · {timeAgo(post.createdAt)}
            </div>
          </div>
        </Link>
        {me && me !== post.userId && (
          <IconButton label="Report post" onClick={() => setReport({ target: "POST", id: post.id })}>
            <Flag className="size-4" />
          </IconButton>
        )}
      </div>

      <div>
        <Cover palette={post.photos[photo]} seed={`${post.id}-${photo}`} className="aspect-[4/3] w-full md:aspect-[16/10]" />
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
        {post.destinationId && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <MapPin className="size-4" />
            {db.destinations.find((d) => d.id === post.destinationId)?.name}
          </p>
        )}
        <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{post.body}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => actions.toggleLike(post.id)} aria-pressed={liked}>
          <Heart className={cx("size-4", liked && "fill-sunset text-sunset")} /> {formatCount(post.likeCount)}
        </Button>
        <Button variant="secondary" href="#comments">
          <MessageCircle className="size-4" /> {post.commentCount}
        </Button>
        <Button variant="secondary" onClick={() => actions.toggleSavePost(post.id)} aria-pressed={saved}>
          <Bookmark className={cx("size-4", saved && "fill-ink")} /> {saved ? "Saved" : "Save"}
        </Button>
        <Button variant="secondary" onClick={() => share(`/posts/${post.id}`)}>
          <Share2 className="size-4" /> Share
        </Button>
      </div>

      {trip && tripVisible && (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">The trip behind this post</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <TripCard trip={trip} compact />
            <div className="flex flex-col gap-2 sm:w-48">
              <Button href={`/trips/${trip.id}`} variant="secondary">
                View trip
              </Button>
              {perm.can("trip.fork") && (
                <Button variant="accent" onClick={() => setForkOpen(true)}>
                  <GitFork className="size-4" /> Use this trip
                </Button>
              )}
              {!perm.can("trip.fork") && trip.ownerId !== me && !trip.allowFork && <p className="text-center text-xs text-muted">The creator turned off remixing.</p>}
            </div>
          </div>
        </section>
      )}

      <section id="comments" className="scroll-mt-20 space-y-4">
        <h2 className="font-display text-xl font-semibold">Comments · {comments.length}</h2>
        {comments.length === 0 && <p className="text-sm text-muted">No comments yet. Ask {author.displayName} something about the trip!</p>}
        <ul className="space-y-4">
          {comments.map((c) => {
            const cu = userById(db, c.userId)!;
            const mine = c.userId === me || post.userId === me;
            return (
              <li key={c.id} className="group flex gap-3">
                <Avatar user={cu} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="rounded-2xl rounded-tl-sm bg-surface px-3.5 py-2.5">
                    <span className="text-sm font-semibold">{cu.displayName}</span>
                    <p className="text-sm text-ink-2">{c.body}</p>
                  </div>
                  <div className="mt-1 flex gap-3 px-1 text-xs text-muted">
                    {timeAgo(c.createdAt)}
                    {mine ? (
                      <button onClick={() => actions.deleteComment(c.id)} className="flex items-center gap-1 hover:text-danger">
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
            );
          })}
        </ul>
        {user && commentsAllowed ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (actions.addComment(post.id, comment)) setComment("");
            }}
            className="flex items-center gap-2"
          >
            <Avatar user={user} size={34} />
            <input className={cx(inputCls, "rounded-full")} placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            <IconButton label="Send" type="submit" className="bg-lagoon text-white hover:bg-lagoon-600" disabled={!comment.trim()}>
              <Send className="size-4" />
            </IconButton>
          </form>
        ) : !commentsAllowed ? (
          <p className="text-sm text-muted">Comments are turned off for this trip.</p>
        ) : null}
      </section>

      {trip && <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} tripId={trip.id} />}
      {report && <ReportSheet open onClose={() => setReport(null)} target={report.target} targetId={report.id} />}
    </div>
  );
}
