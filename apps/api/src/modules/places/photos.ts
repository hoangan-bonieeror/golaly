import { Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Param, ParseUUIDPipe, Patch, Post, Query, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { addPlacePhotoSchema, moderatePhotoSchema, type AddPlacePhotoInput, type ModerationPhoto, type Paged, type PlacePhotoView } from "@triply/shared";
import { z } from "zod";
import { ViewerId, requireUser } from "../../common/auth";
import { AppError, Errors, ZodPipe } from "../../common/http";
import { placePhotoInclude, toPlacePhotoView, type PlacePhotoRow } from "../../common/presenters";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { MediaService } from "../media/media";

/** Photos a user may add to place pages per day (on top of the media upload quota). */
const DAILY_PLACE_PHOTOS = 50;
/** New accounts' photos wait for review; older ones, or ones with public trips/posts, publish at once. */
const TRUSTED_AFTER_DAYS = 3;
/** Ordering: approved user photos first, then imports (set by the pipeline: main image 1.5, quality images 1.0). */
export const USER_PHOTO_SCORE = 2;

type WithMedia = PlacePhotoRow & { media: NonNullable<PlacePhotoRow["media"]> };
const view = (p: PlacePhotoRow, viewerId: string | null) => toPlacePhotoView(p as WithMedia, viewerId);

@Injectable()
export class PlacePhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async isAdmin(userId: string) {
    return (await this.prisma.user.count({ where: { id: userId, role: "ADMIN", deletedAt: null } })) > 0;
  }

  private async requireAdmin(userId: string) {
    if (!(await this.isAdmin(userId))) throw Errors.forbidden("Only moderators can do that.");
  }

  /** Verified, and either not brand new or already sharing public trips/posts. */
  private async trusted(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, createdAt: true } });
    if (u.role === "ADMIN" || u.createdAt < new Date(Date.now() - TRUSTED_AFTER_DAYS * 86_400_000)) return true;
    const [trips, posts] = await Promise.all([
      this.prisma.trip.count({ where: { ownerId: userId, visibility: "PUBLIC", deletedAt: null } }),
      this.prisma.post.count({ where: { userId, visibility: "PUBLIC", deletedAt: null } }),
    ]);
    return trips + posts > 0;
  }

  async add(placeId: string, viewerId: string, input: AddPlacePhotoInput): Promise<PlacePhotoView> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { emailVerifiedAt: true } });
    if (!user.emailVerifiedAt) throw new AppError(403, "Confirm your email address to share photos on place pages.");
    const place = await this.prisma.place.findFirst({ where: { id: placeId, status: "ACTIVE", mergedIntoId: null }, select: { id: true } });
    if (!place) throw Errors.notFound("That place");
    const media = await this.prisma.media.findFirst({ where: { id: input.mediaId, ownerId: viewerId }, select: { id: true } });
    if (!media) throw Errors.invalid("Upload the photo first.");
    if (input.postId) {
      const inPost = await this.prisma.postMedia.count({ where: { postId: input.postId, mediaId: input.mediaId, post: { userId: viewerId, deletedAt: null } } });
      if (!inPost) throw Errors.invalid("That photo isn't in that post.");
    }
    const today = await this.prisma.placePhoto.count({ where: { uploadedById: viewerId, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (today >= DAILY_PLACE_PHOTOS) throw new AppError(429, `You've shared ${DAILY_PLACE_PHOTOS} place photos today — that's the daily limit.`);
    const status = (await this.trusted(viewerId)) ? "APPROVED" : "PENDING";
    try {
      const row = await this.prisma.placePhoto.create({
        data: { placeId, source: "user", mediaId: input.mediaId, caption: input.caption || null, postId: input.postId ?? null, uploadedById: viewerId, status, score: USER_PHOTO_SCORE },
        include: placePhotoInclude,
      });
      return view(row, viewerId);
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw Errors.conflict("That photo is already on this place.");
      throw e;
    }
  }

  /** Uploaders can take their photo down; moderators can remove any. */
  async remove(photoId: string, viewerId: string) {
    const p = await this.prisma.placePhoto.findUnique({ where: { id: photoId }, select: { uploadedById: true, status: true, source: true } });
    if (!p || (p.status !== "APPROVED" && p.uploadedById !== viewerId && !(await this.isAdmin(viewerId)))) throw Errors.notFound("That photo");
    const admin = p.uploadedById !== viewerId;
    if (admin) await this.requireAdmin(viewerId);
    await this.prisma.placePhoto.delete({ where: { id: photoId } });
    if (admin) await this.audit.log(viewerId, "place_photo.removed", "place_photo", photoId, { source: p.source });
    return { ok: true };
  }

  async moderate(photoId: string, viewerId: string, status: "APPROVED" | "HIDDEN"): Promise<PlacePhotoView> {
    await this.requireAdmin(viewerId);
    const exists = await this.prisma.placePhoto.count({ where: { id: photoId } });
    if (!exists) throw Errors.notFound("That photo");
    const row = await this.prisma.transaction(async (tx) => {
      // Approving resolves the reports, so the same reports can't immediately hide it again.
      if (status === "APPROVED") await tx.report.deleteMany({ where: { target: "PLACE_PHOTO", targetId: photoId } });
      const r = await tx.placePhoto.update({ where: { id: photoId }, data: { status, ...(status === "APPROVED" ? { reportCount: 0 } : {}) }, include: placePhotoInclude });
      await this.audit.log(viewerId, status === "APPROVED" ? "place_photo.approved" : "place_photo.hidden", "place_photo", photoId, {}, tx);
      return r;
    });
    return view(row, viewerId);
  }

  /** Moderation queue: waiting for review, reported, or hidden. Only processed photos (there's something to look at). */
  async queue(viewerId: string, filter: "pending" | "reported" | "hidden", cursor: string | undefined, limit: number): Promise<Paged<ModerationPhoto>> {
    await this.requireAdmin(viewerId);
    const where = {
      mediaId: { not: null },
      ...(filter === "pending" ? { status: "PENDING" as const } : filter === "hidden" ? { status: "HIDDEN" as const } : { status: "APPROVED" as const, reportCount: { gt: 0 } }),
    };
    const rows = await this.prisma.placePhoto.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { ...placePhotoInclude, place: { select: { id: true, name: true, destination: { select: { name: true } }, area: { select: { name: true } } } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        ...view(r, viewerId),
        place: { id: r.place.id, name: r.place.name, destinationName: r.place.destination?.name ?? r.place.area?.name ?? "" },
        reportCount: r.reportCount,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }
}

/**
 * Downloads imported photos (rows the catalog pipeline queued with a `remoteUrl`) and stores them
 * through MediaService, so they're served from our own storage in our own sizes. Rows are claimed
 * with FOR UPDATE SKIP LOCKED and a lease, so several API instances can run this safely.
 */
@Injectable()
export class PhotoIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("PhotoIngest");
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** The CLI drain script turns the timer off and runs batches itself. */
  static autoStart = true;
  /** "Golaly/0.2 (+contact) node" per Wikimedia's User-Agent policy; null → imports wait (see env.ts). */
  userAgent: string | null = env.PHOTO_USER_AGENT ?? (env.CATALOG_CONTACT ? `Golaly/0.2 (+${env.CATALOG_CONTACT}) node/${process.versions.node}` : null);
  private warnedNoContact = false;
  /** Swappable in tests; production uses the global fetch. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  onModuleInit() {
    if (!PhotoIngestService.autoStart || env.PHOTO_INGEST === "off" || env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), 20_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.ingestBatch(5);
    } catch (e) {
      this.log.warn(`batch failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Processes up to `limit` queued photos. Returns how many were claimed, stored and failed. */
  async ingestBatch(limit = 5) {
    if (!this.userAgent) {
      if (!this.warnedNoContact) this.log.warn("Imported photos are waiting: set CATALOG_CONTACT (a URL or email) so Wikimedia accepts our downloads.");
      this.warnedNoContact = true;
      return { claimed: 0, stored: 0, failed: 0 };
    }
    const claimed = await this.prisma.$queryRaw<{ id: string; remote_url: string; source: string; source_id: string | null; ingest_attempts: number }[]>`
      UPDATE place_photos SET ingest_attempts = ingest_attempts + 1, next_ingest_at = now() + interval '10 minutes'
      WHERE id IN (
        SELECT id FROM place_photos
        WHERE media_id IS NULL AND remote_url IS NOT NULL AND status <> 'HIDDEN' AND ingest_attempts < 5
          AND (next_ingest_at IS NULL OR next_ingest_at <= now())
        ORDER BY score DESC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id::text AS id, remote_url, source, source_id, ingest_attempts`;
    let stored = 0;
    let failed = 0;
    for (const row of claimed) {
      try {
        // The same Commons file can illustrate several places: download it once.
        const twin = row.source_id
          ? await this.prisma.placePhoto.findFirst({ where: { source: row.source, sourceId: row.source_id, mediaId: { not: null } }, select: { mediaId: true } })
          : null;
        const mediaId = twin?.mediaId ?? (await this.media.store(await this.download(row.remote_url), null)).id;
        await this.prisma.placePhoto.update({ where: { id: row.id }, data: { mediaId, ingestError: null, nextIngestAt: null } });
        stored++;
      } catch (e) {
        failed++;
        const msg = (e as Error).message.slice(0, 500);
        // Back off: 5, 10, 20, 40 minutes, then give up (ingest_attempts reaches 5).
        await this.prisma.placePhoto.update({
          where: { id: row.id },
          data: { ingestError: msg, nextIngestAt: new Date(Date.now() + 5 * 60_000 * 2 ** (row.ingest_attempts - 1)) },
        });
        this.log.warn(`photo ${row.id}: ${msg}`);
      }
    }
    return { claimed: claimed.length, stored, failed };
  }

  /** HTTPS from an allowed host only, no redirects, size-capped — never a way to make the server fetch arbitrary URLs. */
  async download(url: string): Promise<Buffer> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error("invalid URL");
    }
    if (u.protocol !== "https:" || !env.PHOTO_HOSTS.includes(u.hostname.toLowerCase())) throw new Error(`host not allowed: ${u.hostname}`);
    const res = await this.fetcher(u, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": this.userAgent ?? "", Accept: "image/*" } });
    if (res.status === 403) throw new Error("HTTP 403 — Wikimedia refused the request; check CATALOG_CONTACT / PHOTO_USER_AGENT");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`not an image: ${type}`);
    const max = env.MEDIA_MAX_BYTES * 2;
    if (Number(res.headers.get("content-length") ?? 0) > max) throw new Error("too large");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("empty body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
}

const queueQuery = z.object({
  filter: z.enum(["pending", "reported", "hidden"]).default("pending"),
  cursor: z.uuid("That page link is invalid.").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

@Controller()
export class PlacePhotosController {
  constructor(private readonly photos: PlacePhotosService) {}

  @Post("places/:id/photos")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  add(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(addPlacePhotoSchema)) body: AddPlacePhotoInput, @ViewerId() me: string | null) {
    return this.photos.add(id, requireUser(me), body);
  }

  @Delete("place-photos/:id")
  @HttpCode(200)
  remove(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.photos.remove(id, requireUser(me));
  }

  @Patch("place-photos/:id")
  moderate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(moderatePhotoSchema)) body: z.infer<typeof moderatePhotoSchema>, @ViewerId() me: string | null) {
    return this.photos.moderate(id, requireUser(me), body.status);
  }

  @Get("admin/place-photos")
  queue(@Query(new ZodPipe(queueQuery)) q: z.infer<typeof queueQuery>, @ViewerId() me: string | null) {
    return this.photos.queue(requireUser(me), q.filter, q.cursor, q.limit);
  }
}
