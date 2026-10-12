"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdminCategoryView, CategoryMapView, UnmappedCategoryView } from "@triply/shared";
import { Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { Button, EmptyState, ErrorState, IconButton, PageLoader, Tabs, TabPanel, formatCount, inputCls } from "@/components/ui";
import { api, qs } from "@/lib/api/client";
import { useAction } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PROVIDERS = ["osm", "overture", "fsq"] as const;
type View = "unmapped" | "maps" | "categories";

/**
 * Source categories → TRIPLY categories. Records whose category has no mapping are kept but never published;
 * mapping one here publishes them on the area's next sync.
 */
export default function CategoriesPage() {
  useDocumentTitle("Categories · Admin");
  const [view, setView] = useState<View>("unmapped");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("osm");
  const cats = useQuery({ queryKey: ["admin", "categories"], queryFn: () => api.get<AdminCategoryView[]>("/admin/categories") });

  return (
    <div className="space-y-5">
      <AdminHeader title="Categories" body="Map what each source calls a place (amenity=cafe, coffee_shop…) to a TRIPLY category. Changes apply on each area's next sync." />
      <Tabs
        id="cats"
        label="Category views"
        value={view}
        onChange={setView}
        tabs={[
          { value: "unmapped", label: "Unmapped" },
          { value: "maps", label: "Mappings" },
          { value: "categories", label: "TRIPLY categories" },
        ]}
      />
      {view !== "categories" && (
        <label className="block w-full max-w-xs">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Source</span>
          <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      <TabPanel tabsId="cats" value={view}>
        {cats.isLoading ? (
          <PageLoader />
        ) : cats.isError ? (
          <ErrorState error={cats.error} onRetry={() => cats.refetch()} />
        ) : view === "unmapped" ? (
          <Unmapped provider={provider} cats={cats.data ?? []} />
        ) : view === "maps" ? (
          <Maps provider={provider} cats={cats.data ?? []} />
        ) : (
          <CategoryList cats={cats.data ?? []} />
        )}
      </TabPanel>
    </div>
  );
}

function useSetMap() {
  return useAction((body: { provider: string; externalCategory: string; categoryKey: string | null }) => api.put<{ records: number }>("/admin/category-maps", body), {
    invalidate: [["admin", "category-maps"], ["admin", "categories"]],
    success: (r) => `Saved — ${formatCount(r.records)} record${r.records === 1 ? "" : "s"} follow on the next sync`,
  });
}

function CategorySelect({ cats, value, onChange, label }: { cats: AdminCategoryView[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className={`${inputCls} h-9 text-sm`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose…</option>
      {cats.map((c) => (
        <option key={c.key} value={c.key}>
          {c.parentKey ? `— ${c.labelEn}` : c.labelEn}
        </option>
      ))}
    </select>
  );
}

function Unmapped({ provider, cats }: { provider: string; cats: AdminCategoryView[] }) {
  const q = useQuery({
    queryKey: ["admin", "category-maps", "unmapped", provider],
    queryFn: () => api.get<UnmappedCategoryView[]>(`/admin/category-maps${qs({ unmapped: "true", provider })}`),
  });
  const setMap = useSetMap();
  const [choice, setChoice] = useState<Record<string, string>>({});
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<Tags className="size-7" />} title="Everything is mapped" body="Every category this source sent has a TRIPLY category." />;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {q.data.map((u) => (
        <li key={u.externalCategory} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="break-all font-mono text-sm">{u.externalCategory}</p>
            <p className="text-xs text-muted">{formatCount(u.records)} unpublished records</p>
          </div>
          <div className="flex items-center gap-2 sm:w-80">
            <CategorySelect cats={cats} value={choice[u.externalCategory] ?? ""} onChange={(v) => setChoice((c) => ({ ...c, [u.externalCategory]: v }))} label={`Category for ${u.externalCategory}`} />
            <Button
              size="sm"
              disabled={!choice[u.externalCategory] || setMap.isPending}
              onClick={() => setMap.run({ provider, externalCategory: u.externalCategory, categoryKey: choice[u.externalCategory]! })}
              aria-label={`Map ${u.externalCategory}`}
            >
              Map
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Maps({ provider, cats }: { provider: string; cats: AdminCategoryView[] }) {
  const q = useQuery({ queryKey: ["admin", "category-maps", provider], queryFn: () => api.get<CategoryMapView[]>(`/admin/category-maps${qs({ provider })}`) });
  const setMap = useSetMap();
  const [filter, setFilter] = useState("");
  const label = new Map(cats.map((c) => [c.key, c.labelEn]));
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = (q.data ?? []).filter((m) => !filter || m.externalCategory.includes(filter) || m.categoryKey.includes(filter));
  return (
    <div className="space-y-3">
      <label className="block w-full max-w-xs">
        <span className="sr-only">Filter mappings</span>
        <input className={inputCls} placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value.trim())} />
      </label>
      {!rows.length ? (
        <EmptyState icon={<Tags className="size-7" />} title="No mappings" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((m) => (
            <li key={m.externalCategory} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 break-all font-mono text-sm">{m.externalCategory}</p>
              <div className="flex items-center gap-2 sm:w-80">
                <CategorySelect
                  cats={cats}
                  value={m.categoryKey}
                  onChange={(v) => v && setMap.run({ provider, externalCategory: m.externalCategory, categoryKey: v })}
                  label={`Category for ${m.externalCategory} (now ${label.get(m.categoryKey) ?? m.categoryKey})`}
                />
                <IconButton label={`Remove mapping for ${m.externalCategory}`} onClick={() => setMap.run({ provider, externalCategory: m.externalCategory, categoryKey: null })}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryList({ cats }: { cats: AdminCategoryView[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {cats.map((c) => (
        <li key={c.key} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 ${c.parentKey ? "pl-8" : "bg-sand-2/40"}`}>
          <span className={c.parentKey ? "" : "font-semibold"}>{c.labelEn}</span>
          <span className="text-sm text-muted">{c.labelVi}</span>
          <span className="font-mono text-xs text-muted">{c.key}</span>
          <span className="ml-auto text-xs text-muted">
            {formatCount(c.places)} places · {c.maps} source mappings
          </span>
        </li>
      ))}
    </ul>
  );
}
