import { Controller, Delete, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { MediaView } from "@triply/shared";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ViewerId, requireUser } from "../../common/auth";
import { randomToken } from "../../common/crypto";
import { AppError, Errors } from "../../common/http";
import { mediaUrl } from "../../common/presenters";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";

/** Storage boundary (spec §32). Local disk for development; add S3/R2 with signed URLs for production. */
export interface StorageDriver {
  put(key: string, body: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
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
const MAX_STORED_DIM = 2400;
const THUMB_DIM = 640;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageDriver,
  ) {}

  /**
   * Validates type (by content, not just the header), size and dimensions; re-encodes to WebP,
   * which also strips EXIF metadata such as GPS location; and generates a feed thumbnail.
   */
  async upload(ownerId: string, file: Express.Multer.File | undefined): Promise<MediaView> {
    if (!file) throw Errors.invalid("Choose a photo to upload.");
    if (!ALLOWED.has(file.mimetype)) throw new AppError(415, "Use a JPEG, PNG or WebP image.");
    if (file.size > env.MEDIA_MAX_BYTES) throw new AppError(413, `Photos can be up to ${Math.round(env.MEDIA_MAX_BYTES / 1024 / 1024)} MB.`);
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      meta = await sharp(file.buffer).metadata();
    } catch {
      throw new AppError(415, "That file isn't a valid image.");
    }
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new AppError(415, "Use a JPEG, PNG or WebP image.");
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < MIN_DIM || h < MIN_DIM) throw Errors.invalid(`Images need to be at least ${MIN_DIM}×${MIN_DIM} pixels.`);
    if (w > MAX_DIM || h > MAX_DIM) throw Errors.invalid(`Images can be at most ${MAX_DIM} pixels on a side.`);

    const base = sharp(file.buffer).rotate();
    const main = await base.clone().resize({ width: MAX_STORED_DIM, height: MAX_STORED_DIM, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await base.clone().resize({ width: THUMB_DIM, height: THUMB_DIM, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    const stem = `${ownerId.slice(0, 8)}/${randomToken(12)}`;
    const key = `${stem}.webp`;
    const thumbKey = `${stem}_thumb.webp`;
    await this.storage.put(key, main.data);
    await this.storage.put(thumbKey, thumb);
    const m = await this.prisma.media.create({
      data: { ownerId, storageKey: key, thumbKey, mimeType: "image/webp", sizeBytes: main.info.size, width: main.info.width, height: main.info.height },
    });
    return { id: m.id, url: mediaUrl(m.storageKey)!, thumbUrl: mediaUrl(m.thumbKey), width: m.width, height: m.height, mimeType: m.mimeType };
  }

  async remove(ownerId: string, id: string) {
    const m = await this.prisma.media.findFirst({ where: { id, ownerId } });
    if (!m) throw Errors.notFound("That photo");
    await this.prisma.media.delete({ where: { id } });
    await this.storage.delete(m.storageKey);
    if (m.thumbKey) await this.storage.delete(m.thumbKey);
    return { ok: true };
  }
}

@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
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

@Module({ controllers: [MediaController], providers: [MediaService, LocalStorageDriver] })
export class MediaModule {}
