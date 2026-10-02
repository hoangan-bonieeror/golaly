import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { env } from "../config/env";
import { Errors } from "./http";

export const ACCESS_COOKIE = "triply_at";
export const REFRESH_COOKIE = "triply_rt";
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "triply";

export interface AuthUser {
  id: string;
  sessionId: string;
}

export interface JwtPayload {
  sub: string;
  sid: string;
}

/** Route is reachable without logging in. `req.user` is still set when a valid session exists. */
export const Public = () => SetMetadata("isPublic", true);
/** Skip the CSRF header check (only for auth endpoints a browser form might hit before JS loads). */
export const SkipCsrf = () => SetMetadata("skipCsrf", true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  return req.user ?? null;
});

/** Shortcut for the id of the (possibly anonymous) viewer. */
export const ViewerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  return req.user?.id ?? null;
});

export function readAccessToken(req: { cookies?: Record<string, string>; headers: Request["headers"] }): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * Global guard, runs on every HTTP route:
 *  1. Authentication — verifies the access JWT (HTTP-only cookie or Bearer header).
 *  2. CSRF — state-changing requests must carry `X-Requested-With: triply`. Browsers can't
 *     add custom headers cross-site without a CORS preflight, which only WEB_ORIGIN passes.
 * Resource-level checks (ownership, membership, role) happen in services (spec §28).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [ctx.getHandler(), ctx.getClass()]);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>("skipCsrf", [ctx.getHandler(), ctx.getClass()]);

    if (!skipCsrf && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw Errors.forbidden("Request blocked for your security. Please refresh the page and try again.");
    }

    const token = readAccessToken(req);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: env.JWT_SECRET });
        req.user = { id: payload.sub, sessionId: payload.sid };
      } catch {
        // Expired/invalid token: treat as anonymous; the client refreshes on 401.
      }
    }
    if (!req.user && !isPublic) throw Errors.unauthorized();
    return true;
  }
}

/** Throws 401 when the viewer is anonymous. */
export function requireUser(viewerId: string | null): string {
  if (!viewerId) throw Errors.unauthorized();
  return viewerId;
}
