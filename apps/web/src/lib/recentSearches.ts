"use client";

/**
 * Recent Explore searches — a per-device convenience kept in localStorage (not account data).
 * Exposed as an external store for useSyncExternalStore: no hydration mismatch, no effect.
 */
import { useSyncExternalStore } from "react";

const KEY = "triply.recentSearches";
const MAX = 6;
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; list: string[] } = { raw: null, list: EMPTY };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY; // storage blocked (private mode, sandboxed iframe…)
  }
  if (raw === cache.raw) return cache.list;
  let list = EMPTY;
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === "string").slice(0, MAX);
  } catch {
    /* corrupted value — treat as empty */
  }
  cache = { raw, list };
  return list;
}

function write(list: string[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRecentSearches() {
  const recent = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    recent,
    remember: (q: string) => write([q, ...read().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX)),
    clear: () => write([]),
  };
}
