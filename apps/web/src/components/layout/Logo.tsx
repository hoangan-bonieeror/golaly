import { cx } from "@/lib/utils";

/** TRIPLY mark: three stops joined by a route — plan, discover, travel. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="10" fill="var(--color-primary)" />
      <path d="M8 22 C 12 10, 18 26, 24 11" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="2 3" strokeLinecap="round" />
      <circle cx="8" cy="22" r="3" fill="#fff" />
      <circle cx="16" cy="17" r="2.4" fill="#fff" />
      <circle cx="24" cy="11" r="3.2" fill="var(--color-accent)" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cx("font-display text-[22px] font-bold tracking-tight", light ? "text-white" : "text-ink")}>triply</span>
    </span>
  );
}
