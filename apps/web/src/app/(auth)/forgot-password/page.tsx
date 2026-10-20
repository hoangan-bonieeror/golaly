"use client";

import { emailSchema } from "@golaly/shared";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api/client";

export default function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (sent)
    return (
      <div className="animate-rise text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-50 text-primary">
          <MailCheck className="size-7" />
        </div>
        <h1 className="font-display text-3xl font-semibold">{t.auth.forgot.sentTitle}</h1>
        {/* Same message whether or not the account exists — avoids account enumeration. */}
        <p className="mt-2 text-sm text-muted">{t.auth.forgot.sentBody(email)}</p>
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-4 rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
            Dev: emails are written to <code>apps/api/storage/outbox</code>.
          </p>
        )}
        <Button href="/login" variant="secondary" className="mt-8">
          {t.auth.backToLogin}
        </Button>
      </div>
    );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = emailSchema.safeParse(email);
        if (!parsed.success) return setError(t.auth.forgot.invalidEmail);
        setBusy(true);
        try {
          await api.post("/auth/forgot-password", { email: parsed.data });
          setSent(true);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : t.common.errors.generic);
        } finally {
          setBusy(false);
        }
      }}
      className="animate-rise space-y-5"
      noValidate
    >
      <div>
        <h1 className="font-display text-3xl font-semibold">{t.auth.forgot.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.forgot.subtitle}</p>
      </div>
      <Field label={t.auth.email} error={error}>
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button size="lg" className="w-full" type="submit" disabled={busy}>
        {t.auth.forgot.send}
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="inline-block py-2.5 font-semibold text-primary hover:underline">
          {t.auth.backToLogin}
        </Link>
      </p>
    </form>
  );
}
