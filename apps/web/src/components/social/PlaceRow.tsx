"use client";

import { ITEM_TYPE_LABEL, type Place } from "@triply/shared";
import { Bookmark, Star } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { cx } from "../ui";
import { ItemTypeIcon } from "../itinerary/ItemTypeIcon";

export function PlaceRow({ place }: { place: Place }) {
  const { db, me, actions, toast } = useStore();
  const saved = db.savedPlaces.some((s) => s.userId === me && s.placeId === place.id);
  const dest = db.destinations.find((d) => d.id === place.destinationId);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <ItemTypeIcon type={place.category} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{place.name}</div>
        <div className="truncate text-xs text-muted">
          {ITEM_TYPE_LABEL[place.category]} · {dest?.name}
          {place.rating && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-ink-2">
              <Star className="size-3 fill-gold text-gold" />
              {place.rating}
            </span>
          )}
        </div>
      </div>
      {me && (
        <button
          aria-label={saved ? "Remove place from saved" : "Save place"}
          aria-pressed={saved}
          onClick={() => {
            const r = actions.toggleSavePlace(place.id);
            if (r !== undefined) toast(r ? "Place saved" : "Removed from saved");
          }}
          className="flex size-9 items-center justify-center rounded-full hover:bg-sand-2"
        >
          <Bookmark className={cx("size-4", saved && "fill-sunset text-sunset")} />
        </button>
      )}
    </div>
  );
}
