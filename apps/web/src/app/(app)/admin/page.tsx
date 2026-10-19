"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdminAreaView } from "@triply/shared";
import { ChevronLeft, ChevronRight, Globe2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { LiveDot, RunProgress, RunStatus, SyncAreaButtons, runWhen, useLiveRuns } from "@/components/admin/runs";
import { EmptyState, ErrorState, PageLoader, formatCount, inputCls } from "@/components/ui";
import { api, qs } from "@/lib/api/client";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export default function AreasPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Areas />
    </Suspense>
  );
}

/** Countries, then a country's provinces: how many places each has and how its last sync went. */
function Areas() {
  const parent = useSearchParams().get("parent") ?? undefined;
  const [filter, setFilter] = useState("");
  const live = useLiveRuns();
  useDocumentTitle("Areas · Admin");
  const q = useQuery({ queryKey: ["admin", "areas", parent ?? null], queryFn: () => api.get<AdminAreaView[]>(`/admin/areas${qs({ parent })}`) });
  const items = (q.data ?? []).filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || a.slug.includes(filter.toLowerCase()));

  return (
    <div className="space-y-5">
      <AdminHeader
        title={parent ? `Regions of ${parent.toUpperCase()}` : "Areas"}
        body="Each country's boundaries are imported once (golaly-catalog bootstrap); after that, places sync per area. Sync a whole country or one province."
        action={<LiveDot live={live} />}
      />
      <div className="flex flex-wrap items-center gap-3">
        {parent && (
          <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <ChevronLeft className="size-4" aria-hidden /> All countries
          </Link>
        )}
        <label className="w-full max-w-xs">
          <span className="sr-only">Filter areas</span>
          <input className={inputCls} placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      </div>
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !items.length ? (
        <EmptyState
          icon={<Globe2 className="size-7" />}
          title={filter ? "No matching areas" : "No areas yet"}
          body={filter ? "Try another name." : "Import a country's boundaries first: golaly-catalog bootstrap --country VN"}
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {items.map((a) => (
            <AreaRow key={a.slug} area={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AreaRow({ area: a }: { area: AdminAreaView }) {
  return (
    <li className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{a.name}</h2>
          <span className="font-mono text-xs text-muted">{a.slug}</span>
          {!a.hasBoundary && <span className="text-xs text-accent-700">no boundary</span>}
        </div>
        <p className="text-sm text-muted">
          {formatCount(a.places)} place{a.places === 1 ? "" : "s"}
          {a.regions > 0 && (
            <>
              {" · "}
              <Link href={`/admin?parent=${a.slug}`} className="inline-flex items-center font-medium text-primary hover:underline">
                {a.regions} regions <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3 md:w-72">
        {a.lastRun ? (
          <Link href={`/admin/runs/${a.lastRun.id}`} className="flex flex-wrap items-center gap-2 text-sm hover:underline" aria-label={`Last run for ${a.name}: ${a.lastRun.status}`}>
            <RunStatus status={a.lastRun.status} />
            <span className="text-xs text-muted">{runWhen(a.lastRun)}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted">Never synced</span>
        )}
        {a.lastRun && <RunProgress progress={a.lastRun.progress} status={a.lastRun.status} />}
      </div>
      <SyncAreaButtons area={a.slug} name={a.name} compact />
    </li>
  );
}
