"use client";

import { useQuery } from "@tanstack/react-query";
import type { Messages } from "@/i18n/types";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";

/**
 * "Continue with Google" — a full-page navigation to the API, which runs the OAuth
 * authorization-code + PKCE flow and redirects back. Hidden when the API has no
 * Google credentials configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 */
export function GoogleButton({ next }: { next?: string }) {
  const t = useT();
  // The answer never changes while the API runs, so it's cached for good once we have it. But in dev the web
  // server is often up before the API (`npm run dev` starts both), so keep asking for a while instead of hiding
  // the button forever after one refused connection.
  const providers = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: () => api.get<{ google: boolean }>("/auth/providers"),
    staleTime: Infinity,
    retry: 8,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
  if (!providers.data?.google) return null;
  const href = `/api/v1/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" /> {t.common.or} <span className="h-px flex-1 bg-line" />
      </div>
      <a
        href={href}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 text-base font-semibold text-ink transition-colors hover:bg-sand-2"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8.1z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
        </svg>
        {t.auth.google.continue}
      </a>
    </>
  );
}

/** ?error= codes the Google callback redirects with; their friendly messages are in `t.auth.google.errors`. */
export type OAuthError = keyof Messages["auth"]["google"]["errors"];

const OAUTH_ERROR_CODES: readonly OAuthError[] = [
  "google_cancelled",
  "google_expired",
  "google_state",
  "google_unverified",
  "google_deleted",
  "google_unavailable",
  "google_failed",
];

export const isOAuthError = (code: string | null): code is OAuthError => !!code && (OAUTH_ERROR_CODES as readonly string[]).includes(code);
