"use client";

import { loginSchema } from "@triply/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Button, Field, inputCls } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
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
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy(true);
    setError(undefined);
    try {
      const user = await login(parsed.data);
      toast(`Welcome back, ${user.displayName}`);
      router.push(user.onboarded ? next : "/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="animate-rise space-y-5" noValidate>
      <div>
        <h1 className="font-display text-3xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Log in to keep planning.</p>
      </div>
      <Field label="Email">
        <input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" error={error}>
        <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-lagoon hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button size="lg" className="w-full" type="submit" disabled={busy}>
        {busy ? "Logging in…" : "Log in"}
      </Button>
      <GoogleButton />
      <p className="text-center text-sm text-muted">
        New to TRIPLY?{" "}
        <Link href="/register" className="font-semibold text-lagoon hover:underline">
          Create account
        </Link>
      </p>
      {process.env.NODE_ENV !== "production" && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-3 text-xs text-muted">
          <b className="text-ink-2">Dev demo accounts</b> (after <code>npm run db:seed</code>, password <code>demo1234</code>): an@, sarah@, minh@, linh@, nam@triply.dev
        </div>
      )}
    </form>
  );
}
