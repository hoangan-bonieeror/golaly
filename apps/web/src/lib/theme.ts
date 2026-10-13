"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Theme preference: "system" follows the OS (prefers-color-scheme), "light"/"dark" override it.
 * Stored per device in localStorage (a display preference, like zoom). The resolved theme lives on
 * <html data-theme>, set before first paint by THEME_SCRIPT so there's no flash of the wrong theme.
 */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";
const KEY = "triply-theme";

/** Runs inline in <head> before the page paints. Keep it tiny and dependency-free. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}");var d=p==="dark"||((!p||p==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}})()`;

function readPref(): ThemePref {
  try {
    const p = localStorage.getItem(KEY);
    return p === "light" || p === "dark" ? p : "system";
  } catch {
    return "system";
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (p: ThemePref): Theme => (p === "system" ? (media().matches ? "dark" : "light") : p);

const listeners = new Set<() => void>();
function apply(p: ThemePref) {
  const theme = resolve(p);
  document.documentElement.dataset.theme = theme;
  // Browser chrome (mobile address bar) follows the canvas colour.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", theme === "dark" ? "#15130f" : "#f3efe6"));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = media();
  const onOs = () => readPref() === "system" && apply("system");
  const onStorage = (e: StorageEvent) => e.key === KEY && apply(readPref());
  mq.addEventListener("change", onOs);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onOs);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => `${readPref()}|${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}`;

export function useTheme() {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "system|light");
  const [pref, theme] = snap.split("|") as [ThemePref, Theme];
  const setPref = useCallback((p: ThemePref) => {
    try {
      if (p === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      /* private mode: still switch for this page */
    }
    apply(p);
  }, []);
  return { pref, theme, setPref };
}
