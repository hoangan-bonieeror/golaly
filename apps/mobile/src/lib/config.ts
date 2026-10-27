/** Where the app talks to. EXPO_PUBLIC_* values are inlined at build time (see .env.example). */
const origin = (process.env.EXPO_PUBLIC_GOLALY_URL ?? "https://golaly.vercel.app").replace(/\/+$/, "");

export const config = {
  /** The web app's origin: it serves /api/v1 (proxied to the API) and /media (photos). */
  origin,
  apiUrl: `${origin}/api/v1`,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined,
};

/** Photos come as "/media/…" paths (the web rewrites them to the bucket); the app needs full URLs. */
export const absoluteUrl = (url: string | null | undefined) => (!url ? null : /^https?:\/\//.test(url) ? url : `${origin}${url}`);
