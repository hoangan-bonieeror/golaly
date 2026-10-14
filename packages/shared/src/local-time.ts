/**
 * The local date and time at a place, for "open now". Places don't store a time zone, so it's inferred from
 * coordinates: exact for the single-zone countries the catalog covers (by bounding box), the four zones of the
 * contiguous US by longitude, and otherwise solar time (UTC offset ≈ longitude / 15) — close enough to say
 * open / closed, and the UI says "local time".
 */

type Box = { zone: string; minLat: number; maxLat: number; minLng: number; maxLng: number };

// Small to large: the first box that contains the point wins.
const BOXES: Box[] = [
  { zone: "Asia/Singapore", minLat: 1.15, maxLat: 1.48, minLng: 103.6, maxLng: 104.1 },
  { zone: "Asia/Hong_Kong", minLat: 22.15, maxLat: 22.57, minLng: 113.82, maxLng: 114.45 },
  { zone: "Asia/Taipei", minLat: 21.8, maxLat: 25.4, minLng: 119.9, maxLng: 122.1 },
  { zone: "Europe/Lisbon", minLat: 36.9, maxLat: 42.2, minLng: -9.6, maxLng: -6.15 },
  { zone: "Asia/Seoul", minLat: 33, maxLat: 38.7, minLng: 124.5, maxLng: 131 },
  { zone: "Asia/Ho_Chi_Minh", minLat: 8.3, maxLat: 23.5, minLng: 102.1, maxLng: 109.6 },
  { zone: "Asia/Bangkok", minLat: 5.6, maxLat: 20.5, minLng: 97.3, maxLng: 105.7 },
  { zone: "Asia/Tokyo", minLat: 24, maxLat: 45.6, minLng: 122.9, maxLng: 146 },
  { zone: "Europe/Madrid", minLat: 36, maxLat: 43.8, minLng: -9.3, maxLng: 3.4 },
  { zone: "Europe/Paris", minLat: 42.3, maxLat: 51.1, minLng: -4.8, maxLng: 8.3 },
  { zone: "Europe/Rome", minLat: 36.6, maxLat: 47.1, minLng: 6.6, maxLng: 18.6 },
  { zone: "Europe/London", minLat: 49.9, maxLat: 58.7, minLng: -8.2, maxLng: 1.8 },
  { zone: "Asia/Shanghai", minLat: 18, maxLat: 53.6, minLng: 73.5, maxLng: 134.8 },
];

/** An IANA zone for a point (an `Etc/GMT±N` solar zone when nothing better is known). */
export function timeZoneAt(lat: number, lng: number): string {
  for (const b of BOXES) if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) return b.zone;
  // Contiguous United States by rough longitude bands.
  if (lat >= 24 && lat <= 49.5 && lng >= -125 && lng <= -66.9) {
    if (lng < -114.5) return "America/Los_Angeles";
    if (lng < -102) return "America/Denver";
    if (lng < -86.5) return "America/Chicago";
    return "America/New_York";
  }
  const offset = Math.max(-12, Math.min(14, Math.round(lng / 15)));
  // Etc/GMT zones have inverted signs: UTC+7 is "Etc/GMT-7".
  return offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

/** The date (YYYY-MM-DD) and time (HH:mm) right now at a point, in its inferred zone. */
export function localNowAt(lat: number, lng: number, now = new Date()): { date: string; time: string; zone: string } {
  const zone = timeZoneAt(lat, lng);
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, zone };
  } catch {
    const iso = now.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16), zone: "Etc/UTC" };
  }
}
