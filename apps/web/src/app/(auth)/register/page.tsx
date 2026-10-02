"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Button, Field, inputCls } from "@/components/ui";
import { useStore } from "@/lib/store/store";

export default function Register() {
  const { actions, signIn, toast } = useStore();
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", username: "" });
  const [touched, setTouched] = useState(false);

  // Mirrors the shared Zod schema that the API will also enforce.
  const errors = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? undefined : "Enter a valid email address.",
    password: form.password.length >= 8 ? undefined : "At least 8 characters.",
    username: /^[a-z0-9._]{3,24}$/i.test(form.username) ? undefined : "3–24 letters, numbers, dots or underscores.",
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const user = actions.register(form);
    if (!user) return;
    signIn(user.id);
    toast("Account created");
    router.push("/onboarding");
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="animate-rise space-y-5" noValidate>
      <div>
        <h1 className="font-display text-3xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-muted">It takes less than a minute.</p>
      </div>
      <Field label="Email" error={touched ? errors.email : undefined}>
        <input className={inputCls} type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="you@example.com" />
      </Field>
      <Field label="Username" error={touched ? errors.username : undefined} hint="This is how friends find you.">
        <input className={inputCls} autoComplete="username" value={form.username} onChange={set("username")} placeholder="an.nguyen" />
      </Field>
      <Field label="Password" error={touched ? errors.password : undefined}>
        <input className={inputCls} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
      </Field>
      <Button size="lg" className="w-full" type="submit">
        Create account
      </Button>
      <GoogleButton />
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-lagoon hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
