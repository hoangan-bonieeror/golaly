"use client";

import type { AdminPlaceView } from "@golaly/shared";
import { Lock, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { Badge, EmptyState, ErrorState, LoadMore, PageLoader, inputCls, timeAgo } from "@/components/ui";
import { useCategories, usePagedList } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** Find any place (hidden and closed ones too) to correct it by hand. */
export default function AdminPlacesPage() {
  useDocumentTitle("Places · Admin");
  const cats = useCategories().data ?? [];
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const list = usePagedList<AdminPlaceView>(["admin", "places", q, area, status, category], "/admin/places", {
    q: q || undefined,
    area: area || undefined,
    status: status || undefined,
    category: category || undefined,
    limit: 30,
  });

  return (
    <div className="space-y-5">
      <AdminHeader title="Places" body="Edits here are locked: future syncs won't overwrite a field you changed until you unlock it." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Search</span>
          <input className={inputCls} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or address" />
        </label>
        <label>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Area</span>
          <input className={inputCls} value={area} onChange={(e) => setArea(e.target.value.trim())} placeholder="e.g. vn-da-nang" />
        </label>
        <label>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Status</span>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            <option value="ACTIVE">Active</option>
            <option value="HIDDEN">Hidden</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Category</span>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any</option>
            {cats.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isLoading ? (
        <PageLoader />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.items?.length ? (
        <EmptyState icon={<MapPin className="size-7" />} title="No places found" body="Try fewer filters." />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {list.items.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/places/${p.id}`} className="flex flex-col gap-1 p-4 hover:bg-sand-2/50 md:flex-row md:items-center md:gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.name}</span>
                      {p.status !== "ACTIVE" && <Badge tone="accent">{p.status === "HIDDEN" ? "Hidden" : "Closed"}</Badge>}
                      {p.lockedFields.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted" title={`Locked: ${p.lockedFields.join(", ")}`}>
                          <Lock className="size-3" aria-hidden /> {p.lockedFields.length} locked
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted">{[p.categoryLabel, p.areaName, p.address].filter(Boolean).join(" · ")}</p>
                  </div>
                  <p className="text-xs text-muted">
                    {p.sourceCount} source{p.sourceCount === 1 ? "" : "s"} · quality {Math.round(p.qualityScore * 100)}% · updated {timeAgo(p.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </div>
      )}
    </div>
  );
}
