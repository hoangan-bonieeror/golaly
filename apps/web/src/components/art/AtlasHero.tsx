import type { Locale } from "@golaly/shared";

/**
 * The sign-in / sign-up hero: a hand-drawn paper map that inks itself in. Contours and a coastline
 * appear first, then a vermilion route travels between real cities at a steady pace, each city
 * popping in as the line reaches it, while a compass needle settles and the rose sways gently.
 * A different journey each visit (chosen on the server, so there is no hydration mismatch).
 * Purely decorative (aria-hidden); theme tokens only, so it follows light/dark.
 */

type P = [number, number];
type Journey = {
  stops: { at: P; en: string; vi: string; /** Label side: right (default), left, top or bottom. */ label?: "l" | "r" | "t" | "b" }[];
  /** Coastline control points (top → bottom or left → right) and the corners that close the sea. */
  coast: P[];
  sea: P[];
  hills: P[];
};

// Coordinates in a 600 × 800 sheet (squeezed upwards at render time, see `fit`).
const JOURNEYS: Journey[] = [
  {
    stops: [
      { at: [214, 120], en: "Hanoi", vi: "Hà Nội" },
      { at: [300, 268], en: "Hue", vi: "Huế", label: "l" },
      { at: [352, 326], en: "Hoi An", vi: "Hội An" },
      { at: [336, 470], en: "Da Lat", vi: "Đà Lạt", label: "l" },
      { at: [244, 540], en: "Saigon", vi: "Sài Gòn", label: "l" },
    ],
    coast: [[300, -20], [290, 90], [262, 170], [334, 250], [398, 320], [418, 410], [404, 500], [330, 560], [250, 600], [150, 640], [-20, 650]],
    sea: [[620, 820], [620, -20]],
    hills: [[118, 250], [210, 400]],
  },
  {
    stops: [
      { at: [490, 200], en: "Tokyo", vi: "Tokyo", label: "t" },
      { at: [410, 320], en: "Hakone", vi: "Hakone", label: "b" },
      { at: [292, 250], en: "Kyoto", vi: "Kyoto", label: "t" },
      { at: [220, 350], en: "Osaka", vi: "Osaka", label: "b" },
      { at: [96, 300], en: "Hiroshima", vi: "Hiroshima", label: "t" },
    ],
    coast: [[-20, 470], [100, 440], [200, 430], [300, 410], [400, 400], [480, 350], [560, 300], [620, 280]],
    sea: [[620, 820], [-20, 820]],
    hills: [[200, 150], [380, 130]],
  },
  {
    stops: [
      { at: [356, 112], en: "Venice", vi: "Venezia" },
      { at: [290, 236], en: "Florence", vi: "Firenze", label: "l" },
      { at: [312, 376], en: "Rome", vi: "Roma", label: "l" },
      { at: [400, 466], en: "Naples", vi: "Napoli", label: "l" },
      { at: [470, 560], en: "Amalfi", vi: "Amalfi" },
    ],
    coast: [[160, -20], [196, 120], [222, 240], [252, 340], [318, 432], [380, 520], [432, 600], [480, 660], [540, 720], [600, 760]],
    sea: [[-20, 820], [-20, -20]],
    hills: [[440, 260], [420, 120]],
  },
  {
    stops: [
      { at: [236, 104], en: "Chiang Mai", vi: "Chiang Mai" },
      { at: [278, 236], en: "Sukhothai", vi: "Sukhothai" },
      { at: [318, 386], en: "Bangkok", vi: "Bangkok" },
      { at: [214, 478], en: "Hua Hin", vi: "Hua Hin", label: "l" },
      { at: [150, 570], en: "Krabi", vi: "Krabi", label: "l" },
    ],
    coast: [[620, 420], [470, 432], [376, 424], [300, 440], [256, 480], [222, 540], [206, 600], [214, 680], [230, 820]],
    sea: [[620, 820]],
    hills: [[420, 200], [140, 300]],
  },
];

/** Catmull-Rom through the points, as cubic Béziers — a smooth hand-drawn line. */
function smooth(pts: P[]): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Fraction of the smoothed route's length at which each stop sits (sampled, good to a pixel). */
function stopFractions(pts: P[]): number[] {
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    let len = 0;
    let prev = p1;
    for (let k = 1; k <= 24; k++) {
      const t = k / 24;
      const u = 1 - t;
      const q: P = [u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]];
      len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
    }
    lens.push(len);
  }
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const out = [0];
  lens.forEach((l) => out.push(out[out.length - 1] + l / total));
  return out;
}

/** A wobbly closed loop around a centre — a contour line. Deterministic per (centre, radius). */
function blob([cx, cy]: P, r: number, seed: number): string {
  const n = 9;
  const pts: P[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + 0.16 * Math.sin(seed * 1.7 + i * 2.3) + 0.08 * Math.cos(seed + i * 4.1);
    return [cx + Math.cos(a) * r * w * 1.25, cy + Math.sin(a) * r * w * 0.8];
  });
  const at = (i: number) => pts[(i + n) % n];
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

const ms = (n: number) => ({ "--d": `${Math.round(n)}ms` }) as React.CSSProperties;

export function AtlasHero({ journey, locale }: { journey: number; locale: Locale }) {
  const raw = JOURNEYS[((journey % JOURNEYS.length) + JOURNEYS.length) % JOURNEYS.length];
  // Keep the journey in the upper ~60% of the sheet, clear of the headline (bottom-left).
  const fit = ([x, y]: P): P => [x, Math.round(70 + (y - 100) * 0.78)];
  const j: Journey = { stops: raw.stops.map((s) => ({ ...s, at: fit(s.at) })), coast: raw.coast.map(fit), sea: raw.sea, hills: raw.hills.map(fit) };
  const route = j.stops.map((s) => s.at);
  const at = stopFractions(route);
  const ROUTE_START = 900;
  const ROUTE_DRAW = 2600;
  const coast = smooth(j.coast);
  const seaFill = `${coast} ${j.sea.map(([x, y]) => `L${x} ${y}`).join(" ")} Z`;

  return (
    <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <rect width="600" height="800" fill="var(--color-map)" />
      {/* Graticule */}
      <g stroke="var(--color-contour)" strokeWidth="1" opacity="0.7">
        {[120, 270, 420].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="800" strokeDasharray="2 8" />
        ))}
        {[160, 330, 500, 670].map((y) => (
          <line key={y} x1="0" y1={y} x2="600" y2={y} strokeDasharray="2 8" />
        ))}
      </g>

      {/* Sea, coastline and its echo */}
      <path d={seaFill} fill="var(--color-water)" opacity="0.55" className="hero-fade" style={ms(100)} />
      <path d={coast} fill="none" stroke="var(--color-water)" strokeWidth="12" strokeLinecap="round" opacity="0.6" transform="translate(10 6)" className="hero-fade" style={ms(300)} />
      <path d={coast} pathLength={1} fill="none" stroke="var(--color-ink-2)" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" className="hero-ink" style={ms(150)} />

      {/* Hills */}
      {j.hills.map((c, h) =>
        [34, 60, 88].map((r, k) => <path key={`${h}-${r}`} d={blob(c, r, h * 3 + k)} pathLength={1} fill="none" stroke="var(--color-contour)" strokeWidth="2" className="hero-ink" style={ms(250 + h * 220 + k * 120)} />),
      )}

      {/* The journey */}
      <path d={smooth(route)} fill="none" stroke="var(--color-map)" strokeWidth="9" strokeLinecap="round" opacity="0.9" />
      <path
        d={smooth(route)}
        pathLength={1}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="3.5"
        strokeLinecap="round"
        className="hero-route"
        style={{ ...ms(ROUTE_START), "--draw": `${ROUTE_DRAW}ms` } as React.CSSProperties}
      />
      {j.stops.map((s, i) => {
        const delay = ROUTE_START + at[i] * ROUTE_DRAW;
        const last = i === j.stops.length - 1;
        const left = s.label === "l";
        const vertical = s.label === "t" || s.label === "b";
        return (
          <g key={s.en} transform={`translate(${s.at[0]} ${s.at[1]})`}>
            <g className="svg-pin-in" style={{ "--delay": `${Math.round(delay)}ms` } as React.CSSProperties}>
              <circle r={last || i === 0 ? 9 : 7} fill={last ? "var(--color-accent)" : "var(--color-primary)"} stroke="var(--color-pin-ring)" strokeWidth="3" />
            </g>
            <text
              x={left ? -16 : vertical ? 0 : 16}
              y={s.label === "t" ? -18 : s.label === "b" ? 28 : 5}
              textAnchor={left ? "end" : vertical ? "middle" : "start"}
              fontSize="15"
              fontWeight="600"
              letterSpacing="1.5"
              fontFamily="var(--font-mono)"
              fill="var(--color-ink-2)"
              stroke="var(--color-map)"
              strokeWidth="5"
              paintOrder="stroke"
              className="hero-fade"
              style={ms(delay + 120)}
            >
              {(locale === "vi" ? s.vi : s.en).toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* Compass rose: the needle spins and settles on north; the rose then sways, slowly. */}
      <g transform="translate(520 86)" className="hero-fade" style={ms(200)}>
        <g className="hero-compass">
          <circle r="34" fill="var(--color-map)" stroke="var(--color-ink-2)" strokeOpacity="0.6" strokeWidth="1.5" />
          <circle r="27" fill="none" stroke="var(--color-contour)" strokeWidth="1" />
          {Array.from({ length: 16 }, (_, i) => (
            <line key={i} y1={i % 4 ? -30 : -33} y2="-26" transform={`rotate(${i * 22.5})`} stroke="var(--color-ink-2)" strokeOpacity="0.6" strokeWidth={i % 4 ? 1 : 1.8} />
          ))}
          <text y="-40" textAnchor="middle" fontSize="12" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--color-accent-700)">
            N
          </text>
          <g className="compass-settle" style={ms(300)}>
            <path d="M0 -24 L6 0 L-6 0Z" fill="var(--color-accent)" />
            <path d="M0 24 L6 0 L-6 0Z" fill="var(--color-ink-2)" opacity="0.7" />
          </g>
          <circle r="3" fill="var(--color-map)" stroke="var(--color-ink-2)" strokeWidth="1.5" />
        </g>
      </g>

    </svg>
  );
}

/** A journey for this request (server-side, so each visit can show a different one). */
export const pickJourney = () => Math.floor(Math.random() * JOURNEYS.length);
