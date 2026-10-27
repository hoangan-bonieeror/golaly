import Constants from "expo-constants";

/**
 * While developing, the phone already reaches the computer running Expo (it loads the app's code from it), so
 * Golaly is assumed at that same address on the web dev server's port: no IP to type into .env.
 * Tunnel mode (`expo start --tunnel`) can't reach port 3000 that way: set EXPO_PUBLIC_GOLALY_URL then.
 */
function devOrigin(): string | null {
  if (!__DEV__) return null;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host && !host.endsWith(".exp.direct") ? `http://${host}:3000` : null;
}

/** Where the app talks to. EXPO_PUBLIC_* values are inlined at build time (see .env.example). */
const origin = (process.env.EXPO_PUBLIC_GOLALY_URL || devOrigin() || "https://golaly.vercel.app").replace(/\/+$/, "");

export const config = {
  /** The web app's origin: it serves /api/v1 (proxied to the API) and /media (photos). */
  origin,
  apiUrl: `${origin}/api/v1`,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined,
};

/** Photos come as "/media/…" paths (the web rewrites them to the bucket); the app needs full URLs. */
export const absoluteUrl = (url: string | null | undefined) => (!url ? null : /^https?:\/\//.test(url) ? url : `${origin}${url}`);
