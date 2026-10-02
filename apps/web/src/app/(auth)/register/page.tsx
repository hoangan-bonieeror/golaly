"use client";

import { registerSchema } from "@triply/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Button, Field, inputCls } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/api/queries";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

export default function Register() {
  const { register } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", username: "" });
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Already signed in? This page isn't for you. (Skipped while our own sign-up redirects.)
  const me = useMe().data;
  const submitting = useRef(false);
  useEffect(() => {
    if (me && !submitting.current) router.replace("/home");
  }, [me, router]);

  // Same Zod schema the API enforces.
  const parsed = registerSchema.safeParse(form);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  const err = (k: string) => (touched ? fieldErrors[k] : undefined) ?? serverErrors[k];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!parsed.success) return;
    setBusy(true);
    submitting.current = true;
    setServerErrors({});
    try {
      await register(parsed.data);
      toast("Account created");
      router.push("/onboarding");
    } catch (e) {
      if (e instanceof ApiError) {
        const key = /username/i.test(e.message) ? "username" : /email/i.test(e.message) ? "email" : "password";
        setServerErrors(e.fields ?? { [key]: e.message });
      } else toast("Something went wrong. Please try again.", "error");
      submitting.current = false;
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setServerErrors({});
  };

  return (
    <form onSubmit={submit} className="animate-rise space-y-5" noValidate>
      <div>
        <h1 className="font-display text-3xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-muted">It takes less than a minute.</p>
      </div>
      <Field label="Email" error={err("email")}>
        <input className={inputCls} type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="you@example.com" />
      </Field>
      <Field label="Username" error={err("username")} hint="This is how friends find you.">
        <input className={inputCls} autoComplete="username" value={form.username} onChange={set("username")} placeholder="an.nguyen" />
      </Field>
      <Field label="Password" error={err("password")} hint="At least 8 characters.">
        <input className={inputCls} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
      </Field>
      <Button size="lg" className="w-full" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </Button>
      <GoogleButton />
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="inline-block py-2.5 font-semibold text-lagoon hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
