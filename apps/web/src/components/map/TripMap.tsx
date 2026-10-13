"use client";

import { ITEM_TYPE_LABEL, type ItemView, type PlaceView, type TripDetail } from "@triply/shared";
import { Navigation, Star, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { DAY_COLORS, dayColor, dayStats, formatKm } from "@/lib/trip-geo";
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
export interface MapStop {
  item: ItemView;
  place: PlaceView;
  dayNumber: number;
  order: number;
}

const COLORS = [...DAY_COLORS];

export function TripMap({
  trip,
  day,
  selectedId,
  onSelect,
  className,
}: {
  trip: TripDetail;
  day: DayFilter;
  selectedId?: string | null;
  onSelect?: (item: ItemView) => void;
  className?: string;
}) {
  const days = trip.days;
  const [tiles, setTiles] = useState(TILES_ENABLED);

  const stops: MapStop[] = useMemo(() => {
    const out: MapStop[] = [];
    for (const d of days) {
      let order = 0;
      for (const item of d.items) {
        if (item.place) out.push({ item, place: item.place, dayNumber: d.dayNumber, order: ++order });
      }
    }
    return out;
  }, [days]);

  const visible = stops.filter((s) => day === "all" || s.dayNumber === day);
  const selected = visible.find((s) => s.item.id === selectedId) ?? null;
  const shownDay = day === "all" ? null : days.find((d) => d.dayNumber === day);
  const km = shownDay ? dayStats(shownDay).km : 0;

  return (
    <div className={cx("relative isolate overflow-hidden rounded-[var(--radius-card)] border border-line bg-map", className ?? "h-[440px]")}>
      {tiles ? (
        <TileMap stops={visible} colors={COLORS} selectedId={selectedId} onSelect={onSelect} onFail={() => setTiles(false)} />
      ) : (
        <MapCanvas stops={visible} selectedId={selectedId} onSelect={onSelect} />
      )}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex gap-2">
        <span className="rounded-[10px] border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold">
          {shownDay ? (
            <>
              Day {shownDay.dayNumber} route{km > 0 && <span className="font-mono font-normal text-muted"> · {formatKm(km)}</span>}
            </>
          ) : (
            <>
              All days <span className="font-mono font-normal text-muted">· {visible.length} stops</span>
            </>
          )}
        </span>
      </div>
      {visible.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-muted">
          {stops.length ? "No places on this day yet." : "Add places to your itinerary to see them on the map."}
        </div>
      )}
      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-pop sm:right-auto sm:w-[22rem]">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-semibold text-white" style={{ background: dayColor(selected.dayNumber) }}>
            {selected.order}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{selected.place.name}</div>
            <div className="truncate text-[13px] text-muted">
              Day {selected.dayNumber}
              {selected.item.startTime && <span className="font-mono"> · {selected.item.startTime}</span>} · {selected.place.categoryLabel || ITEM_TYPE_LABEL[selected.place.category]}
              {selected.place.rating && (
                <span className="ml-1 inline-flex items-center gap-0.5">
                  <Star className="size-3 fill-gold text-gold" aria-hidden /> {selected.place.rating}
                </span>
              )}
            </div>
            <div className="hidden truncate font-mono text-xs text-ink-2 sm:block">
              {Math.abs(selected.place.lat).toFixed(4)}° {selected.place.lat >= 0 ? "N" : "S"}, {Math.abs(selected.place.lng).toFixed(4)}° {selected.place.lng >= 0 ? "E" : "W"}
            </div>
          </div>
          <a
            href={`https://www.openstreetmap.org/?mlat=${selected.place.lat}&mlon=${selected.place.lng}#map=16/${selected.place.lat}/${selected.place.lng}`}
            target="_blank"
            rel="noreferrer"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary hover:bg-primary hover:text-white"
            aria-label={`Open ${selected.place.name} in OpenStreetMap`}
          >
            <Navigation className="size-4" />
          </a>
          <button type="button" onClick={() => onSelect?.(selected.item)} aria-label="Close place details" className="-mr-1 flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-sand-2 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function MapCanvas({ stops, selectedId, onSelect }: { stops: MapStop[]; selectedId?: string | null; onSelect?: (i: ItemView) => void }) {
  // Drawn at the box's real pixel size, so pins and labels stay the same size on a phone and a desktop.
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
    const lats = stops.map((s) => s.place.lat);
    const lngs = stops.map((s) => s.place.lng);
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
  }, [stops, W, H, pad, top]);

  const byDay = useMemo(() => {
    const m = new Map<number, MapStop[]>();
    stops.forEach((s) => m.set(s.dayNumber, [...(m.get(s.dayNumber) ?? []), s]));
    return m;
  }, [stops]);

  return (
    <div ref={box} className="absolute inset-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`Map of ${stops.length} trip stops (simplified)`}>
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

        {proj &&
          [...byDay.entries()].map(([day, list]) => (
            <polyline
              key={day}
              points={list.map((s) => proj(s.place.lat, s.place.lng).join(",")).join(" ")}
              fill="none"
              stroke={dayColor(day)}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
          ))}

        {proj &&
          stops.map((s) => {
            const [x, y] = proj(s.place.lat, s.place.lng);
            const color = dayColor(s.dayNumber);
            const sel = s.item.id === selectedId;
            return (
              <g
                key={s.item.id}
                transform={`translate(${x}, ${y})`}
                onClick={() => onSelect?.(s.item)}
                className="cursor-pointer"
                role="button"
                aria-label={`${s.place.name}, day ${s.dayNumber}`}
              >
                {sel && <circle r="21" fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth="4" />}
                <circle r={sel ? 15 : 14} fill={color} stroke={sel ? "none" : "var(--color-surface)"} strokeWidth="2" />
                <text y="4.5" textAnchor="middle" fontSize="13" fontWeight="600" fontFamily="var(--font-mono)" fill="#fff">
                  {s.order}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}
