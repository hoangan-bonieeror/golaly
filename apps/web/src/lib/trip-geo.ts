import type { DayView, ItemView, PlaceView } from "@triply/shared";

/**
 * Atlas day palette: each day of a trip gets one colour, used for its chip, pins and route.
 * Every colour carries white text at ≥ 5.3:1 (numbers on pins, the active day chip).
 * Trips longer than seven days cycle — neighbouring days never share a colour.
 */
export const DAY_COLORS = ["#c23e14", "#1f5e52", "#3d4fa1", "#93601a", "#8a3b6e", "#26699a", "#5e6f26"] as const;
export const dayColor = (dayNumber: number) => DAY_COLORS[(((dayNumber - 1) % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];

/** Great-circle distance in kilometres. */
export function haversineKm(a: Pick<PlaceView, "lat" | "lng">, b: Pick<PlaceView, "lat" | "lng">) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type LegMode = "Walk" | "Transit" | "Drive" | "Fly";
export interface Leg {
  mode: LegMode;
  /** Estimated travel distance (straight line × a typical street-network detour factor). */
  km: number;
  minutes: number;
}

/**
 * A rough travel estimate between two stops, computed from coordinates alone (no routing API).
 * Straight-line distance × 1.3 approximates the street network; speeds are typical city
 * averages including waiting time. Shown with "≈" in the UI — it's for pacing a day, not for
 * catching a train. A RouteProvider can replace this later without changing callers.
 */
export function estimateLeg(a: Pick<PlaceView, "lat" | "lng">, b: Pick<PlaceView, "lat" | "lng">): Leg {
  const straight = haversineKm(a, b);
  const km = straight * 1.3;
  if (km <= 1.5) return { mode: "Walk", km, minutes: Math.max(1, Math.round((km / 4.8) * 60)) };
  if (km <= 30) return { mode: "Transit", km, minutes: Math.round((km / 20) * 60 + 6) };
  if (straight <= 600) return { mode: "Drive", km, minutes: Math.round((km / 70) * 60 + 10) };
  return { mode: "Fly", km: straight, minutes: Math.round((straight / 750) * 60 + 120) };
}

export function formatKm(km: number) {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en")} km`;
}

export function formatMinutes(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const legLabel = (leg: Leg) => `${leg.mode} ≈ ${formatMinutes(leg.minutes)} · ${formatKm(leg.km)}`;

/** Legs keyed by the id of the item they lead *to*; only between consecutive items that both have a place. */
export function dayLegs(items: ItemView[]) {
  const legs = new Map<string, Leg>();
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1].place;
    const b = items[i].place;
    if (a && b) legs.set(items[i].id, estimateLeg(a, b));
  }
  return legs;
}

export function dayStats(day: DayView) {
  const stops = day.items.filter((i) => i.place).length;
  let km = 0;
  dayLegs(day.items).forEach((l) => (km += l.km));
  return { stops, km };
}
