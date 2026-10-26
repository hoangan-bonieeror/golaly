import type { DayView, ItemView, Locale, PlaceView } from "@golaly/shared";
import { INTL_LOCALE, type Messages } from "@/i18n/catalog";

/** Atlas day palette (one colour per day for chips, pins and route; white text ≥ 5.3:1), shared with the app. */
export { DAY_COLORS, dayColor } from "@golaly/tokens";

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

/** Distance for display, with the language's decimal separator ("4.9 km" / "4,9 km"). */
export function formatKm(km: number, locale: Locale) {
  const n = (v: number, digits = 0) => v.toLocaleString(INTL_LOCALE[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (km < 1) return `${n(Math.max(10, Math.round((km * 1000) / 10) * 10))} m`;
  if (km < 10) return `${n(km, 1)} km`;
  return `${n(Math.round(km))} km`;
}

export function formatMinutes(min: number, t: Messages) {
  if (min < 60) return t.format.minutes(min);
  return t.format.hoursMinutes(Math.floor(min / 60), min % 60);
}

/** "Transit ≈ 21 min · 4.9 km" in the given language (no hooks: callers pass the catalog and locale). */
export const legLabel = (leg: Leg, t: Messages, locale: Locale) => t.trips.map.leg(t.labels.legMode[leg.mode], formatMinutes(leg.minutes, t), formatKm(leg.km, locale));

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
