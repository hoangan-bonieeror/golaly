/** Motion helpers shared by the planner, the maps and the itinerary. */

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Ease-in-out cubic, for route drawing (starts gently, lands softly). */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** How long drawing a route of `n` stops takes: long enough to read the order, never sluggish. */
export const drawDuration = (n: number) => Math.min(1600, Math.max(700, 450 + n * 140));

type Pt = [number, number];

/**
 * A polyline cut at `fraction` of its length (planar, with longitude scaled by latitude), plus the
 * fraction of the length at which each vertex sits — used to pop each pin as the line reaches it.
 */
export function measurePolyline(coords: Pt[], { planar = false }: { planar?: boolean } = {}) {
  // [lng, lat] by default (longitude shrinks with latitude); `planar` for points already projected to pixels.
  const k = planar ? 1 : Math.cos(((coords.reduce((s, c) => s + c[1], 0) / Math.max(1, coords.length)) * Math.PI) / 180);
  const seg = coords.slice(1).map((c, i) => Math.hypot((c[0] - coords[i][0]) * k, c[1] - coords[i][1]));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  const at: number[] = [0];
  seg.forEach((d) => at.push(at[at.length - 1] + d / total));
  const cut = (fraction: number): Pt[] => {
    if (fraction >= 1) return coords;
    const out: Pt[] = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      if (at[i] <= fraction) out.push(coords[i]);
      else {
        const f = (fraction - at[i - 1]) / Math.max(1e-9, at[i] - at[i - 1]);
        out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]);
        break;
      }
    }
    return out;
  };
  /** Where the drawn line ends at `fraction`: the point, the leg it is on (1-based) and how far along that leg. */
  const tip = (fraction: number) => {
    const f = Math.min(1, Math.max(0, fraction));
    let i = 1;
    while (i < coords.length - 1 && at[i] < f) i++;
    const legT = Math.min(1, Math.max(0, (f - at[i - 1]) / Math.max(1e-9, at[i] - at[i - 1])));
    const a = coords[i - 1];
    const b = coords[i] ?? a;
    return { point: [a[0] + (b[0] - a[0]) * legT, a[1] + (b[1] - a[1]) * legT] as Pt, leg: i, legT };
  };
  return { at, cut, tip };
}
