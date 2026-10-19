import { useId } from "react";
import { cx } from "@/lib/utils";

/** The mark's route — shared by the logo and the route loader. */
export const LOGO_ROUTE = "M8 22 C 12 10, 18 26, 24 11";

/**
 * Golaly mark: three stops joined by a route — plan, discover, travel.
 * It comes alive on first paint: the dashed route draws itself (through a mask, so the dashes stay
 * put) and the stops pop in order; hovering the link it sits in makes them hop. Static under reduced motion.
 */
export function LogoMark({ className }: { className?: string }) {
  const mask = `logo-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" className={cx("size-8", className)} aria-hidden>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <path d={LOGO_ROUTE} pathLength={1} className="logo-draw" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        </mask>
      </defs>
      <rect width="32" height="32" rx="10" fill="var(--color-primary)" />
      <path d={LOGO_ROUTE} mask={`url(#${mask})`} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="2 3" strokeLinecap="round" />
      <circle cx="8" cy="22" r="3" fill="#fff" className="logo-dot" style={{ "--d": "60ms" } as React.CSSProperties} />
      <circle cx="16" cy="17" r="2.4" fill="#fff" className="logo-dot" style={{ "--d": "420ms" } as React.CSSProperties} />
      <circle cx="24" cy="11" r="3.2" fill="var(--color-accent)" stroke="#fff" strokeWidth="1.5" className="logo-dot" style={{ "--d": "760ms" } as React.CSSProperties} />
    </svg>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cx("font-display text-[22px] font-bold tracking-tight", light ? "text-white" : "text-ink")}>golaly</span>
    </span>
  );
}

/** Loading indicator in the brand's own terms: a comet runs the logo route, each stop swells as it passes. */
export function RouteLoader({ className }: { className?: string }) {
  return (
    <svg viewBox="4 6 24 20" className={cx("h-12 w-14", className)} aria-hidden>
      <path d={LOGO_ROUTE} fill="none" stroke="var(--color-line-strong)" strokeWidth="1.6" strokeDasharray="1.6 2.4" strokeLinecap="round" />
      <path d={LOGO_ROUTE} pathLength={1} className="loader-comet" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="8" cy="22" r="2.6" fill="var(--color-primary)" className="loader-dot" style={{ "--d": "0ms" } as React.CSSProperties} />
      <circle cx="16" cy="17" r="2.2" fill="var(--color-primary)" className="loader-dot" style={{ "--d": "520ms" } as React.CSSProperties} />
      <circle cx="24" cy="11" r="2.8" fill="var(--color-accent)" stroke="var(--color-pin-ring)" strokeWidth="1.2" className="loader-dot" style={{ "--d": "1000ms" } as React.CSSProperties} />
    </svg>
  );
}
