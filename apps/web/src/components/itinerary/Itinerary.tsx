"use client";

import type { ItemView, TripDetail } from "@triply/shared";
import { ArrowDown, ArrowUp, CalendarPlus, Copy, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { dayColor, dayLegs, dayStats, formatKm, legLabel } from "@/lib/trip-geo";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { prefersReducedMotion } from "@/lib/motion";
import { useToast } from "@/lib/toast";
import { useFormat, useI18n, useT } from "@/i18n/client";
import { cx } from "../ui";
import type { DayFilter } from "../trip/DayBar";
import { ItemTypeIcon } from "./ItemTypeIcon";
import { useFlip, useItineraryDrag, type DragState } from "./useItineraryDrag";

/** The trip with one item moved — what the server will answer, applied right away. */
function moveItem(trip: TripDetail, id: string, toDayId: string, toIndex: number): TripDetail {
  const item = trip.days.flatMap((d) => d.items).find((i) => i.id === id);
  if (!item) return trip;
  return {
    ...trip,
    days: trip.days.map((d) => {
      const items = d.items.filter((i) => i.id !== id);
      if (d.id === toDayId) items.splice(Math.min(toIndex, items.length), 0, { ...item, dayId: toDayId });
      return { ...d, items };
    }),
  };
}

/**
 * The itinerary column of the planner (Atlas): one section per day, numbered stops in the day's
 * colour, and an estimated travel leg between consecutive places. The page owns the day filter,
 * the selection (shared with the map) and the add/edit sheet.
 */
export function Itinerary({
  trip,
  day = "all",
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onAdd,
  onEdit,
}: {
  trip: TripDetail;
  day?: DayFilter;
  selectedId?: string | null;
  /** The stop whose pin is under the pointer on the map; `onHover` reports the stop under the pointer here. */
  hoveredId?: string | null;
  onSelect?: (item: ItemView) => void;
  onHover?: (itemId: string | null) => void;
  onAdd?: (dayId: string) => void;
  onEdit?: (item: ItemView) => void;
}) {
  const me = useMe().data;
  const { m: t, locale } = useI18n();
  const f = useFormat();
  const ti = t.trips.itinerary;
  const days = day === "all" ? trip.days : trip.days.filter((d) => d.dayNumber === day);
  const may = (a: string) => trip.permissions.includes(a as never);
  const canEdit = may("itinerary.edit");
  const canAdd = may("itinerary.add");
  const qc = useQueryClient();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [liveMsg, setLiveMsg] = useState("");

  const invalidate = [keys.trip(trip.id), ["trips"]];
  /** Optimistic move: the list (and the map, legs, totals) update at once; the server confirms. */
  const move = async (id: string, dayId: string, index: number) => {
    const key = keys.trip(trip.id);
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) qc.setQueryData(key, moveItem(prev, id, dayId, index));
    try {
      await api.post(`/items/${id}/reorder`, { dayId, index });
    } catch {
      toast(ti.drag.failed, "error");
    } finally {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["trips"] });
    }
  };
  const duplicate = useAction((id: string) => api.post(`/items/${id}/duplicate`), { invalidate, success: ti.duplicated });
  const remove = useAction((id: string) => api.delete(`/items/${id}`), { invalidate, success: ti.removed });
  const addDay = useAction(() => api.post(`/trips/${trip.id}/days`), { invalidate, success: ti.dayAdded });

  const titleOf = (id: string) => trip.days.flatMap((d) => d.items).find((i) => i.id === id)?.title ?? "";
  const dayNo = (dayId: string) => trip.days.find((d) => d.id === dayId)?.dayNumber ?? 0;
  const announce = (kind: "picked" | "moved" | "dropped" | "cancelled", st: DragState) => {
    const total = (trip.days.find((d) => d.id === st.toDay)?.items.filter((i) => i.id !== st.id).length ?? 0) + 1;
    const pos = st.toIndex + 1;
    setLiveMsg(
      kind === "picked"
        ? ti.drag.picked(titleOf(st.id), dayNo(st.toDay), pos, total)
        : kind === "moved"
          ? ti.drag.moved(dayNo(st.toDay), pos, total)
          : kind === "dropped"
            ? ti.drag.dropped(titleOf(st.id), dayNo(st.toDay), pos)
            : ti.drag.cancelled(titleOf(st.id)),
    );
  };
  const dnd = useItineraryDrag({
    lists: days.map((d) => ({ id: d.id, dayNumber: d.dayNumber, itemIds: d.items.map((i) => i.id) })),
    onDrop: (id, dayId, index) => void move(id, dayId, index),
    announce,
  });
  const dragging = dnd.drag;

  // Order/set changes animate (drops, menu moves, collaborators' edits).
  useFlip(root, days.map((d) => `${d.id}:${d.items.map((i) => i.id).join(",")}`).join("|"));

  // A stop picked on the map: bring its card into view and let it "breathe" once.
  const [pulseId, setPulseId] = useState<string | null>(null);
  /** The card under the pointer in this list (a hover from the map doesn't count). */
  const listHover = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-item-id="${selectedId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    // Only when the selection came from the map (a card clicked here is already under the pointer).
    if (listHover.current === selectedId) return;
    setPulseId(selectedId);
    const t = setTimeout(() => setPulseId(null), 800);
    return () => clearTimeout(t);
  }, [selectedId]);

  return (
    <div ref={root} className="space-y-8">
      <p id={instructionsId} className="sr-only">
        {ti.drag.instructions}
      </p>
      <p className="sr-only" role="status" aria-live="assertive">
        {liveMsg}
      </p>
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
                  {t.trips.day(d.dayNumber)}
                  {d.date && <span className="font-semibold text-ink-2"> · {f.day(d.date, { weekday: "short", day: "numeric", month: "short" })}</span>}
                  {d.title && <span className="font-semibold text-ink-2"> · {d.title}</span>}
                </span>
              </h2>
              {stats.stops > 0 && (
                <span className="shrink-0 font-mono text-xs text-muted">
                  {t.format.stops(stats.stops)}
                  {stats.km > 0 && ` · ${formatKm(stats.km, locale)}`}
                </span>
              )}
            </header>

            <ol ref={dnd.listRef(d.id)} className="relative">
              {items.length === 0 && (
                <li
                  className={cx(
                    "rounded-[14px] border border-dashed border-line px-4 py-5 text-center text-sm text-muted transition-colors",
                    dragging && dragging.toDay === d.id && "border-primary bg-primary-50 text-primary",
                  )}
                >
                  {ti.nothingPlanned}
                </li>
              )}
              {items.map((it, idx) => {
                const place = it.place;
                const n = place ? ++stop : null;
                const leg = legs.get(it.id);
                const editor = it.updatedBy && it.updatedBy.id !== me?.id ? it.updatedBy : null;
                const selected = selectedId === it.id;
                const meta = [place ? place.categoryLabel || t.labels.itemType[it.type] : it.type === "NOTE" ? ti.note : ti.custom(t.labels.itemType[it.type]), place && place.name !== it.title ? place.name : null, it.endTime ? ti.until(it.endTime) : null].filter(Boolean).join(" · ");
                return (
                  <li
                    key={it.id}
                    ref={dnd.itemRef(it.id)}
                    data-item-id={it.id}
                    data-flip-id={it.id}
                    style={dnd.itemStyle(it.id, d.id)}
                    onMouseEnter={() => {
                      listHover.current = it.id;
                      if (place && !dragging) onHover?.(it.id);
                    }}
                    onMouseLeave={() => {
                      listHover.current = null;
                      onHover?.(null);
                    }}
                    className="group relative"
                  >
                    {idx > 0 && (
                      <div
                        className={cx("ml-[26px] border-l-2 border-dashed border-line py-1.5 pl-[14px] font-mono text-xs text-muted transition-opacity sm:ml-[62px]", dragging && "opacity-0")}
                        title={leg ? ti.legHint : undefined}
                      >
                        {leg ? legLabel(leg, t, locale) : <span aria-hidden>&nbsp;</span>}
                        {leg && <span className="sr-only"> {ti.estimate}</span>}
                      </div>
                    )}
                    <div className="flex items-start gap-3 sm:gap-3.5">
                      <div className="hidden w-12 shrink-0 pt-[15px] text-right font-mono text-[13px] text-ink sm:block">{it.startTime ?? ""}</div>
                      <div
                        onClick={() => onSelect?.(it)}
                        className={cx(
                          "min-w-0 flex-1 cursor-pointer rounded-[14px] border p-3 transition-[border-color,background-color,box-shadow,transform] duration-200",
                          selected ? "border-primary bg-primary-50 ring-1 ring-primary" : hoveredId === it.id ? "border-ink-2/50 bg-surface" : "border-line bg-surface hover:border-ink-2/40",
                          pulseId === it.id && "animate-select-pulse",
                          dragging?.id === it.id && "scale-[1.02] shadow-pop",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {n !== null ? (
                            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-semibold text-white" style={{ background: color }}>
                              <span className="sr-only">{ti.stop} </span>
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
                              aria-label={place ? ti.showOnMap(it.title) : undefined}
                              aria-pressed={place ? selected : undefined}
                            >
                              {it.title}
                            </button>
                            <div className={cx("truncate text-[13px]", selected ? "text-ink-2" : "text-muted")}>{meta}</div>
                          </div>
                          {it.startTime && <span className="shrink-0 font-mono text-[13px] text-ink sm:hidden">{it.startTime}</span>}
                          {canEdit && (
                            <>
                              {/* Drag handle: pointer drag, or Space + arrow keys (announced). touch-action:none lets a finger drag it. */}
                              <button
                                type="button"
                                {...dnd.handleProps(it.id, d.id, idx)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={ti.drag.handle(it.title)}
                                aria-describedby={instructionsId}
                                aria-pressed={dragging?.id === it.id}
                                className={cx(
                                  "-my-1 flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-sand-2 hover:text-ink active:cursor-grabbing md:size-8 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100",
                                  dragging?.id === it.id && "bg-sand-2 text-ink md:opacity-100",
                                )}
                              >
                                <GripVertical className="size-4" aria-hidden />
                              </button>
                              <ItemMenu
                                first={idx === 0}
                                last={idx === items.length - 1}
                                onEdit={() => onEdit?.(it)}
                                onDuplicate={() => duplicate.run(it.id)}
                                onMove={(dir) => void move(it.id, d.id, idx + dir)}
                                onDelete={() => remove.run(it.id)}
                              />
                            </>
                          )}
                        </div>
                        {it.notes && <p className={cx("mt-2 whitespace-pre-line border-l-2 pl-2.5 text-[13px]", selected ? "border-primary font-semibold text-primary" : "border-line text-ink-2")}>{it.notes}</p>}
                        {editor && it.updatedAt && (
                          <p className="mt-1.5 text-[11px] text-muted">
                            {ti.editedBy(editor.displayName, f.timeAgo(it.updatedAt))}
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
                className="mt-4 flex h-11 w-full items-center gap-2 rounded-xl border border-dashed border-line-strong px-3.5 text-left text-sm font-semibold text-primary hover:border-primary hover:bg-primary-50/60 sm:ml-[62px] sm:w-[calc(100%-62px)]"
              >
                <Plus className="size-4 shrink-0" aria-hidden /> {ti.addPlaceToDay(d.dayNumber)}
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
          <CalendarPlus className="size-4" /> {ti.addDay}
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
  const t = useT();
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
        aria-label={t.trips.itinerary.actions}
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
        <div id={menuId} role="menu" aria-label={t.trips.itinerary.actions} onKeyDown={onMenuKey} className="animate-rise absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-line bg-surface p-1 shadow-pop">
          {item(<Pencil className="size-4" />, t.common.edit, onEdit)}
          {item(<Copy className="size-4" />, t.trips.itinerary.duplicate, onDuplicate)}
          {item(<ArrowUp className="size-4" />, t.trips.itinerary.moveUp, () => onMove(-1), false, first)}
          {item(<ArrowDown className="size-4" />, t.trips.itinerary.moveDown, () => onMove(1), false, last)}
          <div role="separator" className="my-1 h-px bg-line" />
          {item(<Trash2 className="size-4" />, t.common.delete, onDelete, true)}
        </div>
      )}
    </div>
  );
}
