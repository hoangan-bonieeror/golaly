"use client";

import { ITEM_TYPE_LABEL, type ItemView, type PlaceView, type TripDetail } from "@triply/shared";
import { Navigation, Star } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Chip, cx } from "../ui";

const TileMap = dynamic(() => import("./TileMap").then((m) => m.TileMap), { ssr: false });
const TILES_ENABLED = process.env.NEXT_PUBLIC_MAP_STYLE_URL !== "off";

/**
 * Trip map (spec §14) — markers, day filter, selected place, simple A→B→C route.
 *
 * Renders real tiles with MapLibre (<TileMap>) and falls back to <MapCanvas>, an offline,
 * dependency-free SVG projection, when WebGL/tiles are unavailable or
 * NEXT_PUBLIC_MAP_STYLE_URL=off. Routes are straight lines between stops; a RouteProvider
 * (routing API) can replace them later without changing TripMap's props.
 */
export interface MapStop {
  item: ItemView;
  place: PlaceView;
  dayNumber: number;
  order: number;
}

const DAY_COLORS = ["#0e6e6a", "#f26b4e", "#5b4a9e", "#2f6db5", "#c28512", "#b5446e", "#3d8b5a", "#6b7780", "#a4471f", "#1b4965"];

export function TripMap({
  trip,
  selectedId,
  onSelect,
  className,
}: {
  trip: TripDetail;
  selectedId?: string | null;
  onSelect?: (item: ItemView) => void;
  className?: string;
}) {
  const days = trip.days;
  const multiCity = trip.destinations.length > 1;
  // Multi-city trips start on Day 1 so markers aren't squeezed into far-apart clusters.
  const [dayFilter, setDayFilter] = useState<number | "all">(multiCity ? 1 : "all");
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

  // Selecting an item (in the list or on the map) focuses its day.
  useEffect(() => {
    const s = stops.find((x) => x.item.id === selectedId);
    if (s) setDayFilter((cur) => (cur === "all" || cur === s.dayNumber ? cur : s.dayNumber));
  }, [selectedId, stops]);

  const visible = stops.filter((s) => dayFilter === "all" || s.dayNumber === dayFilter);
  const selected = stops.find((s) => s.item.id === selectedId) ?? null;

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1">
        <Chip active={dayFilter === "all"} onClick={() => setDayFilter("all")} className="h-8 shrink-0 px-3">
          All days
        </Chip>
        {days.map((d) => (
          <Chip key={d.id} active={dayFilter === d.dayNumber} onClick={() => setDayFilter(d.dayNumber)} className="h-8 shrink-0 px-3">
            <span className="size-2 rounded-full" style={{ background: DAY_COLORS[(d.dayNumber - 1) % DAY_COLORS.length] }} />
            Day {d.dayNumber}
          </Chip>
        ))}
      </div>
      {tiles ? (
        <TileMap stops={visible} colors={DAY_COLORS} selectedId={selectedId} onSelect={onSelect} onFail={() => setTiles(false)} />
      ) : (
        <MapCanvas stops={visible} selectedId={selectedId} onSelect={onSelect} />
      )}
      {selected ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
          <span className="flex size-10 items-center justify-center rounded-xl text-white" style={{ background: DAY_COLORS[(selected.dayNumber - 1) % DAY_COLORS.length] }}>
            {selected.order}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{selected.place.name}</div>
            <div className="truncate text-xs text-muted">
              Day {selected.dayNumber} {selected.item.startTime && `· ${selected.item.startTime}`} · {ITEM_TYPE_LABEL[selected.place.category]}
              {selected.place.rating && (
                <span className="ml-1 inline-flex items-center gap-0.5">
                  <Star className="size-3 fill-gold text-gold" /> {selected.place.rating}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted">{selected.place.address}</div>
          </div>
          <a
            href={`https://www.openstreetmap.org/?mlat=${selected.place.lat}&mlon=${selected.place.lng}#map=16/${selected.place.lat}/${selected.place.lng}`}
            target="_blank"
            rel="noreferrer"
            className="flex size-10 items-center justify-center rounded-full bg-lagoon-50 text-lagoon"
            aria-label="Open in maps"
          >
            <Navigation className="size-4" />
          </a>
        </div>
      ) : (
        <p className="px-1 text-xs text-muted">{visible.length} stops · tap a marker or an itinerary item to see details.</p>
      )}
    </div>
  );
}

function MapCanvas({ stops, selectedId, onSelect }: { stops: MapStop[]; selectedId?: string | null; onSelect?: (i: ItemView) => void }) {
  const W = 600;
  const H = 440;
  const pad = 60;

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
    const sy = (H - pad * 2) / (maxLat - minLat);
    const s = Math.min(sx, sy);
    const ox = (W - (maxLng - minLng) * k * s) / 2;
    const oy = (H - (maxLat - minLat) * s) / 2;
    return (lat: number, lng: number) => [ox + (lng - minLng) * k * s, oy + (maxLat - lat) * s] as const;
  }, [stops]);

  const byDay = useMemo(() => {
    const m = new Map<number, MapStop[]>();
    stops.forEach((s) => m.set(s.dayNumber, [...(m.get(s.dayNumber) ?? []), s]));
    return m;
  }, [stops]);

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-[#eef1ea]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Map of trip stops">
        <defs>
          <pattern id="mapgrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#d9ded2" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#mapgrid)" />
        {/* soft decorative "land" contours */}
        <path d="M-20 330 C 120 280, 200 380, 330 320 S 560 260, 640 300 L640 460 L-20 460Z" fill="#e3e9dc" />
        <path d="M-20 90 C 80 40, 180 120, 300 80 S 520 20, 640 70 L640 -20 L-20 -20Z" fill="#dfe8ec" />
        <g transform={`translate(${W - 44}, 40)`} opacity="0.55">
          <circle r="16" fill="none" stroke="#6b7780" />
          <path d="M0 -12 L4 0 L0 12 L-4 0Z" fill="#6b7780" />
          <text y="-20" textAnchor="middle" fontSize="10" fill="#6b7780" fontWeight="700">
            N
          </text>
        </g>

        {proj &&
          [...byDay.entries()].map(([day, list]) => (
            <polyline
              key={day}
              points={list.map((s) => proj(s.place.lat, s.place.lng).join(",")).join(" ")}
              fill="none"
              stroke={DAY_COLORS[(day - 1) % DAY_COLORS.length]}
              strokeWidth="3"
              strokeDasharray="1 7"
              strokeLinecap="round"
              opacity="0.85"
            />
          ))}

        {proj &&
          stops.map((s) => {
            const [x, y] = proj(s.place.lat, s.place.lng);
            const color = DAY_COLORS[(s.dayNumber - 1) % DAY_COLORS.length];
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
                <circle r={sel ? 20 : 0} fill={color} opacity="0.18" />
                <path d="M0 0 C -11 -14, -13 -18, -13 -24 A 13 13 0 1 1 13 -24 C 13 -18, 11 -14, 0 0Z" fill={color} stroke="#fff" strokeWidth={sel ? 3 : 2} transform={sel ? "scale(1.15)" : undefined} />
                <text y={sel ? -24 : -20} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
                  {s.order}
                </text>
                {sel && (
                  <g transform="translate(0, 12)">
                    <rect x={-Math.min(90, s.place.name.length * 3.6 + 10)} width={Math.min(180, s.place.name.length * 7.2 + 20)} height="22" rx="11" fill="#16232e" />
                    <text y="15" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="600">
                      {s.place.name.length > 24 ? s.place.name.slice(0, 23) + "…" : s.place.name}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
      </svg>
      {stops.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">Add places to your itinerary to see them on the map.</div>
      )}
    </div>
  );
}
