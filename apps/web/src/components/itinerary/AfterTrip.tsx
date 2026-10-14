"use client";

import type { ItemEvidence, ItemStatus, ItemView, MediaView, TripDetail } from "@triply/shared";
import { Check, GitFork, Heart, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { isOffline, queueMarks } from "@/lib/offline";
import { applyStatuses, markable } from "@/lib/plan";
import { useToast } from "@/lib/toast";
import { Photo } from "../place/PlacePhotos";
import { Button, Sheet, cx } from "../ui";
import { ItemTypeIcon } from "./ItemTypeIcon";

/**
 * Recording what happened (roadmap phase 3): statuses change optimistically through the batch
 * endpoint, so one tap on a stop and the after-trip checklist share one path.
 */
export function useSetStatuses(trip: TripDetail) {
  const qc = useQueryClient();
  const toast = useToast();
  const all = useT();
  const t = all.after.status;
  const tq = all.during.offline;
  return async (changes: [string, ItemStatus][], message?: string | null) => {
    if (changes.length === 0) return true;
    const key = keys.trip(trip.id);
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) qc.setQueryData(key, applyStatuses(prev, new Map(changes)));
    try {
      await api.patch(`/trips/${trip.id}/items/status`, { items: changes.map(([id, status]) => ({ id, status })) });
      if (message !== null) toast(message ?? t.saved[changes[0][1]]);
      return true;
    } catch (e) {
      // No connection: keep the mark on screen and on this device; it syncs when the connection is back.
      if (isOffline(e)) {
        queueMarks(trip.id, changes);
        toast(tq.queued);
        return true;
      }
      if (prev) qc.setQueryData(key, prev);
      toast(t.failed, "error");
      return false;
    } finally {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["trips"] });
    }
  };
}

/** Two one-tap toggles on a stop once the trip has started: went ✓ / skipped ✕ (tap again to undo). */
export function StatusToggle({ item, onChange, labeled, className }: { item: ItemView; onChange: (status: ItemStatus) => void; labeled?: boolean; className?: string }) {
  const t = useT().after.status;
  const btn = labeled
    ? "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border text-[13px] font-semibold transition-colors"
    : "flex size-9 items-center justify-center rounded-full border transition-colors md:size-8";
  return (
    <div className={cx("flex shrink-0 items-center gap-1", labeled && "gap-2", className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-pressed={item.status === "VISITED"}
        aria-label={t.visitedLabel(item.title)}
        title={t.markVisited}
        onClick={() => onChange(item.status === "VISITED" ? "PLANNED" : "VISITED")}
        className={cx(btn, item.status === "VISITED" ? "border-primary bg-primary text-on-primary" : "border-line text-muted hover:border-primary hover:text-primary")}
      >
        <Check className="size-4" aria-hidden />
        {labeled && t.markVisited}
      </button>
      <button
        type="button"
        aria-pressed={item.status === "SKIPPED"}
        aria-label={t.skippedLabel(item.title)}
        title={t.markSkipped}
        onClick={() => onChange(item.status === "SKIPPED" ? "PLANNED" : "SKIPPED")}
        className={cx(btn, item.status === "SKIPPED" ? "border-ink-2 bg-ink-2 text-surface" : "border-line text-muted hover:border-ink-2 hover:text-ink")}
      >
        <X className="size-4" aria-hidden />
        {labeled && t.markSkipped}
      </button>
    </div>
  );
}

/** "Went" / "Skipped" on a stop (nothing while it's only planned). */
export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  const t = useT().after.status;
  if (status === "PLANNED") return null;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        status === "VISITED" ? "bg-primary-50 text-primary" : "bg-sand-2 text-ink-2",
        className,
      )}
    >
      {status === "VISITED" ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      {t[status]}
    </span>
  );
}

/** On a remixed stop: what the original group did with it, and how many of them really wanted it. */
export function EvidenceBadge({ evidence }: { evidence: ItemEvidence | null }) {
  const t = useT().after.evidence;
  if (!evidence) return null;
  return (
    <p className="mt-2 inline-flex flex-wrap items-center gap-x-1.5 rounded-lg bg-accent-50 px-2.5 py-1 text-[12px] font-medium text-accent-700" title={t.hint}>
      <GitFork className="size-3.5 shrink-0" aria-hidden />
      <span>{t[evidence.status]}</span>
      {evidence.loves > 0 && (
        <>
          <span aria-hidden>·</span>
          <Heart className="size-3 fill-current" aria-hidden />
          <span>{t.loves(evidence.loves)}</span>
        </>
      )}
    </p>
  );
}

/** A few photos of a stop on its card in the plan. */
export function PhotoStrip({ item, max = 4 }: { item: ItemView; max?: number }) {
  const t = useT().after.photos;
  if (item.photos.length === 0) return null;
  const shown = item.photos.slice(0, max);
  const more = item.photos.length - shown.length;
  return (
    <ul className="mt-2.5 flex gap-1.5" aria-label={t.count(item.photos.length)}>
      {shown.map((p, i) => (
        <li key={p.id} className="relative size-14 overflow-hidden rounded-lg">
          <Photo image={p.image} alt={t.by(p.uploadedBy.displayName)} sizes="56px" />
          {i === shown.length - 1 && more > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/45 font-mono text-xs font-semibold text-white">+{more}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A stop's photos in the recap, with "Add photo" for members and remove for the uploader or the owner. */
export function ItemPhotos({ trip, item }: { trip: TripDetail; item: ItemView }) {
  const t = useT().after.photos;
  const me = useMe().data;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const canAdd = trip.permissions.includes("itinerary.photo");
  const remove = useAction((id: string) => api.delete(`/item-photos/${id}`), { invalidate: [keys.trip(trip.id)], success: t.removed });
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of [...files].slice(0, 6)) {
        const media = await api.upload<MediaView>("/media", file);
        await api.post(`/items/${item.id}/photos`, { mediaId: media.id });
      }
      toast(t.added);
    } catch (e) {
      toast(e instanceof Error ? e.message : t.added, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      void qc.invalidateQueries({ queryKey: keys.trip(trip.id) });
    }
  };
  if (!canAdd && item.photos.length === 0) return null;
  const picker = <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />;
  // No photos yet: one small button rather than an empty tile.
  if (item.photos.length === 0)
    return (
      <div className="mt-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          aria-label={t.addTo(item.title)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 text-xs font-semibold text-primary hover:border-primary hover:bg-primary-50/60 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          {busy ? t.uploading : t.add}
        </button>
        {picker}
      </div>
    );
  return (
    <div className="mt-3">
      <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {item.photos.map((p) => (
          <li key={p.id} className="group relative aspect-square overflow-hidden rounded-xl">
            <Photo image={p.image} alt={t.by(p.uploadedBy.displayName)} sizes="(min-width: 640px) 160px, 33vw" />
            {(p.uploadedBy.id === me?.id || trip.myRole === "OWNER") && (
              <button
                type="button"
                onClick={() => remove.run(p.id)}
                aria-label={t.remove}
                className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white opacity-100 hover:bg-black/75 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
        {canAdd && (
          <li className="aspect-square">
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              aria-label={t.addTo(item.title)}
              className="flex size-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-xs font-semibold text-primary hover:border-primary hover:bg-primary-50/60 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
              {busy ? t.uploading : t.add}
            </button>
            {picker}
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * After the trip: one checklist of every stop on a day, went / skipped. Unmarked stops start as
 * "went" (most of a plan usually happens); saving sends only what changed, in one request.
 */
export function ReviewSheet({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDetail }) {
  const t = useT().after;
  return (
    <Sheet open={open} onClose={onClose} title={t.review.title} wide>
      {open && <ReviewBody trip={trip} onDone={onClose} />}
    </Sheet>
  );
}

function ReviewBody({ trip, onDone }: { trip: TripDetail; onDone: () => void }) {
  const { m } = useI18n();
  const t = m.after;
  const setStatuses = useSetStatuses(trip);
  const days = trip.days.map((d) => ({ ...d, items: d.items.filter(markable) })).filter((d) => d.items.length > 0);
  const all = days.flatMap((d) => d.items);
  const [choice, setChoice] = useState<Record<string, ItemStatus>>(() => Object.fromEntries(all.map((i) => [i.id, i.status === "PLANNED" ? "VISITED" : i.status])));
  const [saving, setSaving] = useState(false);
  if (all.length === 0) return <p className="text-sm text-ink-2">{t.review.empty}</p>;
  const changes = all.filter((i) => choice[i.id] !== i.status).map((i) => [i.id, choice[i.id]] as [string, ItemStatus]);
  const save = async () => {
    setSaving(true);
    const ok = await setStatuses(changes, t.review.saved(changes.length));
    setSaving(false);
    if (ok) onDone();
  };
  return (
    <div>
      <p className="text-sm text-ink-2">{t.review.intro}</p>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setChoice(Object.fromEntries(all.map((i) => [i.id, "VISITED" as const])))}>
          <Check className="size-4" /> {t.review.allVisited}
        </Button>
      </div>
      <div className="mt-2 space-y-5">
        {days.map((d) => (
          <section key={d.id} aria-labelledby={`review-${d.id}`}>
            <h3 id={`review-${d.id}`} className="mb-1.5 font-display text-base font-bold">
              {m.trips.day(d.dayNumber)}
              {d.title && <span className="font-semibold text-ink-2"> · {d.title}</span>}
            </h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {d.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                  <ItemTypeIcon type={i.type} size="sm" />
                  <span className={cx("min-w-0 flex-1 truncate text-sm font-semibold", choice[i.id] === "SKIPPED" && "text-muted line-through")}>{i.title}</span>
                  <div role="radiogroup" aria-label={t.review.group(i.title)} className="flex shrink-0 gap-1 rounded-xl bg-sand-2 p-1">
                    {(["VISITED", "SKIPPED"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={choice[i.id] === s}
                        onClick={() => setChoice((c) => ({ ...c, [i.id]: s }))}
                        className={cx(
                          "flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold",
                          choice[i.id] === s ? (s === "VISITED" ? "bg-primary text-on-primary" : "bg-surface text-ink shadow-card") : "text-ink-2 hover:text-ink",
                        )}
                      >
                        {s === "VISITED" ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                        {t.status[s]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="sticky bottom-0 -mx-1 mt-5 bg-surface px-1 pb-1 pt-3">
        <Button className="w-full" size="lg" onClick={save} disabled={saving}>
          {t.review.save}
        </Button>
      </div>
    </div>
  );
}
