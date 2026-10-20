"use client";

import { localizeMessage, loginSchema } from "@golaly/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { GoogleButton, isOAuthError } from "@/components/auth/GoogleButton";
import { Button, Field, inputCls } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/api/queries";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { safeNext } from "@/lib/utils";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const { login } = useSession();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { locale, m: t } = useI18n();
  const errorCode = params.get("error");
  const oauthError = isOAuthError(errorCode) ? t.auth.google.errors[errorCode] : undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Already signed in? Continue where they were going. (Skipped while our own login redirects.)
  const me = useMe().data;
  const submitting = useRef(false);
  useEffect(() => {
    if (me && !submitting.current) router.replace(next);
  }, [me, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message;
      return setError(msg && localizeMessage(msg, locale));
    }
    setBusy(true);
    submitting.current = true;
    setError(undefined);
    try {
      const user = await login(parsed.data);
      toast(t.auth.login.welcomeBack(user.displayName));
      router.push(user.onboarded ? next : "/onboarding");
    } catch (err) {
      submitting.current = false;
      setError(err instanceof ApiError ? err.message : t.common.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="animate-rise space-y-5" noValidate>
      <div>
        <h1 className="font-display text-3xl font-semibold">{t.auth.login.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.login.subtitle}</p>
      </div>
      {oauthError && (
        <p role="alert" className="rounded-xl bg-accent-50 px-3 py-2 text-sm text-danger">
          {oauthError}
        </p>
      )}
      <Field label={t.auth.email}>
        <input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t.auth.password} error={error}>
        <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="inline-block py-2.5 text-sm font-medium text-primary hover:underline">
          {t.auth.login.forgot}
        </Link>
      </div>
      <Button size="lg" className="w-full" type="submit" disabled={busy}>
        {busy ? t.auth.login.loggingIn : t.common.logIn}
      </Button>
      <GoogleButton next={next} />
      <p className="text-center text-sm text-muted">
        {t.auth.login.newHere}{" "}
        <Link href="/register" className="inline-block py-2.5 font-semibold text-primary hover:underline">
          {t.auth.login.createAccount}
        </Link>
      </p>
      {process.env.NODE_ENV !== "production" && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-3 text-xs text-muted">
          <b className="text-ink-2">Dev demo accounts</b> (after <code>npm run db:seed</code>, password <code>demo1234</code>): an@, sarah@, minh@, linh@, nam@golaly.dev
        </div>
      )}
    </form>
  );
}
