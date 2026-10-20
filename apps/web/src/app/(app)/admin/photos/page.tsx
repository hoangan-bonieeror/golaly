"use client";

import type { ModerationPhoto } from "@golaly/shared";
import { Check, EyeOff, Flag, ImageOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Photo, PhotoCredit } from "@/components/place/PlacePhotos";
import { Badge, Button, EmptyState, ErrorState, LoadMore, PageLoader, Tabs, TabPanel } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useAction, usePagedList } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const FILTERS = [
  { value: "pending", label: "Waiting for review" },
  { value: "reported", label: "Reported" },
  { value: "hidden", label: "Hidden" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** Moderation queue for place photos: new uploaders' photos, loose import matches, reported and hidden ones. */
export default function ModerationPage() {
  const [filter, setFilter] = useState<Filter>("pending");
  useDocumentTitle("Place photos · Admin");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold md:text-4xl">Place photos</h1>
        <p className="text-sm text-muted">Approve what helps travelers; hide anything off-topic, unsafe or not the uploader’s to share.</p>
      </header>
      <Tabs id="moderation" label="Photo queues" value={filter} onChange={setFilter} tabs={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      <TabPanel tabsId="moderation" value={filter}>
        <Queue key={filter} filter={filter} />
      </TabPanel>
    </div>
  );
}

function Queue({ filter }: { filter: Filter }) {
  const q = usePagedList<ModerationPhoto>(["admin", "place-photos", filter], "/admin/place-photos", { filter, limit: 24 });
  const invalidate = [["admin", "place-photos"], ["places"]];
  const moderate = useAction((a: { id: string; status: "APPROVED" | "HIDDEN" }) => api.patch(`/place-photos/${a.id}`, { status: a.status }), {
    invalidate,
    success: (r) => ((r as ModerationPhoto).status === "APPROVED" ? "Approved" : "Hidden"),
  });
  const remove = useAction((id: string) => api.delete(`/place-photos/${id}`), { invalidate, success: "Removed" });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.items ?? [];
  if (!items.length) return <EmptyState level="h2" icon={<ImageOff className="size-7" />} title="Nothing here" body={filter === "pending" ? "No photos are waiting for review." : "No photos in this list."} />;

  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
            <div className="aspect-[4/3] bg-sand-2">
              <Photo image={p.image} alt={p.caption || `Photo of ${p.place.name}`} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
            </div>
            <div className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/places/${p.place.id}`} className="font-semibold text-primary hover:underline">
                  {p.place.name}
                </Link>
                {p.place.destinationName && <span className="text-xs text-muted">{p.place.destinationName}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={p.source === "user" ? "primary" : "neutral"}>{p.source === "user" ? "Traveler upload" : p.credit.sourceName}</Badge>
                {p.reportCount > 0 && (
                  <Badge tone="accent">
                    <Flag className="size-3" aria-hidden /> {p.reportCount} report{p.reportCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              {p.caption && <p className="text-sm">{p.caption}</p>}
              <p className="text-xs text-muted">
                <PhotoCredit photo={p} />
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {p.status !== "APPROVED" || p.reportCount > 0 ? (
                  <Button size="sm" onClick={() => moderate.run({ id: p.id, status: "APPROVED" })} disabled={moderate.isPending} aria-label={`Approve photo of ${p.place.name}`}>
                    <Check className="size-4" aria-hidden /> Approve
                  </Button>
                ) : null}
                {p.status !== "HIDDEN" && (
                  <Button size="sm" variant="secondary" onClick={() => moderate.run({ id: p.id, status: "HIDDEN" })} disabled={moderate.isPending} aria-label={`Hide photo of ${p.place.name}`}>
                    <EyeOff className="size-4" aria-hidden /> Hide
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => remove.run(p.id)} disabled={remove.isPending} aria-label={`Remove photo of ${p.place.name}`}>
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
    </div>
  );
}
