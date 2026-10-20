"use client";

import type { ItemSlot, ItemView, TripDetail } from "@golaly/shared";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarPlus, Check, CircleDashed, Copy, Flag, GripVertical, Heart, Lightbulb, Moon, Pencil, Plus, Shuffle, Sun, Sunrise, Trash2, Users, Wallet, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { dayColor, dayLegs, dayStats, formatKm, legLabel } from "@/lib/trip-geo";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { prefersReducedMotion } from "@/lib/motion";
import { absentOn, applyMove, dayIndexFor, dayProgress, firstName, ITEM_SLOTS, listId, markable, nameList, parseList, todayIso, tripNow, tripPhase } from "@/lib/plan";
import { useClock } from "@/lib/clock";
import { useNow } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { useFormat, useI18n } from "@/i18n/client";
import { cx } from "../ui";
import type { DayFilter } from "../trip/DayBar";
import { EvidenceBadge, PhotoStrip, StatusBadge, StatusToggle, useSetStatuses } from "./AfterTrip";
import { ItemMenu, type MenuAction } from "./ItemMenu";
import { AssignSheet, GoingLine, LaneChips, laneKey, lanesOf } from "./Split";
import { SwipeArea } from "./Swipe";
import { ItemTypeIcon, TYPE_META } from "./ItemTypeIcon";
import { PoolSection, sortPool, type MoveFn } from "./Pool";
import { useFlip, useItineraryDrag, type DragState } from "./useItineraryDrag";

const SLOT_ICON: Record<ItemSlot, React.ElementType> = { MORNING: Sunrise, AFTERNOON: Sun, EVENING: Moon, ANY: Shuffle };

/**
 * The plan column of the planner (Atlas, flexible plans): the ideas pool on top, then one section
 * per day split into parts of the day — morning, afternoon, evening, any time. Only anchors
 * (flights, bookings) show a clock time. Stops are numbered in the day's colour with an estimated
 * leg between consecutive places. Drag (or use the menu) to move between the pool, days and parts
 * of the day; the page owns the day filter, the selection (shared with the map) and the item sheet.
 */
export function Itinerary({
  trip,
  day = "all",
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onAdd,
  onAddIdea,
  onEdit,
  onAddExpense,
}: {
  trip: TripDetail;
  day?: DayFilter;
  selectedId?: string | null;
  /** The stop whose pin is under the pointer on the map; `onHover` reports the stop under the pointer here. */
  hoveredId?: string | null;
  onSelect?: (item: ItemView) => void;
  onHover?: (itemId: string | null) => void;
  onAdd?: (dayId: string, slot?: ItemSlot) => void;
  onAddIdea?: () => void;
  onEdit?: (item: ItemView) => void;
  /** "Add expense" on a stop (members only). */
  onAddExpense?: (item: ItemView) => void;
}) {
  const me = useMe().data;
  const { m: t, locale } = useI18n();
  const f = useFormat();
  const ti = t.trips.itinerary;
  const tp = t.trips.plan;
  const days = day === "all" ? trip.days : trip.days.filter((d) => d.dayNumber === day);
  const may = (a: string) => trip.permissions.includes(a as never);
  const canEdit = may("itinerary.edit");
  const canAdd = may("itinerary.add");
  const canMove = may("itinerary.reorder");
  const qc = useQueryClient();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const [liveMsg, setLiveMsg] = useState("");
  const and = locale === "vi" ? "và" : "&";
  const ta = t.after;
  // After the trip starts, stops can be marked went / skipped: one tap on the card while it's under way or over.
  const { timeZone } = useClock();
  const clock = useNow();
  const phase = tripPhase(trip, todayIso(clock, timeZone));
  const canMark = canEdit && phase !== "before";
  const inlineMark = canEdit && (phase === "during" || phase === "after");
  const setStatuses = useSetStatuses(trip);
  // While the trip is under way: today's day and the part of the day it is now.
  const nowAt = tripNow(trip, clock, timeZone);
  const td = t.during;
  // Splitting up: who's going to a stop, and the meet-up point.
  const [assigning, setAssigning] = useState<ItemView | null>(null);
  const meetup = useAction((it: ItemView) => api.patch(`/items/${it.id}`, { meetup: !it.meetup }), {
    invalidate: [keys.trip(trip.id), ["trips"]],
    success: (r) => ((r as ItemView).meetup ? td.split.meetupSaved : td.split.meetupCleared),
  });
  const canSpend = may("expenses.manage") && !!onAddExpense;

  const invalidate = [keys.trip(trip.id), ["trips"]];
  /** Optimistic move: the list (and the map, legs, totals) update at once; the server confirms. */
  const move: MoveFn = async (id, dayId, index, slot) => {
    const key = keys.trip(trip.id);
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) qc.setQueryData(key, applyMove(prev, id, dayId, index, slot));
    try {
      await api.post(`/items/${id}/reorder`, { dayId, index, ...(slot ? { slot } : {}) });
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

  // ── Drag lists: the pool, then each part of each shown day (empty parts only for editors). ──
  const pool = sortPool(trip.pool);
  const slotsOf = (d: (typeof days)[number]) => ITEM_SLOTS.filter((s) => canMove || d.items.some((i) => i.slot === s));
  const lists = [
    ...(canMove ? [{ id: "pool", itemIds: pool.map((i) => i.id) }] : []),
    ...days.flatMap((d) => slotsOf(d).map((s) => ({ id: listId(d.id, s), itemIds: d.items.filter((i) => i.slot === s).map((i) => i.id) }))),
  ];

  const titleOf = (id: string) => [...trip.pool, ...trip.days.flatMap((d) => d.items)].find((i) => i.id === id)?.title ?? "";
  const whereOf = (list: string) => {
    const { dayId, slot } = parseList(list);
    if (!dayId) return tp.pool.title;
    return tp.where(trip.days.find((d) => d.id === dayId)?.dayNumber ?? 0, tp.slots[slot]);
  };
  const announce = (kind: "picked" | "moved" | "dropped" | "cancelled", st: DragState) => {
    const total = (lists.find((l) => l.id === st.toDay)?.itemIds.filter((i) => i !== st.id).length ?? 0) + 1;
    const pos = st.toIndex + 1;
    setLiveMsg(
      kind === "picked"
        ? ti.drag.picked(titleOf(st.id), whereOf(st.toDay), pos, total)
        : kind === "moved"
          ? ti.drag.moved(whereOf(st.toDay), pos, total)
          : kind === "dropped"
            ? ti.drag.dropped(titleOf(st.id), whereOf(st.toDay), pos)
            : ti.drag.cancelled(titleOf(st.id)),
    );
  };
  const dnd = useItineraryDrag({
    lists,
    onDrop: (id, list, index) => {
      const { dayId, slot } = parseList(list);
      if (!dayId) return void move(id, null, index);
      const dayItems = trip.days.find((d) => d.id === dayId)?.items ?? [];
      void move(id, dayId, dayIndexFor(dayItems, slot, index, id), slot);
    },
    announce,
  });
  const dragging = dnd.drag;

  // Order/set changes animate (drops, menu moves, collaborators' edits).
  useFlip(root, lists.map((l) => `${l.id}:${l.itemIds.join(",")}`).join("|"));

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

  const defaultDayId = day === "all" ? undefined : days[0]?.id;

  return (
    <div ref={root}>
      <p id="plan-drag-instructions" className="sr-only">
        {ti.drag.instructions}
      </p>
      <p className="sr-only" role="status" aria-live="assertive">
        {liveMsg}
      </p>

      {canEdit && <AssignSheet trip={trip} item={assigning} onClose={() => setAssigning(null)} />}
      <PoolSection
        trip={trip}
        dnd={dnd}
        move={move}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onSelect={onSelect}
        onHover={onHover}
        onAddIdea={onAddIdea}
        onEdit={onEdit}
        defaultDayId={defaultDayId}
      />

      <div className="space-y-8">
        {days.map((d) => {
          const color = dayColor(d.dayNumber);
          const legs = dayLegs(d.items);
          const stats = dayStats(d);
          const away = absentOn(trip.members, d.date);
          const progress = dayProgress(d.items);
          const isToday = nowAt?.dayId === d.id;
          const numbers = new Map<string, number>();
          d.items.filter((i) => i.place).forEach((i, n) => numbers.set(i.id, n + 1));
          return (
            <section key={d.id} aria-labelledby={`day-${d.id}`}>
              <header className="mb-2 flex items-baseline justify-between gap-3">
                <h2 id={`day-${d.id}`} className="flex min-w-0 items-baseline gap-2 font-display text-xl font-bold">
                  <span aria-hidden className="size-2.5 shrink-0 translate-y-[-2px] self-center rounded-full" style={{ background: color }} />
                  <span className="truncate">
                    {t.trips.day(d.dayNumber)}
                    {d.date && <span className="font-semibold text-ink-2"> · {f.day(d.date, { weekday: "short", day: "numeric", month: "short" })}</span>}
                    {d.title && <span className="font-semibold text-ink-2"> · {d.title}</span>}
                  </span>
                  {isToday && <span className="shrink-0 self-center rounded-full bg-primary px-2 py-0.5 font-sans text-[11px] font-semibold text-on-primary">{td.today}</span>}
                </h2>
                {stats.stops > 0 && (
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {t.format.stops(stats.stops)}
                    {stats.km > 0 && ` · ${formatKm(stats.km, locale)}`}
                  </span>
                )}
              </header>
              {/* Progress once the trip has started: how much of the day is done. */}
              {phase !== "before" && progress.total > 0 && (progress.done > 0 || phase === "during" || phase === "after") && (
                <div className="-mt-1 mb-2 flex items-center gap-2" title={td.progressLabel(progress.visited, progress.skipped, progress.total)}>
                  <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-sand-2" role="img" aria-label={td.progressLabel(progress.visited, progress.skipped, progress.total)}>
                    <span className="h-full bg-primary transition-[width] duration-300" style={{ width: `${(progress.visited / progress.total) * 100}%` }} />
                    <span className="h-full bg-ink-2/40 transition-[width] duration-300" style={{ width: `${(progress.skipped / progress.total) * 100}%` }} />
                  </div>
                  <span aria-hidden className="shrink-0 font-mono text-[11px] text-muted">{td.progress(progress.done, progress.total)}</span>
                </div>
              )}
              {away.length > 0 && (
                <p className="-mt-1 mb-2 flex items-center gap-1.5 text-[13px] text-muted">
                  <Users className="size-3.5" aria-hidden /> {tp.absent(nameList(away.map((m) => firstName(m.user)), and))}
                </p>
              )}

              {d.items.length === 0 && !canMove && <p className="rounded-[14px] border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{ti.nothingPlanned}</p>}

              <div className="space-y-1">
                {slotsOf(d).map((slot) => {
                  const items = d.items.filter((i) => i.slot === slot);
                  const SlotIcon = SLOT_ICON[slot];
                  const lid = listId(d.id, slot);
                  const target = dragging && dragging.toDay === lid;
                  const isNow = isToday && nowAt?.slot === slot;
                  const lanes = lanesOf(items);
                  const laneColor = (it: ItemView) => lanes.find((l) => l.key === laneKey(it))?.color;
                  return (
                    <div key={slot} role="group" aria-label={tp.where(d.dayNumber, tp.slots[slot])}>
                      <div className="flex h-8 items-center gap-2 sm:pl-[62px]" aria-current={isNow ? "time" : undefined}>
                        <SlotIcon className={cx("size-3.5", target || isNow ? "text-primary" : "text-muted")} aria-hidden />
                        <span className={cx("font-mono text-[11px] font-semibold uppercase tracking-wider", target || isNow ? "text-primary" : "text-muted")}>{tp.slots[slot]}</span>
                        {isNow && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-px text-[11px] font-semibold text-primary">
                            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                            {td.now}
                          </span>
                        )}
                        <span aria-hidden className={cx("h-px flex-1", target || isNow ? "bg-primary" : "bg-line")} />
                        {canAdd && (
                          <button
                            type="button"
                            onClick={() => onAdd?.(d.id, slot)}
                            aria-label={tp.addToSlot(tp.slots[slot], d.dayNumber)}
                            title={tp.addToSlot(tp.slots[slot], d.dayNumber)}
                            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"
                          >
                            <Plus className="size-4" />
                          </button>
                        )}
                      </div>
                      <LaneChips trip={trip} lanes={lanes} />
                      <ol ref={dnd.listRef(lid)} className={cx("relative min-h-1.5 rounded-[14px] transition-colors", target && items.length === 0 && "min-h-12 border border-dashed border-primary bg-primary-50/60")}>
                        {items.map((it, idx) => {
                          const place = it.place;
                          const n = numbers.get(it.id) ?? null;
                          // No walk between two stops of different groups: they happen side by side.
                          const prevLane = idx > 0 ? laneKey(items[idx - 1]) : null;
                          const parallel = !!prevLane && !!laneKey(it) && prevLane !== laneKey(it);
                          const leg = idx > 0 && !parallel ? legs.get(it.id) : undefined;
                          const editor = it.updatedBy && it.updatedBy.id !== me?.id ? it.updatedBy : null;
                          const selected = selectedId === it.id;
                          // Flights and transfers look like tickets: a notched perforation and a stub with the time.
                          const ticket = it.type === "FLIGHT" || it.type === "TRANSPORTATION";
                          const TicketIcon = TYPE_META[it.type].icon;
                          const loves = it.votes.filter((v) => v.level === "LOVE").length;
                          const awayLovers = it.votes.filter((v) => v.level === "LOVE" && away.some((m) => m.user.id === v.userId)).map((v) => firstName(away.find((m) => m.user.id === v.userId)!.user));
                          const meta = [
                            place ? place.categoryLabel || t.labels.itemType[it.type] : it.type === "NOTE" ? ti.note : ti.custom(t.labels.itemType[it.type]),
                            place && place.name !== it.title ? place.name : null,
                            it.endTime ? ti.until(it.endTime) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          const statusActions: MenuAction[] =
                            canMark && markable(it)
                              ? [
                                  ...(it.status !== "PLANNED" ? [{ heading: ta.status[it.status] }] : []),
                                  ...(it.status !== "VISITED" ? [{ icon: <Check className="size-4" />, label: ta.status.markVisited, onClick: () => void setStatuses([[it.id, "VISITED"]]) }] : []),
                                  ...(it.status !== "SKIPPED" ? [{ icon: <X className="size-4" />, label: ta.status.markSkipped, onClick: () => void setStatuses([[it.id, "SKIPPED"]]) }] : []),
                                  ...(it.status !== "PLANNED" ? [{ icon: <CircleDashed className="size-4" />, label: ta.status.markPlanned, onClick: () => void setStatuses([[it.id, "PLANNED"]]) }] : []),
                                  "separator" as const,
                                ]
                              : [];
                          const actions: MenuAction[] = [
                            ...statusActions,
                            ...(canEdit ? [{ icon: <Pencil className="size-4" />, label: t.common.edit, onClick: () => onEdit?.(it) }] : []),
                            ...(canEdit && markable(it) && trip.members.length > 1
                              ? [
                                  { icon: <Users className="size-4" />, label: td.split.who, onClick: () => setAssigning(it) },
                                  { icon: <Flag className="size-4" />, label: it.meetup ? td.split.unmakeMeetup : td.split.makeMeetup, onClick: () => meetup.run(it) },
                                ]
                              : []),
                            ...(canSpend && markable(it) ? [{ icon: <Wallet className="size-4" />, label: ta.expenses.addForItem, onClick: () => onAddExpense?.(it) }] : []),
                            ...(canAdd ? [{ icon: <Copy className="size-4" />, label: ti.duplicate, onClick: () => duplicate.run(it.id) }] : []),
                            ...(canMove
                              ? [
                                  { icon: <ArrowUp className="size-4" />, label: ti.moveUp, onClick: () => void move(it.id, d.id, dayIndexFor(d.items, slot, idx - 1, it.id), slot), disabled: idx === 0 },
                                  { icon: <ArrowDown className="size-4" />, label: ti.moveDown, onClick: () => void move(it.id, d.id, dayIndexFor(d.items, slot, idx + 1, it.id), slot), disabled: idx === items.length - 1 },
                                  // An anchor's time decides its part of the day.
                                  ...(!it.startTime
                                    ? [
                                        { heading: tp.moveTo },
                                        ...ITEM_SLOTS.filter((s) => s !== slot).map((s) => {
                                          const Icon = SLOT_ICON[s];
                                          return { icon: <Icon className="size-4" />, label: tp.slots[s], onClick: () => void move(it.id, d.id, dayIndexFor(d.items, s, 9_999, it.id), s) };
                                        }),
                                      ]
                                    : []),
                                  ...(it.type !== "NOTE"
                                    ? [{ icon: <Lightbulb className="size-4" />, label: tp.backToPool, onClick: () => void move(it.id, null, 9_999).then(() => toast(tp.movedToPool)) }]
                                    : []),
                                ]
                              : []),
                            ...(may("itinerary.delete") ? ["separator" as const, { icon: <Trash2 className="size-4" />, label: t.common.delete, onClick: () => remove.run(it.id), danger: true }] : []),
                          ];
                          return (
                            <li
                              key={it.id}
                              ref={dnd.itemRef(it.id)}
                              data-item-id={it.id}
                              data-flip-id={it.id}
                              style={dnd.itemStyle(it.id, lid)}
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
                                <SwipeArea
                                  className="min-w-0 flex-1"
                                  enabled={inlineMark && markable(it) && !dragging}
                                  onSwipe={(dir) => void setStatuses([[it.id, dir === "right" ? (it.status === "VISITED" ? "PLANNED" : "VISITED") : it.status === "SKIPPED" ? "PLANNED" : "SKIPPED"]])}
                                >
                                <div
                                  onClick={() => onSelect?.(it)}
                                  className={cx(
                                    "min-w-0 cursor-pointer rounded-[14px] border p-3 transition-[border-color,background-color,box-shadow,transform] duration-200",
                                    ticket && "ticket flex gap-3",
                                    ticket && (selected ? "[--ticket-line:var(--color-primary)]" : "[--ticket-line:var(--color-line)]"),
                                    selected ? "border-primary bg-primary-50 ring-1 ring-primary" : hoveredId === it.id ? "border-ink-2/50 bg-surface" : "border-line bg-surface hover:border-ink-2/40",
                                    pulseId === it.id && "animate-select-pulse",
                                    dragging?.id === it.id && "scale-[1.02] shadow-pop",
                                    laneColor(it) && "border-l-[3px]",
                                  )}
                                  style={laneColor(it) ? { borderLeftColor: laneColor(it) } : undefined}
                                >
                                  <div className={ticket ? "min-w-0 flex-1" : "contents"}>
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
                                          className={cx("text-left font-semibold leading-snug hover:underline", it.status === "SKIPPED" && "text-ink-2 line-through decoration-ink-2/50")}
                                          aria-label={place ? ti.showOnMap(it.title) : undefined}
                                          aria-pressed={place ? selected : undefined}
                                        >
                                          {it.title}
                                        </button>
                                        <div className={cx("truncate text-[13px]", selected ? "text-ink-2" : "text-muted")}>{meta}</div>
                                        {!(inlineMark && markable(it)) && <StatusBadge status={it.status} className="mt-1" />}
                                      </div>
                                      {loves > 0 && (
                                        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-accent-700" title={t.trips.plan.vote.LOVE}>
                                          <Heart className="size-3.5 fill-current" aria-hidden />
                                          <span className="sr-only">{t.trips.plan.vote.LOVE}: </span>
                                          {loves}
                                        </span>
                                      )}
                                      {it.startTime && <span className="shrink-0 font-mono text-[13px] text-ink sm:hidden">{it.startTime}</span>}
                                      {inlineMark && markable(it) && <StatusToggle className="hidden sm:flex" item={it} onChange={(st) => void setStatuses([[it.id, st]])} />}
                                      {canMove && (
                                        /* Drag handle: pointer drag, or Space + arrow keys (announced). touch-action:none lets a finger drag it. */
                                        <button
                                          type="button"
                                          {...dnd.handleProps(it.id, lid, idx)}
                                          onClick={(e) => e.stopPropagation()}
                                          aria-label={ti.drag.handle(it.title)}
                                          aria-describedby="plan-drag-instructions"
                                          aria-pressed={dragging?.id === it.id}
                                          className={cx(
                                            "-my-1 flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-sand-2 hover:text-ink active:cursor-grabbing md:size-8 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100",
                                            dragging?.id === it.id && "bg-sand-2 text-ink md:opacity-100",
                                          )}
                                        >
                                          <GripVertical className="size-4" aria-hidden />
                                        </button>
                                      )}
                                      {actions.length > 0 && <ItemMenu actions={actions} />}
                                    </div>
                                    {it.notes && <p className={cx("mt-2 whitespace-pre-line border-l-2 pl-2.5 text-[13px]", selected ? "border-primary font-semibold text-primary" : "border-line text-ink-2")}>{it.notes}</p>}
                                    {awayLovers.length > 0 && (
                                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-gold-50 px-2.5 py-1.5 text-[12px] text-gold-700">
                                        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {tp.lovedButAway(nameList(awayLovers, and))}
                                      </p>
                                    )}
                                    {/* Phones: the went / skipped buttons get their own row (and a swipe does the same). */}
                                    {inlineMark && markable(it) && <StatusToggle labeled className="mt-2.5 sm:hidden" item={it} onChange={(st) => void setStatuses([[it.id, st]])} />}
                                    <GoingLine trip={trip} item={it} color={laneColor(it)} />
                                    <EvidenceBadge evidence={it.evidence} />
                                    <PhotoStrip item={it} />
                                    {editor && it.updatedAt && <p className="mt-1.5 text-[11px] text-muted">{ti.editedBy(editor.displayName, f.timeAgo(it.updatedAt))}</p>}
                                  </div>
                                  {ticket && (
                                    <>
                                      <span aria-hidden className="ticket-notch is-top" style={{ right: 61 }} />
                                      <span aria-hidden className="ticket-notch is-bottom" style={{ right: 61 }} />
                                      <div aria-hidden className="ticket-stub -my-3 -mr-3 flex w-[68px] shrink-0 flex-col items-center justify-center gap-1 border-l-2 border-dashed border-[var(--ticket-line)] px-2 text-ink-2">
                                        <TicketIcon className="size-[18px]" />
                                        <span className="max-w-full break-words text-center font-mono text-[10px] font-semibold uppercase leading-tight tracking-wide text-ink">{it.endTime ? `→ ${it.endTime}` : t.labels.itemType[it.type]}</span>
                                      </div>
                                    </>
                                  )}
                                </div>
                                </SwipeArea>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  );
                })}
              </div>

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
    </div>
  );
}
