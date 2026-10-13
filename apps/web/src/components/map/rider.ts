/**
 * The vehicle that rides the tip of a route while it draws (motion idea 8): a walker for short
 * hops, a train for regional legs, a plane — climbing on an arc over its ground shadow — for long
 * ones. Plain DOM/SVG so the same rider serves the MapLibre map (inside a marker) and the offline
 * SVG map. Markup is built from constants only.
 */

export type Vehicle = "walk" | "train" | "plane";

export const vehicleFor = (km: number): Vehicle => (km > 500 ? "plane" : km > 5 ? "train" : "walk");

const GLYPH: Record<Exclude<Vehicle, "plane">, string> = {
  walk: `<circle cx="1" cy="-5" r="1.7" fill="currentColor"/><path d="M0.6 -2.6 L-0.4 2 M-0.4 2 L-2.6 6.4 M-0.4 2 L2.2 6 M0.4 -1.6 L-2.6 1 M0.4 -1.6 L3 0.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  train: `<path d="M-4.5 -6.5 h9 a1.6 1.6 0 0 1 1.6 1.6 v8.2 a1.6 1.6 0 0 1 -1.6 1.6 h-9 a1.6 1.6 0 0 1 -1.6 -1.6 v-8.2 a1.6 1.6 0 0 1 1.6 -1.6z M-6.1 -2.5 h12.2 M-3.5 6.4 l-2 2.2 M3.5 6.4 l2 2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="-2.8" cy="1.6" r="1" fill="currentColor"/><circle cx="2.8" cy="1.6" r="1" fill="currentColor"/>`,
};
const PLANE = `M9 0 C9 -1 8 -1.4 7 -1.4 L2.5 -1.4 L-1.5 -7.5 L-3.6 -7.5 L-1.4 -1.4 L-5.6 -1.4 L-7.2 -4 L-8.8 -4 L-7.8 0 L-8.8 4 L-7.2 4 L-5.6 1.4 L-1.4 1.4 L-3.6 7.5 L-1.5 7.5 L2.5 1.4 L7 1.4 C8 1.4 9 1 9 0Z`;

function markup(kind: Vehicle, color: string) {
  if (kind === "plane")
    return `<ellipse class="rider-shadow" rx="7" ry="2.4" cy="3" fill="#1f1a16" opacity="0.28"/><g class="rider-body"><path d="${PLANE}" fill="${color}" stroke="var(--color-pin-ring)" stroke-width="1.4" stroke-linejoin="round" transform="scale(1.45)"/></g>`;
  return `<g class="rider-body"><circle r="10.5" fill="var(--color-surface)" stroke="${color}" stroke-width="2.5"/><g style="color:${color}">${GLYPH[kind]}</g></g>`;
}

/**
 * Draw the rider into `root` (an SVG <g>): `angle` is the screen heading in degrees (planes turn to
 * face it), `legT` how far along the current leg (planes climb and land over it).
 */
export function placeRider(root: SVGGElement, kind: Vehicle, color: string, angle: number, legT: number) {
  if (root.dataset.kind !== kind || root.dataset.color !== color) {
    root.innerHTML = markup(kind, color);
    root.dataset.kind = kind;
    root.dataset.color = color;
  }
  if (kind !== "plane") return;
  const lift = Math.sin(legT * Math.PI) * 12;
  const body = root.querySelector<SVGGElement>(".rider-body");
  const shadow = root.querySelector<SVGEllipseElement>(".rider-shadow");
  body?.setAttribute("transform", `translate(0 ${(-lift).toFixed(1)}) rotate(${angle.toFixed(1)})`);
  shadow?.setAttribute("transform", `scale(${(1 - lift / 30).toFixed(2)})`);
  shadow?.setAttribute("opacity", (0.3 - lift / 80).toFixed(2));
}

/** A standalone rider element for a map marker (40 × 40, centred on the route tip). */
export function riderElement(): { el: HTMLDivElement; g: SVGGElement } {
  const el = document.createElement("div");
  el.className = "triply-rider";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg width="44" height="44" viewBox="-22 -22 44 44" style="overflow:visible;display:block"><g></g></svg>`;
  return { el, g: el.querySelector("g")! };
}
