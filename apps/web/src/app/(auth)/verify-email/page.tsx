"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MailWarning } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button, PageLoader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api/client";
import { keys } from "@/lib/api/queries";

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <Suspense fallback={<PageLoader label={t.auth.verify.confirming} />}>
      <VerifyEmail />
    </Suspense>
  );
}

function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const qc = useQueryClient();
  const t = useT();
  // No message on an error = the link is incomplete (worded in the current language at render time).
  const [state, setState] = useState<{ status: "pending" | "done" | "error"; message?: string }>({ status: token ? "pending" : "error" });
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
      .catch((e) => setState({ status: "error", message: e instanceof ApiError ? e.message : undefined }));
  }, [token, qc]);

  if (state.status === "pending") return <PageLoader label={t.auth.verify.confirming} />;
  const ok = state.status === "done";
  return (
    <div className="animate-rise space-y-5 text-center" role="status">
      <div className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${ok ? "bg-primary-50 text-primary" : "bg-accent-50 text-accent-700"}`}>
        {ok ? <CheckCircle2 className="size-7" aria-hidden /> : <MailWarning className="size-7" aria-hidden />}
      </div>
      <h1 className="font-display text-3xl font-semibold">{ok ? t.auth.verify.doneTitle : t.auth.verify.errorTitle}</h1>
      <p className="text-sm text-muted">{ok ? t.auth.verify.doneBody : t.auth.verify.errorBody(state.message ?? (token ? t.common.errors.generic : t.auth.verify.incomplete))}</p>
      <Button size="lg" className="w-full" href="/home">
        {t.auth.verify.continue}
      </Button>
    </div>
  );
}
