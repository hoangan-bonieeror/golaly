/**
 * The web's API client: @golaly/client over the same-origin /api/v1 rewrite, with the session in cookies.
 * Kept as this module so screens keep importing from "@/lib/api/client".
 */
import { createApiClient } from "@golaly/client";
import type { Locale } from "@golaly/shared";
import { placeNameHeader } from "../placeLanguage";

export { ApiError, qs } from "@golaly/client";

/** Interface language sent with every call (set by the I18nProvider). Place names follow it unless Settings pins another. */
let uiLocale: Locale = "en";
export function setRequestLocale(l: Locale) {
  uiLocale = l;
}
export const currentRequestLocale = () => uiLocale;

const client = createApiClient({
  baseUrl: "/api/v1",
  auth: { kind: "cookie" },
  getLocale: currentRequestLocale,
  getPlaceLanguage: placeNameHeader,
});

export const api = client.api;
/** Rotates the session cookies. Shared by REST retries and the realtime socket. */
export const refreshSession = client.refreshSession;
