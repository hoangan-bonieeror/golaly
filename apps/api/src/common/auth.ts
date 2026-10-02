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
import { PrismaService } from "../prisma/prisma.service";
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
  /** Token type: other JWTs signed with the same secret (e.g. the OAuth state cookie) are never accepted as access tokens. */
  typ: "access";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies an access token AND that its session is still live (not revoked/expired, user not deleted).
 * Checking the session on every request makes logout, password changes and account deletion take
 * effect immediately instead of when the 15-minute access token expires. It's one primary-key lookup.
 */
export async function verifyAccess(jwt: JwtService, prisma: PrismaService, token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  let payload: Partial<JwtPayload>;
  try {
    payload = await jwt.verifyAsync<JwtPayload>(token, { secret: env.JWT_SECRET });
  } catch {
    return null;
  }
  if (payload.typ !== "access" || !UUID_RE.test(payload.sub ?? "") || !UUID_RE.test(payload.sid ?? "")) return null;
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { deletedAt: true } } },
  });
  if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) return null;
  return { id: payload.sub!, sessionId: payload.sid! };
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
 *  1. Authentication — verifies the access JWT (HTTP-only cookie or Bearer header) and its live session.
 *  2. CSRF — state-changing requests must carry `X-Requested-With: triply`. Browsers can't
 *     add custom headers cross-site without a CORS preflight, which only WEB_ORIGIN passes.
 * Resource-level checks (ownership, membership, role) happen in services (spec §28).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [ctx.getHandler(), ctx.getClass()]);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>("skipCsrf", [ctx.getHandler(), ctx.getClass()]);

    if (!skipCsrf && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw Errors.forbidden("Request blocked for your security. Please refresh the page and try again.");
    }

    // Expired/invalid/revoked token: treat as anonymous; the client refreshes on 401.
    const user = await verifyAccess(this.jwt, this.prisma, readAccessToken(req));
    if (user) req.user = user;
    if (!req.user && !isPublic) throw Errors.unauthorized();
    return true;
  }
}

/** Throws 401 when the viewer is anonymous. */
export function requireUser(viewerId: string | null): string {
  if (!viewerId) throw Errors.unauthorized();
  return viewerId;
}
