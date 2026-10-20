"use client";

import type { ItemView, MemberView, TripDetail } from "@golaly/shared";
import { Flag, Users } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction } from "@/lib/api/queries";
import { firstName, nameList } from "@/lib/plan";
import { Avatar, Button, Sheet, SheetActions, cx } from "../ui";

/**
 * Splitting up (roadmap phase 2): a stop can be for some of the group ("Who's going?"); when a part of the
 * day has stops for different people, each group gets a colour — a rail on its stops and a chip in the
 * part's header — and one stop can be the meet-up point where everyone joins again.
 */

/** Lane colours (text ≥ 4.5:1 on surface in both themes). */
export const LANE_COLORS = ["var(--color-primary)", "var(--color-accent-700)", "var(--color-gold-700)", "var(--color-ink-2)"];

const keyOf = (ids: string[]) => [...ids].sort().join(",");

/** The distinct groups in a part of the day (only when there are at least two, or one that isn't everyone). */
export function lanesOf(items: ItemView[]): { key: string; ids: string[]; color: string }[] {
  const seen = new Map<string, string[]>();
  for (const i of items) if (i.assignees.length) seen.set(keyOf(i.assignees), [...i.assignees].sort());
  return [...seen.entries()].map(([key, ids], n) => ({ key, ids, color: LANE_COLORS[n % LANE_COLORS.length] }));
}
export const laneKey = (item: ItemView) => (item.assignees.length ? keyOf(item.assignees) : null);

export function useNames(trip: TripDetail) {
  const { locale } = useI18n();
  const and = locale === "vi" ? "và" : "&";
  const memberOf = (id: string) => trip.members.find((m) => m.user.id === id);
  return (ids: string[]) => nameList(ids.map((id) => memberOf(id)).filter((m): m is MemberView => !!m).map((m) => firstName(m.user)), and);
}

/** On a stop: who's going (small avatars + names), and the meet-up flag. */
export function GoingLine({ trip, item, color }: { trip: TripDetail; item: ItemView; color?: string }) {
  const { m } = useI18n();
  const t = m.during.split;
  const names = useNames(trip);
  if (!item.assignees.length && !item.meetup) return null;
  const people = item.assignees.map((id) => trip.members.find((x) => x.user.id === id)?.user).filter((u) => !!u);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {item.assignees.length > 0 && (
        <span role="img" className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color }} aria-label={t.goingLabel(names(item.assignees))}>
          <span className="flex" aria-hidden>
            {people.map((u, n) => (
              <span key={u!.id} className={cx("rounded-full ring-2 ring-surface", n > 0 && "-ml-1.5")}>
                <Avatar user={u} size={18} />
              </span>
            ))}
          </span>
          <span aria-hidden>{names(item.assignees)}</span>
        </span>
      )}
      {item.meetup && (
        <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-gold-700">
          <Flag className="size-3" aria-hidden /> {t.meetup}
        </span>
      )}
    </div>
  );
}

/** In a part of the day's header when the group splits: one chip per group in its colour. */
export function LaneChips({ trip, lanes }: { trip: TripDetail; lanes: ReturnType<typeof lanesOf> }) {
  const { m } = useI18n();
  const names = useNames(trip);
  if (lanes.length === 0) return null;
  return (
    <div className="relative mb-1.5 flex flex-wrap items-center gap-1.5 sm:pl-[62px]" aria-label={m.during.split.lanes} role="group">
      <Users className="size-3.5 text-muted" aria-hidden />
      <span className="sr-only">{m.during.split.lanes}:</span>
      {lanes.map((l) => (
        <span key={l.key} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: l.color, borderColor: l.color }}>
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: l.color }} />
          {names(l.ids)}
        </span>
      ))}
    </div>
  );
}

/** "Who's going?" — tick the people going to this stop; everyone ticked (the default) means the whole group. */
export function AssignSheet({ trip, item, onClose }: { trip: TripDetail; item: ItemView | null; onClose: () => void }) {
  const { m } = useI18n();
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? m.during.split.whoTitle(item.title) : m.during.split.who}>
      {item && <AssignBody key={item.id} trip={trip} item={item} onDone={onClose} />}
    </Sheet>
  );
}

function AssignBody({ trip, item, onDone }: { trip: TripDetail; item: ItemView; onDone: () => void }) {
  const { m } = useI18n();
  const t = m.during.split;
  const all = trip.members.map((x) => x.user.id);
  const [who, setWho] = useState<string[]>(item.assignees.length ? item.assignees : all);
  const save = useAction((ids: string[]) => api.put(`/items/${item.id}/assignees`, { userIds: ids.length === all.length ? [] : ids }), {
    invalidate: [keys.trip(trip.id)],
    success: t.saved,
  });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (who.length === 0) return;
        if (await save.run(who)) onDone();
      }}
      className="space-y-4"
    >
      <p className="text-sm text-ink-2">{t.everyoneHint}</p>
      <div className="flex justify-end">
        <button type="button" onClick={() => setWho(all)} className="h-8 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary-50">
          {t.everyone}
        </button>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {trip.members.map((x) => {
          const on = who.includes(x.user.id);
          return (
            <li key={x.user.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={on} onChange={() => setWho((w) => (on ? w.filter((id) => id !== x.user.id) : [...w, x.user.id]))} className="size-4 accent-[var(--color-primary)]" />
                <Avatar user={x.user} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm">{x.user.displayName}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <SheetActions>
        <Button type="submit" size="lg" className="w-full" disabled={save.isPending || who.length === 0}>
          {t.save}
        </Button>
      </SheetActions>
    </form>
  );
}
