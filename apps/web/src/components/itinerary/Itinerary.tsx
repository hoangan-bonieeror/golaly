"use client";

import type { ItemView, TripDetail } from "@triply/shared";
import { ArrowDown, ArrowUp, CalendarPlus, Copy, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { cx, timeAgo } from "../ui";
import { ItemSheet } from "./ItemSheet";
import { ItemTypeIcon } from "./ItemTypeIcon";

export function Itinerary({
  trip,
  selectedId,
  onSelect,
}: {
  trip: TripDetail;
  selectedId?: string | null;
  onSelect?: (item: ItemView) => void;
}) {
  const me = useMe().data;
  const days = trip.days;
  const may = (a: string) => trip.permissions.includes(a as never);
  const canEdit = may("itinerary.edit");
  const canAdd = may("itinerary.add");
  const [sheet, setSheet] = useState<{ open: boolean; dayId?: string; item?: ItemView | null }>({ open: false });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const invalidate = [keys.trip(trip.id), ["trips"]];
  const reorder = useAction((a: { id: string; dayId: string; index: number }) => api.post(`/items/${a.id}/reorder`, { dayId: a.dayId, index: a.index }), { invalidate });
  const duplicate = useAction((id: string) => api.post(`/items/${id}/duplicate`), { invalidate, success: "Item duplicated" });
  const remove = useAction((id: string) => api.delete(`/items/${id}`), { invalidate, success: "Item removed" });
  const addDay = useAction(() => api.post(`/trips/${trip.id}/days`), { invalidate, success: "Day added" });

  const drop = (dayId: string, index: number) => {
    if (dragId) void reorder.run({ id: dragId, dayId, index });
    setDragId(null);
    setOverKey(null);
  };

  return (
    <div className="space-y-8">
      {days.map((day) => {
        const items = day.items;
        return (
          <section key={day.id} aria-labelledby={`day-${day.id}`}>
            <header className="sticky top-[100px] z-10 -mx-1 mb-2 flex items-baseline gap-3 bg-sand/90 px-1 py-2 backdrop-blur md:top-0">
              <h2 id={`day-${day.id}`} className="font-display text-xl font-semibold">
                Day {day.dayNumber}
              </h2>
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
                const place = it.place;
                const editor = it.updatedBy && it.updatedBy.id !== me?.id ? it.updatedBy : null;
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
                              onDuplicate={() => duplicate.run(it.id)}
                              onMove={(dir) => reorder.run({ id: it.id, dayId: day.id, index: idx + dir })}
                              onDelete={() => remove.run(it.id)}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {canAdd && (
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

      {canAdd && (
        <button
          disabled={addDay.isPending}
          onClick={() => addDay.run(undefined)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sand-2 text-sm font-semibold text-ink-2 hover:bg-line"
        >
          <CalendarPlus className="size-4" /> Add another day
        </button>
      )}

      {/* One-hand mobile FAB */}
      {canAdd && (
        <button
          onClick={() => setSheet({ open: true, dayId: days[0]?.id })}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-lagoon px-5 font-semibold text-white shadow-pop md:hidden"
        >
          <Plus className="size-5" /> Add item
        </button>
      )}

      <ItemSheet open={sheet.open} onClose={() => setSheet({ open: false })} trip={trip} defaultDayId={sheet.dayId} item={sheet.item} />
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
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    // Keyboard users land on the first action.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const dismiss = () => {
    setOpen(false);
    button.current?.focus();
  };
  /** WAI-ARIA menu keys: ↑/↓ (wrapping), Home/End, Escape closes and returns focus, Tab closes. */
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    } else if (e.key === "Tab") setOpen(false);
  };
  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean, disabled?: boolean) => (
    <button
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
        fn();
      }}
      className={cx("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-sand-2 focus:bg-sand-2 focus:outline-none disabled:opacity-40 md:min-h-0", danger ? "text-danger" : "text-ink-2")}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative -mr-1.5 -mt-1">
      <button
        ref={button}
        aria-label="Item actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-sand-2 hover:text-ink md:size-8"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Item actions" onKeyDown={onMenuKey} className="animate-rise absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-line bg-surface p-1 shadow-pop">
          {item(<Pencil className="size-4" />, "Edit", onEdit)}
          {item(<Copy className="size-4" />, "Duplicate", onDuplicate)}
          {item(<ArrowUp className="size-4" />, "Move up", () => onMove(-1), false, first)}
          {item(<ArrowDown className="size-4" />, "Move down", () => onMove(1), false, last)}
          <div role="separator" className="my-1 h-px bg-line" />
          {item(<Trash2 className="size-4" />, "Delete", onDelete, true)}
        </div>
      )}
    </div>
  );
}
