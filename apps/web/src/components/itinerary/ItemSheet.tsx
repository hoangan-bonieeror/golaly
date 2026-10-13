"use client";

import { createItemSchema, localizeMessage, type ItemView, type ItineraryItemType, type PlaceView, type TripDetail } from "@triply/shared";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, usePlaceSearch } from "@/lib/api/queries";
import { useDebounced } from "@/lib/hooks";
import { Button, Field, Sheet, cx, inputCls } from "../ui";
import { ItemTypeIcon, TYPE_META } from "./ItemTypeIcon";

const TYPES: ItineraryItemType[] = ["PLACE", "RESTAURANT", "HOTEL", "ACTIVITY", "FLIGHT", "TRANSPORTATION", "NOTE"];

/**
 * Add / edit itinerary item (spec §13). Optimised for few taps:
 * pick a type → pick a place (title auto-fills) → optional time → Add.
 */
type Props = {
  open: boolean;
  onClose: () => void;
  trip: TripDetail;
  defaultDayId?: string;
  item?: ItemView | null;
};

/** Mounted only while open (and re-mounted per item), so the form always starts from the right values. */
export function ItemSheet(props: Props) {
  return props.open ? <ItemSheetBody key={props.item?.id ?? `new:${props.defaultDayId ?? ""}`} {...props} /> : null;
}

function ItemSheetBody({ open, onClose, trip, defaultDayId, item }: Props) {
  const { m: t, locale } = useI18n();
  const tx = t.trips.item;
  const [type, setType] = useState<ItineraryItemType>(item?.type ?? "PLACE");
  const [dayId, setDayId] = useState(item?.dayId ?? defaultDayId ?? trip.days[0]?.id ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [place, setPlace] = useState<PlaceView | null>(item?.place ?? null);
  const [startTime, setStart] = useState(item?.startTime ?? "");
  const [endTime, setEnd] = useState(item?.endTime ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const debouncedQ = useDebounced(q, 200);
  const suggestions = usePlaceSearch(debouncedQ, trip.id);

  const invalidate = [keys.trip(trip.id), ["trips"]];
  const create = useAction((body: object) => api.post<ItemView>(`/days/${dayId}/items`, body), { invalidate, success: () => tx.addedToDay(trip.days.find((d) => d.id === dayId)?.dayNumber ?? 1) });
  const update = useAction(
    async (body: object) => {
      const updated = await api.patch<ItemView>(`/items/${item!.id}`, body);
      if (item!.dayId !== dayId) await api.post(`/items/${item!.id}/reorder`, { dayId, index: 999 });
      return updated;
    },
    { invalidate, success: tx.updated },
  );

  const list = suggestions.data ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      type,
      title: title.trim() || place?.name || "",
      placeId: type === "NOTE" ? null : (place?.id ?? null),
      startTime: startTime || null,
      endTime: endTime || null,
      notes: type === "NOTE" ? null : notes.trim() || null,
    };
    // Same schema the API enforces.
    const parsed = createItemSchema.safeParse(payload);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message;
      return setError(msg ? localizeMessage(msg, locale) : type === "NOTE" ? tx.writeNote : tx.needTitle);
    }
    const ok = item ? await update.run(payload) : await create.run(payload);
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={item ? tx.editTitle : tx.addTitle}>
      <form onSubmit={submit} className="space-y-5">
        <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0" role="radiogroup" aria-label={tx.type}>
          {TYPES.map((ty) => {
            const Icon = TYPE_META[ty].icon;
            return (
              <button
                type="button"
                key={ty}
                role="radio"
                aria-checked={type === ty}
                onClick={() => setType(ty)}
                className={cx(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                  type === ty ? "border-ink bg-ink text-on-ink" : "border-line text-ink-2 hover:border-ink-2",
                )}
              >
                <Icon className="size-4" />
                {t.labels.itemType[ty]}
              </button>
            );
          })}
        </div>

        {type !== "NOTE" && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink-2">{tx.place}</span>
            {place ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary bg-primary-50/60 p-2.5">
                <ItemTypeIcon type={place.category} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{place.name}</div>
                  <div className="truncate text-xs text-muted">{place.address}</div>
                </div>
                <button type="button" onClick={() => setPlace(null)} aria-label={tx.clearPlace} className="rounded-full p-1.5 hover:bg-surface">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <input className={cx(inputCls, "pl-9")} placeholder={tx.searchPlaces} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx.searchPlaces} />
                </div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto" aria-busy={suggestions.isFetching}>
                  {list.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setPlace(p);
                        if (!title) setTitle(p.name);
                        if (type === "PLACE" && p.category !== "PLACE") setType(p.category);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-sand-2"
                    >
                      <ItemTypeIcon type={p.category} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {p.address} · {p.destinationName}
                        </span>
                      </span>
                    </button>
                  ))}
                  {!suggestions.isFetching && list.length === 0 && <p className="px-2 py-2 text-xs text-muted">{tx.noMatches}</p>}
                </div>
              </>
            )}
          </div>
        )}

        <Field label={type === "NOTE" ? tx.note : tx.title}>
          <input className={inputCls} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={type === "NOTE" ? tx.notePlaceholder : (place?.name ?? tx.titlePlaceholder)} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label={tx.day}>
            <select className={inputCls} value={dayId} onChange={(e) => setDayId(e.target.value)}>
              {trip.days.map((d) => (
                <option key={d.id} value={d.id}>
                  {t.trips.day(d.dayNumber)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tx.start}>
            <input className={inputCls} type="time" value={startTime} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={tx.end}>
            <input className={inputCls} type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        {type !== "NOTE" && (
          <Field label={tx.notes} hint={tx.notesHint}>
            <textarea className={cx(inputCls, "h-20 py-2.5")} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tx.notesPlaceholder} />
          </Field>
        )}

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={create.isPending || update.isPending}>
          {item ? t.common.saveChanges : tx.add}
        </Button>
      </form>
    </Sheet>
  );
}
