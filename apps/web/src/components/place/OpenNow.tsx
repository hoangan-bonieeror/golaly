"use client";

import { localNowAt, openStateAt, parseOpeningHours, weekdayOf, type OpenState } from "@golaly/shared";
import { Clock } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/catalog";
import { useHydrated } from "@/lib/api/queries";
import { useNow } from "@/lib/hooks";
import { cx } from "../ui";
import { formatOpeningHours } from "./categoryMeta";

type Hours = { openingHours: string | null; lat: number; lng: number };

/**
 * Open right now — in the place's own local time (inferred from its coordinates), not the viewer's: someone in
 * California looking at a café in Hội An needs Hội An's clock. Rendered only after hydration (the server can't
 * know "now" the way the browser does), and refreshed every minute.
 */
export function useOpenState(place: Hours): { state: OpenState; local: { date: string; time: string } } | null {
  const hydrated = useHydrated();
  const now = useNow();
  if (!hydrated || !place.openingHours) return null;
  const local = localNowAt(place.lat, place.lng, now);
  return { state: openStateAt(place.openingHours, local.date, local.time), local };
}

export function OpenNowPill({ place, className }: { place: Hours; className?: string }) {
  const t = useI18n().m.explore.place.now;
  const s = useOpenState(place);
  if (!s || s.state.state === "unknown") return null;
  const open = s.state.state === "open";
  const label = s.state.state === "open" ? (s.state.until ? t.openUntil(s.state.until) : t.open24) : s.state.opensAt ? t.closedOpens(s.state.opensAt) : t.closed;
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold", open ? "bg-primary-50 text-primary" : "bg-accent-50 text-accent-700", className)}
      title={t.localTime(s.local.time)}
    >
      <span aria-hidden className={cx("size-2 rounded-full", open ? "bg-primary" : "bg-accent-700")} />
      {label}
    </span>
  );
}

/** The week's hours, Monday first, with today (at the place) marked (the page header carries the open-now pill); falls back to the listed text when unreadable. */
export function WeekHours({ place }: { place: Hours }) {
  const { m, locale } = useI18n();
  const t = m.explore.place.week;
  const s = useOpenState(place);
  if (!place.openingHours) return null;
  const week = parseOpeningHours(place.openingHours);
  const today = s ? weekdayOf(s.local.date) : -1;
  // 2024-01-01 was a Monday.
  const dayName = (d: number) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + d)));
  const hm = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  return (
    <section aria-labelledby="week-hours" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
      <h2 id="week-hours" className="mb-2 flex items-center gap-2 font-display text-[22px] font-semibold">
        <Clock className="size-5 text-muted" aria-hidden /> {t.title}
      </h2>
      {week ? (
        <table className="w-full text-sm">
          <tbody>
            {week.map((spans, d) => {
              const isToday = d === today;
              const allDay = spans.length === 1 && spans[0][0] === 0 && spans[0][1] >= 1440;
              return (
                <tr key={d} className={cx("border-t border-line first:border-t-0", isToday && "font-semibold text-ink")} aria-current={isToday ? "date" : undefined}>
                  <th scope="row" className={cx("py-2 pr-3 text-left font-medium capitalize", isToday ? "text-ink" : "text-ink-2")}>
                    {dayName(d)}
                    {isToday && <span className="ml-2 rounded-full bg-sand-2 px-2 py-px text-[11px] font-semibold normal-case text-ink-2">{t.today}</span>}
                  </th>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {spans.length === 0 ? <span className="font-sans text-muted">{t.closed}</span> : allDay ? <span className="font-sans">{t.allDay}</span> : spans.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="text-sm">
          <ul>
            {formatOpeningHours(place.openingHours, locale).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">{t.raw}</p>
        </div>
      )}
    </section>
  );
}
