"use client";

import { ITEM_TYPE_LABEL, type ItineraryItem, type ItineraryItemType, type UUID } from "@triply/shared";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { tripDays } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";
import { Button, Field, Sheet, cx, inputCls } from "../ui";
import { ItemTypeIcon, TYPE_META } from "./ItemTypeIcon";

const TYPES: ItineraryItemType[] = ["PLACE", "RESTAURANT", "HOTEL", "ACTIVITY", "FLIGHT", "TRANSPORTATION", "NOTE"];

/**
 * Add / edit itinerary item (spec §13). Optimised for few taps:
 * pick a type → pick a place (title auto-fills) → optional time → Add.
 */
export function ItemSheet({
  open,
  onClose,
  tripId,
  defaultDayId,
  item,
}: {
  open: boolean;
  onClose: () => void;
  tripId: UUID;
  defaultDayId?: UUID;
  item?: ItineraryItem | null;
}) {
  const { db, actions, toast } = useStore();
  const trip = db.trips.find((t) => t.id === tripId)!;
  const days = tripDays(db, tripId);

  const [type, setType] = useState<ItineraryItemType>("PLACE");
  const [dayId, setDayId] = useState<UUID>("");
  const [title, setTitle] = useState("");
  const [placeId, setPlaceId] = useState<UUID | undefined>();
  const [startTime, setStart] = useState("");
  const [endTime, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setType(item?.type ?? "PLACE");
    setDayId(item?.dayId ?? defaultDayId ?? days[0]?.id ?? "");
    setTitle(item?.title ?? "");
    setPlaceId(item?.placeId);
    setStart(item?.startTime ?? "");
    setEnd(item?.endTime ?? "");
    setNotes(item?.notes ?? "");
    setQ("");
    setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const place = db.places.find((p) => p.id === placeId);
  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    return db.places
      .filter((p) => (s ? p.name.toLowerCase().includes(s) || p.address.toLowerCase().includes(s) : trip.destinationIds.includes(p.destinationId)))
      .filter((p) => type === "NOTE" || type === "PLACE" || p.category === type || s)
      .sort((a, b) => Number(trip.destinationIds.includes(b.destinationId)) - Number(trip.destinationIds.includes(a.destinationId)))
      .slice(0, 6);
  }, [db.places, q, trip.destinationIds, type]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = title.trim() || place?.name || "";
    if (!finalTitle) return setError(type === "NOTE" ? "Write a note first." : "Add a title or pick a place.");
    if (startTime && endTime && endTime < startTime) return setError("End time should be after the start time.");
    const payload = { type, title: finalTitle, placeId: type === "NOTE" ? undefined : placeId, startTime: startTime || undefined, endTime: endTime || undefined, notes: notes.trim() || undefined };
    if (item) {
      if (!actions.updateItem(item.id, payload)) return;
      if (item.dayId !== dayId) actions.reorderItem(item.id, { dayId, index: 999 });
      toast("Item updated");
    } else {
      const created = actions.addItem(dayId, payload);
      if (!created) return;
      toast(`Added to Day ${days.find((d) => d.id === dayId)?.dayNumber}`);
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={item ? "Edit item" : "Add to itinerary"}>
      <form onSubmit={submit} className="space-y-5">
        <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0" role="radiogroup" aria-label="Type">
          {TYPES.map((t) => {
            const Icon = TYPE_META[t].icon;
            return (
              <button
                type="button"
                key={t}
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cx(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                  type === t ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-ink-2",
                )}
              >
                <Icon className="size-4" />
                {ITEM_TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>

        {type !== "NOTE" && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink-2">Place</span>
            {place ? (
              <div className="flex items-center gap-3 rounded-xl border border-lagoon bg-lagoon-50/60 p-2.5">
                <ItemTypeIcon type={place.category} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{place.name}</div>
                  <div className="truncate text-xs text-muted">{place.address}</div>
                </div>
                <button type="button" onClick={() => setPlaceId(undefined)} aria-label="Clear place" className="rounded-full p-1.5 hover:bg-surface">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <input className={cx(inputCls, "pl-9")} placeholder="Search places" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {suggestions.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setPlaceId(p.id);
                        if (!title) setTitle(p.name);
                        if (type === "PLACE" && p.category !== "PLACE") setType(p.category);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-sand-2"
                    >
                      <ItemTypeIcon type={p.category} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted">{p.address}</span>
                      </span>
                    </button>
                  ))}
                  {suggestions.length === 0 && <p className="px-2 py-2 text-xs text-muted">No matches — you can still add it with a custom title.</p>}
                </div>
              </>
            )}
          </div>
        )}

        <Field label={type === "NOTE" ? "Note" : "Title"}>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "NOTE" ? "e.g. Free afternoon" : place?.name ?? "e.g. Lunch"} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Day">
            <select className={inputCls} value={dayId} onChange={(e) => setDayId(e.target.value)}>
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  Day {d.dayNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start">
            <input className={inputCls} type="time" value={startTime} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End">
            <input className={inputCls} type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        {type !== "NOTE" && (
          <Field label="Notes" hint="Visible to everyone on the trip.">
            <textarea className={cx(inputCls, "h-20 py-2.5")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tickets, reservations, tips…" />
          </Field>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full">
          {item ? "Save changes" : "Add to itinerary"}
        </Button>
      </form>
    </Sheet>
  );
}
