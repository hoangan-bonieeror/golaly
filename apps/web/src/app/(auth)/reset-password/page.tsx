"use client";

import { passwordSchema } from "@triply/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
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
        if (!parsed.success) return setError(parsed.error.issues[0]?.message);
        setBusy(true);
        try {
          await api.post("/auth/reset-password", { token, password });
          toast("Password updated — log in with your new password");
          router.push("/login");
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h1 className="font-display text-3xl font-semibold">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted">You&apos;ll be logged out on your other devices.</p>
      </div>
      <Field label="New password" error={error} hint="At least 8 characters.">
        <input className={inputCls} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button size="lg" className="w-full" type="submit" disabled={busy || !token}>
        Update password
      </Button>
      {!token && <p className="text-sm text-danger">This reset link is incomplete. Request a new one.</p>}
    </form>
  );
}
