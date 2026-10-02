import { Body, Controller, HttpCode, Injectable, Post, Req, Res } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type LoginInput,
  type Me,
  type RegisterInput,
} from "@triply/shared";
import type { Request, Response } from "express";
import { CurrentUser, Public, REFRESH_COOKIE, ViewerId, type AuthUser, type JwtPayload } from "../../common/auth";
import { clearAuthCookies, setAuthCookies } from "../../common/cookies";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../common/crypto";
import { AppError, Errors, ZodPipe } from "../../common/http";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { MailService } from "../mail/mail";
import { UsersService } from "../users/users.service";
import { SearchIndexService } from "../search/search-index";

const AUTH_LIMIT = { default: { limit: env.AUTH_RATE_LIMIT_PER_MIN, ttl: 60_000 } };
const RESET_TTL_MS = 30 * 60_000;
// Verify against a real hash for unknown emails so both failure paths take the same time.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly searchIndex: SearchIndexService,
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
    return user;
  }

  /** Change password (or set a first one for Google-only accounts). Signs out every other session. */
  async changePassword(userId: string, sessionId: string, input: { currentPassword?: string; newPassword: string }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!u) throw Errors.unauthorized();
    if (u.passwordHash && !(await verifyPassword(u.passwordHash, input.currentPassword ?? "")))
      throw new AppError(403, "Your current password isn't right.", { currentPassword: "Your current password isn't right." });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(userId, "user.password_changed", "user", userId);
  }

  async login(input: LoginInput) {
    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null }, select: { id: true, passwordHash: true } });
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);
    if (!user || !ok) throw new AppError(401, "That email and password don't match.");
    return user;
  }

  /** Creates a session and returns both tokens. Only the refresh token's hash is stored. */
  async startSession(userId: string, userAgent?: string) {
    const refresh = randomToken();
    const session = await this.prisma.session.create({
      data: { userId, tokenHash: sha256(refresh), userAgent: userAgent?.slice(0, 200), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000) },
    });
    return { access: await this.signAccess(userId, session.id), refresh };
  }

  signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId } satisfies JwtPayload, { secret: env.JWT_SECRET, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
  }

  /** Refresh-token rotation: each refresh token works exactly once; a replayed (already rotated) token is rejected. */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw Errors.unauthorized();
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: { select: { deletedAt: true } } } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) throw Errors.unauthorized();
    const next = randomToken();
    await this.prisma.session.update({ where: { id: session.id }, data: { tokenHash: sha256(next), lastUsedAt: new Date() } });
    return { access: await this.signAccess(session.userId, session.id), refresh: next };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Same response whether or not the account exists — no account enumeration. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    if (!user) return;
    const token = randomToken();
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    await this.mail.send({
      to: email,
      subject: "Reset your TRIPLY password",
      text: `Someone asked to reset your TRIPLY password. If it was you, open this link within 30 minutes:\n\n${env.WEB_ORIGIN}/reset-password?token=${token}\n\nIf it wasn't you, you can ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw Errors.invalid("This reset link has expired. Request a new one.");
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // Log out everywhere after a password reset.
      this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(row.userId, "user.password_reset", "user", row.userId);
  }

  me(userId: string): Promise<Me> {
    return this.users.me(userId);
  }
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post("register")
  async register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(body);
    setAuthCookies(res, await this.auth.startSession(user.id, req.headers["user-agent"]));
    return this.auth.me(user.id);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("login")
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body);
    setAuthCookies(res, await this.auth.startSession(user.id, req.headers["user-agent"]));
    return this.auth.me(user.id);
  }

  @Public()
  @HttpCode(200)
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      setAuthCookies(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
      return { ok: true };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @ViewerId() _me: string | null) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    return { ok: true };
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
