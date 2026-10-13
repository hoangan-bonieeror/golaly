"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Drag-and-drop for the itinerary, without a library:
 *
 * - **Pointer** (mouse, pen, touch) from a stop's grip handle: the stop lifts and follows the pointer,
 *   the others slide apart to show where it will land — within its day or into another day — and the
 *   list scrolls when the pointer nears an edge.
 * - **Keyboard** (WAI-ARIA sortable pattern): Space/Enter on the handle picks the stop up, arrow keys move
 *   it (across day boundaries), Space/Enter drops, Escape cancels. Every step is announced.
 *
 * Positions are measured once when a drag starts (in scroll-container coordinates); during the drag only
 * CSS transforms change, so nothing reflows. On drop the caller moves the item in its data, and `useFlip`
 * animates every stop from where it was on screen to its new place.
 */

export interface DayList {
  id: string;
  dayNumber: number;
  itemIds: string[];
}

interface Measured {
  dayId: string;
  top: number;
  bottom: number;
  items: { id: string; top: number; bottom: number }[];
}

export interface DragState {
  id: string;
  mode: "pointer" | "keyboard";
  fromDay: string;
  fromIndex: number;
  toDay: string;
  /** Index in the target day's list without the dragged stop (what the reorder API expects). */
  toIndex: number;
  /** Translation of the dragged stop. */
  dy: number;
  /** Height of the dragged stop (how far the others move aside). */
  h: number;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null; // the page itself scrolls
}

export function useItineraryDrag({
  lists,
  onDrop,
  announce,
}: {
  lists: DayList[];
  onDrop: (id: string, toDayId: string, toIndex: number) => void;
  announce: (kind: "picked" | "moved" | "dropped" | "cancelled", s: DragState) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const listEls = useRef(new Map<string, HTMLElement>());
  const itemEls = useRef(new Map<string, HTMLElement>());
  const measured = useRef<Measured[]>([]);
  const scroller = useRef<HTMLElement | null>(null);
  const pointer = useRef({ startY: 0, clientY: 0, raf: 0 });
  const latest = useRef({ lists, onDrop, announce });
  useEffect(() => {
    latest.current = { lists, onDrop, announce };
  });

  const scrollTop = () => (scroller.current ? scroller.current.scrollTop : window.scrollY);
  const set = useCallback((s: DragState | null) => {
    dragRef.current = s;
    setDrag(s);
  }, []);

  /** Snapshot every list and stop position, in scroll-container coordinates. */
  const measure = () => {
    const st = scrollTop();
    measured.current = latest.current.lists
      .map((l) => {
        const el = listEls.current.get(l.id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const items = l.itemIds.flatMap((id) => {
          const ie = itemEls.current.get(id);
          if (!ie) return [];
          const ir = ie.getBoundingClientRect();
          return [{ id, top: ir.top + st, bottom: ir.bottom + st }];
        });
        return { dayId: l.id, top: r.top + st, bottom: r.bottom + st, items };
      })
      .filter((x): x is Measured => !!x);
  };

  const listOf = (dayId: string) => measured.current.find((l) => l.dayId === dayId);

  /** Where the dragged stop would end up for a pointer at content-y `y`. */
  const targetAt = (y: number, s: DragState) => {
    const lists = measured.current;
    if (!lists.length) return { toDay: s.toDay, toIndex: s.toIndex };
    let best = lists[0];
    let bestDist = Infinity;
    for (const l of lists) {
      const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
      if (d < bestDist) [best, bestDist] = [l, d];
    }
    const others = best.items.filter((i) => i.id !== s.id);
    return { toDay: best.dayId, toIndex: others.filter((i) => (i.top + i.bottom) / 2 < y).length };
  };

  /** Top edge (content-y) the dragged stop settles at for the current target — used by keyboard moves. */
  const settleTop = (s: DragState) => {
    const target = listOf(s.toDay);
    const self = listOf(s.fromDay)?.items.find((i) => i.id === s.id);
    if (!target || !self) return 0;
    const others = target.items.filter((i) => i.id !== s.id);
    const next = others[s.toIndex];
    if (next) return next.top + shiftOf(s, s.toDay, next.id) - s.h;
    const last = others[others.length - 1];
    return last ? last.bottom + shiftOf(s, s.toDay, last.id) : target.top;
  };

  /** How far a stop that isn't being dragged moves aside. */
  function shiftOf(s: DragState, dayId: string, id: string) {
    const list = listOf(dayId);
    if (!list || id === s.id) return 0;
    const j = list.items.findIndex((i) => i.id === id);
    let shift = 0;
    if (dayId === s.fromDay && j > s.fromIndex) shift -= s.h;
    if (dayId === s.toDay) {
      const k = dayId === s.fromDay && j > s.fromIndex ? j - 1 : j;
      if (k >= s.toIndex) shift += s.h;
    }
    return shift;
  }

  const begin = (id: string, dayId: string, index: number, mode: DragState["mode"]) => {
    scroller.current = scrollParent(itemEls.current.get(id) ?? null);
    measure();
    const self = listOf(dayId)?.items.find((i) => i.id === id);
    const s: DragState = { id, mode, fromDay: dayId, fromIndex: index, toDay: dayId, toIndex: index, dy: 0, h: self ? self.bottom - self.top : 0 };
    set(s);
    latest.current.announce("picked", s);
    return s;
  };

  const finish = (commit: boolean) => {
    const s = dragRef.current;
    cancelAnimationFrame(pointer.current.raf);
    if (!s) return;
    set(null);
    document.body.classList.remove("select-none", "cursor-grabbing");
    const moved = s.toDay !== s.fromDay || s.toIndex !== s.fromIndex;
    if (commit && moved) {
      latest.current.onDrop(s.id, s.toDay, s.toIndex);
      latest.current.announce("dropped", s);
    } else if (!commit || s.mode === "keyboard") latest.current.announce("cancelled", s);
  };

  // ── Pointer ──────────────────────────────────────────────────────────
  const onPointerMove = (e: PointerEvent) => {
    const s = dragRef.current;
    if (!s || s.mode !== "pointer") return;
    pointer.current.clientY = e.clientY;
    const y = e.clientY + scrollTop();
    set({ ...s, ...targetAt(y, s), dy: y - pointer.current.startY });
  };

  /** Scrolls the list (or page) while the pointer is near its top or bottom edge. */
  const autoScroll = () => {
    const s = dragRef.current;
    if (!s || s.mode !== "pointer") return;
    const box = scroller.current?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const y = pointer.current.clientY;
    const zone = 90;
    const speed = y < box.top + zone + 60 ? -Math.ceil((box.top + zone + 60 - y) / 8) : y > box.bottom - zone ? Math.ceil((y - (box.bottom - zone)) / 8) : 0;
    if (speed) {
      if (scroller.current) scroller.current.scrollTop += speed;
      else window.scrollBy(0, speed);
      const cy = y + scrollTop();
      set({ ...s, ...targetAt(cy, s), dy: cy - pointer.current.startY });
    }
    pointer.current.raf = requestAnimationFrame(autoScroll);
  };

  const pointerDown = (id: string, dayId: string, index: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    begin(id, dayId, index, "pointer");
    pointer.current.startY = e.clientY + scrollTop();
    pointer.current.clientY = e.clientY;
    document.body.classList.add("select-none", "cursor-grabbing");
    pointer.current.raf = requestAnimationFrame(autoScroll);
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      finish(ev.type === "pointerup");
    };
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  // ── Keyboard ─────────────────────────────────────────────────────────
  const keyDown = (id: string, dayId: string, index: number) => (e: React.KeyboardEvent<HTMLElement>) => {
    const s = dragRef.current;
    const pick = e.key === " " || e.key === "Enter";
    if (!s) {
      if (!pick) return;
      e.preventDefault();
      const started = begin(id, dayId, index, "keyboard");
      set({ ...started, dy: 0 });
      return;
    }
    if (s.mode !== "keyboard") return;
    if (pick) {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      finish(false);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const lists = measured.current;
      const li = lists.findIndex((l) => l.dayId === s.toDay);
      const len = (l: Measured) => l.items.filter((i) => i.id !== s.id).length;
      let { toDay, toIndex } = s;
      if (e.key === "ArrowUp") {
        if (toIndex > 0) toIndex--;
        else if (li > 0) [toDay, toIndex] = [lists[li - 1].dayId, len(lists[li - 1])];
      } else if (toIndex < len(lists[li])) toIndex++;
      else if (li < lists.length - 1) [toDay, toIndex] = [lists[li + 1].dayId, 0];
      if (toDay === s.toDay && toIndex === s.toIndex) return;
      const next = { ...s, toDay, toIndex };
      const self = listOf(s.fromDay)?.items.find((i) => i.id === s.id);
      next.dy = self ? settleTop(next) - self.top : 0;
      set(next);
      latest.current.announce("moved", next);
      // Keep the moving stop in view.
      itemEls.current.get(s.id)?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  };

  /** Inline style for a stop: follows the pointer if dragged, slides aside otherwise. */
  const itemStyle = (id: string, dayId: string): React.CSSProperties | undefined => {
    const s = drag;
    if (!s) return undefined;
    if (id === s.id) return { transform: `translateY(${s.dy}px)`, zIndex: 30, position: "relative", transition: s.mode === "keyboard" ? "transform 180ms cubic-bezier(0.2,0,0,1)" : "none" };
    const shift = shiftOf(s, dayId, id);
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: prefersReducedMotion() ? "none" : "transform 180ms cubic-bezier(0.2,0,0,1)" };
  };

  return {
    drag,
    itemStyle,
    handleProps: (id: string, dayId: string, index: number) => ({
      onPointerDown: pointerDown(id, dayId, index),
      onKeyDown: keyDown(id, dayId, index),
      onBlur: () => dragRef.current?.mode === "keyboard" && dragRef.current.id === id && finish(false),
    }),
    listRef: (dayId: string) => (el: HTMLElement | null) => {
      if (el) listEls.current.set(dayId, el);
      else listEls.current.delete(dayId);
    },
    itemRef: (id: string) => (el: HTMLElement | null) => {
      if (el) itemEls.current.set(id, el);
      else itemEls.current.delete(id);
    },
  };
}

/**
 * FLIP: when the order or set of stops changes (a drop, a move from the menu, a collaborator's edit),
 * each stop animates from where it was to where it is now, and new stops slide in.
 * Elements opt in with `data-flip-id`.
 */
export function useFlip(container: React.RefObject<HTMLElement | null>, signature: string) {
  const prev = useRef<Map<string, number> | null>(null);
  const prevSig = useRef(signature);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const base = root.getBoundingClientRect().top;
    const now = new Map<string, number>();
    root.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((el) => now.set(el.dataset.flipId!, el.getBoundingClientRect().top - base));
    if (prev.current && prevSig.current !== signature && !prefersReducedMotion()) {
      const before = prev.current;
      root.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((el) => {
        const id = el.dataset.flipId!;
        const was = before.get(id);
        const top = now.get(id)!;
        if (was === undefined) {
          if (before.size) el.animate([{ opacity: 0, transform: "translateY(10px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2,0,0,1)" });
        } else if (Math.abs(was - top) > 1 && Math.abs(was - top) < 2000) {
          el.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(0.2,0,0,1)" });
        }
      });
    }
    prev.current = now;
    prevSig.current = signature;
  });
}
