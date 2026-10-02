"use client";

import type { UUID } from "@triply/shared";
import { Check, GitFork, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { tripStats, userById } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";
import { Button, Sheet } from "../ui";

/** "Use This Trip" confirmation — makes the fork contract explicit (spec §20). */
export function ForkSheet({ open, onClose, tripId }: { open: boolean; onClose: () => void; tripId: UUID }) {
  const { db, actions, toast } = useStore();
  const router = useRouter();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return null;
  const s = tripStats(db, trip);
  const owner = userById(db, trip.ownerId);

  const fork = () => {
    const created = actions.forkTrip(tripId);
    if (!created) return;
    onClose();
    toast("Trip copied — it's yours to edit");
    router.push(`/trips/${created.id}`);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Use this trip">
      <p className="text-sm text-ink-2">
        We&apos;ll make your own private copy of <b>{trip.title}</b> by {owner?.displayName}. Change anything — the original stays exactly as it is.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-lagoon">Copied</h4>
          <ul className="space-y-1.5 text-sm">
            {[`${s.days} days of itinerary`, `${s.items} items & ${s.places} places`, "Title, description & destinations", "Dates (you can change them)"].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-lagoon" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Not copied</h4>
          <ul className="space-y-1.5 text-sm text-muted">
            {["Members & permissions", "Comments & private media", "Likes, saves & forks"].map((t) => (
              <li key={t} className="flex gap-2">
                <X className="mt-0.5 size-4 shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-5 rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
        Your copy starts <b>Private</b> and shows “Based on {trip.title} by @{owner?.username}”.
      </p>
      <Button size="lg" variant="accent" className="mt-5 w-full" onClick={fork}>
        <GitFork className="size-5" /> Make it mine
      </Button>
    </Sheet>
  );
}
