"use client";

import { Check, X } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { cx } from "../ui";

const START = 12;
const COMMIT = 72;
const MAX = 132;

/**
 * Swipe a card sideways with a finger (touch only — mouse and pen keep click/drag): right or left past
 * COMMIT px calls `onSwipe`. Vertical moves are left to the page (the card is `touch-action: pan-y`), and the
 * click that ends a swipe is swallowed so it doesn't also select the card.
 */
export function useSwipe(onSwipe: (dir: "right" | "left") => void, enabled: boolean) {
  const [dx, setDx] = useState(0);
  const st = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);
  // The latest offset, for pointerup (state may not have re-rendered yet between fast moves).
  const last = useRef(0);
  const reset = () => {
    st.current = null;
    last.current = 0;
    setDx(0);
  };
  if (!enabled) return { dx: 0, bind: {}, committed: false };
  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") return;
      st.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = st.current;
      if (!s || e.pointerId !== s.id) return;
      const ddx = e.clientX - s.x;
      const ddy = e.clientY - s.y;
      if (!s.active) {
        if (Math.abs(ddy) > START && Math.abs(ddy) > Math.abs(ddx)) return void (st.current = null);
        if (Math.abs(ddx) < START || Math.abs(ddx) < Math.abs(ddy) * 1.5) return;
        s.active = true;
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* the pointer is already gone */
        }
      }
      last.current = Math.max(-MAX, Math.min(MAX, ddx));
      setDx(last.current);
    },
    onPointerUp: () => {
      const s = st.current;
      if (s?.active) {
        swallowClick.current = true;
        setTimeout(() => (swallowClick.current = false), 0);
        if (Math.abs(last.current) >= COMMIT) onSwipe(last.current > 0 ? "right" : "left");
      }
      reset();
    },
    onPointerCancel: reset,
    onClickCapture: (e: React.MouseEvent) => {
      if (swallowClick.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
  return { dx, bind, committed: Math.abs(dx) >= COMMIT };
}

/**
 * A swipeable stop card: what the swipe will do shows underneath (went on the left in jade, skip on the right),
 * and the card follows the finger. Buttons and the menu remain the accessible way to do the same.
 */
export function SwipeArea({ enabled, onSwipe, className, children }: { enabled: boolean; onSwipe: (dir: "right" | "left") => void; className?: string; children: React.ReactNode }) {
  const t = useT().during.swipe;
  const { dx, bind, committed } = useSwipe(onSwipe, enabled);
  return (
    <div className={cx("relative", className)}>
      {dx !== 0 && (
        <div
          aria-hidden
          className={cx(
            "absolute inset-0 flex items-center rounded-[14px] px-4 text-sm font-semibold",
            dx > 0 ? "justify-start bg-primary text-on-primary" : "justify-end bg-ink-2 text-surface",
            !committed && "opacity-70",
          )}
        >
          {dx > 0 ? <Check className="mr-1.5 size-4" /> : null}
          {dx > 0 ? t.went : t.skip}
          {dx < 0 ? <X className="ml-1.5 size-4" /> : null}
        </div>
      )}
      <div {...bind} className={cx("relative", enabled && "touch-pan-y")} style={dx ? { transform: `translateX(${dx}px)` } : { transition: "transform 180ms ease-out" }}>
        {children}
      </div>
    </div>
  );
}
