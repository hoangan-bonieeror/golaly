"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * One clock for server-rendered pages (pages that arrive with their data, lib/api/server.ts).
 *
 * Anything that depends on "now" — "2 min ago", "today", is it open, which part of the day — must come out the same
 * on the server and while the browser hydrates, or React throws the server HTML away. Two things differ between them:
 * the moment (the browser hydrates a little later) and the time zone (the server runs in UTC). So:
 * - while rendering on the server and while hydrating, "now" is the server's render time and the time zone is the
 *   one the browser reported last visit (the `triply-tz` cookie), or UTC on a first visit;
 * - right after hydration the components re-render with the real clock and the device's own time zone.
 */
export const TZ_COOKIE = "triply-tz";

type Clock = { renderedAt: number; timeZone: string | null };
const ClockCtx = createContext<Clock>({ renderedAt: 0, timeZone: null });

const noop = () => () => {};
/** False on the server and during hydration, true afterwards (React re-renders the subscribers when it flips). */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export function ClockProvider({ renderedAt, timeZone, children }: Clock & { children: React.ReactNode }) {
  // Tell the server the device's time zone, for the next server render.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tz !== timeZone) document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // No Intl time zone support: the server keeps rendering in UTC.
    }
  }, [timeZone]);
  const value = useMemo(() => ({ renderedAt, timeZone }), [renderedAt, timeZone]);
  return <ClockCtx.Provider value={value}>{children}</ClockCtx.Provider>;
}

/**
 * `now` and the time zone to read it in (undefined = the device's). Stable for a render; call again after hydration
 * for the live values.
 */
export function useClock(): { now: Date; timeZone: string | undefined } {
  const hydrated = useHydrated();
  const c = useContext(ClockCtx);
  if (hydrated) return { now: new Date(), timeZone: undefined };
  return { now: new Date(c.renderedAt), timeZone: c.timeZone ?? "UTC" };
}

/** The render-time instant while hydrating, for state initialisers (useNow). */
export function useRenderNow(): () => Date {
  const hydrated = useHydrated();
  const c = useContext(ClockCtx);
  return () => (hydrated || !c.renderedAt ? new Date() : new Date(c.renderedAt));
}

/** YYYY-MM-DD and HH:mm of an instant in a time zone (undefined = the device's). */
export function zonedParts(now: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
