/**
 * Is a place open right now? A small evaluator for the common part of OpenStreetMap's `opening_hours`
 * syntax — enough for "Where to now?" — that says "unknown" rather than guess at anything else.
 *
 * Understood: `24/7`; rules separated by `;` (or `||`), a later rule replacing earlier ones for the days it
 * names; weekday lists and ranges (`Mo-Fr`, `Sa,Su`, `Fr-Mo` wraps); time spans with breaks
 * (`08:00-12:00,13:00-17:30`), past midnight (`18:00-02:00`), `24:00` and open ends (`18:00+`);
 * `off` / `closed`; quoted comments. Public holidays (`PH`, `SH`) are ignored when combined with weekdays.
 * Anything else — months, dates, weeks, sunrise/sunset, `open "…"` modifiers — gives "unknown".
 */

export type OpenState =
  | { state: "open"; /** HH:mm today or after midnight; null when open around the clock. */ until: string | null }
  | { state: "closed"; /** HH:mm later today, or null if not again today. */ opensAt: string | null }
  | { state: "unknown" };

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
type Span = [start: number, end: number];
type Week = Span[][];

class Unsupported extends Error {}

const minutes = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) throw new Unsupported(hm);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 48 || min > 59) throw new Unsupported(hm);
  return h * 60 + min;
};

function parseDays(sel: string): number[] {
  const out = new Set<number>();
  for (const part of sel.split(",")) {
    const p = part.trim();
    if (p === "PH" || p === "SH") continue;
    const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(p);
    if (!range) throw new Unsupported(p);
    const a = DAYS.indexOf(range[1] as (typeof DAYS)[number]);
    const b = range[2] ? DAYS.indexOf(range[2] as (typeof DAYS)[number]) : a;
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
  }
  return [...out];
}

function parseSpans(sel: string): Span[] {
  return sel.split(",").map((part) => {
    const p = part.trim();
    const open = /^(\d{1,2}:\d{2})\+$/.exec(p);
    if (open) return [minutes(open[1]), 24 * 60] as Span;
    const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(p);
    if (!m) throw new Unsupported(p);
    const start = minutes(m[1]);
    let end = minutes(m[2]);
    if (end <= start) end += 24 * 60; // past midnight
    return [start, end] as Span;
  });
}

/** The week as spans per weekday (Mo = 0), or null when the expression can't be read. */
export function parseOpeningHours(spec: string): Week | null {
  const text = spec.replace(/"[^"]*"/g, "").trim();
  if (!text) return null;
  if (text === "24/7") return DAYS.map(() => [[0, 24 * 60]]);
  try {
    const week: Week = DAYS.map(() => []);
    let any = false;
    for (const raw of text.split(/;|\|\|/)) {
      const rule = raw.trim();
      if (!rule) continue;
      const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?))*)?\s*(.*)$/.exec(rule);
      if (!m) return null;
      const daySel = m[1]?.replace(/\s+/g, "");
      const rest = m[2].trim();
      const days = daySel ? parseDays(daySel) : [0, 1, 2, 3, 4, 5, 6];
      if (daySel && days.length === 0) continue; // a holidays-only rule
      const spans = rest === "" ? (daySel ? [[0, 24 * 60] as Span] : null) : /^(off|closed)$/i.test(rest) ? [] : rest === "24/7" ? [[0, 24 * 60] as Span] : parseSpans(rest);
      if (!spans) return null;
      for (const d of days) week[d] = spans; // a later rule replaces the day
      any = true;
    }
    return any ? week : null;
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}

const hm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Monday = 0 for a YYYY-MM-DD date. */
export function weekdayOf(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Open or closed at a local date and time (the place's own clock: YYYY-MM-DD and HH:mm). A span that runs past
 * midnight counts on the next day too; "until" follows a span into the next day's when they join up.
 */
export function openStateAt(spec: string | null | undefined, date: string, time: string): OpenState {
  if (!spec) return { state: "unknown" };
  const week = parseOpeningHours(spec);
  if (!week) return { state: "unknown" };
  const w = weekdayOf(date);
  const t = minutes(time);
  const prev = (w + 6) % 7;
  // Today's spans, plus yesterday's that run past midnight (shifted into today).
  const today: Span[] = [...week[w], ...week[prev].filter(([, e]) => e > 1440).map(([, e]) => [0, e - 1440] as Span)].sort((a, b) => a[0] - b[0]);
  const hit = today.find(([s, e]) => s <= t && t < e);
  if (hit) {
    const allDay = week.every((d) => d.some(([s, e]) => s === 0 && e >= 1440));
    if (allDay) return { state: "open", until: null };
    let end = hit[1];
    // Joined to the next day's opening at midnight (e.g. 18:00-24:00 then 00:00-02:00).
    if (end === 1440) {
      const next = week[(w + 1) % 7].find(([s]) => s === 0);
      if (next) end = 1440 + next[1];
    }
    // Merge back-to-back spans today.
    for (const [s, e] of today) if (s === end) end = e;
    return { state: "open", until: hm(end) };
  }
  const later = today.filter(([s]) => s > t).sort((a, b) => a[0] - b[0])[0];
  return { state: "closed", opensAt: later ? hm(later[0]) : null };
}
