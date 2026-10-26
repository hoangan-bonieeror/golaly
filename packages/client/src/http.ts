import { LOCALE_HEADER, localizeMessage, type ApiErrorBody, type Locale } from "@golaly/shared";
import { ApiError, FALLBACK_MESSAGES, GENERIC_ERROR, OFFLINE_ERROR } from "./errors";

/**
 * How requests prove who is calling.
 * - `cookie` (web): the browser sends the session cookies; same-origin through the web app's /api/v1 rewrite.
 * - `bearer` (mobile): an access token in `Authorization`; `refresh()` gets a new one when it expires.
 */
export type ClientAuth =
  | { kind: "cookie" }
  | { kind: "bearer"; getAccessToken: () => string | null | Promise<string | null>; refresh: () => Promise<boolean> };

export interface ApiClientConfig {
  /** Where /api/v1 lives: "/api/v1" on the web (same origin), "https://api.golaly.com/api/v1" in the app. */
  baseUrl: string;
  auth: ClientAuth;
  /** Interface language, sent with every call; the API answers messages in it. */
  getLocale: () => Locale;
  /** Language for place names when it differs from the interface (a user setting); defaults to the locale. */
  getPlaceLanguage?: () => string | undefined;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** The CSRF header the API requires on every write (browsers can't add it cross-site without a preflight). */
export const CSRF_HEADER = { "X-Requested-With": "golaly" } as const;

/**
 * Typed REST client for the Golaly API.
 * - Adds the CSRF header on writes and the language headers on every call.
 * - On 401 it refreshes the session once (cookie: POST /auth/refresh; bearer: `auth.refresh()`) and retries.
 * - Errors carry the API's friendly message; raw backend errors are never shown.
 */
export function createApiClient(config: ApiClientConfig) {
  const doFetch = (...a: Parameters<typeof fetch>) => (config.fetch ?? fetch)(...a);
  const base = config.baseUrl.replace(/\/+$/, "");
  let refreshing: Promise<boolean> | null = null;

  /** One refresh at a time, shared by every caller that hit a 401 meanwhile (and by the realtime socket). */
  function refreshSession(): Promise<boolean> {
    refreshing ??= (
      config.auth.kind === "cookie"
        ? doFetch(`${base}/auth/refresh`, { method: "POST", credentials: "include", headers: { ...CSRF_HEADER } }).then((r) => r.ok)
        : config.auth.refresh()
    )
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
    return refreshing;
  }

  async function request<T>(method: Method, path: string, body?: unknown, retry = true, signal?: AbortSignal): Promise<T> {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const locale = config.getLocale();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": config.getPlaceLanguage?.() ?? locale,
      [LOCALE_HEADER]: locale,
      ...(method !== "GET" ? CSRF_HEADER : {}),
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
    };
    if (config.auth.kind === "bearer") {
      const token = await config.auth.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        credentials: config.auth.kind === "cookie" ? "include" : "omit",
        headers,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e; // superseded (e.g. the next keystroke): not a connection problem
      throw new ApiError(0, localizeMessage(OFFLINE_ERROR, locale));
    }

    if (res.status === 401 && retry && !path.startsWith("/auth/")) {
      if (await refreshSession()) return request<T>(method, path, body, false, signal);
    }
    if (!res.ok) {
      let data: Partial<ApiErrorBody> = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON error page (e.g. the API is down behind a proxy) */
      }
      // 5xx messages are hidden (they may be internals), except the API's deliberate "upstream unavailable" answers.
      const shown = res.status < 500 || res.status === 502 || res.status === 503;
      const message = typeof data.message === "string" && shown ? data.message : res.status >= 500 ? GENERIC_ERROR : FALLBACK_MESSAGES[res.status] ?? GENERIC_ERROR;
      // The API already answers in the locale; the local fallbacks are translated here.
      throw new ApiError(res.status, localizeMessage(message, locale), data.fields);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const api = {
    /** `signal` cancels the request (TanStack Query passes one to every query function). */
    get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, true, signal),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
    delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
    /** Multipart upload of one file (`Blob` on the web; React Native passes its `{ uri, name, type }` object). */
    upload: <T>(path: string, file: Blob | { uri: string; name: string; type: string }) => {
      const fd = new FormData();
      fd.append("file", file as Blob);
      return request<T>("POST", path, fd);
    },
  };

  return { api, refreshSession };
}

export type Api = ReturnType<typeof createApiClient>["api"];
