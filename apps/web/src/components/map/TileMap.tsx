"use client";

/**
 * Real map tiles via MapLibre GL (open source, no API key). Default style is
 * OpenFreeMap; override with NEXT_PUBLIC_MAP_STYLE_URL (e.g. a MapTiler/Stadia style).
 * If WebGL or the tile server is unavailable, `onFail` lets the caller fall back to the
 * offline SVG map, so the trip page never shows a blank box.
 */
import type { ItemView } from "@triply/shared";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { MapStop } from "./TripMap";

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

type Markers = Map<string, { marker: Marker; node: HTMLButtonElement }>;
interface Latest {
  stops: MapStop[];
  colors: string[];
  onSelect?: (i: ItemView) => void;
  onFail: () => void;
}

/** Draws markers + per-day route lines and fits the view to the visible stops. */
async function syncMap(m: MapLibreMap | null, markers: Markers, latest: Latest, fit: boolean, lib?: typeof import("maplibre-gl")) {
  if (!m || !m.isStyleLoaded()) return;
  const maplibregl = lib ?? (await import("maplibre-gl"));
  const { stops, colors } = latest;
  const keep = new Set(stops.map((s) => s.item.id));
  markers.forEach((v, id) => {
    if (!keep.has(id)) {
      v.marker.remove();
      markers.delete(id);
    }
  });
  for (const s of stops) {
    const color = colors[(s.dayNumber - 1) % colors.length];
    let entry = markers.get(s.item.id);
    if (!entry) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "triply-pin";
      node.appendChild(document.createElement("span"));
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        const cur = latest.stops.find((x) => x.item.id === s.item.id);
        if (cur) latest.onSelect?.(cur.item);
      });
      const marker = new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([s.place.lng, s.place.lat]).addTo(m);
      entry = { marker, node };
      markers.set(s.item.id, entry);
    }
    entry.marker.setLngLat([s.place.lng, s.place.lat]);
    entry.node.firstElementChild!.textContent = String(s.order);
    entry.node.style.setProperty("--pin", color);
    entry.node.setAttribute("aria-label", `${s.order}. ${s.place.name}, day ${s.dayNumber}`);
    entry.node.title = s.place.name;
  }
  const byDay = new Map<number, MapStop[]>();
  stops.forEach((s) => byDay.set(s.dayNumber, [...(byDay.get(s.dayNumber) ?? []), s]));
  (m.getSource("route") as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: [...byDay.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([day, list]) => ({
        type: "Feature",
        properties: { color: colors[(day - 1) % colors.length] },
        geometry: { type: "LineString", coordinates: list.map((s) => [s.place.lng, s.place.lat]) },
      })),
  });
  if (fit && stops.length) {
    const b = new maplibregl.LngLatBounds();
    stops.forEach((s) => b.extend([s.place.lng, s.place.lat]));
    m.fitBounds(b, { padding: 56, maxZoom: 14, duration: 500 });
  }
}

export function TileMap({
  stops,
  colors,
  selectedId,
  onSelect,
  onFail,
}: {
  stops: MapStop[];
  colors: string[];
  selectedId?: string | null;
  onSelect?: (i: ItemView) => void;
  onFail: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Markers>(new Map());
  // Event handlers registered once read the latest props through this ref.
  const latest = useRef<Latest>({ stops, colors, onSelect, onFail });
  useEffect(() => {
    latest.current = { stops, colors, onSelect, onFail };
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let failTimer: ReturnType<typeof setTimeout> | undefined;
    const markerMap = markers.current;
    const fail = () => latest.current.onFail();
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      // Worker is served from /public (copied by scripts/copy-maplibre-worker.mjs).
      if (!maplibregl.getWorkerUrl()?.includes("/maplibre/")) maplibregl.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);
      let m: MapLibreMap;
      try {
        m = new maplibregl.Map({ container: el.current, style: MAP_STYLE_URL, center: [0, 20], zoom: 1, attributionControl: { compact: true }, cooperativeGestures: true });
      } catch {
        return fail(); // no WebGL
      }
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // Style never loads (offline / blocked tile host) → fall back.
      failTimer = setTimeout(() => !ready && fail(), 8000);
      m.on("error", (e) => {
        if (!ready && /style|fetch|Failed/i.test(String(e.error?.message ?? ""))) fail();
      });
      m.on("load", () => {
        ready = true;
        clearTimeout(failTimer);
        m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.85, "line-dasharray": [1, 2] },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        void syncMap(m, markerMap, latest.current, true, maplibregl);
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

  // Re-sync when the visible stops change (day filter / itinerary edits).
  const stopsKey = stops.map((s) => `${s.item.id}:${s.order}:${s.dayNumber}`).join("|");
  useEffect(() => {
    void syncMap(map.current, markers.current, { ...latest.current, stops, colors }, true);
    // stopsKey captures every change to `stops` that matters for drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  // Highlight + pan to the selected stop.
  useEffect(() => {
    markers.current.forEach(({ node }, id) => node.classList.toggle("is-selected", id === selectedId));
    const s = latest.current.stops.find((x) => x.item.id === selectedId);
    const m = map.current;
    if (s && m?.isStyleLoaded()) m.easeTo({ center: [s.place.lng, s.place.lat], zoom: Math.max(m.getZoom(), 13), duration: 500 });
  }, [selectedId]);

  return <div ref={el} className="h-[440px] w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-[#eef1ea]" role="region" aria-label="Map of trip stops" />;
}
