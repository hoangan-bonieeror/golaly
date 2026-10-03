"use client";

import { MailCheck } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/queries";

/** Shown until the user confirms their address. Needed to accept email invitations. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const resend = useAction(() => api.post("/auth/verify-email/resend"), { success: "Confirmation email sent" });
  return (
    <div role="status" className="mb-5 flex flex-col gap-2 rounded-2xl border border-gold/40 bg-gold-50 px-4 py-3 text-sm text-ink-2 sm:flex-row sm:items-center">
      <MailCheck className="size-5 shrink-0 text-[#8a6114]" aria-hidden />
      <p className="flex-1">
        Confirm <b className="text-ink">{email}</b> to accept trip invitations sent to it. Check your inbox for our link.
      </p>
      <button
        type="button"
        disabled={sent || resend.isPending}
        onClick={async () => {
          if (await resend.run(undefined)) setSent(true);
        }}
        className="min-h-11 shrink-0 rounded-full px-3 font-semibold text-[#6f4e10] underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
      >
        {sent ? "Sent — check your inbox" : "Resend email"}
      </button>
    </div>
  );
}
