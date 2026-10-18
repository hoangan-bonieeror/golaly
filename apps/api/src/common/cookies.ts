import type { CookieOptions, Response } from "express";
import { env } from "../config/env";
import { ACCESS_COOKIE, DEVICE_COOKIE, REFRESH_COOKIE } from "./auth";

/** HTTP-only, SameSite=Lax cookies; `Secure` in production (spec §42). */
function cookieBase(): CookieOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax" };
}

/**
 * Readable by the web app's JavaScript and says nothing but "this browser may have a session": when it's absent the
 * app doesn't ask the API who is signed in (and doesn't try a refresh) on every page a visitor opens. Never trusted
 * for anything — the HTTP-only cookies are the session.
 */
export const SESSION_HINT_COOKIE = "triply_si";

export function setAuthCookies(res: Response, tokens: { access: string; refresh: string }) {
  res.cookie(ACCESS_COOKIE, tokens.access, { ...cookieBase(), path: "/", maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refresh, { ...cookieBase(), path: "/api/v1/auth", maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
  res.cookie(SESSION_HINT_COOKIE, "1", { ...cookieBase(), httpOnly: false, path: "/", maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
}

/** "This browser has signed in to this account before" — lets its owner in while a lockout blocks strangers. */
export function setDeviceCookie(res: Response, token: string) {
  res.cookie(DEVICE_COOKIE, token, { ...cookieBase(), path: "/api/v1/auth", maxAge: 365 * 86_400_000 });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: "/api/v1/auth" });
  res.clearCookie(SESSION_HINT_COOKIE, { ...cookieBase(), httpOnly: false, path: "/" });
}

