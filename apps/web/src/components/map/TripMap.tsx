"use client";

import type { DirectionsMode, ItemView, PlaceView, TripDetail } from "@triply/shared";
import { Lightbulb, Navigation, Star, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useT } from "@/i18n/client";
import { drawDuration, easeInOut, measurePolyline, prefersReducedMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import { DAY_COLORS, dayColor, dayStats, formatKm, haversineKm } from "@/lib/trip-geo";
import { defaultMode, DirectionsPanel, useDirections, useGeolocation, type LatLng } from "./Directions";
import { placeRider, vehicleFor } from "./rider";
import { mapStyleFor } from "./TileMap";
import type { DayFilter } from "../trip/DayBar";
import { cx } from "../ui";

const TileMap = dynamic(() => import("./TileMap").then((m) => m.TileMap), { ssr: false });
const TILES_ENABLED = process.env.NEXT_PUBLIC_MAP_STYLE_URL !== "off";

/**
 * Trip map (spec §14) — numbered pins in each day's colour, the day's route, and the selected stop.
 *
 * Renders real tiles with MapLibre (<TileMap>) and falls back to <MapCanvas>, an offline,
 * dependency-free SVG projection, when WebGL/tiles are unavailable or
 * NEXT_PUBLIC_MAP_STYLE_URL=off. Routes are straight lines between stops; a RouteProvider
 * (routing API) can replace them later without changing TripMap's props.
 *
 * The day filter is owned by the page (shared with the itinerary through <DayBar>).
 * Size it with `className` (e.g. `h-[440px]`, or `h-full` inside a sticky column).
 */
/** The viewer's position and (once found) their route to the selected stop. */
export interface MapDirections {
  from: LatLng;
  to: LatLng;
  geometry: [number, number][] | null;
}

export interface MapStop {
  item: ItemView;
  place: PlaceView;
  /** 0 for ideas in the pool. */
  dayNumber: number;
  order: number;
  /** An idea from the pool: a hollow pin, on the map whatever day is shown, never on a route. */
  pooled?: boolean;
}

const COLORS = [...DAY_COLORS];

export function TripMap({
  trip,
  day,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  className,
  flush,
}: {
  trip: TripDetail;
  day: DayFilter;
  selectedId?: string | null;
  /** The stop under the pointer in the itinerary (its pin lifts); `onHover` reports pins under the pointer. */
  hoveredId?: string | null;
  onSelect?: (item: ItemView) => void;
  onHover?: (itemId: string | null) => void;
  className?: string;
  /** Edge to edge (no border or rounded corners), for the full-height planner column. */
  flush?: boolean;
}) {
  const days = trip.days;
  const [tiles, setTiles] = useState(TILES_ENABLED);
  const { theme } = useTheme();
  const { m: t, locale } = useI18n();
  const tm = t.trips.map;

  const stops: MapStop[] = useMemo(() => {
    const out: MapStop[] = [];
    for (const d of days) {
      let order = 0;
      for (const item of d.items) {
        if (item.place) out.push({ item, place: item.place, dayNumber: d.dayNumber, order: ++order });
      }
    }
    for (const item of trip.pool) if (item.place) out.push({ item, place: item.place, dayNumber: 0, order: 0, pooled: true });
    return out;
  }, [days, trip.pool]);

  const visible = stops.filter((s) => s.pooled || day === "all" || s.dayNumber === day);
  const planned = visible.filter((s) => !s.pooled);
  const selected = visible.find((s) => s.item.id === selectedId) ?? null;
  const shownDay = day === "all" ? null : days.find((d) => d.dayNumber === day);

  // Directions to the selected stop, from where the viewer is (one position fix, on request).
  const geo = useGeolocation();
  const [dirFor, setDirFor] = useState<string | null>(null);
  const [chosenMode, setChosenMode] = useState<DirectionsMode | null>(null);
  const dirOpen = !!selected && dirFor === selected.item.id;
  const dest = selected ? { lat: selected.place.lat, lng: selected.place.lng } : null;
  const from = dirOpen && geo.state.status === "ok" ? geo.state.at : null;
  const mode: DirectionsMode = chosenMode ?? (from && dest ? defaultMode(from, dest) : "walk");
  const route = useDirections(from, dest ?? { lat: 0, lng: 0 }, mode);
  const openDirections = () => {
    if (!selected) return;
    setDirFor(selected.item.id);
    setChosenMode(null);
    if (geo.state.status !== "ok") geo.request();
  };
  const directions = dirOpen && from && dest ? { from, to: dest, geometry: route.data?.geometry ?? null } : null;
  const km = shownDay ? dayStats(shownDay).km : 0;

  return (
    <div className={cx("relative isolate overflow-hidden bg-map", !flush && "rounded-[var(--radius-card)] border border-line", className ?? "h-[440px]")}>
      {tiles ? (
        <TileMap
          key={theme}
          styleUrl={mapStyleFor(theme)}
          stops={visible}
          colors={COLORS}
          selectedId={selectedId}
          hoveredId={hoveredId}
          revealKey={String(day)}
          onSelect={onSelect}
          onHover={onHover}
          directions={directions}
          youLabel={tm.directions.you}
          onFail={() => setTiles(false)}
        />
      ) : (
        <MapCanvas stops={visible} selectedId={selectedId} hoveredId={hoveredId} revealKey={String(day)} onSelect={onSelect} onHover={onHover} directions={directions} />
      )}
      <div className={cx("pointer-events-none absolute z-10 flex gap-2", flush ? "left-4 top-4" : "left-3 top-3")}>
        <span className="rounded-[10px] border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold">
          {shownDay ? (
            <>
              {tm.dayRoute(shownDay.dayNumber)}
              {km > 0 && <span className="font-mono font-normal text-muted"> · {formatKm(km, locale)}</span>}
            </>
          ) : (
            <>
              {tm.allDays} <span className="font-mono font-normal text-muted">· {t.format.stops(planned.length)}</span>
            </>
          )}
        </span>
      </div>
      {planned.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-6 text-center text-sm text-muted">
          {stops.some((s) => !s.pooled) ? tm.noPlacesDay : tm.noPlaces}
        </div>
      )}
      {selected && (
        <div
          className={cx(
            "absolute z-10 rounded-2xl border border-line bg-surface p-3 shadow-pop sm:right-auto",
            dirOpen ? "sm:w-[24rem]" : "sm:w-[22rem]",
            flush ? "inset-x-4 bottom-4" : "inset-x-3 bottom-3",
          )}
        >
          <div className="flex items-center gap-3">
            {selected.pooled ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong bg-surface text-gold-700" aria-hidden>
                <Lightbulb className="size-4" />
              </span>
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-semibold text-white" style={{ background: dayColor(selected.dayNumber) }}>
                {selected.order}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{selected.place.name}</div>
              <div className="truncate text-[13px] text-muted">
                {selected.pooled ? t.trips.plan.pool.onMap : t.trips.day(selected.dayNumber)}
                {selected.item.startTime && <span className="font-mono"> · {selected.item.startTime}</span>} · {selected.place.categoryLabel || t.labels.itemType[selected.place.category]}
                {selected.place.rating && (
                  <span className="ml-1 inline-flex items-center gap-0.5">
                    <Star className="size-3 fill-gold text-gold" aria-hidden /> {selected.place.rating}
                  </span>
                )}
              </div>
              <div className="hidden truncate font-mono text-xs text-ink-2 sm:block">
                {Math.abs(selected.place.lat).toFixed(4)}° {selected.place.lat >= 0 ? tm.north : tm.south}, {Math.abs(selected.place.lng).toFixed(4)}° {selected.place.lng >= 0 ? tm.east : tm.west}
              </div>
            </div>
            {!dirOpen && (
              <button
                type="button"
                onClick={openDirections}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary hover:bg-primary hover:text-on-primary"
                aria-label={tm.directions.openLabel(selected.place.name)}
                title={tm.directions.open}
              >
                <Navigation className="size-4" />
              </button>
            )}
            <button type="button" onClick={() => onSelect?.(selected.item)} aria-label={tm.closeDetails} className="-mr-1 flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-sand-2 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          {dirOpen && (
            <DirectionsPanel
              name={selected.place.name}
              to={dest!}
              geo={geo.state}
              mode={mode}
              onMode={setChosenMode}
              route={route}
              onRetry={() => (geo.state.status === "ok" ? void route.refetch() : geo.request())}
              onClose={() => setDirFor(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MapCanvas({
  stops,
  selectedId,
  hoveredId,
  revealKey,
  onSelect,
  onHover,
  directions,
}: {
  stops: MapStop[];
  selectedId?: string | null;
  hoveredId?: string | null;
  revealKey: string;
  onSelect?: (i: ItemView) => void;
  onHover?: (id: string | null) => void;
  directions?: MapDirections | null;
}) {
  // Drawn at the box's real pixel size, so pins and labels stay the same size on a phone and a desktop.
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 440 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size.w;
  const H = size.h;
  const pad = Math.min(64, Math.max(40, W * 0.08));
  const top = pad + 28; // clear of the "Day N route" label

  // Equirectangular projection fitted to the visible stops' bounding box.
  const proj = useMemo(() => {
    if (stops.length === 0) return null;
    // With directions open, the frame also takes in the viewer and their route.
    const extra = directions ? [[directions.from.lng, directions.from.lat], ...(directions.geometry ?? [])] : [];
    // Frame the planned stops; ideas only when nothing is planned (they may lie far outside the day).
    const framed = stops.some((s) => !s.pooled) ? stops.filter((s) => !s.pooled) : stops;
    const lats = [...framed.map((s) => s.place.lat), ...extra.map((c) => c[1])];
    const lngs = [...framed.map((s) => s.place.lng), ...extra.map((c) => c[0])];
    let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const minSpan = 0.02;
    if (maxLat - minLat < minSpan) [minLat, maxLat] = [minLat - minSpan, maxLat + minSpan];
    if (maxLng - minLng < minSpan) [minLng, maxLng] = [minLng - minSpan, maxLng + minSpan];
    const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const sx = (W - pad * 2) / ((maxLng - minLng) * k);
    const sy = (H - top - pad) / (maxLat - minLat);
    const s = Math.min(sx, sy);
    const ox = (W - (maxLng - minLng) * k * s) / 2;
    const oy = top + (H - top - pad - (maxLat - minLat) * s) / 2;
    return (lat: number, lng: number) => [ox + (lng - minLng) * k * s, oy + (maxLat - lat) * s] as const;
  }, [stops, W, H, pad, top, directions]);

  const byDay = useMemo(() => {
    const m = new Map<number, MapStop[]>();
    stops.forEach((s) => !s.pooled && m.set(s.dayNumber, [...(m.get(s.dayNumber) ?? []), s]));
    return m;
  }, [stops]);

  // When each pin pops in: the fraction of its day's (projected) route at which it sits.
  const duration = drawDuration(Math.max(1, ...[...byDay.values()].map((l) => l.length)));
  const appearAt = useMemo(() => {
    const out = new Map<string, number>();
    if (!proj) return out;
    for (const list of byDay.values()) {
      const at = list.length > 1 ? measurePolyline(list.map((s) => [...proj(s.place.lat, s.place.lng)] as [number, number]), { planar: true }).at : [0];
      list.forEach((s, i) => out.set(s.item.id, at[i] ?? 0));
    }
    return out;
  }, [byDay, proj]);

  // A vehicle rides each day's line while it draws — same clock as .route-draw (150 ms delay, ease-in-out cubic).
  const riderEls = useRef(new Map<number, SVGGElement>());
  const drawing = useRef({ byDay, proj, duration });
  useEffect(() => {
    drawing.current = { byDay, proj, duration };
  });
  const ready = !!proj;
  useEffect(() => {
    const { byDay, proj, duration } = drawing.current;
    if (!proj || prefersReducedMotion()) return;
    const routes = [...byDay.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([day, list]) => {
        const pts = list.map((s) => [...proj(s.place.lat, s.place.lng)] as [number, number]);
        return { day, list, pts, line: measurePolyline(pts, { planar: true }), g: riderEls.current.get(day) };
      });
    const start = performance.now() + 150;
    let raf = 0;
    const frame = (now: number) => {
      const p = easeInOut(Math.min(1, Math.max(0, (now - start) / duration)));
      for (const r of routes) {
        if (!r.g) continue;
        const { point, leg, legT } = r.line.tip(p);
        const [a, b] = [r.pts[leg - 1], r.pts[leg]];
        r.g.setAttribute("transform", `translate(${point[0].toFixed(1)} ${point[1].toFixed(1)})`);
        placeRider(r.g, vehicleFor(haversineKm(r.list[leg - 1].place, r.list[leg].place)), dayColor(r.day), (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, legT);
        r.g.classList.toggle("is-done", p >= 1);
      }
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [revealKey, ready]);

  return (
    <div ref={box} className="absolute inset-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label={t.trips.map.simplified(stops.length)}>
        {/* Atlas paper map: decorative contour lines and a river, then the routes and numbered pins. */}
        {[0.25, 0.34, 0.86, 0.95].map((f, i) => {
          const y = H * f;
          return <path key={f} d={`M-40 ${y} C ${W * 0.2} ${y - 40 + i * 6}, ${W * 0.37} ${y + 40}, ${W * 0.57} ${y - 4} S ${W * 0.93} ${y - 60}, ${W + 40} ${y - 20}`} fill="none" stroke="var(--color-contour)" strokeWidth="2" />;
        })}
        <path d={`M${W * 0.72} -20 C ${W * 0.68} ${H * 0.27}, ${W * 0.76} ${H * 0.5}, ${W * 0.73} ${H * 0.73} S ${W * 0.8} ${H * 1.05}, ${W * 0.79} ${H + 40}`} fill="none" stroke="var(--color-water)" strokeWidth="14" strokeLinecap="round" opacity="0.8" />
        <g transform={`translate(${W - 36}, 36)`} opacity="0.6">
          <circle r="14" fill="none" stroke="var(--color-muted)" />
          <path d="M0 -10 L3.5 0 L0 10 L-3.5 0Z" fill="var(--color-muted)" />
        </g>

        {proj && directions && (
          <g aria-hidden>
            {directions.geometry && (
              <>
                <polyline points={directions.geometry.map(([lng, lat]) => proj(lat, lng).join(",")).join(" ")} fill="none" stroke="var(--color-surface)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={directions.geometry.map(([lng, lat]) => proj(lat, lng).join(",")).join(" ")} pathLength={1} className="route-draw" fill="none" stroke="var(--color-primary)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
            <g transform={`translate(${proj(directions.from.lat, directions.from.lng).join(",")})`}>
              <circle r="16" fill="var(--color-primary)" opacity="0.18" />
              <circle r="8" fill="var(--color-primary)" stroke="var(--color-pin-ring)" strokeWidth="3" />
            </g>
          </g>
        )}
        {/* Keyed by the day filter: choosing a day replays the route drawing and the pins popping in. */}
        {proj && (
          <g key={revealKey}>
            {[...byDay.entries()].map(([day, list]) => (
              <polyline
                key={day}
                points={list.map((s) => proj(s.place.lat, s.place.lng).join(",")).join(" ")}
                pathLength={1}
                className="route-draw"
                style={{ "--draw": `${duration}ms` } as React.CSSProperties}
                fill="none"
                stroke={dayColor(day)}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            ))}
            {[...stops].sort((a, b) => Number(!!b.pooled) - Number(!!a.pooled)).map((s) => {
              const [x, y] = proj(s.place.lat, s.place.lng);
              const color = dayColor(s.dayNumber);
              const sel = s.item.id === selectedId;
              return (
                <g
                  key={s.item.id}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => onSelect?.(s.item)}
                  onMouseEnter={() => onHover?.(s.item.id)}
                  onMouseLeave={() => onHover?.(null)}
                  className="cursor-pointer"
                  role="button"
                  aria-label={s.pooled ? t.trips.plan.pool.pinLabel(s.place.name) : t.trips.map.pin(s.place.name, s.dayNumber)}
                >
                  {/* Ideas appear once the routes have drawn. */}
                  <g className="svg-pin-in" style={{ "--delay": `${Math.round(150 + (s.pooled ? 1 : (appearAt.get(s.item.id) ?? 0)) * duration)}ms` } as React.CSSProperties}>
                    <g className={cx("svg-pin", hoveredId === s.item.id && "is-hover")}>
                      {sel && <circle r="21" fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth="4" />}
                      {s.pooled ? (
                        <>
                          <circle r={sel ? 12 : 10} fill="var(--color-surface)" stroke="var(--color-ink-2)" strokeWidth="2" strokeDasharray="3 2.5" />
                          <circle r="3.5" fill="var(--color-gold)" />
                        </>
                      ) : (
                        <>
                          <circle r={sel ? 15 : 14} fill={color} stroke={sel ? "none" : "var(--color-pin-ring)"} strokeWidth="2" />
                          <text y="4.5" textAnchor="middle" fontSize="13" fontWeight="600" fontFamily="var(--font-mono)" fill="#fff">
                            {s.order}
                          </text>
                        </>
                      )}
                    </g>
                  </g>
                </g>
              );
            })}
            {[...byDay.entries()]
              .filter(([, list]) => list.length > 1)
              .map(([day]) => (
                <g
                  key={`rider-${day}`}
                  aria-hidden
                  className="golaly-rider"
                  ref={(el) => {
                    if (el) riderEls.current.set(day, el);
                    else riderEls.current.delete(day);
                  }}
                />
              ))}
          </g>
        )}
      </svg>
    </div>
  );
}
