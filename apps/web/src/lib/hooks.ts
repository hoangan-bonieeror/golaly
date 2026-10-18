"use client";

import { useEffect, useState } from "react";
import { useRenderNow } from "./clock";

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Tracks a CSS media query. `false` on the server and first client render, then the real value. */
export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

/** The current time, refreshed every `ms` (default a minute) — for "now" highlights. */
export function useNow(ms = 60_000) {
  // Starts at the server's render time while hydrating (lib/clock.tsx), so server-rendered pages match.
  const renderNow = useRenderNow();
  const [now, setNow] = useState(renderNow);
  useEffect(() => {
    // Right after hydration, then every `ms`.
    const first = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ms]);
  return now;
}
