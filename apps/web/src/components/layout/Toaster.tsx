"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useToasts } from "@/lib/toast";
import { cx } from "../ui";

export function Toaster() {
  const toasts = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "animate-toast pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium shadow-pop",
            t.tone === "error" ? "bg-[#3b1d17] text-white" : "bg-ink text-white",
          )}
        >
          {t.tone === "error" ? <AlertCircle className="size-4 shrink-0 text-accent" /> : <CheckCircle2 className="size-4 shrink-0 text-success" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
