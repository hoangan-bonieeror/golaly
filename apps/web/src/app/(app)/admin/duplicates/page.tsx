"use client";

import type { MergeCandidateView, MergePlaceSide } from "@triply/shared";
import { Check, Copy, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { Badge, Button, EmptyState, ErrorState, LoadMore, PageLoader, Tabs, TabPanel, cx, inputCls, timeAgo } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useAction, usePagedList } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const FILTERS = [
  { value: "pending", label: "To review" },
  { value: "merged", label: "Merged" },
  { value: "rejected", label: "Not duplicates" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** Pairs the dedupe step wasn't sure about (score 0.6–0.85): an admin decides. Merges can be undone from the place page. */
export default function DuplicatesPage() {
  useDocumentTitle("Duplicates · Admin");
  const [filter, setFilter] = useState<Filter>("pending");
  const [area, setArea] = useState("");
  return (
    <div className="space-y-5">
      <AdminHeader
        title="Duplicates"
        body="Places the pipeline thinks might be the same. Merging keeps the better-sourced one and moves trips, saves and photos onto it; the other place's link keeps working."
      />
      <label className="block w-full max-w-xs">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">Area</span>
        <input className={inputCls} placeholder="e.g. vn-da-nang" value={area} onChange={(e) => setArea(e.target.value.trim())} />
      </label>
      <Tabs id="dupes" label="Duplicate pairs" value={filter} onChange={setFilter} tabs={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      <TabPanel tabsId="dupes" value={filter}>
        <Pairs key={`${filter}:${area}`} status={filter} area={area} />
      </TabPanel>
    </div>
  );
}

function Pairs({ status, area }: { status: Filter; area: string }) {
  const q = usePagedList<MergeCandidateView>(["admin", "dupes", status, area], "/admin/merge-candidates", { status, area: area || undefined, limit: 20 });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.items ?? [];
  if (!items.length)
    return <EmptyState icon={<Copy className="size-7" />} title={status === "pending" ? "Nothing to review" : "No pairs here"} body={status === "pending" ? "New pairs show up after each sync." : undefined} />;
  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((c) => (
          <Pair key={c.id} c={c} />
        ))}
      </ul>
      <LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
    </div>
  );
}

const SIGNALS: Record<string, string> = { name: "Name", distance: "Distance", category: "Category", address: "Address", phone: "Phone", website: "Website" };

function Pair({ c }: { c: MergeCandidateView }) {
  // The list isn't refetched after a decision, so the pair stays where it was (with Undo) until the page reloads.
  const [decided, setDecided] = useState<{ status: "MERGED" | "REJECTED"; mergeId: string | null } | null>(null);
  const [undone, setUndone] = useState(false);
  const decide = useAction((decision: "merge" | "reject") => api.post<{ status: "MERGED" | "REJECTED"; mergeId: string | null }>(`/admin/merge-candidates/${c.id}/decide`, { decision }), {
    invalidate: [["admin", "places"]],
    success: (r) => (r.status === "MERGED" ? "Merged" : "Marked as different places"),
  });
  const undo = useAction((id: string) => api.post(`/admin/place-merges/${id}/undo`), { invalidate: [["admin", "places"]], success: "Merge undone" });
  const signals = Object.entries(c.signals).filter(([k, v]) => SIGNALS[k] && typeof v === "number") as [string, number][];
  const blocked = typeof c.signals.blocked === "string" ? c.signals.blocked : null;
  const run = async (d: "merge" | "reject") => {
    const r = await decide.run(d);
    if (r) setDecided({ status: r.status, mergeId: r.mergeId });
  };

  return (
    <li className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.score >= 0.75 ? "primary" : "gold"}>Match {Math.round(c.score * 100)}%</Badge>
        {signals.map(([k, v]) => (
          <span key={k} className="text-xs text-muted">
            {SIGNALS[k]} {Math.round(v * 100)}%
          </span>
        ))}
        {blocked && <Badge tone="accent">{blocked.replace(/_/g, " ")}</Badge>}
        {c.decidedAt && <span className="text-xs text-muted">decided {timeAgo(c.decidedAt)}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Side p={c.a} other={c.b} />
        <Side p={c.b} other={c.a} />
      </div>
      {c.status === "PENDING" && !decided && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run("merge")} disabled={decide.isPending} aria-label={`Merge ${c.a.name} and ${c.b.name}`}>
            <Check className="size-4" aria-hidden /> Same place — merge
          </Button>
          <Button size="sm" variant="secondary" onClick={() => run("reject")} disabled={decide.isPending} aria-label={`${c.a.name} and ${c.b.name} are different places`}>
            <X className="size-4" aria-hidden /> Different places
          </Button>
        </div>
      )}
      {decided && (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <span className="text-sm font-medium">{undone ? "Merge undone — both places are back." : decided.status === "MERGED" ? "Merged." : "Marked as different places."}</span>
          {decided.mergeId && !undone && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await undo.run(decided.mergeId!)) setUndone(true);
              }}
              disabled={undo.isPending}
            >
              <Undo2 className="size-4" aria-hidden /> Undo merge
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Side({ p, other }: { p: MergePlaceSide; other: MergePlaceSide }) {
  const diff = (a: unknown, b: unknown) => (a ?? "") !== (b ?? "");
  const metres = Math.round(distance(p, other));
  const row = (label: string, value: React.ReactNode, changed: boolean) => (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("min-w-0 break-words", changed && "font-medium text-accent-700")}>{value || "—"}</dd>
    </div>
  );
  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <Link href={`/admin/places/${p.id}`} className="font-semibold text-primary hover:underline">
        {p.name}
      </Link>
      <dl className="space-y-1 text-sm">
        {row("Address", p.address, diff(p.address, other.address))}
        {row("Category", p.categoryKey, diff(p.categoryKey, other.categoryKey))}
        {row("Phone", p.phone, diff(p.phone, other.phone))}
        {row("Website", p.website, diff(p.website, other.website))}
        {row("Apart", `${metres} m`, metres > 50)}
        {row("Sources", p.sources.map((s) => s.provider).join(", "), false)}
        {row("Used by", `${p.links} trip item${p.links === 1 ? "" : "s"}, saves or photos`, false)}
      </dl>
    </div>
  );
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
