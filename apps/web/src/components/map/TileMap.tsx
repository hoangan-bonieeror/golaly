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
import { haversineKm } from "@/lib/trip-geo";
import { placeRider, riderElement, vehicleFor } from "./rider";
import type { MapDirections, MapStop } from "./TripMap";

/** A literal colour for MapLibre paint (CSS variables don't reach WebGL); read once per map (it's keyed by theme). */
const cssColor = (name: string, fallback: string) => (typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

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
 * stop to its last while the numbered pins pop in as the line reaches them, a vehicle riding the tip
 * (walker, train or plane by the length of each leg). Returns a cancel function.
 */
function revealRoute(m: MapLibreMap, markers: Markers, stops: MapStop[], colors: string[], lib: typeof import("maplibre-gl") | null): () => void {
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

  // One rider per drawn route (same order as routeFeatures: days with two or more stops).
  const lists = [...byDay.values()].filter((l) => l.length > 1);
  const riders = lib
    ? lists.map((list, i) => {
        const { el, g } = riderElement();
        const marker = new lib.Marker({ element: el }).setLngLat(features[i].geometry.coordinates[0]).addTo(m);
        return { marker, el, g, list, color: features[i].properties.color };
      })
    : [];
  let riderTimer: ReturnType<typeof setTimeout> | undefined;

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
    // setData is applied off the main thread, so the drawn line trails by a frame or so; the rider
    // trails it slightly too, to ride the tip rather than run ahead of it.
    const pr = easeInOut(Math.min(1, Math.max(0, (now - start - 50) / duration)));
    riders.forEach((r, i) => {
      const { point, leg, legT } = paths[i].tip(pr);
      r.marker.setLngLat(point);
      const a = r.list[leg - 1].place;
      const b = r.list[leg].place;
      const pa = m.project([a.lng, a.lat]);
      const pb = m.project([b.lng, b.lat]);
      placeRider(r.g, vehicleFor(haversineKm(a, b)), r.color, (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI, legT);
    });
    if (pr < 1) raf = requestAnimationFrame(frame);
    else {
      riders.forEach((r) => r.el.classList.add("is-done"));
      riderTimer = setTimeout(() => riders.forEach((r) => r.marker.remove()), 350);
    }
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(riderTimer);
    riders.forEach((r) => r.marker.remove());
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
  directions,
  youLabel,
  styleUrl = MAP_STYLE_URL,
}: {
  /** The viewer's position and route to the selected stop ("Directions from here"). */
  directions?: MapDirections | null;
  youLabel?: string;
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
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const me = useRef<Marker | null>(null);
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
        // Directions sit under the pins, above the day routes: a white casing and a jade line.
        m.addSource("directions", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "directions-casing", type: "line", source: "directions", paint: { "line-color": cssColor("--color-surface", "#fffdf8"), "line-width": 9 }, layout: { "line-cap": "round", "line-join": "round" } });
        m.addLayer({ id: "directions-line", type: "line", source: "directions", paint: { "line-color": cssColor("--color-primary", "#1f5e52"), "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
        libRef.current = maplibregl;
        void syncMap(m, markerMap, latest.current, true, maplibregl).then(() => {
          cancelReveal.current = revealRoute(m, markerMap, latest.current.stops, latest.current.colors, maplibregl);
          setLoaded(true);
        });
      });
    })();
    return () => {
      cancelled = true;
      cancelReveal.current();
      me.current?.remove();
      me.current = null;
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
      if (replay && m?.getSource("route")) cancelReveal.current = revealRoute(m, markers.current, stops, colors, libRef.current);
    });
    // stopsKey + revealKey capture every change to `stops` that matters for drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, revealKey]);

  // Directions: the "you are here" dot, the route line, and a frame that shows both ends.
  const dirKey = directions ? `${directions.from.lat},${directions.from.lng}>${directions.to.lat},${directions.to.lng}:${directions.geometry?.length ?? 0}` : "";
  useEffect(() => {
    const m = map.current;
    const lib = libRef.current;
    if (!m || !lib || !m.getSource("directions")) return;
    (m.getSource("directions") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: directions?.geometry ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: directions.geometry } }] : [],
    });
    if (!directions) {
      me.current?.remove();
      me.current = null;
      return;
    }
    if (!me.current) {
      const node = document.createElement("div");
      node.className = "triply-me";
      node.setAttribute("role", "img");
      me.current = new lib.Marker({ element: node, anchor: "center" }).setLngLat([directions.from.lng, directions.from.lat]).addTo(m);
    }
    me.current.setLngLat([directions.from.lng, directions.from.lat]);
    me.current.getElement().setAttribute("aria-label", youLabel ?? "");
    const b = new lib.LngLatBounds();
    b.extend([directions.from.lng, directions.from.lat]);
    b.extend([directions.to.lng, directions.to.lat]);
    directions.geometry?.forEach((c) => b.extend(c));
    // Leave room at the bottom for the stop card with the directions panel.
    m.fitBounds(b, { padding: { top: 72, left: 48, right: 48, bottom: 300 }, maxZoom: 16, duration: prefersReducedMotion() ? 0 : 800 });
    // dirKey captures every change to `directions` that matters for drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirKey, loaded]);

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
