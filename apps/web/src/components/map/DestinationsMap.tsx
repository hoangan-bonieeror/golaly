"use client";

/**
 * Explore's atlas: every destination people have shared trips to, as a pin sized by how many trips go there.
 * Real tiles via MapLibre; without WebGL/tiles it falls back to an offline equirectangular sketch on a graticule.
 * Each pin is a link to the destination page.
 */
import type { DestinationView } from "@golaly/shared";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "../ui";
import { useT } from "@/i18n/client";
import { useTheme } from "@/lib/theme";
import { mapStyleFor } from "./TileMap";

const TILES_ENABLED = process.env.NEXT_PUBLIC_MAP_STYLE_URL !== "off";

/** Pin diameter in px: grows with the square root of the trip count (area ∝ trips), within limits. */
export const pinSize = (trips: number) => Math.round(Math.min(56, 22 + 8 * Math.sqrt(Math.max(0, trips))));

/**
 * Which names fit without overlapping, biggest destinations first (`pts` already in that order, in screen px).
 * A name is a box under its pin; one that would collide stays hidden — the pin keeps its label for screen
 * readers and its title on hover.
 */
export function fitLabels(pts: { x: number; y: number; size: number; name: string }[], charW = 6.6, lineH = 15): boolean[] {
  const boxes: [number, number, number, number][] = [];
  const pins = pts.map((p) => [p.x - p.size / 2, p.y - p.size / 2, p.x + p.size / 2, p.y + p.size / 2] as [number, number, number, number]);
  const hit = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  return pts.map((p, i) => {
    const w = p.name.length * charW + 6;
    const box: [number, number, number, number] = [p.x - w / 2, p.y + p.size / 2 + 1, p.x + w / 2, p.y + p.size / 2 + 1 + lineH];
    if (boxes.some((b) => hit(b, box)) || pins.some((b, j) => j !== i && hit(b, box))) return false;
    boxes.push(box);
    return true;
  });
}

type Props = { destinations: DestinationView[]; className?: string };

export function DestinationsMap(props: Props) {
  const [tiles, setTiles] = useState(TILES_ENABLED);
  const { theme } = useTheme();
  return tiles ? <TileDestinations key={theme} styleUrl={mapStyleFor(theme)} {...props} onFail={() => setTiles(false)} /> : <SvgDestinations {...props} />;
}

function TileDestinations({ destinations, className, styleUrl, onFail }: Props & { styleUrl: string; onFail: () => void }) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<{ marker: Marker; node: HTMLAnchorElement; d: DestinationView }[]>([]);
  const router = useRouter();
  const latest = useRef({ destinations, onFail, router });
  useEffect(() => {
    latest.current = { destinations, onFail, router };
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let failTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      if (!maplibregl.getWorkerUrl()?.includes("/maplibre/")) maplibregl.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);
      let m: MapLibreMap;
      try {
        m = new maplibregl.Map({
          container: el.current,
          style: styleUrl,
          center: [60, 25],
          zoom: 1,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
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
        setReady(true);
      });
    })();
    const list = markers.current;
    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      list.forEach((mk) => mk.marker.remove());
      list.length = 0;
      map.current?.remove();
      map.current = null;
    };
  }, [styleUrl]);

  /** Show only the names that fit at the current zoom. */
  const relabel = () => {
    const m = map.current;
    if (!m) return;
    const list = markers.current;
    const shown = fitLabels(
      list.map(({ d }) => ({
        ...m.project([d.lng, d.lat]),
        size: pinSize(d.tripCount),
        name: d.name,
      })),
    );
    list.forEach(({ node }, i) => node.classList.toggle("no-label", !shown[i]));
  };
  const relabelRef = useRef(relabel);
  useEffect(() => {
    relabelRef.current = relabel;
  });
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const on = () => relabelRef.current();
    m.on("moveend", on);
    return () => {
      m.off("moveend", on);
    };
  }, [ready]);

  const key = destinations.map((d) => `${d.id}:${d.tripCount}`).join(",");
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    void (async () => {
      const maplibregl = await import("maplibre-gl");
      markers.current.forEach((mk) => mk.marker.remove());
      markers.current = [];
      const b = new maplibregl.LngLatBounds();
      // Biggest first, so small pins sit on top and stay clickable.
      for (const d of [...latest.current.destinations].sort((a, b) => b.tripCount - a.tripCount)) {
        const a = document.createElement("a");
        a.href = `/explore/${d.slug}`;
        a.className = "golaly-dest";
        a.style.setProperty("--size", `${pinSize(d.tripCount)}px`);
        a.setAttribute("aria-label", `${d.name}, ${d.country} · ${t.explore.tripCount(d.tripCount)}`);
        a.innerHTML = `<span class="dot">${d.tripCount || ""}</span><span class="name"></span>`;
        a.querySelector(".name")!.textContent = d.name;
        a.addEventListener("click", (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          latest.current.router.push(`/explore/${d.slug}`);
        });
        a.title = d.name;
        markers.current.push({
          node: a,
          d,
          marker: new maplibregl.Marker({ element: a, anchor: "center" }).setLngLat([d.lng, d.lat]).addTo(m),
        });
        b.extend([d.lng, d.lat]);
      }
      if (!b.isEmpty()) m.fitBounds(b, { padding: 56, maxZoom: 6, duration: 0 });
      relabel();
    })();
  }, [ready, key, t]);

  return (
    <div ref={el} className={cx("h-[300px] w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-map md:h-[380px]", className)} role="region" aria-label={t.explore.atlas.label} />
  );
}

/** Offline fallback: an equirectangular sketch of the pins on a 30° graticule, framed to fit them. */
function SvgDestinations({ destinations, className }: Props) {
  const t = useT();
  const router = useRouter();
  const W = 960;
  const H = 380;
  if (!destinations.length) return <div className={cx("h-[300px] rounded-[var(--radius-card)] border border-line bg-map md:h-[380px]", className)} role="region" aria-label={t.explore.atlas.label} />;
  const lngs = destinations.map((d) => d.lng);
  const lats = destinations.map((d) => d.lat);
  const pad = 15;
  const [x0, x1, y0, y1] = [Math.min(...lngs) - pad, Math.max(...lngs) + pad, Math.min(...lats) - pad, Math.max(...lats) + pad];
  const scale = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - (x1 - x0) * scale) / 2;
  const oy = (H - (y1 - y0) * scale) / 2;
  const px = (lng: number) => ox + (lng - x0) * scale;
  const py = (lat: number) => oy + (y1 - lat) * scale;
  const grid: string[] = [];
  for (let g = -180; g <= 180; g += 30) grid.push(`M${px(g)} 0V${H}`);
  for (let g = -60; g <= 60; g += 30) grid.push(`M0 ${py(g)}H${W}`);
  const sorted = [...destinations].sort((a, b) => b.tripCount - a.tripCount);
  const shown = fitLabels(
    sorted.map((d) => ({
      x: px(d.lng),
      y: py(d.lat),
      size: pinSize(d.tripCount),
      name: d.name,
    })),
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cx("h-[300px] w-full rounded-[var(--radius-card)] border border-line bg-map md:h-[380px]", className)}
      preserveAspectRatio="xMidYMid slice"
      role="group"
      aria-label={t.explore.map.simplified(t.explore.atlas.label)}
    >
      <path d={grid.join("")} stroke="var(--color-contour)" strokeWidth="1" fill="none" />
      <path d={`M0 ${py(0)}H${W}`} stroke="var(--color-contour)" strokeWidth="1.5" strokeDasharray="6 6" fill="none" />
      {sorted.map((d, i) => {
        const r = pinSize(d.tripCount) / 2;
        return (
          <a
            key={d.id}
            href={`/explore/${d.slug}`}
            aria-label={`${d.name}, ${d.country} · ${t.explore.tripCount(d.tripCount)}`}
            onClick={(e) => {
              e.preventDefault();
              router.push(`/explore/${d.slug}`);
            }}
            className="group"
          >
            <g transform={`translate(${px(d.lng)} ${py(d.lat)})`}>
              <circle r={r} fill="var(--color-primary)" fillOpacity={0.85} stroke="var(--color-pin-ring)" strokeWidth={2.5} className="transition-[fill-opacity] group-hover:fill-opacity-100" />
              {d.tripCount > 0 && (
                <text textAnchor="middle" dy="4" fontSize="12" fontWeight="700" fill="var(--color-on-primary)" fontFamily="var(--font-mono)">
                  {d.tripCount}
                </text>
              )}
              <title>{d.name}</title>
              {shown[i] && (
                <text y={r + 14} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-ink)" stroke="var(--color-map)" strokeWidth="3" paintOrder="stroke">
                  {d.name}
                </text>
              )}
            </g>
          </a>
        );
      })}
    </svg>
  );
}
