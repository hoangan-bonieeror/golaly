"use client";

import type { TripSummary } from "@golaly/shared";
import { Check, GitFork, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { useAction } from "@/lib/api/queries";
import { Button, Sheet } from "../ui";

/** "Use This Trip" confirmation — makes the fork contract explicit (spec §20). */
export function ForkSheet({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripSummary }) {
  const router = useRouter();
  const t = useT();
  const tf = t.trips.fork;
  const fork = useAction(() => api.post<TripSummary>(`/trips/${trip.id}/fork`), {
    invalidate: [["trips"], ["trip", trip.id]],
    success: tf.done,
  });
  const s = trip.stats;

  return (
    <Sheet open={open} onClose={onClose} title={t.trips.useThisTrip}>
      <p className="text-sm text-ink-2">
        {tf.intro.before} <b>{trip.title}</b> {tf.intro.after(trip.owner.displayName)}
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{tf.copied}</h4>
          <ul className="space-y-1.5 text-sm">
            {[tf.copiedItems.days(s.days), tf.copiedItems.items(s.items, s.places), tf.copiedItems.details, tf.copiedItems.dates].map((line) => (
              <li key={line} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{tf.notCopied}</h4>
          <ul className="space-y-1.5 text-sm text-muted">
            {tf.notCopiedItems.map((line) => (
              <li key={line} className="flex gap-2">
                <X className="mt-0.5 size-4 shrink-0" /> {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-5 rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
        {tf.note.before} <b>{t.labels.visibility.PRIVATE.label}</b> {tf.note.after(trip.title, trip.owner.username)}
      </p>
      <Button
        size="lg"
        variant="accent"
        className="mt-5 w-full"
        disabled={fork.isPending}
        onClick={async () => {
          const created = await fork.run(undefined);
          if (!created) return;
          onClose();
          router.push(`/trips/${created.id}`);
        }}
      >
        <GitFork className="size-5" /> {fork.isPending ? tf.copying : tf.makeItMine}
      </Button>
    </Sheet>
  );
}
