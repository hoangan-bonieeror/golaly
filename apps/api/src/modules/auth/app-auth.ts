import { Body, Controller, Get, HttpCode, Logger, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  appAppleSchema,
  appGoogleSchema,
  appLoginSchema,
  appLogoutSchema,
  appRefreshSchema,
  appRegisterSchema,
  type AppAppleInput,
  type AppGoogleInput,
  type AppLoginInput,
  type AppSession,
  type AppTokens,
  type RegisterInput,
} from "@golaly/shared";
import type { Request } from "express";
import { CurrentUser, Public, type AuthUser } from "../../common/auth";
import { AppError, ZodPipe } from "../../common/http";
import { env } from "../../config/env";
import { ProductEventsService } from "../activity/product-events";
import { AppleClient } from "./apple";
import { AUTH_LIMIT, AuthService } from "./auth";
import { GoogleAuthService, GoogleClient, type GoogleProfile, type OAuthProvider } from "./google";

/** Why a Google / Apple sign-in failed, as the person should read it. Details stay in the log. */
function providerError(provider: OAuthProvider, reason: string): AppError {
  const name = provider === "google" ? "Google" : "Apple";
  if (reason === "unverified-email") return new AppError(401, `Your ${name} account doesn't share a verified email, so we can't sign you in with it.`);
  if (reason === "deleted-account") return new AppError(401, "This account has been deleted.");
  return new AppError(401, `We couldn't sign you in with ${name}. Please try again.`);
}

/**
 * Sign-in for the mobile app. The same accounts, sessions and rules as the web (AuthController, Google), but the
 * tokens travel in the body and the app keeps them in the phone's secure storage — no cookies:
 *  - every sign-in answers an AppSession (user + access/refresh tokens + a known-device token);
 *  - requests then carry `Authorization: Bearer <accessToken>`; on a 401 the app calls /auth/app/refresh once;
 *  - refresh tokens rotate exactly like the web's (one use each, replay = theft), except that a replay inside the
 *    grace window — the phone lost the previous answer — gets a fresh pair instead of "raced".
 * Writes still need the `X-Requested-With: golaly` header (@golaly/client sends it).
 */
@Controller("auth/app")
export class AppAuthController {
  private readonly log = new Logger("AppAuth");

  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleClient,
    private readonly apple: AppleClient,
    private readonly oauth: GoogleAuthService,
    private readonly product: ProductEventsService,
  ) {}

  private async session(userId: string, req: Request, isNew: boolean): Promise<AppSession> {
    const t = await this.auth.startSession(userId, req.headers["user-agent"]);
    return {
      user: await this.auth.me(userId),
      accessToken: t.access,
      refreshToken: t.refresh,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      isNew,
      deviceToken: await this.auth.signDevice(userId),
    };
  }

  /** Which sign-in buttons the app shows. */
  @Public()
  @Get("providers")
  providers() {
    return { google: this.google.appConfigured, apple: this.apple.configured };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post("register")
  async register(@Body(new ZodPipe(appRegisterSchema)) body: RegisterInput, @Req() req: Request): Promise<AppSession> {
    const user = await this.auth.register(body);
    this.product.track({ type: "user.registered", userId: user.id, props: { method: "password", client: "app" } });
    return this.session(user.id, req, true);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("login")
  async login(@Body(new ZodPipe(appLoginSchema)) body: AppLoginInput, @Req() req: Request): Promise<AppSession> {
    const user = await this.auth.login(body, body.deviceToken);
    this.product.track({ type: "user.login", userId: user.id, props: { method: "password", client: "app" } });
    return this.session(user.id, req, false);
  }

  @Public()
  @HttpCode(200)
  @Post("refresh")
  async refresh(@Body(new ZodPipe(appRefreshSchema)) body: { refreshToken: string }): Promise<AppTokens> {
    const t = await this.auth.refresh(body.refreshToken, { reissueOnRace: true });
    if (t === "raced") throw new AppError(401, "Please log in to continue."); // not reached with reissueOnRace
    return { accessToken: t.access, refreshToken: t.refresh, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }

  /** Ends this phone's session (by its refresh token and/or the Bearer token) and stops its push notifications. */
  @Public()
  @HttpCode(200)
  @Post("logout")
  async logout(@Body(new ZodPipe(appLogoutSchema)) body: { refreshToken?: string }, @CurrentUser() user: AuthUser | null) {
    await this.auth.logout(body.refreshToken, user?.sessionId);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("google")
  async googleSignIn(@Body(new ZodPipe(appGoogleSchema)) body: AppGoogleInput, @Req() req: Request): Promise<AppSession> {
    if (!this.google.appConfigured) throw new AppError(503, "Google sign-in isn't available right now.");
    let profile: GoogleProfile;
    try {
      profile = await this.google.appProfile(body.idToken);
    } catch (e) {
      this.log.warn(`Google ID token rejected: ${(e as Error).message}`);
      throw providerError("google", "invalid");
    }
    return this.signInWith("google", profile, req);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post("apple")
  async appleSignIn(@Body(new ZodPipe(appAppleSchema)) body: AppAppleInput, @Req() req: Request): Promise<AppSession> {
    if (!this.apple.configured) throw new AppError(503, "Sign in with Apple isn't available right now.");
    let profile: GoogleProfile;
    try {
      // Apple gives the name only once, to the app — it sends it along for a new account's display name.
      profile = { ...(await this.apple.verify(body.identityToken, body.nonce)), name: body.name };
    } catch (e) {
      this.log.warn(`Apple identity token rejected: ${(e as Error).message}`);
      throw providerError("apple", "invalid");
    }
    return this.signInWith("apple", profile, req);
  }

  private async signInWith(provider: OAuthProvider, profile: GoogleProfile, req: Request): Promise<AppSession> {
    let user: { id: string; isNew: boolean };
    try {
      user = await this.oauth.resolveUser(profile, provider);
    } catch (e) {
      const reason = (e as Error).message;
      if (!["unverified-email", "deleted-account"].includes(reason)) this.log.warn(`${provider} sign-in failed: ${reason}`);
      throw providerError(provider, reason);
    }
    this.product.track({ type: user.isNew ? "user.registered" : "user.login", userId: user.id, props: { method: provider, client: "app" } });
    return this.session(user.id, req, user.isNew);
  }
}
