"use client";

import type { SyncRunSummary } from "@triply/shared";
import { Boxes, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { LiveDot, RunProgress, RunStatus, runWhen, useLiveRuns } from "@/components/admin/runs";
import { EmptyState, ErrorState, LoadMore, PageLoader, Tabs, TabPanel } from "@/components/ui";
import { usePagedList } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const FILTERS = [
  { value: "", label: "All" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
  { value: "needs_review", label: "Needs review" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export default function RunsPage() {
  useDocumentTitle("Runs · Admin");
  const live = useLiveRuns();
  const [filter, setFilter] = useState<Filter>("");
  return (
    <div className="space-y-5">
      <AdminHeader title="Runs" body="Every sync — scheduled, started here, or from the CLI. Progress updates live while a run works." action={<LiveDot live={live} />} />
      <Tabs id="runs" label="Run status" value={filter} onChange={setFilter} tabs={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      <TabPanel tabsId="runs" value={filter}>
        <RunList key={filter} status={filter} />
      </TabPanel>
    </div>
  );
}

function RunList({ status }: { status: string }) {
  const q = usePagedList<SyncRunSummary>(["admin", "runs", status], "/admin/sync-runs", { status: status || undefined, limit: 30 });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.items ?? [];
  if (!items.length) return <EmptyState icon={<Boxes className="size-7" />} title="No runs" body="Start one from Areas or Sync jobs." />;
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {items.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/runs/${r.id}`} className="flex flex-col gap-2 p-4 hover:bg-sand-2/50 md:flex-row md:items-center md:gap-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RunStatus status={r.status} />
                  <span className="font-semibold">{r.jobName ?? r.area ?? "Ad-hoc run"}</span>
                  {r.jobName && r.area && <span className="font-mono text-xs text-muted">{r.area}</span>}
                </div>
                <p className="text-xs text-muted">
                  {r.trigger}
                  {r.requestedBy && ` by ${r.requestedBy}`} · {runWhen(r)}
                  {r.providers.length > 0 && ` · ${r.providers.join(", ")}`}
                  {r.errorCount > 0 && ` · ${r.errorCount} error${r.errorCount === 1 ? "" : "s"}`}
                </p>
              </div>
              <RunProgress progress={r.progress} status={r.status} />
              <ChevronRight className="hidden size-4 text-muted md:block" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
    </div>
  );
}
