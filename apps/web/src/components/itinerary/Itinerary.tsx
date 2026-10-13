"use client";

import { ITEM_TYPE_LABEL, type ItemView, type TripDetail } from "@triply/shared";
import { ArrowDown, ArrowUp, CalendarPlus, Copy, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { dayColor, dayLegs, dayStats, formatKm, legLabel } from "@/lib/trip-geo";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { cx, timeAgo } from "../ui";
import type { DayFilter } from "../trip/DayBar";
import { ItemTypeIcon } from "./ItemTypeIcon";

/**
 * The itinerary column of the planner (Atlas): one section per day, numbered stops in the day's
 * colour, and an estimated travel leg between consecutive places. The page owns the day filter,
 * the selection (shared with the map) and the add/edit sheet.
 */
export function Itinerary({
  trip,
  day = "all",
  selectedId,
  onSelect,
  onAdd,
  onEdit,
}: {
  trip: TripDetail;
  day?: DayFilter;
  selectedId?: string | null;
  onSelect?: (item: ItemView) => void;
  onAdd?: (dayId: string) => void;
  onEdit?: (item: ItemView) => void;
}) {
  const me = useMe().data;
  const days = day === "all" ? trip.days : trip.days.filter((d) => d.dayNumber === day);
  const may = (a: string) => trip.permissions.includes(a as never);
  const canEdit = may("itinerary.edit");
  const canAdd = may("itinerary.add");
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
      {days.map((d) => {
        const items = d.items;
        const color = dayColor(d.dayNumber);
        const legs = dayLegs(items);
        const stats = dayStats(d);
        let stop = 0;
        return (
          <section key={d.id} aria-labelledby={`day-${d.id}`}>
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id={`day-${d.id}`} className="flex min-w-0 items-baseline gap-2 font-display text-xl font-bold">
                <span aria-hidden className="size-2.5 shrink-0 translate-y-[-2px] self-center rounded-full" style={{ background: color }} />
                <span className="truncate">
                  Day {d.dayNumber}
                  {d.date && <span className="font-semibold text-ink-2"> · {new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>}
                  {d.title && <span className="font-semibold text-ink-2"> · {d.title}</span>}
                </span>
              </h2>
              {stats.stops > 0 && (
                <span className="shrink-0 font-mono text-xs text-muted">
                  {stats.stops} {stats.stops === 1 ? "stop" : "stops"}
                  {stats.km > 0 && ` · ${formatKm(stats.km)}`}
                </span>
              )}
            </header>

            <ol
              className="relative"
              onDragOver={(e) => {
                if (dragId && items.length === 0) {
                  e.preventDefault();
                  setOverKey(`${d.id}:0`);
                }
              }}
              onDrop={() => items.length === 0 && drop(d.id, 0)}
            >
              {items.length === 0 && (
                <li className={cx("rounded-[14px] border border-dashed border-line px-4 py-5 text-center text-sm text-muted", overKey === `${d.id}:0` && "border-primary bg-primary-50")}>
                  Nothing planned yet.
                </li>
              )}
              {items.map((it, idx) => {
                const place = it.place;
                const n = place ? ++stop : null;
                const leg = legs.get(it.id);
                const editor = it.updatedBy && it.updatedBy.id !== me?.id ? it.updatedBy : null;
                const selected = selectedId === it.id;
                const meta = [place ? place.categoryLabel || ITEM_TYPE_LABEL[it.type] : it.type === "NOTE" ? "Note" : `${ITEM_TYPE_LABEL[it.type]} · custom`, place && place.name !== it.title ? place.name : null, it.endTime ? `until ${it.endTime}` : null].filter(Boolean).join(" · ");
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
                      setOverKey(`${d.id}:${idx}`);
                    }}
                    onDrop={() => drop(d.id, idx)}
                    className={cx("group relative", dragId === it.id && "opacity-40")}
                  >
                    {idx > 0 && (
                      <div className="ml-[26px] border-l-2 border-dashed border-line py-1.5 pl-[14px] font-mono text-xs text-muted sm:ml-[62px]" title={leg ? "Estimated from straight-line distance" : undefined}>
                        {leg ? legLabel(leg) : <span aria-hidden>&nbsp;</span>}
                        {leg && <span className="sr-only"> (estimate)</span>}
                      </div>
                    )}
                    {overKey === `${d.id}:${idx}` && dragId !== it.id && <span className="absolute left-0 right-0 top-0 h-0.5 rounded bg-primary sm:left-[62px]" />}
                    <div className="flex items-start gap-3 sm:gap-3.5">
                      <div className="hidden w-12 shrink-0 pt-[15px] text-right font-mono text-[13px] text-ink sm:block">{it.startTime ?? ""}</div>
                      <div
                        onClick={() => onSelect?.(it)}
                        className={cx(
                          "min-w-0 flex-1 cursor-pointer rounded-[14px] border p-3 transition-colors",
                          selected ? "border-primary bg-primary-50 ring-1 ring-primary" : "border-line bg-surface hover:border-ink-2/40",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {n !== null ? (
                            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-semibold text-white" style={{ background: color }}>
                              <span className="sr-only">Stop </span>
                              {n}
                            </span>
                          ) : (
                            <ItemTypeIcon type={it.type} size="sm" />
                          )}
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelect?.(it);
                              }}
                              className="text-left font-semibold leading-snug hover:underline"
                              aria-label={place ? `Show ${it.title} on map` : undefined}
                              aria-pressed={place ? selected : undefined}
                            >
                              {it.title}
                            </button>
                            <div className={cx("truncate text-[13px]", selected ? "text-ink-2" : "text-muted")}>{meta}</div>
                          </div>
                          {it.startTime && <span className="shrink-0 font-mono text-[13px] text-ink sm:hidden">{it.startTime}</span>}
                          {canEdit && (
                            <>
                              <GripVertical className="hidden size-4 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100 md:block" aria-hidden />
                              <ItemMenu
                                first={idx === 0}
                                last={idx === items.length - 1}
                                onEdit={() => onEdit?.(it)}
                                onDuplicate={() => duplicate.run(it.id)}
                                onMove={(dir) => reorder.run({ id: it.id, dayId: d.id, index: idx + dir })}
                                onDelete={() => remove.run(it.id)}
                              />
                            </>
                          )}
                        </div>
                        {it.notes && <p className={cx("mt-2 whitespace-pre-line border-l-2 pl-2.5 text-[13px]", selected ? "border-primary font-semibold text-primary" : "border-line text-ink-2")}>{it.notes}</p>}
                        {editor && it.updatedAt && (
                          <p className="mt-1.5 text-[11px] text-muted">
                            Edited by {editor.displayName} · {timeAgo(it.updatedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {canAdd && (
              <button
                type="button"
                onClick={() => onAdd?.(d.id)}
                className="mt-4 flex h-11 w-full items-center gap-2 rounded-xl border border-dashed border-[#b9ad99] px-3.5 text-left text-sm font-semibold text-primary hover:border-primary hover:bg-primary-50/60 sm:ml-[62px] sm:w-[calc(100%-62px)]"
              >
                <Plus className="size-4 shrink-0" aria-hidden /> Add a place to Day {d.dayNumber}
              </button>
            )}
          </section>
        );
      })}

      {canAdd && day === "all" && (
        <button
          type="button"
          disabled={addDay.isPending}
          onClick={() => addDay.run(undefined)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sand-2 text-sm font-semibold text-ink-2 hover:bg-line"
        >
          <CalendarPlus className="size-4" /> Add another day
        </button>
      )}
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
        className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-sand-2 hover:text-ink md:size-8"
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
