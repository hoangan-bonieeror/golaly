/** Pure helpers — safe on server and client. */
export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function formatCount(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function timeAgo(iso: string) {
  const s = Math.max(1, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateRange(start?: string, end?: string) {
  if (!start) return "Dates not set";
  const d = (s: string) => new Date(s + "T00:00:00");
  const md = (s: string) => d(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const y = (s: string) => s.slice(0, 4);
  if (!end || end === start) return `${md(start)}, ${y(start)}`;
  if (y(start) !== y(end)) return `${md(start)}, ${y(start)} – ${md(end)}, ${y(end)}`;
  if (start.slice(5, 7) === end.slice(5, 7)) return `${md(start)} – ${d(end).getDate()}, ${y(end)}`;
  return `${md(start)} – ${md(end)}, ${y(end)}`;
}
