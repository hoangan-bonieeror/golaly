"use client";

import type { ReportReason, ReportTarget } from "@triply/shared";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { useAction } from "@/lib/api/queries";
import { Button, Sheet, cx } from "../ui";

const REASONS: ReportReason[] = ["SPAM", "HARASSMENT", "INAPPROPRIATE", "MISLEADING", "OTHER"];

export function ReportSheet({ open, onClose, target, targetId }: { open: boolean; onClose: () => void; target: ReportTarget; targetId: string }) {
  const [reason, setReason] = useState<ReportReason>();
  const t = useT();
  const report = useAction((r: ReportReason) => api.post("/reports", { target, targetId, reason: r }), { success: t.social.report.thanks });
  return (
    <Sheet open={open} onClose={onClose} title={t.social.report.title[target]}>
      <div className="space-y-2" role="radiogroup">
        {REASONS.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cx("w-full rounded-xl border px-4 py-3 text-left text-sm font-medium", reason === r ? "border-ink bg-sand-2" : "border-line hover:border-ink-2")}
          >
            {t.social.report.reasons[r]}
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
        {t.social.report.submit}
      </Button>
    </Sheet>
  );
}
