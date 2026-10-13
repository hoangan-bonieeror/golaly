/** Pure helpers — safe on server and client. Formatting follows the interface language (setFormatLocale). */
import type { Locale } from "@triply/shared";
import { CATALOGS, INTL_LOCALE } from "@/i18n/catalog";

/**
 * Default language for the formatters below when no locale is passed — set by the I18nProvider in the
 * browser. React components should prefer `useFormat()` (from "@/i18n/client"), which passes the
 * locale explicitly and is safe during server rendering.
 */
let fmt: Locale = "en";
export function setFormatLocale(l: Locale) {
  fmt = l;
}
export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function formatCount(n: number, l: Locale = fmt) {
  if (n < 1000) return String(n);
  const v = (n / 1000).toFixed(n >= 10000 ? 0 : 1);
  return `${l === "vi" ? v.replace(".", ",") : v}${CATALOGS[l].format.thousandSuffix}`;
}

export function timeAgo(iso: string, l: Locale = fmt) {
  const f = CATALOGS[l].format;
  const s = Math.max(1, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return f.justNow;
  const m = s / 60;
  if (m < 60) return f.minutesShort(Math.floor(m));
  const h = m / 60;
  if (h < 24) return f.hoursShort(Math.floor(h));
  const d = h / 24;
  if (d < 7) return f.daysShort(Math.floor(d));
  return new Date(iso).toLocaleDateString(INTL_LOCALE[l], { month: "short", day: "numeric" });
}

/** A date (YYYY-MM-DD) in the interface language, e.g. "Wed, 10 Mar" / "Th 4, 10 thg 3". */
export function formatDay(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }, l: Locale = fmt) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString(INTL_LOCALE[l], opts);
}

export function formatDateRange(start?: string, end?: string, l: Locale = fmt) {
  if (!start) return CATALOGS[l].format.datesNotSet;
  const d = (s: string) => new Date(s + "T00:00:00");
  const y = (s: string) => s.slice(0, 4);
  if (l === "vi") {
    // "10–16/3/2027", "28/2 – 3/3/2027", "30/12/2026 – 2/1/2027"
    const dm = (s: string) => `${d(s).getDate()}/${d(s).getMonth() + 1}`;
    if (!end || end === start) return `${dm(start)}/${y(start)}`;
    if (y(start) !== y(end)) return `${dm(start)}/${y(start)} – ${dm(end)}/${y(end)}`;
    if (start.slice(5, 7) === end.slice(5, 7)) return `${d(start).getDate()}–${dm(end)}/${y(end)}`;
    return `${dm(start)} – ${dm(end)}/${y(end)}`;
  }
  const md = (s: string) => d(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!end || end === start) return `${md(start)}, ${y(start)}`;
  if (y(start) !== y(end)) return `${md(start)}, ${y(start)} – ${md(end)}, ${y(end)}`;
  if (start.slice(5, 7) === end.slice(5, 7)) return `${md(start)} – ${d(end).getDate()}, ${y(end)}`;
  return `${md(start)} – ${md(end)}, ${y(end)}`;
}

/** Only allow same-site relative redirects after login (no open redirects). */
export function safeNext(next: string | null, fallback = "/home") {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
