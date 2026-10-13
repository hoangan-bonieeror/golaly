import type { TripDetail } from "@triply/shared";
import { dayColor } from "@/lib/trip-geo";

/**
 * A tiny drawing of the whole trip — every stop projected into the box, joined in order by the
 * vermilion route and dotted in its day's colour. Replaces the decorative cover in the planner header.
 */
export function RouteThumb({ trip, width = 88, height = 64, className }: { trip: Pick<TripDetail, "days">; width?: number; height?: number; className?: string }) {
  const pts = trip.days.flatMap((d) => d.items.filter((i) => i.place).map((i) => ({ lat: i.place!.lat, lng: i.place!.lng, day: d.dayNumber })));
  const pad = 8;
  let path = "";
  let dots: { x: number; y: number; day: number }[] = [];
  if (pts.length) {
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * k, 1e-4);
    const spanY = Math.max(maxLat - minLat, 1e-4);
    const s = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const ox = (width - spanX * s) / 2;
    const oy = (height - spanY * s) / 2;
    dots = pts.map((p) => ({ x: ox + (p.lng - minLng) * k * s, y: oy + (maxLat - p.lat) * s, day: p.day }));
    path = dots.map((d, i) => `${i ? "L" : "M"}${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(" ");
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={className}>
      <rect width={width} height={height} rx="12" fill="var(--color-sand-2)" />
      <path d={`M-4 ${height * 0.72} C ${width * 0.3} ${height * 0.55}, ${width * 0.55} ${height * 0.95}, ${width + 4} ${height * 0.7}`} fill="none" stroke="var(--color-contour)" strokeWidth="1.5" />
      <path d={`M-4 ${height * 0.25} C ${width * 0.35} ${height * 0.05}, ${width * 0.6} ${height * 0.4}, ${width + 4} ${height * 0.18}`} fill="none" stroke="var(--color-contour)" strokeWidth="1.5" />
      {dots.length > 1 && <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={dots.length > 12 ? 2.5 : 3.5} fill={dayColor(d.day)} stroke="var(--color-pin-ring)" strokeWidth="1.2" />
      ))}
    </svg>
  );
}
