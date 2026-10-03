"use client";

/**
 * Pins for a list of places (Explore results, a place's neighbours), the search area as a circle,
 * and the centre. Real tiles via MapLibre; if WebGL/tiles are unavailable it falls back to a small
 * offline SVG projection, like the trip map, so the page never shows a blank box.
 */
import type { PlaceView } from "@triply/shared";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { groupMeta, groupOf } from "../place/categoryMeta";
import { cx } from "../ui";
import { MAP_STYLE_URL } from "./TileMap";

const TILES_ENABLED = process.env.NEXT_PUBLIC_MAP_STYLE_URL !== "off";

export interface PlacesMapProps {
  places: PlaceView[];
  center?: { lat: number; lng: number } | null;
  radiusKm?: number | null;
  /** Highlighted pin (e.g. the card under the pointer); `focusId` is drawn larger (the place page). */
  activeId?: string | null;
  focusId?: string | null;
  className?: string;
  label?: string;
}

export function PlacesMap(props: PlacesMapProps) {
  const [tiles, setTiles] = useState(TILES_ENABLED);
  return tiles ? <TilePlacesMap {...props} onFail={() => setTiles(false)} /> : <SvgPlacesMap {...props} />;
}

function circle(lat: number, lng: number, km: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lng + ((km / 111.32) * Math.cos(a)) / Math.cos((lat * Math.PI) / 180), lat + (km / 111.32) * Math.sin(a)]);
  }
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [pts] } };
}

function TilePlacesMap({ places, center, radiusKm, activeId, focusId, className, label = "Map of places", onFail }: PlacesMapProps & { onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; node: HTMLButtonElement }>());
  const router = useRouter();
  const latest = useRef({ places, center, radiusKm, focusId, onFail, router });
  useEffect(() => {
    latest.current = { places, center, radiusKm, focusId, onFail, router };
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let failTimer: ReturnType<typeof setTimeout> | undefined;
    const markerMap = markers.current;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      if (!maplibregl.getWorkerUrl()?.includes("/maplibre/")) maplibregl.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);
      let m: MapLibreMap;
      try {
        m = new maplibregl.Map({ container: el.current, style: MAP_STYLE_URL, center: [0, 20], zoom: 1, attributionControl: { compact: true }, cooperativeGestures: true });
      } catch {
        return latest.current.onFail();
      }
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      failTimer = setTimeout(() => !loaded && latest.current.onFail(), 8000);
      m.on("error", (e) => {
        if (!loaded && /style|fetch|Failed/i.test(String(e.error?.message ?? ""))) latest.current.onFail();
      });
      m.on("load", () => {
        loaded = true;
        clearTimeout(failTimer);
        m.addSource("area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#6b3a1f", "fill-opacity": 0.06 } });
        m.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#6b3a1f", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.6 } });
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      markerMap.forEach(({ marker }) => marker.remove());
      markerMap.clear();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Draw pins + area and fit the view whenever the list or the area changes.
  const key = `${places.map((p) => p.id).join(",")}|${center?.lat},${center?.lng},${radiusKm}|${focusId}`;
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    void (async () => {
      const maplibregl = await import("maplibre-gl");
      const { places, center, radiusKm, focusId } = latest.current;
      const keep = new Set(places.map((p) => p.id));
      markers.current.forEach((v, id) => {
        if (!keep.has(id)) {
          v.marker.remove();
          markers.current.delete(id);
        }
      });
      places.forEach((p, i) => {
        let entry = markers.current.get(p.id);
        if (!entry) {
          const node = document.createElement("button");
          node.type = "button";
          node.className = "triply-pin";
          node.appendChild(document.createElement("span"));
          node.addEventListener("click", (e) => {
            e.stopPropagation();
            latest.current.router.push(`/places/${p.id}`);
          });
          entry = { node, marker: new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([p.lng, p.lat]).addTo(m) };
          markers.current.set(p.id, entry);
        }
        entry.marker.setLngLat([p.lng, p.lat]);
        entry.node.firstElementChild!.textContent = p.id === focusId ? "★" : String(i + 1);
        entry.node.style.setProperty("--pin", groupMeta(groupOf(p.categoryKey)).pin);
        entry.node.classList.toggle("is-selected", p.id === focusId);
        entry.node.setAttribute("aria-label", `${p.id === focusId ? "" : `${i + 1}. `}${p.name}, ${p.categoryLabel}`);
        entry.node.title = p.name;
      });
      (m.getSource("area") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: center && radiusKm ? [circle(center.lat, center.lng, radiusKm)] : [],
      });
      const b = new maplibregl.LngLatBounds();
      places.forEach((p) => b.extend([p.lng, p.lat]));
      if (center && radiusKm) circle(center.lat, center.lng, radiusKm).geometry.coordinates[0].forEach((c) => b.extend(c));
      if (!b.isEmpty()) m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 400 });
    })();
  }, [ready, key]);

  useEffect(() => {
    markers.current.forEach(({ node }, id) => node.classList.toggle("is-selected", id === activeId || id === focusId));
  }, [activeId, focusId]);

  return <div ref={el} className={cx("h-[420px] w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-[#efe6d8]", className)} role="region" aria-label={label} />;
}

/** Offline fallback: an equirectangular projection of the points (no tiles, no WebGL). */
function SvgPlacesMap({ places, center, radiusKm, activeId, focusId, className, label = "Map of places" }: PlacesMapProps) {
  const router = useRouter();
  const W = 600;
  const H = 420;
  const pts = places.map((p) => ({ x: p.lng, y: p.lat }));
  if (center) pts.push({ x: center.lng, y: center.lat });
  if (!pts.length) return <div className={cx("h-[420px] rounded-[var(--radius-card)] border border-line bg-sand-2", className)} role="region" aria-label={label} />;
  const k = Math.cos(((center?.lat ?? pts[0].y) * Math.PI) / 180);
  const [x0, x1, y0, y1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  // Frame the pins (not the whole search circle) so nearby places don't collapse into one dot;
  // the circle is clipped at the edges instead.
  const span = Math.max((x1 - x0) * k, y1 - y0, 0.005);
  const scale = (Math.min(W, H) - 64) / span;
  const cx0 = (x0 + x1) / 2;
  const cy0 = (y0 + y1) / 2;
  const px = (lng: number) => W / 2 + (lng - cx0) * k * scale;
  const py = (lat: number) => H / 2 - (lat - cy0) * scale;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} overflow="hidden" className={cx("h-[420px] w-full rounded-[var(--radius-card)] border border-line bg-[#efe6d8]", className)} role="img" aria-label={`${label} (simplified)`}>
      <defs>
        <pattern id="pm-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#e2d3bd" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#pm-grid)" />
      {center && radiusKm && (
        <circle cx={px(center.lng)} cy={py(center.lat)} r={(radiusKm / 111.32) * scale} fill="#6b3a1f" fillOpacity={0.06} stroke="#6b3a1f" strokeOpacity={0.6} strokeDasharray="6 6" />
      )}
      {places.map((p, i) => {
        const on = p.id === activeId || p.id === focusId;
        return (
          <g
            key={p.id}
            transform={`translate(${px(p.lng)} ${py(p.lat)})`}
            className="cursor-pointer"
            onClick={() => router.push(`/places/${p.id}`)}
          >
            <title>{p.name}</title>
            <circle r={on ? 15 : 12} fill={groupMeta(groupOf(p.categoryKey)).pin} stroke="#fffbf5" strokeWidth={2.5} />
            <text textAnchor="middle" dy="4" fontSize="11" fontWeight="700" fill="#fff">
              {p.id === focusId ? "★" : i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
