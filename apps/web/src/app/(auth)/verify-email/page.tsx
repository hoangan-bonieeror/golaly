"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MailWarning } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button, PageLoader } from "@/components/ui";
import { api, ApiError } from "@/lib/api/client";
import { keys } from "@/lib/api/queries";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<PageLoader label="Confirming your email" />}>
      <VerifyEmail />
    </Suspense>
  );
}

function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const qc = useQueryClient();
  const [state, setState] = useState<{ status: "pending" | "done" | "error"; message?: string }>({ status: token ? "pending" : "error", message: token ? undefined : "This confirmation link is incomplete." });
  const sent = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in development; the token must only be submitted once.
    if (!token || sent.current) return;
    sent.current = true;
    api
      .post("/auth/verify-email", { token })
      .then(() => {
        void qc.invalidateQueries({ queryKey: keys.me });
        setState({ status: "done" });
      })
      .catch((e) => setState({ status: "error", message: e instanceof ApiError ? e.message : "Something went wrong. Please try again." }));
  }, [token, qc]);

  if (state.status === "pending") return <PageLoader label="Confirming your email" />;
  const ok = state.status === "done";
  return (
    <div className="animate-rise space-y-5 text-center" role="status">
      <div className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${ok ? "bg-primary-50 text-primary" : "bg-accent-50 text-accent-700"}`}>
        {ok ? <CheckCircle2 className="size-7" aria-hidden /> : <MailWarning className="size-7" aria-hidden />}
      </div>
      <h1 className="font-display text-3xl font-semibold">{ok ? "Email confirmed" : "We couldn't confirm that link"}</h1>
      <p className="text-sm text-muted">{ok ? "You're all set — invitations sent to this address will now work." : `${state.message} You can send a new link from the banner in the app.`}</p>
      <Button size="lg" className="w-full" href="/home">
        Continue to TRIPLY
      </Button>
    </div>
  );
}
