import { Injectable } from "@nestjs/common";
import type { CommentView, CreatePostInput, CreateReportInput, HomeFeed, Paged, PostView } from "@triply/shared";
import { AppError, Errors } from "../../common/http";
import { commentInclude, postInclude, roleOf, toCommentView, toPostView } from "../../common/presenters";
import type { Prisma } from "../../generated/prisma/client";
import { pageOf } from "../../common/paging";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications";
import { ProductEventsService } from "../activity/product-events";

/** Separate reports from established accounts that hide a place photo until a moderator looks at it. */
export const PHOTO_REPORTS_TO_HIDE = 3;
/** "Established": a confirmed e-mail and an account at least this old — three throwaway sign-ups can't hide a photo. */
export const REPORTER_MIN_AGE_MS = 7 * 86_400_000;

/**
 * Per-account daily limits on what others see (security review S19): generous for people, tight for scripts.
 * Accounts that haven't confirmed their e-mail get the smaller number.
 */
export const DAILY_LIMITS = {
  post: { confirmed: 20, unconfirmed: 3 },
  comment: { confirmed: 200, unconfirmed: 20 },
  report: { confirmed: 30, unconfirmed: 10 },
} as const;

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly product: ProductEventsService,
  ) {}

  /** Throws 429 once the account has done `kind` its daily number of times (rolling 24 hours). */
  private async assertDailyQuota(userId: string, kind: keyof typeof DAILY_LIMITS) {
    const since = new Date(Date.now() - 86_400_000);
    const [user, done] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      {
        post: () => this.prisma.post.count({ where: { userId, createdAt: { gt: since } } }),
        comment: () => this.prisma.postComment.count({ where: { userId, createdAt: { gt: since } } }),
        report: () => this.prisma.report.count({ where: { reporterId: userId, createdAt: { gt: since } } }),
      }[kind](),
    ]);
    const limit = DAILY_LIMITS[kind][user?.emailVerifiedAt ? "confirmed" : "unconfirmed"];
    if (done < limit) return;
    const noun = { post: "posts", comment: "comments", report: "reports" }[kind];
    throw new AppError(
      429,
      user?.emailVerifiedAt
        ? `You've reached today's limit of ${limit} ${noun}. Try again tomorrow.`
        : `You've reached today's limit of ${limit} ${noun}. Confirm your email to raise it.`,
    );
  }

  /** Who may read a post: author always; PUBLIC everyone; FOLLOWERS followers; DRAFT author only. */
  private async visibleWhere(viewerId: string | null): Promise<Prisma.PostWhereInput> {
    // Relation filters (EXISTS subqueries) instead of loading every followed id into an IN list.
    const audience: Prisma.PostWhereInput = {
      OR: [{ visibility: "PUBLIC" }, ...(viewerId ? [{ visibility: "FOLLOWERS" as const, user: { followers: { some: { followerId: viewerId } } } }] : [])],
    };
    // Spec §34: a post whose trip goes private stays readable (it's the author's own story) but
    // drops out of feeds, and the presenter hides the trip itself from anyone who can't see it.
    return { deletedAt: null, OR: [audience, ...(viewerId ? [{ userId: viewerId }] : [])] };
  }

  private async loadVisible(postId: string, viewerId: string | null) {
    const post = await this.prisma.post.findFirst({ where: { id: postId, ...(await this.visibleWhere(viewerId)) }, include: postInclude(viewerId) });
    if (!post) throw Errors.notFound("That post");
    return post;
  }

  async feed(viewerId: string | null, mode: "for-you" | "following", cursor: string | undefined, limit: number): Promise<HomeFeed> {
    const base = await this.visibleWhere(viewerId);
    if (mode === "following" && !viewerId) return { posts: [], nextCursor: null };
    const where: Prisma.PostWhereInput = {
      AND: [
        base,
        { visibility: { not: "DRAFT" } },
        // Posts that point at a now-private trip drop out of public feeds (spec §34).
        { OR: [{ tripId: null }, { trip: { deletedAt: null, visibility: { not: "PRIVATE" } } }] },
        ...(mode === "following" ? [{ user: { followers: { some: { followerId: viewerId! } } } }] : []),
      ],
    };
    const rows = await this.prisma.post.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: postInclude(viewerId),
    });
    const page = rows.slice(0, limit);
    return { posts: page.map((p) => toPostView(p, viewerId)), nextCursor: rows.length > limit ? page.at(-1)!.id : null };
  }

  async get(postId: string, viewerId: string | null): Promise<PostView> {
    return toPostView(await this.loadVisible(postId, viewerId), viewerId);
  }

  async create(viewerId: string, input: CreatePostInput & { mediaIds: string[]; visibility: PostView["visibility"]; body: string }): Promise<PostView> {
    await this.assertDailyQuota(viewerId, "post");
    let destinationId: string | null = null;
    let palettes: [string, string][] = [["#6b3a1f", "#e0662d"]];
    if (input.tripId) {
      const trip = await this.prisma.trip.findFirst({
        where: { id: input.tripId, deletedAt: null },
        include: { members: true, destinations: { orderBy: { position: "asc" }, include: { destination: true } } },
      });
      if (!trip) throw Errors.notFound("That trip");
      if (trip.ownerId !== viewerId) throw new AppError(403, "You can only share your own trips.");
      if (input.visibility !== "DRAFT" && trip.visibility === "PRIVATE")
        throw Errors.invalid("Make the trip Public or Link-only before sharing it.");
      destinationId = trip.destinations[0]?.destinationId ?? null;
      palettes = [[trip.coverA, trip.coverB], ...trip.destinations.slice(1).map((d) => [d.destination.paletteA, d.destination.paletteB] as [string, string])];
    }
    if (input.mediaIds.length) {
      const owned = await this.prisma.media.count({ where: { id: { in: input.mediaIds }, ownerId: viewerId } });
      if (owned !== input.mediaIds.length) throw Errors.invalid("Upload your photos first.");
    }
    const media = input.mediaIds.length
      ? input.mediaIds.map((mediaId, position) => ({ mediaId, position, paletteA: palettes[0][0], paletteB: palettes[0][1] }))
      : palettes.map(([a, b], position) => ({ position, paletteA: a, paletteB: b }));
    const post = await this.prisma.post.create({
      data: { userId: viewerId, tripId: input.tripId ?? null, destinationId, title: input.title, body: input.body, visibility: input.visibility, media: { create: media } },
    });
    this.product.track({ type: "post.created", userId: viewerId, tripId: input.tripId ?? null, props: { visibility: input.visibility, photos: media.length } });
    return this.get(post.id, viewerId);
  }

  async update(postId: string, viewerId: string, patch: { title?: string; body?: string; visibility?: PostView["visibility"] }) {
    const post = await this.prisma.post.findFirst({ where: { id: postId, deletedAt: null }, include: { trip: true } });
    if (!post) throw Errors.notFound("That post");
    if (post.userId !== viewerId) throw new AppError(403, "You can only edit your own posts.");
    if (patch.visibility && patch.visibility !== "DRAFT" && post.trip?.visibility === "PRIVATE")
      throw Errors.invalid("Make the trip Public or Link-only before publishing this post.");
    await this.prisma.post.update({ where: { id: postId }, data: patch });
    return this.get(postId, viewerId);
  }

  async remove(postId: string, viewerId: string) {
    const post = await this.prisma.post.findFirst({ where: { id: postId, deletedAt: null } });
    if (!post) throw Errors.notFound("That post");
    if (post.userId !== viewerId) throw new AppError(403, "You can only delete your own posts.");
    await this.prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /**
   * Idempotent like/unlike. The counter moves by however many rows actually changed, inside the
   * same transaction, so double-clicks and concurrent requests can neither error nor drift it.
   */
  async setLiked(postId: string, viewerId: string, on: boolean): Promise<PostView> {
    const post = await this.loadVisible(postId, viewerId);
    const changed = await this.prisma.transaction(async (tx) => {
      const r = on
        ? await tx.postLike.createMany({ data: [{ userId: viewerId, postId }], skipDuplicates: true })
        : await tx.postLike.deleteMany({ where: { userId: viewerId, postId } });
      if (r.count) await tx.post.update({ where: { id: postId }, data: { likeCount: on ? { increment: r.count } : { decrement: r.count } } });
      return r.count > 0;
    });
    if (on && changed) await this.notifications.notify([post.userId], viewerId, "LIKE", { k: "like", post: post.title }, { postId });
    return this.get(postId, viewerId);
  }

  async setSaved(postId: string, viewerId: string, on: boolean): Promise<PostView> {
    await this.loadVisible(postId, viewerId);
    if (on) await this.prisma.savedPost.createMany({ data: [{ userId: viewerId, postId }], skipDuplicates: true });
    else await this.prisma.savedPost.deleteMany({ where: { userId: viewerId, postId } });
    return this.get(postId, viewerId);
  }

  async savedPosts(viewerId: string, cursor: string | undefined, limit: number): Promise<Paged<PostView>> {
    const rows = await this.prisma.post.findMany({
      where: { ...(await this.visibleWhere(viewerId)), savedBy: { some: { userId: viewerId } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: postInclude(viewerId),
    });
    return pageOf(rows, limit, (p) => toPostView(p, viewerId));
  }

  // ── Comments ───────────────────────────────────────────────────────────
  /** Oldest first, a page at a time ("Show more comments"). */
  async comments(postId: string, viewerId: string | null, cursor: string | undefined, limit: number): Promise<Paged<CommentView>> {
    const post = await this.loadVisible(postId, viewerId);
    const rows = await this.prisma.postComment.findMany({
      where: { postId, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: commentInclude,
    });
    return pageOf(rows, limit, (c) => toCommentView(c, viewerId, post.userId));
  }

  async addComment(postId: string, viewerId: string, body: string): Promise<CommentView> {
    const post = await this.loadVisible(postId, viewerId);
    if (post.trip && !post.trip.allowComments) throw new AppError(403, "Comments are turned off for this trip.");
    if (post.visibility === "DRAFT") throw Errors.invalid("You can't comment on a draft.");
    await this.assertDailyQuota(viewerId, "comment");
    const [c] = await this.prisma.$transaction([
      this.prisma.postComment.create({ data: { postId, userId: viewerId, body }, include: commentInclude }),
      this.prisma.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } }),
    ]);
    await this.notifications.notify([post.userId], viewerId, "COMMENT", { k: "comment", post: post.title }, { postId });
    return toCommentView(c, viewerId, post.userId);
  }

  async deleteComment(commentId: string, viewerId: string) {
    const c = await this.prisma.postComment.findFirst({ where: { id: commentId, deletedAt: null }, include: { post: { select: { userId: true } } } });
    if (!c) throw Errors.notFound("That comment");
    if (c.userId !== viewerId && c.post.userId !== viewerId) throw new AppError(403, "You can only delete your own comments.");
    // Conditional soft-delete: only the request that actually flips deletedAt decrements the
    // counter, so a double-click (or author + post owner at once) can't count it twice.
    await this.prisma.transaction(async (tx) => {
      const r = await tx.postComment.updateMany({ where: { id: commentId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (r.count === 1) await tx.post.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } });
    });
    return { ok: true };
  }

  // ── Reports (spec §35) ─────────────────────────────────────────────────
  async report(viewerId: string, input: CreateReportInput) {
    // Only content the reporter can actually see — so reports can't be used to probe whether a
    // private trip or post exists (both cases give the same 404).
    const visiblePost = await this.visibleWhere(viewerId);
    const exists = await {
      POST: () => this.prisma.post.count({ where: { id: input.targetId, ...visiblePost } }),
      COMMENT: () => this.prisma.postComment.count({ where: { id: input.targetId, deletedAt: null, post: visiblePost } }),
      USER: () => this.prisma.user.count({ where: { id: input.targetId, deletedAt: null } }),
      TRIP: () =>
        this.prisma.trip.count({
          where: { id: input.targetId, deletedAt: null, OR: [{ visibility: { not: "PRIVATE" } }, { members: { some: { userId: viewerId } } }] },
        }),
      PLACE_PHOTO: () => this.prisma.placePhoto.count({ where: { id: input.targetId, OR: [{ status: "APPROVED" }, { uploadedById: viewerId }] } }),
    }[input.target]();
    if (!exists) throw Errors.notFound("That content");
    const already = await this.prisma.report.count({ where: { reporterId: viewerId, target: input.target, targetId: input.targetId } });
    if (!already) await this.assertDailyQuota(viewerId, "report");
    await this.prisma.report.upsert({
      where: { reporterId_target_targetId: { reporterId: viewerId, target: input.target, targetId: input.targetId } },
      create: { reporterId: viewerId, ...input },
      update: { reason: input.reason, details: input.details },
    });
    if (input.target === "PLACE_PHOTO") {
      // Community moderation: enough separate reports from established accounts take a photo down until a moderator
      // reviews it. Every report still counts towards the moderation queue.
      const where = { target: "PLACE_PHOTO" as const, targetId: input.targetId };
      const [n, trusted] = await Promise.all([
        this.prisma.report.count({ where }),
        this.prisma.report.count({
          where: { ...where, reporter: { deletedAt: null, emailVerifiedAt: { not: null }, createdAt: { lt: new Date(Date.now() - REPORTER_MIN_AGE_MS) } } },
        }),
      ]);
      await this.prisma.placePhoto.update({
        where: { id: input.targetId },
        data: { reportCount: n, ...(trusted >= PHOTO_REPORTS_TO_HIDE ? { status: "HIDDEN" } : {}) },
      });
    }
    return { ok: true };
  }

  /** Utility for presenters elsewhere. */
  static canSeeTrip(trip: { visibility: string; ownerId: string; members: { userId: string; role: "OWNER" | "EDITOR" | "VIEWER" }[] }, viewerId: string | null) {
    return trip.visibility !== "PRIVATE" || !!roleOf(trip, viewerId);
  }
}
