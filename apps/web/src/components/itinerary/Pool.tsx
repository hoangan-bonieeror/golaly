"use client";

import { clusterByArea, groupScore, type ItemSlot, type ItemView, type TripDetail, type VoteLevel } from "@triply/shared";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, ChevronDown, GripVertical, Heart, Lightbulb, MapPinned, Pencil, Plus, ThumbsUp, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useFormat, useI18n } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { absentOn, applyVote, firstName, ITEM_SLOTS, nameList } from "@/lib/plan";
import { dayColor } from "@/lib/trip-geo";
import { useToast } from "@/lib/toast";
import { Avatar, Button, Sheet, cx } from "../ui";
import { EvidenceBadge } from "./AfterTrip";
import { ItemMenu } from "./ItemMenu";
import { ItemTypeIcon } from "./ItemTypeIcon";
import type { useItineraryDrag } from "./useItineraryDrag";

type Dnd = ReturnType<typeof useItineraryDrag>;
export type MoveFn = (id: string, dayId: string | null, index: number, slot?: ItemSlot) => Promise<void>;

const VOTE_ICON: Record<VoteLevel, React.ElementType> = { LOVE: Heart, OK: ThumbsUp, SKIP: X };

/** Pool order: what the group wants most first; ties keep the order ideas were added in. */
export function sortPool(pool: ItemView[]) {
  return pool.map((item, n) => ({ item, n, score: groupScore(item.votes) })).sort((a, b) => b.score - a.score || a.n - b.n).map((x) => x.item);
}

/**
 * The trip's ideas pool (roadmap phase 1): places the group wants to fit in somewhere, ranked by
 * the group's votes, grouped into areas that are close together, and dragged (or planned with the
 * menu) into a day and part of the day. Lives in the same scroll column as the days so one drag
 * can go from the pool to any day and back.
 */
export function PoolSection({
  trip,
  dnd,
  move,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onAddIdea,
  onEdit,
  defaultDayId,
}: {
  trip: TripDetail;
  dnd: Dnd;
  move: MoveFn;
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (item: ItemView) => void;
  onHover?: (id: string | null) => void;
  onAddIdea?: () => void;
  onEdit?: (item: ItemView) => void;
  defaultDayId?: string;
}) {
  const { m: t, locale } = useI18n();
  const tp = t.trips.plan;
  const may = (a: string) => trip.permissions.includes(a as never);
  const canAdd = may("itinerary.add");
  const canMove = may("itinerary.reorder");
  const [open, setOpen] = useState(true);
  /** The pool shows the group's top ideas first; the rest on request (or while dragging into it). */
  const [all, setAll] = useState(false);
  const TOP = 3;
  const [plan, setPlan] = useState<{ ids: string[]; label?: string } | null>(null);
  const pool = useMemo(() => sortPool(trip.pool), [trip.pool]);
  const remove = useAction((id: string) => api.delete(`/items/${id}`), { invalidate: [keys.trip(trip.id), ["trips"]], success: tp.pool.removed });

  const areas = useMemo(() => {
    const byId = new Map(pool.map((i) => [i.id, i]));
    return clusterByArea(pool.filter((i) => i.place).map((i) => ({ id: i.id, lat: i.place!.lat, lng: i.place!.lng, areaName: i.place!.areaName ?? null }))).map((a) => {
      // An unnamed area is named after its most wanted place ("Near Kiyomizu-dera").
      const top = sortPool(a.ids.map((id) => byId.get(id)!))[0];
      const name = a.label ?? top.place?.name ?? top.title;
      return { ...a, name, chip: a.label ?? tp.pool.near(name) };
    });
  }, [pool, tp.pool]);

  if (!pool.length && !canAdd) return null;
  const and = locale === "vi" ? "và" : "&";

  return (
    <section aria-labelledby="pool-title" className="mb-8 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-sand/50 p-3.5 sm:p-4">
      <header className="flex items-center gap-2">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-700">
          <Lightbulb className="size-4" />
        </span>
        <h2 id="pool-title" className="whitespace-nowrap font-display text-xl font-bold">
          {tp.pool.title}
        </h2>
        <span className="hidden whitespace-nowrap font-mono text-xs text-muted min-[400px]:inline">{tp.pool.count(pool.length)}</span>
        <span className="flex-1" />
        {canAdd && (
          <Button size="sm" variant="secondary" onClick={onAddIdea} className="w-9 px-0 sm:w-auto sm:px-3">
            <Plus className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">{tp.pool.add}</span>
          </Button>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="pool-body"
          aria-label={open ? tp.pool.hide : tp.pool.show}
          className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-sand-2 hover:text-ink"
        >
          <ChevronDown className={cx("size-4 transition-transform", !open && "-rotate-90")} />
        </button>
      </header>

      {open && (
        <div id="pool-body">
          <p className="mt-1.5 text-[13px] text-muted">{pool.length ? tp.pool.hint : tp.pool.empty}</p>

          {canMove && areas.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">{tp.pool.areas}</span>
              {areas.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setPlan({ ids: a.ids, label: a.name })}
                  aria-label={tp.pool.areaLabel(a.chip, a.ids.length)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink-2 hover:border-primary hover:text-primary"
                >
                  <MapPinned className="size-3.5" aria-hidden /> {tp.pool.areaChip(a.chip, a.ids.length)}
                </button>
              ))}
            </div>
          )}

          <ol ref={dnd.listRef("pool")} className="relative mt-3 min-h-2 space-y-2" aria-label={tp.pool.title}>
            {(all || pool.length <= TOP + 1 ? pool : pool.slice(0, TOP)).map((it, idx) => {
              const selected = selectedId === it.id;
              const added = it.addedBy ? firstName(it.addedBy) : null;
              return (
                <li
                  key={it.id}
                  ref={dnd.itemRef(it.id)}
                  data-item-id={it.id}
                  data-flip-id={it.id}
                  style={dnd.itemStyle(it.id, "pool")}
                  onMouseEnter={() => it.place && !dnd.drag && onHover?.(it.id)}
                  onMouseLeave={() => onHover?.(null)}
                  className="group relative"
                >
                  <div
                    onClick={() => it.place && onSelect?.(it)}
                    className={cx(
                      "rounded-[14px] border bg-surface p-3 transition-[border-color,background-color,box-shadow,transform] duration-200",
                      it.place && "cursor-pointer",
                      selected ? "border-primary ring-1 ring-primary" : hoveredId === it.id ? "border-ink-2/50" : "border-line hover:border-ink-2/40",
                      dnd.drag?.id === it.id && "scale-[1.02] shadow-pop",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <ItemTypeIcon type={it.type} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-snug">{it.title}</div>
                        <div className="truncate text-[13px] text-muted">
                          {[it.place?.categoryLabel, it.place && it.place.name !== it.title ? it.place.name : null, added ? tp.pool.addedBy(added) : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {canMove && (
                        <button
                          type="button"
                          {...dnd.handleProps(it.id, "pool", idx)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={t.trips.itinerary.drag.handle(it.title)}
                          aria-describedby="plan-drag-instructions"
                          aria-pressed={dnd.drag?.id === it.id}
                          className={cx(
                            "-my-1 flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-sand-2 hover:text-ink active:cursor-grabbing md:size-8 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100",
                            dnd.drag?.id === it.id && "bg-sand-2 text-ink md:opacity-100",
                          )}
                        >
                          <GripVertical className="size-4" aria-hidden />
                        </button>
                      )}
                      {(canMove || may("itinerary.edit") || may("itinerary.delete")) && (
                        <ItemMenu
                          actions={[
                            ...(canMove ? [{ icon: <CalendarPlus className="size-4" />, label: tp.pool.planInto, onClick: () => setPlan({ ids: [it.id] }) }] : []),
                            ...(may("itinerary.edit") ? [{ icon: <Pencil className="size-4" />, label: t.common.edit, onClick: () => onEdit?.(it) }] : []),
                            ...(may("itinerary.delete") ? ["separator" as const, { icon: <Trash2 className="size-4" />, label: tp.pool.remove, onClick: () => remove.run(it.id), danger: true }] : []),
                          ]}
                        />
                      )}
                    </div>
                    <EvidenceBadge evidence={it.evidence} />
                    <VoteBar trip={trip} item={it} and={and} />
                  </div>
                </li>
              );
            })}
          </ol>
          {pool.length > TOP + 1 && (
            <button type="button" onClick={() => setAll((x) => !x)} aria-expanded={all} className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary-50">
              <ChevronDown className={cx("size-4 transition-transform", all && "rotate-180")} aria-hidden />
              {all ? tp.pool.showLess : tp.pool.showAll(pool.length)}
            </button>
          )}
        </div>
      )}

      {plan && <PlanSheet trip={trip} ids={plan.ids} label={plan.label} defaultDayId={defaultDayId} move={move} onClose={() => setPlan(null)} />}
    </section>
  );
}

/** Really want / fine / skip, with counts; tapping your current choice again clears it. */
export function VoteBar({ trip, item, and }: { trip: TripDetail; item: ItemView; and: string }) {
  const { m: t } = useI18n();
  const tv = t.trips.plan.vote;
  const me = useMe().data;
  const qc = useQueryClient();
  const toast = useToast();
  const canVote = trip.permissions.includes("itinerary.vote") && !!me;
  const mine = item.votes.find((v) => v.userId === me?.id)?.level ?? null;
  const memberName = (id: string) => {
    const m = trip.members.find((x) => x.user.id === id);
    return m ? firstName(m.user) : "";
  };

  const vote = async (level: VoteLevel) => {
    if (!me) return;
    const next = mine === level ? null : level;
    const key = keys.trip(trip.id);
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<TripDetail>(key);
    if (prev) qc.setQueryData(key, applyVote(prev, item.id, me.id, next));
    try {
      if (next) await api.put(`/items/${item.id}/vote`, { level: next });
      else await api.delete(`/items/${item.id}/vote`);
    } catch {
      toast(tv.failed, "error");
    } finally {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  return (
    <div role="group" aria-label={tv.group(item.title)} className="mt-2.5 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {(["LOVE", "OK", "SKIP"] as const).map((level) => {
        const Icon = VOTE_ICON[level];
        const voters = item.votes.filter((v) => v.level === level);
        const on = mine === level;
        const names = nameList(voters.map((v) => memberName(v.userId)).filter(Boolean), and);
        return (
          <button
            key={level}
            type="button"
            disabled={!canVote}
            aria-pressed={on}
            aria-label={tv.count(tv[level], voters.length, names)}
            title={names || tv[level]}
            onClick={() => vote(level)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition-colors disabled:cursor-default",
              on
                ? level === "LOVE"
                  ? "border-accent-600 bg-accent-600 text-white"
                  : level === "OK"
                    ? "border-primary bg-primary text-on-primary"
                    : "border-ink-2 bg-ink-2 text-on-ink"
                : "border-line bg-surface text-ink-2 enabled:hover:border-ink-2",
            )}
          >
            <Icon className={cx("size-3.5", on && level === "LOVE" && "fill-current")} aria-hidden />
            <span className="hidden sm:inline">{tv[level]}</span>
            {voters.length > 0 && <span className="font-mono">{voters.length}</span>}
          </button>
        );
      })}
      {item.votes.length > 0 && (
        <span className="ml-1 flex items-center" aria-hidden>
          {item.votes.slice(0, 4).map((v, i) => {
            const m = trip.members.find((x) => x.user.id === v.userId);
            return m ? (
              <span key={v.userId} className={cx("rounded-full ring-2 ring-surface", i > 0 && "-ml-1.5")}>
                <Avatar user={m.user} size={20} />
              </span>
            ) : null;
          })}
        </span>
      )}
    </div>
  );
}

/** "Plan into a day": one idea, or a whole area of ideas, into a day and part of the day. */
export function PlanSheet({ trip, ids, label, defaultDayId, move, onClose }: { trip: TripDetail; ids: string[]; label?: string; defaultDayId?: string; move: MoveFn; onClose: () => void }) {
  const { m: t, locale } = useI18n();
  const f = useFormat();
  const tp = t.trips.plan;
  const toast = useToast();
  const [dayId, setDayId] = useState(defaultDayId ?? trip.days[0]?.id ?? "");
  const [slot, setSlot] = useState<ItemSlot>("MORNING");
  const [busy, setBusy] = useState(false);
  const items = ids.map((id) => trip.pool.find((i) => i.id === id)).filter((i): i is ItemView => !!i);
  const day = trip.days.find((d) => d.id === dayId);
  const away = absentOn(trip.members, day?.date ?? null);
  const and = locale === "vi" ? "và" : "&";
  // Who really wants one of these places but isn't there that day.
  const warnings = items.flatMap((it) => {
    const names = it.votes.filter((v) => v.level === "LOVE" && away.some((m) => m.user.id === v.userId)).map((v) => firstName(away.find((m) => m.user.id === v.userId)!.user));
    return names.length ? [{ id: it.id, text: tp.planSheet.away(nameList(names, and), it.title) }] : [];
  });

  const submit = async () => {
    if (!day) return;
    setBusy(true);
    for (const it of items) await move(it.id, day.id, 9_999, slot);
    setBusy(false);
    toast(tp.planSheet.done(items.length, day.dayNumber));
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={label ? tp.planSheet.areaTitle(label) : tp.planSheet.title}>
      <div className="space-y-5">
        <ul className="flex flex-wrap gap-1.5" aria-label={tp.planSheet.places(items.length)}>
          {items.map((it) => (
            <li key={it.id} className="rounded-full bg-sand-2 px-3 py-1 text-[13px] font-semibold text-ink-2">
              {it.title}
            </li>
          ))}
        </ul>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">{tp.planSheet.day}</legend>
          <div className="grid max-h-[36vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {trip.days.map((d) => {
              const absent = absentOn(trip.members, d.date);
              const on = d.id === dayId;
              return (
                <label
                  key={d.id}
                  className={cx(
                    "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                    on ? "border-ink bg-ink text-on-ink" : "border-line bg-surface hover:border-ink-2",
                  )}
                >
                  <input type="radio" name="plan-day" value={d.id} checked={on} onChange={() => setDayId(d.id)} className="sr-only" />
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: dayColor(d.dayNumber) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {t.trips.day(d.dayNumber)}
                      {d.date && <span className={cx("font-normal", on ? "text-on-ink/80" : "text-muted")}> · {f.day(d.date, { weekday: "short", month: "short", day: "numeric" })}</span>}
                    </span>
                    <span className={cx("block truncate text-xs", on ? "text-on-ink/80" : "text-muted")}>
                      {absent.length ? tp.absent(nameList(absent.map((m) => firstName(m.user)), and)) : (d.title ?? t.format.stops(d.items.filter((i) => i.place).length))}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">{tp.planSheet.slot}</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1 sm:grid-cols-4">
            {ITEM_SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={slot === s}
                onClick={() => setSlot(s)}
                className={cx("h-9 rounded-[9px] text-[13px] font-semibold", slot === s ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink")}
              >
                {tp.slots[s]}
              </button>
            ))}
          </div>
        </fieldset>
        {warnings.length > 0 && (
          <ul className="space-y-1.5" aria-live="polite">
            {warnings.map((w) => (
              <li key={w.id} className="flex items-start gap-2 rounded-xl bg-gold-50 px-3 py-2 text-sm text-gold-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w.text}
              </li>
            ))}
          </ul>
        )}
        <Button className="w-full" size="lg" disabled={!day || busy || !items.length} onClick={submit}>
          <CalendarPlus className="size-4" aria-hidden /> {tp.planSheet.confirm}
        </Button>
      </div>
    </Sheet>
  );
}
