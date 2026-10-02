import type { CookieOptions, Response } from "express";
import { env } from "../config/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./auth";

/** HTTP-only, SameSite=Lax cookies; `Secure` in production (spec §42). */
function cookieBase(): CookieOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax" };
}

export function setAuthCookies(res: Response, tokens: { access: string; refresh: string }) {
  res.cookie(ACCESS_COOKIE, tokens.access, { ...cookieBase(), path: "/", maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refresh, { ...cookieBase(), path: "/api/v1/auth", maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: "/api/v1/auth" });
}

