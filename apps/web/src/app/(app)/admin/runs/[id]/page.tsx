"use client";

import { useQuery } from "@tanstack/react-query";
import type { SyncRunDetail, SyncRunErrorView } from "@golaly/shared";
import { ChevronLeft, CircleStop, RotateCw } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { LiveDot, RunProgress, RunStatus, isActive, runWhen, useLiveRuns } from "@/components/admin/runs";
import { Button, ErrorState, PageLoader, timeAgo } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const sum = (o: Obj, key: string) => Object.values(o).reduce<number>((n, v) => n + num(obj(v)[key]), 0);

/** The pipeline's stats (see pipelines/golaly_catalog/pipeline.py finalize) boiled down to the numbers people ask about. */
function summarize(stats: Obj): { label: string; value: number }[] {
  const loaded = obj(stats.loaded);
  const publish = obj(stats.publish);
  const providers = Object.fromEntries(Object.entries(publish).filter(([, v]) => "created" in obj(v)));
  const dedupe = obj(publish.dedupe);
  const missing = Object.entries(stats).filter(([k]) => k.endsWith("_missing")).map(([, v]) => obj(v));
  const quality = obj(stats.quality);
  const rows: [string, unknown][] = [
    ["Records read", Object.keys(loaded).length ? sum(loaded, "fetched") : undefined],
    ["New or changed records", Object.keys(loaded).length ? sum(loaded, "changed") : undefined],
    ["New places", Object.keys(providers).length ? sum(providers, "created") : undefined],
    ["Matched to existing places", Object.keys(providers).length ? sum(providers, "attached") : undefined],
    ["Places refreshed", publish.updated],
    ["Duplicates merged", dedupe.merged],
    ["Sent to duplicate review", dedupe.queued],
    ["Gone from sources", missing.length ? missing.reduce((n, m) => n + num(m.missing), 0) : undefined],
    ["Revived from an interrupted run", stats.revived],
    ["Places in the area now", quality.places],
  ];
  return rows.filter(([, v]) => typeof v === "number").map(([label, value]) => ({ label, value: value as number }));
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const live = useLiveRuns();
  const q = useQuery({ queryKey: ["admin", "run", id], queryFn: () => api.get<SyncRunDetail>(`/admin/sync-runs/${id}`), retry: false });
  const errors = useQuery({ queryKey: ["admin", "run", id, "errors"], queryFn: () => api.get<SyncRunErrorView[]>(`/admin/sync-runs/${id}/errors`), enabled: !!q.data });
  const resume = useAction(() => api.post<SyncRunDetail>(`/admin/sync-runs/${id}/resume`), {
    invalidate: [["admin", "run", id], ["admin", "runs"]],
    success: "Resuming — finished parts are skipped",
  });
  const cancel = useAction(() => api.post<SyncRunDetail>(`/admin/sync-runs/${id}/cancel`), {
    invalidate: [["admin", "run", id], ["admin", "runs"]],
    success: (r) => (r.status === "cancelled" ? "Run cancelled" : "Asked the run to stop after its current batch"),
  });
  const r = q.data;
  useDocumentTitle(r ? `Run ${r.jobName ?? r.area ?? ""} · Admin` : "Run · Admin");

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !r) return <ErrorState error={q.error} onRetry={() => q.refetch()} page />;
  const known = summarize(obj(r.stats));
  const warnings = (obj(obj(r.stats).quality).warnings as string[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <Link href="/admin/runs" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" aria-hidden /> All runs
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold">{r.jobName ?? r.area ?? "Ad-hoc run"}</h1>
            <RunStatus status={r.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {r.trigger}
            {r.requestedBy && ` by ${r.requestedBy}`} · {runWhen(r)}
            {r.finishedAt && ` · took ${duration(r.startedAt, r.finishedAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <LiveDot live={live} />
          {r.resumable && (
            <Button onClick={() => resume.run(undefined)} disabled={resume.isPending}>
              <RotateCw className="size-4" aria-hidden /> Resume run
            </Button>
          )}
          {isActive(r.status) && (
            <Button variant="secondary" onClick={() => cancel.run(undefined)} disabled={cancel.isPending || r.cancelRequested}>
              <CircleStop className="size-4" aria-hidden /> {r.cancelRequested ? "Stopping…" : "Cancel run"}
            </Button>
          )}
        </div>
      </header>

      {isActive(r.status) && (
        <section aria-label="Progress" className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <RunProgress progress={r.progress} status={r.status} />
        </section>
      )}

      {r.error && (
        <p role="alert" className="rounded-xl border border-accent-50 bg-accent-50 p-4 text-sm text-accent-700">
          {r.error}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold">What it did</h2>
        {known.length ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {known.map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-surface p-3">
                <dt className="text-xs text-muted">{k.label}</dt>
                <dd className="font-display text-2xl font-semibold">{k.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">{isActive(r.status) ? "Numbers appear when the run finishes." : "No numbers recorded."}</p>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-gold-50 bg-gold-50 p-3 text-sm text-gold-700" aria-label="Quality warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <details className="rounded-xl border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-medium">All numbers and parameters</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ params: r.params, stats: r.stats }, null, 2)}</pre>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold">
          Errors <span className="text-base font-normal text-muted">({r.errorCount})</span>
        </h2>
        {errors.isLoading ? (
          <PageLoader />
        ) : !errors.data?.length ? (
          <p className="text-sm text-muted">No record-level errors.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {errors.data.map((e) => (
              <li key={e.id} className="space-y-1 p-3 text-sm">
                <p className="text-xs text-muted">
                  {e.stage}
                  {e.provider && ` · ${e.provider}`}
                  {e.externalId && <span className="font-mono"> {e.externalId}</span>} · {timeAgo(e.createdAt)}
                </p>
                <p className="break-words">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
        {r.errorCount > (errors.data?.length ?? 0) && <p className="text-xs text-muted">Showing the first {errors.data?.length}. The rest are in sync_run_errors.</p>}
      </section>
    </div>
  );
}

function duration(from: string, to: string) {
  const s = Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
