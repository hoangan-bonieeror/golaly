"use client";

import { ITEM_TYPE_LABEL, type PlaceView } from "@triply/shared";
import { Bookmark, Star } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction, useMe } from "@/lib/api/queries";
import { ItemTypeIcon } from "../itinerary/ItemTypeIcon";
import { cx } from "../ui";

export function PlaceRow({ place }: { place: PlaceView }) {
  const me = useMe().data;
  const save = useAction((on: boolean) => (on ? api.post<PlaceView>(`/places/${place.id}/save`) : api.delete<PlaceView>(`/places/${place.id}/save`)), {
    invalidate: [["places"], ["explore"], ["search"], ["destination"]],
    success: (r) => (r.savedByMe ? "Place saved" : "Removed from saved"),
  });
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <ItemTypeIcon type={place.category} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{place.name}</div>
        <div className="truncate text-xs text-muted">
          {ITEM_TYPE_LABEL[place.category]} · {place.destinationName}
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
          aria-label={place.savedByMe ? "Remove place from saved" : "Save place"}
          aria-pressed={place.savedByMe}
          disabled={save.isPending}
          onClick={() => save.run(!place.savedByMe)}
          className="flex size-9 items-center justify-center rounded-full hover:bg-sand-2"
        >
          <Bookmark className={cx("size-4", place.savedByMe && "fill-sunset text-sunset")} />
        </button>
      )}
    </div>
  );
}
