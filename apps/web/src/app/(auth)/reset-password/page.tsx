"use client";

import { localizeMessage, passwordSchema } from "@triply/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api/client";
import { useToast } from "@/lib/toast";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}

function ResetPassword() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const toast = useToast();
  const { locale, m: t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <form
      noValidate
      className="animate-rise space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = passwordSchema.safeParse(password);
        if (!parsed.success) {
          const msg = parsed.error.issues[0]?.message;
          return setError(msg && localizeMessage(msg, locale));
        }
        setBusy(true);
        try {
          await api.post("/auth/reset-password", { token, password });
          toast(t.auth.reset.updated);
          router.push("/login");
        } catch (err) {
          setError(err instanceof ApiError ? err.message : t.common.errors.generic);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h1 className="font-display text-3xl font-semibold">{t.auth.reset.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.reset.subtitle}</p>
      </div>
      <Field label={t.auth.newPassword} error={error} hint={t.auth.passwordHint}>
        <input className={inputCls} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button size="lg" className="w-full" type="submit" disabled={busy || !token}>
        {t.auth.reset.submit}
      </Button>
      {!token && <p className="text-sm text-danger">{t.auth.reset.incomplete}</p>}
    </form>
  );
}
