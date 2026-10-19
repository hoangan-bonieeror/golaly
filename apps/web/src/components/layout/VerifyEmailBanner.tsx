"use client";

import { MailCheck, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/queries";
import { useT } from "@/i18n/client";

/** Hidden for a few days after "×", then shown again while the address is still unconfirmed. */
const DISMISS_KEY = "golaly-verify-dismissed";
const DISMISS_MS = 3 * 86_400_000;

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}
const noop = () => () => {};

/**
 * Shown until the user confirms their address (needed to accept email invitations). One compact row — on a phone
 * every line above the content counts — that can be put away for a few days.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const t = useT().nav.verifyBanner;
  const [sent, setSent] = useState(false);
  const [closed, setClosed] = useState(false);
  // Read after hydration only (the server can't know), so the first render matches the server's.
  const dismissed = useSyncExternalStore(noop, dismissedRecently, () => false);
  const resend = useAction(() => api.post("/auth/verify-email/resend"), { success: t.success });
  if (closed || dismissed) return null;
  return (
    <div role="status" className="mb-5 flex items-center gap-3 rounded-2xl border border-gold/40 bg-gold-50 py-2 pl-3 pr-1 text-sm text-ink-2">
      <MailCheck className="size-5 shrink-0 text-gold-700" aria-hidden />
      <p className="min-w-0 flex-1">
        {t.before} <b className="break-all text-ink">{email}</b> {t.after}{" "}
        <button
          type="button"
          disabled={sent || resend.isPending}
          onClick={async () => {
            if (await resend.run(undefined)) setSent(true);
          }}
          className="font-semibold text-gold-700 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
        >
          {sent ? t.sent : t.resend}
        </button>
      </p>
      <button
        type="button"
        aria-label={t.dismiss}
        title={t.dismiss}
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
          } catch {
            // Private mode: hidden for this page view only.
          }
          setClosed(true);
        }}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-gold/10 hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
