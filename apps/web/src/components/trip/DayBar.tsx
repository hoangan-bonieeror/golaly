"use client";

import type { DayView } from "@triply/shared";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { dayColor } from "@/lib/trip-geo";

export type DayFilter = number | "all";

/**
 * Day chips shared by the itinerary and the map. The active day fills with its own colour
 * (white text ≥ 5.3:1); the others show a colour dot so pins on the map are easy to match.
 */
export function DayBar({ days, value, onChange, cityOf, className }: { days: DayView[]; value: DayFilter; onChange: (d: DayFilter) => void; cityOf?: (d: DayView) => string | null; className?: string }) {
  const t = useT();
  const chip = "flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors";
  return (
    <div role="group" aria-label={t.trips.map.showDay} className={cx("scrollbar-none flex gap-2 overflow-x-auto", className)}>
      <button type="button" aria-pressed={value === "all"} onClick={() => onChange("all")} className={cx(chip, value === "all" ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:border-ink-2")}>
        {t.trips.map.allDays}
      </button>
      {days.map((d) => {
        const on = value === d.dayNumber;
        const city = cityOf?.(d);
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(d.dayNumber)}
            className={cx(chip, on ? "border-transparent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-2")}
            style={on ? { background: dayColor(d.dayNumber) } : undefined}
          >
            {!on && <span aria-hidden className="size-2 rounded-full" style={{ background: dayColor(d.dayNumber) }} />}
            {t.trips.day(d.dayNumber)}
            {on && city && <span className="font-medium opacity-90">· {city}</span>}
          </button>
        );
      })}
    </div>
  );
}
