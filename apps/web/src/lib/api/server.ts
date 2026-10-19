import { dehydrate, QueryClient, type DehydratedState, type QueryKey } from "@tanstack/react-query";
import { LOCALE_HEADER } from "@triply/shared";
import { cookies, headers } from "next/headers";
import { getLocale } from "@/i18n/server";
import { PLACE_NAMES_COOKIE } from "../placeLanguage";

/**
 * Server-side prefetch for pages people open from a link (a trip, a destination, a place).
 *
 * Without it, the browser gets an empty shell, runs the JavaScript, and only then asks for the data — one more
 * round trip from the visitor to the API after everything else. Here the page's server render asks the API
 * directly (server to server, close by), puts the answer in the query cache under the same key the client hook
 * uses, and the HTML arrives with the content in it.
 *
 * It's an optimisation only: any failure, a slow API (sleeping host) or a non-2xx answer returns nothing and the
 * client fetches as before. The request is made as the visitor — their cookies, language and (with EDGE_SECRET,
 * like src/proxy.ts) their address — so a signed-in member gets their own view, and rate limits stay per visitor.
 */
const API_ORIGIN = (process.env.API_ORIGIN || "http://localhost:4000").replace(/\/+$/, "");
/** Longer than a warm API answer, short enough that a sleeping API doesn't hold the page back much. */
const TIMEOUT_MS = 900;

async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const [h, c, locale] = await Promise.all([headers(), cookies(), getLocale()]);
    const placeNames = c.get(PLACE_NAMES_COOKIE)?.value;
    const out: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": placeNames === "local" ? "und" : placeNames === "en" || placeNames === "vi" ? placeNames : locale,
      [LOCALE_HEADER]: locale,
      "User-Agent": h.get("user-agent") ?? "golaly-web",
    };
    const cookie = h.get("cookie");
    if (cookie) out.Cookie = cookie;
    const secret = process.env.EDGE_SECRET;
    const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
    if (secret && ip) {
      out["x-golaly-client-ip"] = ip;
      out["x-golaly-edge"] = secret;
    }
    const res = await fetch(`${API_ORIGIN}/api/v1${path}`, { headers: out, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Fetches each [query key, API path] pair in parallel and returns the cache to hand to <Prefetched>. Only for a full
 * page load: on in-app navigation (an RSC request) the browser already runs the app and fetches as usual, so the
 * server doesn't call the API a second time.
 */
export async function prefetch(entries: [QueryKey, string][]): Promise<DehydratedState | null> {
  if ((await headers()).get("rsc") === "1") return null;
  const qc = new QueryClient();
  await Promise.all(
    entries.map(async ([key, path]) => {
      const data = await serverGet<unknown>(path);
      if (data !== null) qc.setQueryData(key, data);
    }),
  );
  return dehydrate(qc);
}
