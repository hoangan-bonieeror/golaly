"use client";

import { AlertTriangle, Compass, Lock, X } from "lucide-react";
import Link from "next/link";
import { cloneElement, isValidElement, useEffect, useId, useRef } from "react";
import { cx } from "@/lib/utils";

export { cx, formatCount, formatDateRange, timeAgo } from "@/lib/utils";


// ── Button ───────────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "accent" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-600 shadow-sm",
  accent: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-sand-2",
  ghost: "text-ink-2 hover:bg-sand-2",
  danger: "bg-surface text-danger border border-line hover:bg-accent-50",
};
/**
 * Small controls keep their compact look but get an invisible 44px hit area (`hit`) so they're
 * comfortable to tap on phones (Apple HIG / WCAG 2.5.5).
 */
const hit = "relative before:absolute before:left-1/2 before:top-1/2 before:size-11 before:min-w-full before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";
const sizes = { sm: `h-8 px-3 text-sm gap-1.5 ${hit}`, md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof sizes;
  href?: string;
};

export function Button({ variant = "primary", size = "md", className, href, children, ...rest }: BtnProps) {
  const cls = cx(
    "inline-flex items-center justify-center rounded-full font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
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
      className={cx("inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-sand-2 transition-colors", hit, className)}
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
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors",
        hit,
        active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-ink-2",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "primary" | "accent" | "gold"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-sand-2 text-ink-2",
    primary: "bg-primary-50 text-primary",
    accent: "bg-accent-50 text-accent-700",
    gold: "bg-gold-50 text-gold-700",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

// ── Sheet: bottom sheet on mobile, centered dialog on desktop ────────────
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: focus moves to the first form field (or the first control), Tab and
 * Shift+Tab stay inside the dialog, Escape closes it, and focus returns to whatever opened it.
 */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Parents usually pass an inline onClose; keep the effect from re-running (and stealing focus) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusables = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = panel?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]),select,textarea") ?? focusables().find((el) => el.getAttribute("aria-label") !== "Close") ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const [head, tail] = [list[0], list[list.length - 1]];
      if (e.shiftKey && (document.activeElement === head || !panel?.contains(document.activeElement))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (document.activeElement === tail || !panel?.contains(document.activeElement))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div aria-hidden className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
/**
 * Label + control + hint/error. The error/hint is linked to the control with aria-describedby and
 * the control gets aria-invalid, so screen readers announce what's wrong with the field.
 * `group` renders a <div role="group"> instead of <label> — use for composite controls (pickers, chip lists).
 */
export function Field({ label, hint, error, group, children }: { label: string; hint?: string; error?: string; group?: boolean; children: React.ReactNode }) {
  const msgId = useId();
  const Tag = group ? "div" : "label";
  const msg = error ?? hint;
  const control =
    !group && isValidElement<Record<string, unknown>>(children) && typeof children.type === "string"
      ? cloneElement(children, { "aria-invalid": error ? true : undefined, "aria-describedby": msg ? msgId : undefined })
      : children;
  return (
    <Tag className="block" {...(group ? { role: "group", "aria-label": label, "aria-describedby": msg ? msgId : undefined } : {})}>
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {control}
      {error ? (
        <span id={msgId} role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={msgId} className="mt-1 block text-xs text-muted">
          {hint}
        </span>
      ) : null}
    </Tag>
  );
}

export const inputCls =
  "w-full h-11 rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// ── Empty state ──────────────────────────────────────────────────────────
export function EmptyState({ icon, title, body, action, level = "h2" }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode; level?: "h1" | "h2" | "h3" }) {
  const H = level;
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-50 text-primary">{icon}</div>
      <H className="font-display text-xl font-semibold">{title}</H>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Tabs (segmented) ─────────────────────────────────────────────────────
/**
 * WAI-ARIA tabs: roving tabindex, ←/→/Home/End move between tabs, and each tab points at the
 * panel it controls. Wrap the content in <TabPanel tabsId={id} value={current}> with the same `id`.
 */
export function Tabs<T extends string>({
  id,
  value,
  onChange,
  tabs,
  className,
  label,
}: {
  id: string;
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: React.ReactNode }[];
  className?: string;
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cx("flex gap-1 border-b border-line", className)}>
      {tabs.map((t, i) => {
        const selected = value === t.value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-tab-${t.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              "-mb-px flex min-h-11 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              selected ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink-2",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ tabsId, value, children, className }: { tabsId: string; value: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${value}`} tabIndex={-1} className={cx("focus:outline-none", className)}>
      {children}
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




// ── Pagination ───────────────────────────────────────────────────────────
export function LoadMore({ hasMore, loading, onClick, label = "Load more" }: { hasMore?: boolean; loading?: boolean; onClick: () => void; label?: string }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button variant="secondary" onClick={onClick} disabled={loading} aria-busy={loading}>
        {loading ? "Loading…" : label}
      </Button>
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
      <span className="size-8 animate-spin rounded-full border-[3px] border-line border-t-primary" />
    </div>
  );
}

/** Friendly full-panel error for failed queries (spec §40). */
/** `page` = the error replaces the whole page, so its title is the page's h1. */
export function ErrorState({ error, onRetry, page }: { error: unknown; onRetry?: () => void; page?: boolean }) {
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? "Something went wrong. Please try again.";
  return (
    <EmptyState
      level={page ? "h1" : "h2"}
      icon={status === 403 ? <Lock className="size-7" /> : status === 404 ? <Compass className="size-7" /> : <AlertTriangle className="size-7" />}
      title={status === 404 ? "We couldn't find that" : status === 403 ? message : status === 0 ? "You're offline" : "We couldn't load this"}
      body={
        status === 403
          ? undefined
          : status === 404
            ? "It may have been deleted or the link is wrong."
            : status === 0
              ? message
              : message === "Something went wrong. Please try again." || !message
                ? "Our server had a hiccup. Your data is safe — try again in a moment."
                : message
      }
      action={onRetry && status !== 403 && status !== 404 ? <Button onClick={onRetry}>Try again</Button> : <Button href="/home">Go home</Button>}
    />
  );
}
