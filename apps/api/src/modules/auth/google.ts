import { Controller, Get, Injectable, Logger, Query, Req, Res } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { normalizeSearch, safeNext } from "@golaly/shared";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { createHash } from "node:crypto";
import { Public } from "../../common/auth";
import { setAuthCookies, setDeviceCookie } from "../../common/cookies";
import { randomToken } from "../../common/crypto";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { SearchIndexService } from "../search/search-index";
import { AuditService } from "../audit/audit";
import { RealtimeService } from "../realtime/realtime";
import { AuthService } from "./auth";
import { ProductEventsService } from "../activity/product-events";

const STATE_COOKIE = "golaly_oauth";
const STATE_PATH = "/api/v1/auth/google";
const STATE_TTL_S = 600;

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Talks to Google. Isolated behind this small class so tests can swap in a fake —
 * the controller logic (state, PKCE, account linking) is what we test.
 */
@Injectable()
export class GoogleClient {
  private client = new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: GoogleClient.redirectUri() });

  static redirectUri() {
    return env.GOOGLE_REDIRECT_URI ?? `${env.WEB_ORIGIN}/api/v1/auth/google/callback`;
  }

  get configured() {
    return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  }

  authUrl(state: string, codeChallenge: string) {
    return this.client.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state,
      code_challenge: codeChallenge,
      // google-auth-library types use an enum; the value is the plain string "S256".
      code_challenge_method: "S256" as never,
      prompt: "select_account",
      access_type: "online",
    });
  }

  /** Exchanges the code (with the PKCE verifier) and verifies the ID token's signature, issuer, audience and expiry. */
  async profile(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const { tokens } = await this.client.getToken({ code, codeVerifier, redirect_uri: GoogleClient.redirectUri() });
    if (!tokens.id_token) throw new Error("Google did not return an ID token");
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error("Google profile is missing an email");
    return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: !!p.email_verified, name: p.name };
  }
}

interface StatePayload {
  typ: "oauth_state";
  state: string;
  verifier: string;
  next: string;
}


@Injectable()
export class GoogleAuthService {
  private readonly log = new Logger("GoogleAuth");
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchIndex: SearchIndexService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Account resolution:
   *  1. Known Google account → that user.
   *  2. Verified email matches an existing user → link Google to it.
   *  3. Otherwise create a new user (no password; they can set one later).
   */
  async resolveUser(profile: GoogleProfile): Promise<{ id: string; isNew: boolean }> {
    if (!profile.emailVerified) throw new Error("unverified-email");
    const p = { ...profile, email: profile.email.trim().toLowerCase() };
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: p.sub } },
      include: { user: { select: { id: true, deletedAt: true } } },
    });
    if (linked) {
      if (linked.user.deletedAt) throw new Error("deleted-account");
      return { id: linked.userId, isNew: false };
    }
    const byEmail = await this.prisma.user.findUnique({ where: { email: p.email } });
    if (byEmail) {
      if (byEmail.deletedAt) throw new Error("deleted-account");
      const now = new Date();
      // Google has just proven this person owns the address. If the existing account never proved
      // it, whoever registered it may not be them (pre-hijacking): drop that unproven password and
      // end every existing session so only the verified owner keeps access.
      const takeover = !byEmail.emailVerifiedAt;
      await this.prisma.$transaction([
        this.prisma.oAuthAccount.create({ data: { userId: byEmail.id, provider: "google", providerAccountId: p.sub, email: p.email } }),
        this.prisma.user.update({
          where: { id: byEmail.id },
          data: takeover ? { emailVerifiedAt: now, passwordHash: null, failedLoginCount: 0, lockedUntil: null } : {},
        }),
        ...(takeover ? [this.prisma.session.updateMany({ where: { userId: byEmail.id, revokedAt: null }, data: { revokedAt: now } })] : []),
      ]);
      if (takeover) await this.realtime.disconnectSessions({ userId: byEmail.id });
      await this.audit.log(byEmail.id, "user.google_linked", "user", byEmail.id, { verifiedBefore: !takeover });
      return { id: byEmail.id, isNew: false };
    }
    const username = await this.uniqueUsername(p.email.split("@")[0]);
    const displayName = (p.name?.trim() || username).slice(0, 50);
    const user = await this.prisma.user.create({
      data: {
        email: p.email,
        username,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        profile: { create: { displayName, avatarHue: Math.floor(Math.random() * 360), searchText: normalizeSearch(`${displayName} ${username}`) } },
        oauthAccounts: { create: { provider: "google", providerAccountId: p.sub, email: p.email } },
      },
    });
    this.log.log("Created account via Google sign-in");
    return { id: user.id, isNew: true };
  }

  private async uniqueUsername(seed: string) {
    const base = normalizeSearch(seed).replace(/[^a-z0-9._]/g, "").replace(/^[._]+|[._]+$/g, "").slice(0, 18).padEnd(3, "0") || "traveler";
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      if (!(await this.prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
    }
    return `traveler${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  }
}

/**
 * Google sign-in (spec P1): OAuth 2.0 authorization-code flow with PKCE + state.
 * The state and PKCE verifier live in a short-lived, signed, HTTP-only cookie scoped to
 * this path, so a callback can't be replayed or forged from another browser.
 */
@Controller("auth")
export class GoogleAuthController {
  private readonly log = new Logger("GoogleAuth");
  constructor(
    private readonly google: GoogleClient,
    private readonly googleAuth: GoogleAuthService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly product: ProductEventsService,
  ) {}

  @Public()
  @Get("providers")
  providers() {
    return { google: this.google.configured };
  }

  @Public()
  @Get("google/start")
  async start(@Query("next") next: string | undefined, @Res() res: Response) {
    if (!this.google.configured) return res.redirect(`${env.WEB_ORIGIN}/login?error=google_unavailable`);
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const signed = await this.jwt.signAsync({ typ: "oauth_state", state, verifier, next: safeNext(next) } satisfies StatePayload, { secret: env.JWT_SECRET, expiresIn: STATE_TTL_S });
    res.cookie(STATE_COOKIE, signed, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: STATE_PATH, maxAge: STATE_TTL_S * 1000 });
    return res.redirect(this.google.authUrl(state, challenge));
  }

  @Public()
  @Get("google/callback")
  async callback(@Query() q: Record<string, string | undefined>, @Req() req: Request, @Res() res: Response) {
    const fail = (code: string) => {
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      return res.redirect(`${env.WEB_ORIGIN}/login?error=${code}`);
    };
    if (q.error) return fail("google_cancelled");
    let saved: StatePayload;
    try {
      saved = await this.jwt.verifyAsync<StatePayload>(req.cookies?.[STATE_COOKIE] ?? "", { secret: env.JWT_SECRET });
    } catch {
      return fail("google_expired");
    }
    if (saved.typ !== "oauth_state" || !q.state || q.state !== saved.state || !q.code) return fail("google_state");

    try {
      const profile = await this.google.profile(q.code, saved.verifier);
      const user = await this.googleAuth.resolveUser(profile);
      setAuthCookies(res, await this.auth.startSession(user.id, req.headers["user-agent"]));
      setDeviceCookie(res, await this.auth.signDevice(user.id));
      this.product.track({ type: user.isNew ? "user.registered" : "user.login", userId: user.id, props: { method: "google" } });
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      const onboarded = (await this.prisma.userProfile.findUnique({ where: { userId: user.id }, select: { onboardedAt: true } }))?.onboardedAt;
      return res.redirect(`${env.WEB_ORIGIN}${user.isNew || !onboarded ? "/onboarding" : saved.next}`);
    } catch (e) {
      const m = (e as Error).message;
      if (!["unverified-email", "deleted-account"].includes(m)) this.log.warn(`Google sign-in failed: ${m}`);
      return fail(m === "unverified-email" ? "google_unverified" : m === "deleted-account" ? "google_deleted" : "google_failed");
    }
  }
}
