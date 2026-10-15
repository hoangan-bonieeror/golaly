import { requestLocale } from "../../common/locale";
import { mails } from "../mail/templates";
import { Body, Controller, HttpCode, Injectable, Post, Req, Res } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import {
  isLocale,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type LoginInput,
  type Me,
  type RegisterInput,
} from "@triply/shared";
import type { Request, Response } from "express";
import { CurrentUser, Public, REFRESH_COOKIE, type AuthUser, type JwtPayload } from "../../common/auth";
import { clearAuthCookies, setAuthCookies } from "../../common/cookies";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../common/crypto";
import { AppError, Errors, ZodPipe } from "../../common/http";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { MailService } from "../mail/mail";
import { UsersService } from "../users/users.service";
import { SearchIndexService } from "../search/search-index";
import { RealtimeService } from "../realtime/realtime";
import { ProductEventsService } from "../activity/product-events";

const AUTH_LIMIT = { default: { limit: env.AUTH_RATE_LIMIT_PER_MIN, ttl: 60_000 } };
const RESET_TTL_MS = 30 * 60_000;
const VERIFY_TTL_MS = 48 * 3_600_000;
/** Per-account brute-force protection: every LOCK_AFTER consecutive failures lock the account for LOCK_MS. */
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
/** Two tabs refreshing with the same token at the same moment is a benign race, not theft. */
const REFRESH_RACE_GRACE_MS = 30_000;
// Verify against a real hash for unknown emails so both failure paths take the same time.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

/** Socket tokens only need to outlive the handshake (and a slow reconnect). */
const SOCKET_TOKEN_TTL_S = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly searchIndex: SearchIndexService,
    private readonly realtime: RealtimeService,
  ) {}

  async register(input: RegisterInput) {
    const taken = await this.prisma.user.findFirst({ where: { OR: [{ email: input.email }, { username: input.username }] }, select: { email: true } });
    if (taken) throw Errors.conflict(taken.email === input.email ? "An account with that email already exists." : "That username is taken.");
    const passwordHash = await hashPassword(input.password);
    const displayName = input.username.split(/[._]/)[0].replace(/^\w/, (c) => c.toUpperCase());
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
        profile: { create: { displayName, avatarHue: Math.floor(Math.random() * 360) } },
      },
      select: { id: true },
    });
    await this.searchIndex.profile(user.id);
    await this.sendVerification(user.id, input.email);
    return user;
  }

  /**
   * Email ownership proof. Until verified, an account can't accept email-bound invitations, and
   * signing in with Google for the same address takes the account over (dropping the password
   * and every session) — so registering someone else's address first gains nothing.
   */
  async sendVerification(userId: string, email: string) {
    const token = randomToken();
    await this.prisma.emailVerificationToken.create({ data: { userId, email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) } });
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { locale: true } });
    const locale = isLocale(profile?.locale) ? profile.locale : requestLocale();
    await this.mail.send({ to: email, ...mails.verifyEmail(locale, `${env.WEB_ORIGIN}/verify-email?token=${token}`) });
  }

  async resendVerification(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!u) throw Errors.unauthorized();
    if (u.emailVerifiedAt) return;
    await this.sendVerification(userId, u.email);
  }

  async verifyEmail(token: string) {
    const now = new Date();
    const userId = await this.prisma.transaction(async (tx) => {
      const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { email: true, deletedAt: true } } } });
      if (!row || row.expiresAt < now || row.user.deletedAt || row.user.email !== row.email) throw Errors.invalid("This confirmation link has expired. Send yourself a new one from the app.");
      // Single use, even under concurrent clicks.
      const used = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (used.count === 0) {
        const verified = await tx.user.findUnique({ where: { id: row.userId }, select: { emailVerifiedAt: true } });
        if (verified?.emailVerifiedAt) return null; // already confirmed — clicking twice is fine
        throw Errors.invalid("This confirmation link has expired. Send yourself a new one from the app.");
      }
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      await tx.emailVerificationToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
      return row.userId;
    });
    if (userId) await this.audit.log(userId, "user.email_verified", "user", userId);
  }

  /** Change password (or set a first one for Google-only accounts). Signs out every other session. */
  async changePassword(userId: string, sessionId: string, input: { currentPassword?: string; newPassword: string }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!u) throw Errors.unauthorized();
    if (u.passwordHash && !(await verifyPassword(u.passwordHash, input.currentPassword ?? "")))
      throw new AppError(403, "Your current password isn't right.", { currentPassword: "Your current password isn't right." });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword), failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    await this.realtime.disconnectSessions({ userId, exceptSessionId: sessionId });
    await this.audit.log(userId, "user.password_changed", "user", userId);
  }

  async login(input: LoginInput) {
    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null }, select: { id: true, passwordHash: true, lockedUntil: true } });
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new AppError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or reset your password.`);
    }
    if (!user || !ok) {
      if (user) await this.recordFailedLogin(user.id);
      throw new AppError(401, "That email and password don't match.");
    }
    await this.prisma.user.updateMany({ where: { id: user.id, OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }] }, data: { failedLoginCount: 0, lockedUntil: null } });
    return user;
  }

  /** Counts failures atomically (concurrent guesses can't slip past the threshold). */
  private async recordFailedLogin(userId: string) {
    const { failedLoginCount } = await this.prisma.user.update({ where: { id: userId }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    if (failedLoginCount % LOCK_AFTER === 0) {
      await this.prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
      await this.audit.log(null, "user.login_locked", "user", userId, { failures: failedLoginCount });
    }
  }

  /** Creates a session and returns both tokens. Only the refresh token's hash is stored. */
  async startSession(userId: string, userAgent?: string) {
    const refresh = randomToken();
    const session = await this.prisma.session.create({
      data: { userId, tokenHash: sha256(refresh), userAgent: userAgent?.slice(0, 200), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000) },
    });
    return { access: await this.signAccess(userId, session.id), refresh };
  }

  /** A one-minute token that only opens a realtime socket for this session (never accepted by HTTP routes). */
  signSocket(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId, typ: "socket" } satisfies JwtPayload, { secret: env.JWT_SECRET, expiresIn: SOCKET_TOKEN_TTL_S });
  }

  signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId, typ: "access" } satisfies JwtPayload, { secret: env.JWT_SECRET, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
  }

  /**
   * Refresh-token rotation: each refresh token works exactly once.
   *  - The swap is conditional on the old hash, so two concurrent refreshes can't both win.
   *  - Replaying the previous token within a few seconds is a benign multi-tab race ("raced"):
   *    the winner already set fresh cookies, so the caller just retries its request.
   *  - Replaying it later means it was copied: the whole session is revoked (theft signal).
   */
  async refresh(refreshToken: string | undefined): Promise<{ access: string; refresh: string } | "raced"> {
    if (!refreshToken) throw Errors.unauthorized();
    const hash = sha256(refreshToken);
    const now = new Date();
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hash }, include: { user: { select: { deletedAt: true } } } });
    if (!session) return this.handleStaleRefresh(hash, now);
    if (session.revokedAt || session.expiresAt < now || session.user.deletedAt) throw Errors.unauthorized();
    const next = randomToken();
    const swapped = await this.prisma.session.updateMany({
      where: { id: session.id, tokenHash: hash, revokedAt: null },
      data: { tokenHash: sha256(next), prevTokenHash: hash, rotatedAt: now, lastUsedAt: now },
    });
    if (swapped.count === 0) return this.handleStaleRefresh(hash, now);
    return { access: await this.signAccess(session.userId, session.id), refresh: next };
  }

  private async handleStaleRefresh(hash: string, now: Date): Promise<"raced"> {
    const prev = await this.prisma.session.findUnique({ where: { prevTokenHash: hash }, select: { id: true, userId: true, revokedAt: true, rotatedAt: true } });
    if (!prev || prev.revokedAt) throw Errors.unauthorized();
    if (prev.rotatedAt && now.getTime() - prev.rotatedAt.getTime() < REFRESH_RACE_GRACE_MS) return "raced";
    await this.prisma.session.update({ where: { id: prev.id }, data: { revokedAt: now } });
    await this.realtime.disconnectSessions({ sessionIds: [prev.id] });
    await this.audit.log(null, "session.reuse_detected", "user", prev.userId);
    throw Errors.unauthorized();
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    const ids = new Set<string>();
    if (refreshToken) {
      const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) }, select: { id: true } });
      if (s) ids.add(s.id);
    }
    if (sessionId) ids.add(sessionId);
    if (!ids.size) return;
    await this.prisma.session.updateMany({ where: { id: { in: [...ids] }, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.realtime.disconnectSessions({ sessionIds: [...ids] });
  }

  /** Same response whether or not the account exists — no account enumeration. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true, profile: { select: { locale: true } } } });
    if (!user) return;
    const token = randomToken();
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    const locale = isLocale(user.profile?.locale) ? user.profile.locale : requestLocale();
    await this.mail.send({ to: email, ...mails.resetPassword(locale, `${env.WEB_ORIGIN}/reset-password?token=${token}`) });
  }

  async resetPassword(token: string, password: string) {
    const expired = () => Errors.invalid("This reset link has expired. Request a new one.");
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw expired();
    const passwordHash = await hashPassword(password);
    const now = new Date();
    await this.prisma.transaction(async (tx) => {
      // Claim the token atomically: two concurrent submissions can't both succeed.
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (claimed.count === 0) throw expired();
      // Any other outstanding reset links stop working too.
      await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
      // Proving control of the inbox also proves ownership of the address.
      const u = await tx.user.findUnique({ where: { id: row.userId }, select: { emailVerifiedAt: true } });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: u?.emailVerifiedAt ?? now } });
      // Log out everywhere after a password reset.
      await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
    });
    await this.realtime.disconnectSessions({ userId: row.userId });
    await this.audit.log(row.userId, "user.password_reset", "user", row.userId);
  }

  me(userId: string): Promise<Me> {
    return this.users.me(userId);
  }
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly product: ProductEventsService,
  ) {}

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post("register")
  async register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(body);
    setAuthCookies(res, await this.auth.startSession(user.id, req.headers["user-agent"]));
    this.product.track({ type: "user.registered", userId: user.id, props: { method: "password" } });
    return this.auth.me(user.id);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("login")
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body);
    setAuthCookies(res, await this.auth.startSession(user.id, req.headers["user-agent"]));
    this.product.track({ type: "user.login", userId: user.id, props: { method: "password" } });
    return this.auth.me(user.id);
  }

  @Public()
  @HttpCode(200)
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      // Lost a benign race with another tab: its response already set fresh cookies — don't touch them.
      if (tokens === "raced") return { ok: true, raced: true };
      setAuthCookies(res, tokens);
      return { ok: true };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @CurrentUser() user: AuthUser | null) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], user?.sessionId);
    clearAuthCookies(res);
    return { ok: true };
  }

  /**
   * A short-lived token for the realtime handshake. The web app asks for it through its own origin
   * (with the HTTP-only cookie) and hands it to Socket.IO, so realtime works when the API lives on
   * another domain. POST + no-store: it must never be cached or prefetched.
   */
  @HttpCode(200)
  @Post("socket-token")
  async socketToken(@CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    if (!user) throw Errors.unauthorized();
    res.setHeader("Cache-Control", "no-store");
    return { token: await this.auth.signSocket(user.id, user.sessionId), expiresIn: SOCKET_TOKEN_TTL_S };
  }

  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("password")
  async password(@CurrentUser() user: AuthUser | null, @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword?: string; newPassword: string }) {
    if (!user) throw Errors.unauthorized();
    await this.auth.changePassword(user.id, user.sessionId, body);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("verify-email")
  async verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @Throttle({ default: { limit: 3, ttl: 10 * 60_000 } })
  @HttpCode(200)
  @Post("verify-email/resend")
  async resendVerification(@CurrentUser() user: AuthUser | null) {
    if (!user) throw Errors.unauthorized();
    await this.auth.resendVerification(user.id);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("forgot-password")
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("reset-password")
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }
}
