import { applyDecorators, Injectable, SetMetadata, UseInterceptors, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { of, tap, type Observable } from "rxjs";
import { LOCALE_HEADER } from "@golaly/shared";
import { env } from "../config/env";
import type { AuthUser } from "./auth";

/**
 * A short-lived in-memory cache for what visitors read (performance work, 2026-10). The API's host has little CPU,
 * and most of a request's CPU goes into Prisma, the Postgres driver and building the JSON, not into our code; a
 * public page asked for again within a minute doesn't need any of that.
 *
 * - Only GET requests from visitors (no session) on routes marked @PublicCache(): a signed-in person's view has
 *   personal bits (saved, my role) and always comes fresh.
 * - Keyed by the full URL (path + query) and the two language headers (interface language, place-name language).
 * - Any successful write clears the whole cache (`clearPublicCacheOnWrite`), so people never see their own change go
 *   missing; what changes without a request (catalog imports, photo downloads) shows up within the TTL.
 * - Per instance and bounded (least recently used entries go first). Responses say `X-Cache: HIT` / `MISS`.
 */
const TTL_KEY = "publicCacheTtl";
const MAX_ENTRIES = 500;

type Entry = { body: unknown; expires: number };
const entries = new Map<string, Entry>();

export function clearPublicCache() {
  entries.clear();
}

/** Mark a GET route as cacheable for visitors, for `ttlMs` (default a minute). */
export const PublicCache = (ttlMs = 60_000) => applyDecorators(SetMetadata(TTL_KEY, ttlMs), UseInterceptors(PublicCacheInterceptor));

@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ttl = this.reflector.get<number | undefined>(TTL_KEY, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (!ttl || env.PUBLIC_CACHE !== "on" || req.method !== "GET" || req.user) return next.handle();

    const key = `${req.originalUrl}\n${req.headers[LOCALE_HEADER] ?? ""}\n${req.headers["accept-language"] ?? ""}`;
    const hit = entries.get(key);
    if (hit && hit.expires > Date.now()) {
      entries.delete(key); // re-insert: most recently used last
      entries.set(key, hit);
      res.setHeader("X-Cache", "HIT");
      return of(hit.body);
    }
    if (hit) entries.delete(key);
    res.setHeader("X-Cache", "MISS");
    return next.handle().pipe(
      tap((body) => {
        if (res.statusCode !== 200) return;
        entries.set(key, { body, expires: Date.now() + ttl });
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
      }),
    );
  }
}

/** Express middleware: a successful write (POST/PUT/PATCH/DELETE answered < 400) empties the cache. */
export function clearPublicCacheOnWrite(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.on("finish", () => {
      if (res.statusCode < 400) clearPublicCache();
    });
  }
  next();
}
