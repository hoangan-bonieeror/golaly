"use client";

import type { ItineraryItem, UUID } from "@triply/shared";
import { ArrowDown, ArrowUp, CalendarPlus, Copy, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dayItems, tripDays, userById } from "@/lib/mock/selectors";
import { usePermissions } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { cx, timeAgo } from "../ui";
import { ItemSheet } from "./ItemSheet";
import { ItemTypeIcon } from "./ItemTypeIcon";

export function Itinerary({
  tripId,
  selectedId,
  onSelect,
}: {
  tripId: UUID;
  selectedId?: UUID | null;
  onSelect?: (item: ItineraryItem) => void;
}) {
  const { db, me, actions, toast } = useStore();
  const perm = usePermissions(tripId);
  const days = tripDays(db, tripId);
  const canEdit = perm.can("itinerary.edit");
  const [sheet, setSheet] = useState<{ open: boolean; dayId?: UUID; item?: ItineraryItem | null }>({ open: false });
  const [dragId, setDragId] = useState<UUID | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const drop = (dayId: UUID, index: number) => {
    if (dragId) actions.reorderItem(dragId, { dayId, index });
    setDragId(null);
    setOverKey(null);
  };

  return (
    <div className="space-y-8">
      {days.map((day) => {
        const items = dayItems(db, day.id);
        return (
          <section key={day.id} aria-labelledby={`day-${day.id}`}>
            <header className="sticky top-14 z-10 -mx-1 mb-2 flex items-baseline gap-3 bg-sand/90 px-1 py-2 backdrop-blur md:top-0">
              <h3 id={`day-${day.id}`} className="font-display text-xl font-semibold">
                Day {day.dayNumber}
              </h3>
              <span className="text-sm text-muted">
                {day.date && new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                {day.title && ` · ${day.title}`}
              </span>
            </header>

            <ol
              className="relative"
              onDragOver={(e) => {
                if (dragId && items.length === 0) {
                  e.preventDefault();
                  setOverKey(`${day.id}:0`);
                }
              }}
              onDrop={() => items.length === 0 && drop(day.id, 0)}
            >
              {items.length === 0 && (
                <li className={cx("rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted", overKey === `${day.id}:0` && "border-lagoon bg-lagoon-50")}>
                  Nothing planned yet.
                </li>
              )}
              {items.map((it, idx) => {
                const place = db.places.find((p) => p.id === it.placeId);
                const editor = it.updatedBy && it.updatedBy !== me ? userById(db, it.updatedBy) : null;
                return (
                  <li
                    key={it.id}
                    draggable={canEdit}
                    onDragStart={() => setDragId(it.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverKey(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setOverKey(`${day.id}:${idx}`);
                    }}
                    onDrop={() => drop(day.id, idx)}
                    className={cx("group relative flex gap-3", dragId === it.id && "opacity-40")}
                  >
                    {overKey === `${day.id}:${idx}` && dragId !== it.id && <span className="absolute -top-1 left-16 right-0 h-0.5 rounded bg-lagoon" />}
                    <div className="w-12 shrink-0 pt-3 text-right text-sm font-semibold tabular-nums text-ink-2">{it.startTime ?? ""}</div>
                    <div className="relative flex flex-col items-center">
                      {items.length > 1 && (
                        <span
                          className="absolute w-px bg-line"
                          style={idx === items.length - 1 ? { top: 0, height: 24 } : { top: idx === 0 ? 24 : 0, bottom: 0 }}
                        />
                      )}
                      <div className="relative mt-1.5">
                        <ItemTypeIcon type={it.type} size="sm" />
                      </div>
                    </div>
                    <div
                      onClick={() => onSelect?.(it)}
                      className={cx(
                        "mb-2.5 min-w-0 flex-1 cursor-pointer rounded-2xl border bg-surface px-3.5 py-2.5 transition-colors",
                        selectedId === it.id ? "border-lagoon ring-2 ring-lagoon/15" : "border-line hover:border-ink-2/40",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect?.(it);
                            }}
                            className="text-left font-semibold leading-snug hover:underline"
                            aria-label={`Show ${it.title} on map`}
                          >
                            {it.title}
                          </button>
                          {place && place.name !== it.title && <div className="truncate text-xs text-muted">{place.name}</div>}
                          {!place && it.type !== "NOTE" && <div className="text-xs text-muted">Custom</div>}
                          {it.endTime && <div className="text-xs text-muted">until {it.endTime}</div>}
                          {it.notes && <p className="mt-1.5 rounded-lg bg-sand px-2 py-1 text-[13px] text-ink-2">{it.notes}</p>}
                          {editor && it.updatedAt && (
                            <p className="mt-1.5 text-[11px] text-muted">
                              Edited by {editor.displayName} · {timeAgo(it.updatedAt)}
                            </p>
                          )}
                        </div>
                        {canEdit && (
                          <>
                            <GripVertical className="mt-0.5 hidden size-4 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100 md:block" aria-hidden />
                            <ItemMenu
                              first={idx === 0}
                              last={idx === items.length - 1}
                              onEdit={() => setSheet({ open: true, item: it })}
                              onDuplicate={() => {
                                actions.duplicateItem(it.id);
                                toast("Item duplicated");
                              }}
                              onMove={(dir) => actions.reorderItem(it.id, { dayId: day.id, index: idx + dir })}
                              onDelete={() => {
                                actions.deleteItem(it.id);
                                toast("Item removed");
                              }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {perm.can("itinerary.add") && (
              <button
                onClick={() => setSheet({ open: true, dayId: day.id })}
                className="ml-[60px] mt-1 flex h-11 w-[calc(100%-60px)] items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-lagoon hover:border-lagoon hover:bg-lagoon-50/60"
              >
                <Plus className="size-4" /> Add to Day {day.dayNumber}
              </button>
            )}
          </section>
        );
      })}

      {perm.can("itinerary.add") && (
        <button
          onClick={() => {
            actions.addDay(tripId);
            toast("Day added");
          }}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sand-2 text-sm font-semibold text-ink-2 hover:bg-line"
        >
          <CalendarPlus className="size-4" /> Add another day
        </button>
      )}

      {/* One-hand mobile FAB */}
      {perm.can("itinerary.add") && (
        <button
          onClick={() => setSheet({ open: true, dayId: days[0]?.id })}
          className="fixed bottom-20 left-1/2 z-30 flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-lagoon px-5 font-semibold text-white shadow-pop md:hidden"
        >
          <Plus className="size-5" /> Add item
        </button>
      )}

      <ItemSheet open={sheet.open} onClose={() => setSheet({ open: false })} tripId={tripId} defaultDayId={sheet.dayId} item={sheet.item} />
    </div>
  );
}

function ItemMenu({
  first,
  last,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
}: {
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean, disabled?: boolean) => (
    <button
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        fn();
      }}
      className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sand-2 disabled:opacity-40", danger ? "text-danger" : "text-ink-2")}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative -mr-1.5 -mt-1">
      <button
        aria-label="Item actions"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-sand-2 hover:text-ink"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="animate-rise absolute right-0 top-9 z-20 w-44 rounded-xl border border-line bg-surface p-1 shadow-pop">
          {item(<Pencil className="size-4" />, "Edit", onEdit)}
          {item(<Copy className="size-4" />, "Duplicate", onDuplicate)}
          {item(<ArrowUp className="size-4" />, "Move up", () => onMove(-1), false, first)}
          {item(<ArrowDown className="size-4" />, "Move down", () => onMove(1), false, last)}
          <div className="my-1 h-px bg-line" />
          {item(<Trash2 className="size-4" />, "Delete", onDelete, true)}
        </div>
      )}
    </div>
  );
}
