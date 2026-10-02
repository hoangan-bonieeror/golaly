"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { cx } from "../ui";

export function Toaster() {
  const { toasts } = useStore();
  return (
    <div aria-live="polite" className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "animate-toast pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium shadow-pop",
            t.tone === "error" ? "bg-[#3b1d17] text-white" : "bg-ink text-white",
          )}
        >
          {t.tone === "error" ? <AlertCircle className="size-4 shrink-0 text-sunset" /> : <CheckCircle2 className="size-4 shrink-0 text-[#7fd1c7]" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
