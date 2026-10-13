"use client";

import type { PlaceView } from "@triply/shared";
import { Bookmark, Star } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { useAction, useMe } from "@/lib/api/queries";
import { useI18n, useT } from "@/i18n/client";
import { AddToTripButton } from "../place/AddToTripSheet";
import { CategoryIcon, formatDistance } from "../place/categoryMeta";
import { cx } from "../ui";

/**
 * A place in a list: opens the place page, and can be saved or added to a trip in place.
 * The whole card is the link (stretched ::after); the buttons sit above it.
 */
export function PlaceRow({ place, index, active, onHover }: { place: PlaceView; index?: number; active?: boolean; onHover?: (id: string | null) => void }) {
  const me = useMe().data;
  const t = useT();
  const { locale } = useI18n();
  const save = useAction((on: boolean) => (on ? api.post<PlaceView>(`/places/${place.id}/save`) : api.delete<PlaceView>(`/places/${place.id}/save`)), {
    invalidate: [["places"], ["explore"], ["search"], ["destination"]],
    success: (r) => (r.savedByMe ? t.social.place.saved : t.social.place.unsaved),
  });
  const distance = formatDistance(place.distanceM, locale);
  return (
    <div
      className={cx(
        "relative flex min-w-0 items-center gap-3 rounded-2xl border bg-surface p-3 transition-colors hover:border-ink-2 has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-primary",
        active ? "border-ink-2" : "border-line",
      )}
      onMouseEnter={onHover && (() => onHover(place.id))}
      onMouseLeave={onHover && (() => onHover(null))}
    >
      <div className="relative">
        {place.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={place.photo.thumbUrl}
            alt=""
            title={place.photo.credit}
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            className="size-10 shrink-0 rounded-xl object-cover"
            style={{ backgroundColor: place.photo.color ?? undefined }}
          />
        ) : (
          <CategoryIcon categoryKey={place.categoryKey} />
        )}
        {index !== undefined && (
          <span className="absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-on-ink" aria-hidden>
            {index}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link href={`/places/${place.id}`} className="block truncate font-semibold after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none">
          {place.name}
        </Link>
        <div className="truncate text-xs text-muted">
          {place.localName && <span className="text-ink-2">{place.localName} · </span>}
          {place.categoryLabel}
          {place.destinationName && ` · ${place.destinationName}`}
        </div>
        {(place.rating || distance) && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-2">
            {place.rating && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="size-3 fill-gold text-gold" aria-hidden />
                <span className="sr-only">{t.social.place.rated}</span>
                {place.rating}
              </span>
            )}
            {distance && <span>{t.social.place.away(distance)}</span>}
          </div>
        )}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {me && (
          <button
            aria-label={place.savedByMe ? t.social.place.unsave(place.name) : t.social.place.save(place.name)}
            aria-pressed={place.savedByMe}
            disabled={save.isPending}
            onClick={() => save.run(!place.savedByMe)}
            className="relative flex size-9 items-center justify-center rounded-full hover:bg-sand-2 before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
          >
            <Bookmark className={cx("size-4", place.savedByMe && "fill-accent text-accent-700")} />
          </button>
        )}
        <AddToTripButton place={place} iconOnly />
      </div>
    </div>
  );
}
