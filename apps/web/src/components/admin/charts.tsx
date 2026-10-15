"use client";

/**
 * Hand-drawn SVG charts for the admin analytics dashboard (no chart library).
 * One series per chart, in the primary hue; text always in ink tokens; hairline solid gridlines;
 * 2px lines, ≤ 24px bars with a 4px rounded data end; a crosshair + tooltip that also works from the keyboard;
 * and every chart has a table view so no value is hover-only.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cx } from "../ui";

const nf = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : nf.format(n));
const dayLabel = (iso: string, long = false) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(long ? { weekday: "short" } : {}), timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** A clean axis maximum (1, 2, 2.5, 5 × 10ⁿ) and its ticks. */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A tiny trend line for a stat tile (decorative: the tile states the number). */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 120;
  const h = 32;
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - (v / max) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className={className}>
      <path d={`${d} L${lx} ${h} L2 ${h} Z`} fill="var(--color-primary)" fillOpacity={0.1} />
      <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={3} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * One measure per day: columns (counts that happen, like sign-ups) or a line with a wash (levels, like active people).
 * Pointer or arrow keys move a crosshair that snaps to a day; the tooltip leads with the value.
 */
export function DailyChart({
  title,
  unit,
  data,
  kind,
  height = 220,
}: {
  title: string;
  /** e.g. "sign-ups" — read in the tooltip and table. */
  unit: string;
  data: { date: string; value: number }[];
  kind: "columns" | "line";
  height?: number;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const w = Math.max(width, 280);
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = data.length;
  const { top, ticks } = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const band = n ? iw / n : iw;
  const xAt = (i: number) => pad.l + band * i + band / 2;
  const yAt = (v: number) => pad.t + ih - (v / top) * ih;
  const barW = Math.max(1, Math.min(24, band - 2)); // 2px surface gap between touching columns
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));

  const fromPointer = useCallback(
    (clientX: number, el: SVGSVGElement) => {
      const x = clientX - el.getBoundingClientRect().left;
      const i = Math.round((x - pad.l - band / 2) / band);
      setActive(Math.max(0, Math.min(n - 1, i)));
    },
    [band, n, pad.l],
  );
  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setActive((a) => Math.max(0, Math.min(n - 1, (a ?? n - 1) + step)));
  };

  const line = data.map((d, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(d.value).toFixed(1)}`).join(" ");
  const cur = active !== null ? data[active] : null;
  const last = data[n - 1];

  return (
    <figure className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`${id}-t`} className="text-base font-semibold">
          {title}
        </h3>
        <button type="button" onClick={() => setTable((v) => !v)} className="min-h-9 text-sm font-medium text-primary hover:underline" aria-expanded={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </figcaption>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-sand-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {unit}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="px-3 py-1.5">{dayLabel(d.date, true)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{nf.format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          {width > 0 && (
            <svg
              width={w}
              height={height}
              role="img"
              aria-labelledby={`${id}-t`}
              aria-describedby={`${id}-d`}
              tabIndex={0}
              onKeyDown={onKey}
              onFocus={() => setActive((a) => a ?? n - 1)}
              onBlur={() => setActive(null)}
              onPointerMove={(e) => fromPointer(e.clientX, e.currentTarget)}
              onPointerLeave={() => setActive(null)}
              className="block touch-pan-y rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <desc id={`${id}-d`}>
                {`${n} days. Latest ${last ? `${dayLabel(last.date)}: ${nf.format(last.value)} ${unit}` : "none"}. Peak ${nf.format(Math.max(0, ...data.map((d) => d.value)))}. Use the arrow keys to read each day, or Show table.`}
              </desc>
              {/* Gridlines + y ticks: hairline, solid, recessive. */}
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={w - pad.r} y1={yAt(t)} y2={yAt(t)} stroke="var(--color-line)" strokeWidth={1} />
                  <text x={pad.l - 8} y={yAt(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)" className="tabular-nums">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) =>
                i % labelEvery === (n - 1) % labelEvery ? (
                  <text key={d.date} x={Math.min(Math.max(xAt(i), pad.l + 18), w - pad.r - 18)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                    {dayLabel(d.date)}
                  </text>
                ) : null,
              )}
              {kind === "columns"
                ? data.map((d, i) => {
                    const h = (d.value / top) * ih;
                    if (h <= 0) return null;
                    const x = xAt(i) - barW / 2;
                    const y = pad.t + ih - h;
                    const r = Math.min(4, barW / 2, h);
                    // Rounded data end, square at the baseline.
                    return (
                      <path
                        key={d.date}
                        d={`M${x} ${pad.t + ih} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + barW - r} Q${x + barW} ${y} ${x + barW} ${y + r} V${pad.t + ih} Z`}
                        fill="var(--color-primary)"
                        opacity={active === null || active === i ? 1 : 0.55}
                      />
                    );
                  })
                : n > 0 && (
                    <>
                      <path d={`${line} L${xAt(n - 1)} ${pad.t + ih} L${xAt(0)} ${pad.t + ih} Z`} fill="var(--color-primary)" fillOpacity={0.1} />
                      <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    </>
                  )}
              {/* Baseline */}
              <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--color-muted)" strokeOpacity={0.5} strokeWidth={1} />
              {cur && active !== null && (
                <g pointerEvents="none">
                  <line x1={xAt(active)} x2={xAt(active)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-ink-2)" strokeOpacity={0.5} strokeWidth={1} />
                  {kind === "line" && <circle cx={xAt(active)} cy={yAt(cur.value)} r={4.5} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={2} />}
                </g>
              )}
            </svg>
          )}
          {cur && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 min-w-28 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-card"
              style={{ left: Math.min(Math.max(xAt(active) - 56, 0), w - 128) }}
            >
              <div className="text-base font-semibold tabular-nums">{nf.format(cur.value)}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden className="inline-block h-0.5 w-3 rounded bg-primary" />
                {unit} · {dayLabel(cur.date, true)}
              </div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Horizontal bars with the value at the tip (a funnel, a top-N list). Every value is printed, so no hover is needed. */
export function BarList({
  rows,
  max,
  className,
}: {
  rows: { key: string; label: React.ReactNode; value: number; note?: string }[];
  /** The value a full-width bar stands for (default: the largest). */
  max?: number;
  className?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={cx("space-y-2.5", className)}>
      {rows.map((r) => {
        const pct = top ? (r.value / top) * 100 : 0;
        return (
          <li key={r.key} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(7rem,11rem)_1fr]">
            <span className="truncate text-ink-2">{r.label}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-5 rounded-r-[4px] bg-primary" style={{ width: `max(${pct > 0 ? 2 : 0}px, calc(${pct}% - 5.5rem))` }} aria-hidden />
              <span className="shrink-0 font-semibold tabular-nums">
                {nf.format(r.value)}
                {r.note && <span className="ml-1 font-normal text-muted">{r.note}</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A share of a whole: the fill on a lighter step of the same hue. */
export function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="font-semibold tabular-nums">
          {pct}% <span className="font-normal text-muted">· {fmt(value)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-primary-50" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
