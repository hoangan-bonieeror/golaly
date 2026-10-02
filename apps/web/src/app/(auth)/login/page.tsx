"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { useStore } from "@/lib/store/store";

export default function Login() {
  const { db, signIn, toast } = useStore();
  const router = useRouter();
  const [email, setEmail] = useState("an@triply.dev");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Prototype auth: <username>@triply.dev / demo1234. Real auth = POST /api/v1/auth/login (HTTP-only cookie).
    const handle = email.trim().toLowerCase().split("@")[0];
    const user = db.users.find((u) => u.displayName.toLowerCase() === handle || u.username === handle);
    if (!user || password !== "demo1234") {
      setError("That email and password don't match. Try a demo account below.");
      return;
    }
    signIn(user.id);
    toast(`Welcome back, ${user.displayName}`);
    router.push("/home");
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
      <Button size="lg" className="w-full" type="submit">
        Log in
      </Button>
      <GoogleButton />
      <p className="text-center text-sm text-muted">
        New to TRIPLY?{" "}
        <Link href="/register" className="font-semibold text-lagoon hover:underline">
          Create account
        </Link>
      </p>
      <div className="rounded-2xl border border-dashed border-line bg-surface p-3 text-xs text-muted">
        <b className="text-ink-2">Demo accounts</b> (password <code>demo1234</code>): an@, sarah@, minh@, linh@, nam@triply.dev
      </div>
    </form>
  );
}
