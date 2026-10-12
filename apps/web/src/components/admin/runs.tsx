"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { SyncProgress, SyncRunDetail, SyncRunSummary } from "@triply/shared";
import { FlaskConical, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, Button, cx, timeAgo } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useAction, useMe } from "@/lib/api/queries";
import { useAdminRealtime } from "@/lib/realtime";

const STATUS: Record<string, { label: string; tone: "neutral" | "primary" | "accent" | "gold" }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "primary" },
  succeeded: { label: "Succeeded", tone: "primary" },
  partial: { label: "Partial", tone: "gold" },
  needs_review: { label: "Needs review", tone: "gold" },
  failed: { label: "Failed", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  dry_run: { label: "Dry run", tone: "neutral" },
};

export function RunStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const isActive = (status: string) => status === "queued" || status === "running";

export function RunProgress({ progress, status }: { progress: SyncProgress; status: string }) {
  const total = progress.total ?? 0;
  const done = progress.done ?? 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  if (!isActive(status) && !total) return null;
  return (
    <div className="min-w-32 space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-sand-2"
        role="progressbar"
        aria-label="Run progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={total ? pct : undefined}
        aria-valuetext={total ? `${done} of ${total} steps` : "Starting"}
      >
        <div className={cx("h-full rounded-full bg-primary transition-[width]", !total && "w-1/4 animate-pulse")} style={total ? { width: `${pct}%` } : undefined} />
      </div>
      <p className="text-xs text-muted">
        {total ? `${done}/${total}` : "Starting…"}
        {progress.failed ? ` · ${progress.failed} failed` : ""}
        {progress.current && isActive(status) ? ` · ${progress.current}` : ""}
      </p>
    </div>
  );
}

export function runWhen(r: SyncRunSummary) {
  return r.finishedAt ? `finished ${timeAgo(r.finishedAt)}` : `started ${timeAgo(r.startedAt)}`;
}

/** Live updates for any admin screen that shows runs: refetch the run lists/details when the pipeline reports progress. */
export function useLiveRuns() {
  const me = useMe();
  const qc = useQueryClient();
  return useAdminRealtime(me.data?.id, (e) => {
    void qc.invalidateQueries({ queryKey: ["admin", "runs"] });
    void qc.invalidateQueries({ queryKey: ["admin", "run", e.id] });
    if (!isActive(e.status)) {
      void qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
      void qc.invalidateQueries({ queryKey: ["admin", "areas"] });
    }
  });
}

export function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <span aria-hidden className={cx("size-2 rounded-full", live ? "bg-primary" : "bg-line")} />
      {live ? "Live" : "Not live — refresh for updates"}
    </span>
  );
}

/** "Sync now" / "Dry run" for an area (ad-hoc run, no job). Opens the run once Airflow accepts it. */
export function SyncAreaButtons({ area, name, compact }: { area: string; name: string; compact?: boolean }) {
  const router = useRouter();
  const start = useAction((dryRun: boolean) => api.post<SyncRunDetail>("/admin/sync-runs", { area, dryRun }), {
    invalidate: [["admin", "runs"], ["admin", "areas"]],
    success: (r) => (r.trigger === "dry_run" ? "Dry run started" : "Sync started"),
  });
  const go = async (dryRun: boolean) => {
    const r = await start.run(dryRun);
    if (r) router.push(`/admin/runs/${r.id}`);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => go(false)} disabled={start.isPending} aria-label={`Sync ${name} now`}>
        <Play className="size-4" aria-hidden /> {compact ? "Sync" : "Sync now"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => go(true)} disabled={start.isPending} aria-label={`Dry run for ${name}`}>
        <FlaskConical className="size-4" aria-hidden /> Dry run
      </Button>
    </div>
  );
}
