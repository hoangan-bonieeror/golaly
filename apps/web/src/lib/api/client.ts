/**
 * Typed REST client for /api/v1. Same-origin (proxied by Next), cookies included.
 * - Adds the CSRF header the API requires on writes.
 * - On 401, refreshes the session once and retries (rotating refresh tokens).
 * - Errors carry the API's friendly message — raw backend errors are never shown (spec §40).
 */
import { LOCALE_HEADER, localizeMessage, type ApiErrorBody, type Locale } from "@triply/shared";
import { placeNameHeader } from "../placeLanguage";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

const FALLBACK: Record<number, string> = {
  401: "Please log in to continue.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that.",
  409: "That conflicts with something that already exists.",
  422: "Some fields need attention.",
  429: "You're doing that a bit too fast. Please wait a moment.",
};

let refreshing: Promise<boolean> | null = null;

/** Interface language sent with every call (set by the I18nProvider). Place names follow it unless Settings pins another. */
let uiLocale: Locale = "en";
export function setRequestLocale(l: Locale) {
  uiLocale = l;
}
export const currentRequestLocale = () => uiLocale;

/** Rotates the session cookies. Shared by REST retries and the realtime socket. */
export async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include", headers: { "X-Requested-With": "triply" } })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown, retry = true, signal?: AbortSignal): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  const lang = placeNameHeader() ?? uiLocale;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Accept-Language": lang,
        [LOCALE_HEADER]: uiLocale,
        ...(method !== "GET" ? { "X-Requested-With": "triply" } : {}),
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e; // superseded (e.g. the next keystroke): not a connection problem

    throw new ApiError(0, localizeMessage("Can't reach TRIPLY right now. Check your connection and try again.", uiLocale));
  }

  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await refreshSession()) return request<T>(method, path, body, false, signal);
  }
  if (!res.ok) {
    let data: Partial<ApiErrorBody> = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page (e.g. API down behind the proxy) */
    }
    // 5xx messages are hidden (they may be internals), except the API's deliberate "upstream unavailable" answers.
    const shown = res.status < 500 || res.status === 502 || res.status === 503;
    const message = typeof data.message === "string" && shown ? data.message : res.status >= 500 ? "Something went wrong. Please try again." : FALLBACK[res.status] ?? "Something went wrong. Please try again.";
    // The API already answers in `uiLocale`; the local fallbacks are translated here.
    throw new ApiError(res.status, localizeMessage(message, uiLocale), data.fields);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  /** `signal` cancels the request (TanStack Query passes one to every query function). */
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, true, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>("POST", path, fd);
  },
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}
