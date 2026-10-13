"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { cx } from "../ui";

export type MenuAction = { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean } | "separator" | { heading: string };

/**
 * The "…" menu on a plan item (a stop on a day or an idea in the pool). WAI-ARIA menu: opens on
 * click or ↓, focuses the first action, ↑/↓ wrap, Home/End, Escape closes and returns focus.
 */
export function ItemMenu({ actions, label }: { actions: MenuAction[]; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const dismiss = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    } else if (e.key === "Tab") setOpen(false);
  };
  const name = label ?? t.trips.itinerary.actions;
  return (
    <div ref={ref} className="relative -mr-1.5 -mt-1">
      <button
        ref={button}
        type="button"
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-sand-2 hover:text-ink md:size-8"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={name} onKeyDown={onMenuKey} className="animate-rise absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-pop">
          {actions.map((a, i) =>
            a === "separator" ? (
              <div key={i} role="separator" className="my-1 h-px bg-line" />
            ) : "heading" in a ? (
              <div key={i} role="presentation" className="px-2.5 pb-0.5 pt-1.5 font-mono text-[11px] uppercase tracking-wider text-muted">
                {a.heading}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={a.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss();
                  a.onClick();
                }}
                className={cx("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-sand-2 focus:bg-sand-2 focus:outline-none disabled:opacity-40 md:min-h-0", a.danger ? "text-danger" : "text-ink-2")}
              >
                <span aria-hidden>{a.icon}</span>
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
