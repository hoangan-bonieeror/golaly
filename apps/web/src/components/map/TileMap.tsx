"use client";

/**
 * Real map tiles via MapLibre GL (open source, no API key). Default style is
 * OpenFreeMap Positron — quiet greys, so the day-coloured pins and routes carry the map (Atlas); override with NEXT_PUBLIC_MAP_STYLE_URL (e.g. a MapTiler/Stadia style).
 * If WebGL or the tile server is unavailable, `onFail` lets the caller fall back to the
 * offline SVG map, so the trip page never shows a blank box.
 */
import type { ItemView } from "@triply/shared";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/catalog";
import { drawDuration, easeInOut, measurePolyline, prefersReducedMotion } from "@/lib/motion";
import type { MapStop } from "./TripMap";

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
/** Atlas Night uses a dark basemap (OpenFreeMap "dark", or NEXT_PUBLIC_MAP_STYLE_URL_DARK). */
export const MAP_STYLE_URL_DARK =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL_DARK || (process.env.NEXT_PUBLIC_MAP_STYLE_URL ? process.env.NEXT_PUBLIC_MAP_STYLE_URL : "https://tiles.openfreemap.org/styles/dark");
export const mapStyleFor = (theme: "light" | "dark") => (theme === "dark" ? MAP_STYLE_URL_DARK : MAP_STYLE_URL);

type Markers = Map<string, { marker: Marker; node: HTMLButtonElement }>;
interface Latest {
  stops: MapStop[];
  colors: string[];
  onSelect?: (i: ItemView) => void;
  onHover?: (id: string | null) => void;
  onFail: () => void;
  t: Messages;
}

type RouteFeature = { type: "Feature"; properties: { color: string }; geometry: { type: "LineString"; coordinates: [number, number][] } };

function routeFeatures(stops: MapStop[], colors: string[]): RouteFeature[] {
  const byDay = new Map<number, MapStop[]>();
  stops.forEach((s) => byDay.set(s.dayNumber, [...(byDay.get(s.dayNumber) ?? []), s]));
  return [...byDay.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([day, list]) => ({
      type: "Feature",
      properties: { color: colors[(day - 1) % colors.length] },
      geometry: { type: "LineString", coordinates: list.map((s) => [s.place.lng, s.place.lat] as [number, number]) },
    }));
}

/**
 * Day change choreography: the camera moves to the day, then each day's route draws from its first
 * stop to its last while the numbered pins pop in as the line reaches them. Returns a cancel function.
 */
function revealRoute(m: MapLibreMap, markers: Markers, stops: MapStop[], colors: string[]): () => void {
  const source = m.getSource("route") as GeoJSONSource | undefined;
  const features = routeFeatures(stops, colors);
  if (!source || prefersReducedMotion() || !stops.length) return () => undefined;
  const paths = features.map((f) => measurePolyline(f.geometry.coordinates));
  // Per stop: the fraction of its day's route at which its pin appears.
  const byDay = new Map<number, MapStop[]>();
  stops.forEach((s) => byDay.set(s.dayNumber, [...(byDay.get(s.dayNumber) ?? []), s]));
  const appearAt = new Map<string, number>();
  for (const list of byDay.values()) {
    const at = list.length > 1 ? measurePolyline(list.map((s) => [s.place.lng, s.place.lat])).at : [0];
    list.forEach((s, i) => appearAt.set(s.item.id, at[i] ?? 0));
  }
  stops.forEach((s) => {
    const n = markers.get(s.item.id)?.node;
    n?.classList.remove("is-in");
    n?.classList.add("is-pending");
  });
  source.setData({ type: "FeatureCollection", features: features.map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: f.geometry.coordinates.slice(0, 1) } })) });

  const longest = Math.max(1, ...[...byDay.values()].map((l) => l.length));
  const duration = drawDuration(longest);
  const delay = 280; // let the camera start moving first
  let raf = 0;
  const start = performance.now() + delay;
  const frame = (now: number) => {
    const p = easeInOut(Math.min(1, Math.max(0, (now - start) / duration)));
    source.setData({ type: "FeatureCollection", features: features.map((f, i) => ({ ...f, geometry: { ...f.geometry, coordinates: paths[i].cut(p) } })) });
    stops.forEach((s) => {
      const n = markers.get(s.item.id)?.node;
      if (n?.classList.contains("is-pending") && (appearAt.get(s.item.id) ?? 0) <= p + 0.001) {
        n.classList.remove("is-pending");
        n.classList.add("is-in");
      }
    });
    if (p < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    markers.forEach(({ node }) => node.classList.remove("is-pending"));
    source.setData({ type: "FeatureCollection", features });
  };
}

/** Draws markers + per-day route lines and fits the view to the visible stops. */
/** Read by marker event listeners, which are created once per pin. */
const latestRef: { current: Latest | null } = { current: null };

async function syncMap(m: MapLibreMap | null, markers: Markers, latest: Latest, fit: boolean, lib?: typeof import("maplibre-gl")) {
  // Ready = our route source exists (added on "load"). Not isStyleLoaded(): that stays false while any
  // source is still loading — including the route source we just added — so pins were never drawn.
  if (!m || !m.getSource("route")) return;
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
      // The latest handler is read at event time (markers outlive renders).
      node.addEventListener("pointerenter", () => latestRef.current?.onHover?.(s.item.id));
      node.addEventListener("pointerleave", () => latestRef.current?.onHover?.(null));
      node.addEventListener("focus", () => latestRef.current?.onHover?.(s.item.id));
      node.addEventListener("blur", () => latestRef.current?.onHover?.(null));
      const marker = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([s.place.lng, s.place.lat]).addTo(m);
      entry = { marker, node };
      markers.set(s.item.id, entry);
    }
    entry.marker.setLngLat([s.place.lng, s.place.lat]);
    entry.node.firstElementChild!.textContent = String(s.order);
    entry.node.style.setProperty("--pin", color);
    entry.node.setAttribute("aria-label", latest.t.trips.map.numberedPin(s.order, s.place.name, s.dayNumber));
    entry.node.title = s.place.name;
  }
  (m.getSource("route") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: routeFeatures(stops, colors) });
  if (fit && stops.length) {
    const b = new maplibregl.LngLatBounds();
    stops.forEach((s) => b.extend([s.place.lng, s.place.lat]));
    m.fitBounds(b, { padding: 64, maxZoom: 14, duration: prefersReducedMotion() ? 0 : 900, essential: false });
  }
}

export function TileMap({
  stops,
  colors,
  selectedId,
  hoveredId,
  revealKey,
  onSelect,
  onHover,
  onFail,
  styleUrl = MAP_STYLE_URL,
}: {
  /** Pin to lift (the stop under the pointer in the itinerary). */
  hoveredId?: string | null;
  /** Changing it (the day filter) replays the camera move + route drawing. */
  revealKey?: string;
  onHover?: (id: string | null) => void;
  /** Fixed for the map's lifetime; callers key the component by it to switch basemaps. */
  styleUrl?: string;
  stops: MapStop[];
  colors: string[];
  selectedId?: string | null;
  onSelect?: (i: ItemView) => void;
  onFail: () => void;
}) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Markers>(new Map());
  const cancelReveal = useRef<() => void>(() => undefined);
  const [loaded, setLoaded] = useState(false);
  // Event handlers registered once read the latest props through this ref.
  const latest = useRef<Latest>({ stops, colors, onSelect, onHover, onFail, t });
  useEffect(() => {
    latest.current = { stops, colors, onSelect, onHover, onFail, t };
    latestRef.current = latest.current;
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
        m = new maplibregl.Map({ container: el.current, style: styleUrl, center: [0, 20], zoom: 1, attributionControl: { compact: true }, cooperativeGestures: true });
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
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.9 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        void syncMap(m, markerMap, latest.current, true, maplibregl).then(() => {
          cancelReveal.current = revealRoute(m, markerMap, latest.current.stops, latest.current.colors);
          setLoaded(true);
        });
      });
    })();
    return () => {
      cancelled = true;
      cancelReveal.current();
      clearTimeout(failTimer);
      markerMap.forEach(({ marker }) => marker.remove());
      markerMap.clear();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Re-sync when the visible stops change (day filter / itinerary edits).
  // A new day replays the reveal; an edit within the day (reorder, add) just redraws.
  const stopsKey = stops.map((s) => `${s.item.id}:${s.order}:${s.dayNumber}`).join("|");
  const lastReveal = useRef(revealKey);
  useEffect(() => {
    const m = map.current;
    const replay = lastReveal.current !== revealKey;
    lastReveal.current = revealKey;
    if (replay) cancelReveal.current();
    void syncMap(m, markers.current, { ...latest.current, stops, colors }, replay).then(() => {
      if (replay && m?.getSource("route")) cancelReveal.current = revealRoute(m, markers.current, stops, colors);
    });
    // stopsKey + revealKey capture every change to `stops` that matters for drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, revealKey]);

  // Lift the pin of the stop under the pointer in the itinerary.
  useEffect(() => {
    markers.current.forEach(({ node }, id) => node.classList.toggle("is-hover", id === hoveredId));
  }, [hoveredId, loaded, stopsKey]);

  // Relabel the pins when the interface language changes (markers are plain DOM nodes).
  useEffect(() => {
    latest.current.stops.forEach((s) => markers.current.get(s.item.id)?.node.setAttribute("aria-label", t.trips.map.numberedPin(s.order, s.place.name, s.dayNumber)));
  }, [t]);

  // Highlight + pan to the selected stop.
  useEffect(() => {
    markers.current.forEach(({ node }, id) => node.classList.toggle("is-selected", id === selectedId));
    const s = latest.current.stops.find((x) => x.item.id === selectedId);
    const m = map.current;
    if (s && m?.getSource("route")) m.easeTo({ center: [s.place.lng, s.place.lat], zoom: Math.max(m.getZoom(), 13), duration: 500 });
  }, [selectedId]);

  // MapLibre makes its container `position: relative`, so the container fills an absolute wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="region" aria-label={t.trips.map.region} />
    </div>
  );
}
