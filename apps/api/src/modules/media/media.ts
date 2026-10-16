import { Throttle } from "@nestjs/throttler";
import { Controller, Delete, Global, HttpCode, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { MediaView } from "@triply/shared";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ViewerId, requireUser } from "../../common/auth";
import { randomToken } from "../../common/crypto";
import { AppError, Errors } from "../../common/http";
import { toImage } from "../../common/presenters";
import { env } from "../../config/env";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { S3StorageDriver } from "./s3";

/**
 * Storage boundary (spec §32). MEDIA_DRIVER=local writes to MEDIA_DIR (development, a VM with a disk);
 * MEDIA_DRIVER=s3 writes to an S3-compatible bucket such as Cloudflare R2 (hosts without a persistent disk).
 * Either way the app serves images at /media/<key>: the API's static handler (local) or a redirect /
 * the web's MEDIA_ORIGIN rewrite to the bucket's public URL (s3).
 */
export interface StorageDriver {
  put(key: string, body: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Injection token for the configured StorageDriver. */
export const STORAGE = Symbol("StorageDriver");

export function createStorageDriver(): StorageDriver {
  if (env.MEDIA_DRIVER === "s3") {
    const s3 = env.S3!;
    return new S3StorageDriver({ endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey });
  }
  return new LocalStorageDriver();
}

@Injectable()
export class LocalStorageDriver implements StorageDriver {
  private readonly root = path.resolve(env.MEDIA_DIR);
  private safe(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("bad key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const file = this.safe(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  async delete(key: string) {
    await unlink(this.safe(key)).catch(() => undefined);
  }
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIN_DIM = 64;
const MAX_DIM = 10_000;
/** Decoding cost is width × height: cap it so one upload can't eat hundreds of MB of RAM. */
const MAX_PIXELS = 40_000_000;
/** Per-user upload quota (abuse/storage protection). */
const DAILY_UPLOADS = 200;
const MAX_STORED_DIM = 2400;
const MEDIUM_DIM = 1280;
const THUMB_DIM = 640;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /**
   * Validates type (by content, not just the header), size and dimensions; re-encodes to WebP,
   * which also strips EXIF metadata such as GPS location; and generates a feed thumbnail.
   */
  async upload(ownerId: string, file: Express.Multer.File | undefined): Promise<MediaView> {
    if (!file) throw Errors.invalid("Choose a photo to upload.");
    if (!ALLOWED.has(file.mimetype)) throw new AppError(415, "Use a JPEG, PNG or WebP image.");
    if (file.size > env.MEDIA_MAX_BYTES) throw new AppError(413, `Photos can be up to ${Math.round(env.MEDIA_MAX_BYTES / 1024 / 1024)} MB.`);
    const today = await this.prisma.media.count({ where: { ownerId, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (today >= DAILY_UPLOADS) throw new AppError(429, `You've uploaded ${DAILY_UPLOADS} photos today — that's the daily limit. Try again tomorrow.`);
    return toImage(await this.store(file.buffer, ownerId)) as MediaView;
  }

  /**
   * Shared by user uploads and imported photos (`ownerId` null): the same checks and the same
   * three WebP sizes, so every image the app serves went through one pipeline.
   */
  async store(buffer: Buffer, ownerId: string | null) {
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new AppError(415, "That file isn't a valid image.");
    }
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new AppError(415, "Use a JPEG, PNG or WebP image.");
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < MIN_DIM || h < MIN_DIM) throw Errors.invalid(`Images need to be at least ${MIN_DIM}×${MIN_DIM} pixels.`);
    if (w > MAX_DIM || h > MAX_DIM || w * h > MAX_PIXELS) throw Errors.invalid(`Images can be at most ${MAX_DIM} pixels on a side and ${MAX_PIXELS / 1_000_000} megapixels.`);

    const base = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();
    const main = await base.clone().resize({ width: MAX_STORED_DIM, height: MAX_STORED_DIM, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const medium = await base.clone().resize({ width: MEDIUM_DIM, height: MEDIUM_DIM, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const thumb = await base.clone().resize({ width: THUMB_DIM, height: THUMB_DIM, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    // Average colour → instant placeholder while the real image loads (no layout shift, no blank box).
    const { dominant } = await sharp(thumb).stats();
    const dominantColor = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    const stem = `${ownerId ? ownerId.slice(0, 8) : "imported"}/${randomToken(12)}`;
    const key = `${stem}.webp`;
    const mediumKey = `${stem}_1280.webp`;
    const thumbKey = `${stem}_thumb.webp`;
    await this.storage.put(key, main.data);
    await this.storage.put(mediumKey, medium);
    await this.storage.put(thumbKey, thumb);
    return this.prisma.media.create({
      data: { ownerId, storageKey: key, mediumKey, thumbKey, dominantColor, mimeType: "image/webp", sizeBytes: main.info.size, width: main.info.width, height: main.info.height },
    });
  }

  async remove(ownerId: string, id: string) {
    const m = await this.prisma.media.findFirst({ where: { id, ownerId } });
    if (!m) throw Errors.notFound("That photo");
    await this.destroy([m]);
    return { ok: true };
  }

  /**
   * Deletes a user's upload as soon as nothing live shows it any more (e.g. a photo taken off a stop): bucket URLs
   * are public and cached, so a photo that's gone from the app must not stay reachable by its link.
   */
  async releaseIfUnused(mediaId: string) {
    await this.destroy(await this.prisma.media.findMany({ where: { id: mediaId, ...unused() } }));
  }

  /** Every upload of an account being deleted — its photos leave the trips and posts they were on, too. */
  async purgeOwner(ownerId: string) {
    for (let batch = await this.page(ownerId); batch.length; batch = await this.page(ownerId)) await this.destroy(batch);
  }
  private page(ownerId: string) {
    return this.prisma.media.findMany({ where: { ownerId }, take: 200 });
  }

  /**
   * Garbage collection: uploads never attached to anything, or whose trip / post was deleted more than a day ago.
   * Only rows older than `graceMs` (an upload is attached a moment after it's made). Returns how many went.
   */
  async sweep(graceMs = 86_400_000, limit = 500) {
    const rows = await this.prisma.media.findMany({ where: { createdAt: { lt: new Date(Date.now() - graceMs) }, ...unused() }, take: limit });
    await this.destroy(rows);
    return rows.length;
  }

  private async destroy(rows: { id: string; storageKey: string; mediumKey: string | null; thumbKey: string | null }[]) {
    if (!rows.length) return;
    // Rows first (stop photos and post images on them go too; covers and avatars are unset), then the files: a failed
    // file delete leaves an unreachable object, never a broken image.
    await this.prisma.media.deleteMany({ where: { id: { in: rows.map((m) => m.id) } } });
    for (const m of rows) for (const k of [m.storageKey, m.mediumKey, m.thumbKey]) if (k) await this.storage.delete(k).catch(() => undefined);
  }
}

/** A user's upload nothing live shows: no avatar, no catalog photo, no cover / stop photo / post photo on a live trip or post. */
function unused() {
  // Deleted trips and posts keep their photos for a day.
  const live = { OR: [{ deletedAt: null }, { deletedAt: { gt: new Date(Date.now() - 86_400_000) } }] };
  return {
    ownerId: { not: null },
    avatarOf: { none: {} },
    placePhoto: { none: {} },
    coverOf: { none: live },
    postMedia: { none: { post: live } },
    itemPhotos: { none: { item: { trip: live } } },
  } satisfies Prisma.MediaWhereInput;
}

/** Runs MediaService.sweep every six hours (not in tests). Several instances may run it: deletes are idempotent. */
@Injectable()
export class MediaJanitor implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("MediaJanitor");
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly media: MediaService) {}

  onModuleInit() {
    if (env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.run(), 6 * 3_600_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    try {
      const n = await this.media.sweep();
      if (n) this.log.log(`Removed ${n} unused upload(s)`);
    } catch (e) {
      this.log.warn(`sweep failed: ${(e as Error).message}`);
    }
  }
}

@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.MEDIA_MAX_BYTES + 1, files: 1 } }))
  upload(@ViewerId() me: string | null, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.media.upload(requireUser(me), file);
  }

  @Delete(":id")
  @HttpCode(200)
  remove(@ViewerId() me: string | null, @Param("id", ParseUUIDPipe) id: string) {
    return this.media.remove(requireUser(me), id);
  }
}

/** Global: stops and accounts release their uploads through MediaService. */
@Global()
@Module({ controllers: [MediaController], providers: [MediaService, MediaJanitor, { provide: STORAGE, useFactory: createStorageDriver }], exports: [MediaService] })
export class MediaModule {}
