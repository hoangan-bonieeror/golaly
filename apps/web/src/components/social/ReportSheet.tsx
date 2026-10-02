"use client";

import type { ReportReason, ReportTarget } from "@triply/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/queries";
import { Button, Sheet, cx } from "../ui";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "INAPPROPRIATE", label: "Inappropriate content" },
  { value: "MISLEADING", label: "Misleading information" },
  { value: "OTHER", label: "Other" },
];

export function ReportSheet({ open, onClose, target, targetId }: { open: boolean; onClose: () => void; target: ReportTarget; targetId: string }) {
  const [reason, setReason] = useState<ReportReason>();
  const report = useAction((r: ReportReason) => api.post("/reports", { target, targetId, reason: r }), { success: "Thanks — our team will review this." });
  return (
    <Sheet open={open} onClose={onClose} title={`Report ${target.toLowerCase()}`}>
      <div className="space-y-2" role="radiogroup">
        {REASONS.map((r) => (
          <button
            key={r.value}
            role="radio"
            aria-checked={reason === r.value}
            onClick={() => setReason(r.value)}
            className={cx("w-full rounded-xl border px-4 py-3 text-left text-sm font-medium", reason === r.value ? "border-ink bg-sand-2" : "border-line hover:border-ink-2")}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Button
        size="lg"
        className="mt-5 w-full"
        disabled={!reason || report.isPending}
        onClick={async () => {
          await report.run(reason!);
          onClose();
        }}
      >
        Submit report
      </Button>
    </Sheet>
  );
}
