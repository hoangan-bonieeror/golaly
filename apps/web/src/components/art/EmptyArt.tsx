import { cx } from "@/lib/utils";

/**
 * Small animated illustrations for empty and error states (Atlas line style, theme tokens only).
 * Each plays once when it appears — the moment the user learns there is nothing here — and is
 * static under reduced motion. All are decorative: the state's heading carries the meaning.
 */

const svgProps = { viewBox: "0 0 160 112", "aria-hidden": true } as const;
const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

/** No trips yet: a suitcase's lid swings open and a folded map pops out of it. */
export function SuitcaseArt({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={cx("h-28 w-40", className)}>
      <ellipse cx="80" cy="104" rx="54" ry="5" fill="var(--color-line)" />
      <g className="art-part art-lid">
        <rect x="34" y="12" width="92" height="50" rx="9" fill="var(--color-primary-600)" />
        <rect x="40" y="18" width="80" height="40" rx="6" fill="#000" opacity="0.18" />
      </g>
      <g className="art-part art-pop" style={d(650)}>
        <path d="M50 26 L68 21 L88 26 L108 21 L108 64 L88 69 L68 64 L50 69Z" fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M68 21 V64 M88 26 V69" stroke="var(--color-line)" strokeWidth="1.5" />
        <path d="M54 58 C 62 50, 64 40, 74 42 S 90 52, 102 32" fill="none" stroke="var(--color-contour)" strokeWidth="5" strokeLinecap="round" />
        <path d="M56 54 C 66 36, 78 56, 86 42 S 98 30, 102 31" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
        <circle cx="56" cy="54" r="3" fill="var(--color-primary)" />
        <circle cx="102" cy="31" r="3.4" fill="var(--color-accent)" stroke="var(--color-pin-ring)" strokeWidth="1.2" />
      </g>
      <rect x="34" y="58" width="92" height="42" rx="9" fill="var(--color-primary)" />
      <rect x="34" y="58" width="92" height="5" fill="#000" opacity="0.14" />
      <rect x="54" y="58" width="7" height="42" fill="#000" opacity="0.16" />
      <rect x="99" y="58" width="7" height="42" fill="#000" opacity="0.16" />
      {/* Travel sticker: a tiny route between three stops */}
      <circle cx="80" cy="79" r="8.5" fill="var(--color-gold)" />
      <path d="M75.5 82 Q 78 75 80.5 79 T 85 76" fill="none" stroke="#fff" strokeWidth="1.3" strokeDasharray="1.5 1.5" strokeLinecap="round" />
      <circle cx="75.5" cy="82" r="1.5" fill="#fff" />
      <circle cx="85" cy="76" r="1.7" fill="var(--color-accent)" stroke="#fff" strokeWidth="0.8" />
    </svg>
  );
}

/** No results: binoculars sweep the horizon (twice), lenses glinting. */
export function BinocularsArt({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={cx("h-28 w-40", className)}>
      <path d="M8 98 C 34 86, 52 94, 76 88 S 122 80, 152 92" fill="none" stroke="var(--color-contour)" strokeWidth="3" strokeLinecap="round" />
      <path d="M28 46 Q 80 6 132 46" fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
      <g className="art-part art-sweep">
        <rect x="52" y="44" width="24" height="38" rx="9" fill="var(--color-primary)" />
        <rect x="84" y="44" width="24" height="38" rx="9" fill="var(--color-primary)" />
        <rect x="72" y="54" width="16" height="12" rx="3" fill="var(--color-primary-600)" />
        <rect x="57" y="38" width="14" height="10" rx="3" fill="var(--color-primary-600)" />
        <rect x="89" y="38" width="14" height="10" rx="3" fill="var(--color-primary-600)" />
        <circle cx="64" cy="84" r="12" fill="var(--color-primary-600)" />
        <circle cx="96" cy="84" r="12" fill="var(--color-primary-600)" />
        <circle cx="64" cy="84" r="7.5" fill="var(--color-water)" />
        <circle cx="96" cy="84" r="7.5" fill="var(--color-water)" />
        <path d="M60 81 a5 5 0 0 1 5 -3 M92 81 a5 5 0 0 1 5 -3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" className="art-glint" />
      </g>
    </svg>
  );
}

/** Offline: the compass needle spins, overshoots and settles on north. */
export function CompassArt({ className }: { className?: string }) {
  const ticks = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <svg {...svgProps} className={cx("h-28 w-40", className)}>
      <ellipse cx="80" cy="104" rx="36" ry="4" fill="var(--color-line)" />
      <circle cx="80" cy="56" r="40" fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth="4" />
      <circle cx="80" cy="56" r="31" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
      {ticks.map((a) => (
        <line key={a} x1="80" y1={a % 90 ? 21 : 19} x2="80" y2="25" transform={`rotate(${a} 80 56)`} stroke={a % 90 ? "var(--color-line-strong)" : "var(--color-ink-2)"} strokeWidth={a % 90 ? 1.2 : 2} />
      ))}
      <text x="80" y="36" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--color-accent-700)">
        N
      </text>
      <g className="compass-settle">
        <path d="M80 30 L86 56 L74 56Z" fill="var(--color-accent)" />
        <path d="M80 82 L86 56 L74 56Z" fill="var(--color-ink-2)" />
      </g>
      <circle cx="80" cy="56" r="4" fill="var(--color-surface)" stroke="var(--color-ink-2)" strokeWidth="2" />
    </svg>
  );
}

/** Not found: a traveller walks the route to the torn edge of the map and leans over it. */
export function EdgeOfMapArt({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={cx("h-28 w-40", className)}>
      <path
        d="M10 24 H112 L118 31 L111 39 L119 47 L112 55 L118 63 L111 71 L117 79 L111 86 L114 92 H10Z"
        fill="var(--color-surface)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 44 C 30 34, 46 52, 66 42 S 96 30, 112 40" fill="none" stroke="var(--color-contour)" strokeWidth="3" />
      <path d="M10 80 C 34 70, 54 86, 80 76 S 104 70, 114 74" fill="none" stroke="var(--color-water)" strokeWidth="5" strokeLinecap="round" />
      <path d="M18 68 C 40 70, 60 58, 82 64 S 104 66, 112 64" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="3 3.5" strokeLinecap="round" />
      <circle cx="18" cy="68" r="3" fill="var(--color-primary)" />
      <path d="M126 70 l3 6 M134 82 l2 5 M124 90 l2 4" stroke="var(--color-line-strong)" strokeWidth="1.5" strokeLinecap="round" />
      <g className="art-walk">
        <g transform="translate(103 35)">
          <g className="art-part art-peek">
            <line x1="0" y1="17" x2="0" y2="28" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" className="art-part art-leg is-back" />
            <line x1="0" y1="17" x2="0" y2="28" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" className="art-part art-leg" />
            <rect x="-7" y="6" width="5" height="9" rx="1.5" fill="var(--color-accent)" />
            <line x1="0" y1="6" x2="0" y2="18" stroke="var(--color-ink)" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="0" y1="8" x2="4" y2="15" stroke="var(--color-ink)" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="0" cy="0" r="4.6" fill="var(--color-ink)" />
          </g>
        </g>
      </g>
      <text x="128" y="40" fontSize="16" fontWeight="700" fontFamily="var(--font-display)" fill="var(--color-accent-700)" className="hero-fade" style={d(3100)}>
        ?
      </text>
    </svg>
  );
}

/** Loading placeholder for a map-topped card: a folded paper map that opens panel by panel. */
export function FoldedMap({ className, panels = 4, caption = true }: { className?: string; panels?: number; caption?: boolean }) {
  return (
    <div aria-hidden className={cx("flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface", className)}>
      <div className="relative flex min-h-0 flex-1">
        {Array.from({ length: panels }, (_, i) => (
          <div
            key={i}
            className={cx("fold-panel flex-1", i % 2 === 1 && "is-odd")}
            style={{
              ...d(i * 110),
              background: `linear-gradient(90deg, ${i % 2 ? "color-mix(in srgb, var(--color-map), #000 7%), var(--color-map)" : "var(--color-map), color-mix(in srgb, var(--color-map), #000 4%)"})`,
            }}
          />
        ))}
        <svg viewBox="0 0 200 120" preserveAspectRatio="none" className="hero-fade absolute inset-0 h-full w-full" style={d(panels * 110 + 250)}>
          <path d="M-5 34 C 40 14, 70 52, 110 30 S 170 18, 205 36" fill="none" stroke="var(--color-contour)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d="M-5 92 C 50 76, 90 108, 130 88 S 180 80, 205 96" fill="none" stroke="var(--color-contour)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d="M30 80 C 60 40, 100 90, 130 52 S 160 40, 172 38" fill="none" stroke="var(--color-line-strong)" strokeWidth="2" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="fold-sheen h-full w-full bg-gradient-to-r from-transparent via-surface/35 to-transparent" />
        </div>
      </div>
      {caption && (
        <div className="space-y-2 p-4">
          <div className="h-4 w-2/3 animate-pulse rounded-md bg-sand-2" />
          <div className="h-3 w-2/5 animate-pulse rounded-md bg-sand-2" />
        </div>
      )}
    </div>
  );
}
