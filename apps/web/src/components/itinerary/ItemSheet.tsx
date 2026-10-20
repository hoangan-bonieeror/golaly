"use client";

import { createItemSchema, ITEM_SLOTS, localizeMessage, slotForTime, type ItemSlot, type ItemView, type ItineraryItemType, type PlaceView, type TripDetail } from "@golaly/shared";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, usePlaceSearch } from "@/lib/api/queries";
import { useDebounced } from "@/lib/hooks";
import { Button, Field, Sheet, SheetActions, cx, inputCls } from "../ui";
import { ItemTypeIcon, TYPE_META } from "./ItemTypeIcon";

const TYPES: ItineraryItemType[] = ["PLACE", "RESTAURANT", "HOTEL", "ACTIVITY", "FLIGHT", "TRANSPORTATION", "NOTE"];

/**
 * Add / edit a plan item (spec §13, flexible plans). Optimised for few taps:
 * pick a type → pick a place (title auto-fills) → a day and part of the day (or the ideas pool) → Add.
 * A clock time is optional and only for anchors (flights, tours, reservations); it decides the part of the day.
 */
type Props = {
  open: boolean;
  onClose: () => void;
  trip: TripDetail;
  defaultDayId?: string;
  defaultSlot?: ItemSlot;
  /** Start in the ideas pool. */
  pool?: boolean;
  item?: ItemView | null;
};

const POOL = "";

/** Mounted only while open (and re-mounted per item), so the form always starts from the right values. */
export function ItemSheet(props: Props) {
  return props.open ? <ItemSheetBody key={props.item?.id ?? `new:${props.pool ? "pool" : (props.defaultDayId ?? "")}:${props.defaultSlot ?? ""}`} {...props} /> : null;
}

function ItemSheetBody({ open, onClose, trip, defaultDayId, defaultSlot, pool, item }: Props) {
  const { m: t, locale } = useI18n();
  const tx = t.trips.item;
  const [type, setType] = useState<ItineraryItemType>(item?.type ?? "PLACE");
  /** A day id, or POOL ("") for the ideas pool. */
  const [dayId, setDayId] = useState(item ? (item.dayId ?? POOL) : pool ? POOL : (defaultDayId ?? trip.days[0]?.id ?? POOL));
  const [slot, setSlot] = useState<ItemSlot>(item?.dayId ? item.slot : (defaultSlot ?? "ANY"));
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
  const inPool = dayId === POOL;
  const create = useAction((body: object) => (inPool ? api.post<ItemView>(`/trips/${trip.id}/pool`, body) : api.post<ItemView>(`/days/${dayId}/items`, body)), {
    invalidate,
    success: () => (inPool ? tx.addedToPool : tx.addedToDay(trip.days.find((d) => d.id === dayId)?.dayNumber ?? 1)),
  });
  const update = useAction(
    async (body: object) => {
      const target = inPool ? null : dayId;
      // Moving first means the edit lands with the right rules (a pool item has no time).
      if ((item!.dayId ?? POOL) !== dayId) await api.post(`/items/${item!.id}/reorder`, { dayId: target, index: 9_999, ...(target ? { slot } : {}) });
      return api.patch<ItemView>(`/items/${item!.id}`, body);
    },
    { invalidate, success: tx.updated },
  );
  // A clock time puts the item in its part of the day.
  const effectiveSlot: ItemSlot = startTime ? slotForTime(startTime) : slot;

  const list = suggestions.data ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      type,
      title: title.trim() || place?.name || "",
      placeId: type === "NOTE" ? null : (place?.id ?? null),
      ...(inPool ? {} : { startTime: startTime || null, endTime: endTime || null, slot: effectiveSlot }),
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
                onClick={() => {
                  setType(ty);
                  // Notes belong on a day.
                  if (ty === "NOTE" && dayId === POOL) setDayId(defaultDayId ?? trip.days[0]?.id ?? POOL);
                }}
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

        <Field label={tx.day}>
          <select className={inputCls} value={dayId} onChange={(e) => setDayId(e.target.value)}>
            {type !== "NOTE" && <option value={POOL}>{tx.toPool}</option>}
            {trip.days.map((d) => (
              <option key={d.id} value={d.id}>
                {t.trips.day(d.dayNumber)}
              </option>
            ))}
          </select>
        </Field>

        {inPool ? (
          <p className="rounded-xl bg-sand-2 px-3 py-2.5 text-sm text-ink-2">{tx.poolNoTime}</p>
        ) : (
          <>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-2">{tx.slot}</legend>
              <div role="radiogroup" aria-label={tx.slot} className="grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1 sm:grid-cols-4">
                {ITEM_SLOTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={effectiveSlot === s}
                    disabled={!!startTime}
                    onClick={() => setSlot(s)}
                    className={cx("h-9 rounded-[9px] text-[13px] font-semibold disabled:cursor-not-allowed", effectiveSlot === s ? "bg-surface text-ink shadow-card" : "text-ink-2 enabled:hover:text-ink disabled:opacity-50")}
                  >
                    {t.trips.plan.slots[s]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-2">{tx.fixedTime}</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tx.start}>
                  <input className={inputCls} type="time" value={startTime} onChange={(e) => setStart(e.target.value)} />
                </Field>
                <Field label={tx.end}>
                  <input className={inputCls} type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} />
                </Field>
              </div>
              <p className="mt-1.5 text-xs text-muted">{tx.fixedTimeHint}</p>
            </fieldset>
          </>
        )}

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
        <SheetActions>
          <Button type="submit" size="lg" className="w-full" disabled={create.isPending || update.isPending}>
            {item ? t.common.saveChanges : tx.add}
          </Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
