"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  if (sent)
    return (
      <div className="animate-rise text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-lagoon-50 text-lagoon">
          <MailCheck className="size-7" />
        </div>
        <h1 className="font-display text-3xl font-semibold">Check your inbox</h1>
        {/* Same message whether or not the account exists — avoids account enumeration. */}
        <p className="mt-2 text-sm text-muted">If an account exists for {email || "that email"}, we&apos;ve sent a reset link. It expires in 30 minutes.</p>
        <Button href="/login" variant="secondary" className="mt-8">
          Back to log in
        </Button>
      </div>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
      className="animate-rise space-y-5"
    >
      <div>
        <h1 className="font-display text-3xl font-semibold">Reset password</h1>
        <p className="mt-1 text-sm text-muted">We&apos;ll email you a secure link.</p>
      </div>
      <Field label="Email">
        <input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button size="lg" className="w-full" type="submit">
        Send reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="font-semibold text-lagoon hover:underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
