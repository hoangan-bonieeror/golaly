/** Where the sun is for a place at a moment — enough to tint a sky, not to navigate by. */

export type SkyPhase = "night" | "dawn" | "day" | "dusk";

const RAD = Math.PI / 180;

/**
 * Solar altitude (degrees above the horizon) and hour angle (degrees; negative before solar noon)
 * from the low-precision formulas in the Astronomical Almanac (good to ~0.1° for decades either
 * side of 2000). Works from the place's coordinates, so no time-zone data is needed.
 */
export function sunPosition(date: Date, lat: number, lng: number) {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const deg = gmst * 15 + lng - ra / RAD; // local hour angle, any number of turns
  const hourAngle = ((((deg + 180) % 360) + 360) % 360) - 180; // (-180, 180]: 0 at solar noon
  const phi = lat * RAD;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle * RAD)) / RAD;
  return { altitude, hourAngle };
}

/** Civil twilight (sun within 6° of the horizon) is dawn before noon and dusk after. */
export function skyPhase(altitude: number, hourAngle: number): SkyPhase {
  if (altitude > 6) return "day";
  if (altitude < -6) return "night";
  return hourAngle < 0 ? "dawn" : "dusk";
}
