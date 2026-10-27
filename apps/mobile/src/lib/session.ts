import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { createApiClient, CSRF_HEADER } from "@golaly/client";
import type { AppSession, AppTokens } from "@golaly/shared";
import { config } from "./config";
import { currentLocale } from "./i18n";

/**
 * The signed-in session on this phone. Tokens live in the OS keychain / keystore (expo-secure-store), never in
 * plain storage. The access token rides on every request; when it expires the API answers 401 and the shared
 * client calls `refresh()` once, which rotates the pair (each refresh token works once).
 */
const TOKENS_KEY = "golaly.tokens";
/** "This phone has signed in to this account before" — kept across sign-outs, sent with the next sign-in. */
const DEVICE_KEY = "golaly.device";

export type SessionStatus = "loading" | "signedIn" | "signedOut";

let tokens: AppTokens | null = null;
let status: SessionStatus = "loading";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function setTokens(next: AppTokens | null) {
  tokens = next;
  status = next ? "signedIn" : "signedOut";
  emit();
}

/** Called once at start-up. */
export async function loadSession() {
  try {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    setTokens(raw ? (JSON.parse(raw) as AppTokens) : null);
  } catch {
    setTokens(null);
  }
}

async function storeTokens(next: AppTokens) {
  const t = { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresIn: next.expiresIn };
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(t));
  setTokens(t);
}

/** After any sign-in endpoint answered. */
export async function startSession(s: AppSession) {
  await SecureStore.setItemAsync(DEVICE_KEY, s.deviceToken);
  await storeTokens(s);
}

export async function endSession() {
  await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => undefined);
  setTokens(null);
}

export const deviceToken = () => SecureStore.getItemAsync(DEVICE_KEY).catch(() => null);
export const currentRefreshToken = () => tokens?.refreshToken ?? null;

/** Rotates the token pair. A definite "no" (401) signs this phone out; a network failure keeps the session. */
async function refresh(): Promise<boolean> {
  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${config.apiUrl}/auth/app/refresh`, {
      method: "POST",
      signal: AbortSignal.timeout?.(20_000),
      headers: { "Content-Type": "application/json", Accept: "application/json", ...CSRF_HEADER },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 401) {
      await endSession();
      return false;
    }
    if (!res.ok) return false;
    await storeTokens((await res.json()) as AppTokens);
    return true;
  } catch {
    return false;
  }
}

export const client = createApiClient({
  baseUrl: config.apiUrl,
  auth: { kind: "bearer", getAccessToken: () => tokens?.accessToken ?? null, refresh },
  getLocale: currentLocale,
  timeoutMs: 20_000,
});
export const api = client.api;

export function useSessionStatus(): SessionStatus {
  return useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), () => status);
}
export const isSignedIn = () => status === "signedIn";
