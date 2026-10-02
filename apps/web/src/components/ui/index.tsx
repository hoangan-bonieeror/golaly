"use client";

import { AlertTriangle, Compass, Lock, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { cx } from "@/lib/utils";

export { cx, formatCount, formatDateRange, timeAgo } from "@/lib/utils";


// ── Button ───────────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "accent" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-lagoon text-white hover:bg-lagoon-600 shadow-sm",
  accent: "bg-sunset text-white hover:brightness-95 shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-sand-2",
  ghost: "text-ink-2 hover:bg-sand-2",
  danger: "bg-surface text-danger border border-line hover:bg-sunset-50",
};
const sizes = { sm: "h-8 px-3 text-sm gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof sizes;
  href?: string;
};

export function Button({ variant = "primary", size = "md", className, href, children, ...rest }: BtnProps) {
  const cls = cx(
    "inline-flex items-center justify-center rounded-full font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    variants[variant],
    sizes[size],
    className,
  );
  if (href)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx("inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-sand-2 transition-colors", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────
type AvatarUser = { displayName: string; avatarHue: number; avatarUrl?: string | null };
export function Avatar({ user, size = 36, ring }: { user?: AvatarUser | null; size?: number; ring?: boolean }) {
  const hue = user?.avatarHue ?? 180;
  const cls = cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none", ring && "ring-2 ring-surface");
  if (user?.avatarUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt="" width={size} height={size} className={cx(cls, "object-cover")} style={{ width: size, height: size }} />;
  return (
    <span
      className={cls}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 70% 60%))`,
      }}
      aria-hidden
    >
      {user?.displayName?.[0] ?? "?"}
    </span>
  );
}

// ── Chip / Badge ─────────────────────────────────────────────────────────
export function Chip({ active, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      aria-pressed={active}
      className={cx(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
        active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-ink-2",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "lagoon" | "sunset" | "gold"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-sand-2 text-ink-2",
    lagoon: "bg-lagoon-50 text-lagoon",
    sunset: "bg-sunset-50 text-sunset",
    gold: "bg-[#fbf1dc] text-[#8a6114]",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

// ── Sheet: bottom sheet on mobile, centered dialog on desktop ────────────
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal aria-labelledby={titleId}>
      <button aria-label="Close" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          "animate-rise relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-pop md:rounded-3xl md:p-6",
          wide ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line md:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-xl font-semibold">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Form fields ──────────────────────────────────────────────────────────
/** `group` renders a <div> instead of <label> — use for composite controls (pickers, chip lists). */
export function Field({ label, hint, error, group, children }: { label: string; hint?: string; error?: string; group?: boolean; children: React.ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block" {...(group ? { role: "group", "aria-label": label } : {})}>
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </Tag>
  );
}

export const inputCls =
  "w-full h-11 rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20";

// ── Empty state ──────────────────────────────────────────────────────────
export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-lagoon-50 text-lagoon">{icon}</div>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Tabs (segmented) ─────────────────────────────────────────────────────
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("flex gap-1 border-b border-line", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            value === t.value ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink-2",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="font-display text-[22px] font-semibold leading-tight">{children}</h2>
      {action}
    </div>
  );
}




// ── Loading states ───────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-2xl bg-sand-2", className)} aria-hidden />;
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label={label}>
      <span className="size-8 animate-spin rounded-full border-[3px] border-line border-t-lagoon" />
    </div>
  );
}

/** Friendly full-panel error for failed queries (spec §40). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? "Something went wrong. Please try again.";
  return (
    <EmptyState
      icon={status === 403 ? <Lock className="size-7" /> : status === 404 ? <Compass className="size-7" /> : <AlertTriangle className="size-7" />}
      title={status === 404 ? "We couldn't find that" : status === 403 ? message : "Something went wrong"}
      body={status === 403 ? undefined : status === 404 ? "It may have been deleted or the link is wrong." : message}
      action={onRetry && status !== 403 && status !== 404 ? <Button onClick={onRetry}>Try again</Button> : <Button href="/home">Go home</Button>}
    />
  );
}
