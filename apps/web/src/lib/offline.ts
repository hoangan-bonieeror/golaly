"use client";

/**
 * Offline tolerance (roadmap phase 2). The service worker (public/sw.js) keeps the last copy of trip
 * pages and data; this module keeps went / skipped marks made without a connection in localStorage and
 * sends them when the connection is back (one batch per trip; a mark for a stop that no longer exists
 * is dropped). The planner shows the queued marks on top of the saved trip, so nothing jumps back.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { ItemStatus, TripDetail } from "@triply/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";

const KEY = "golaly-offline-status";
const EVENT = "golaly-offline-queue";

type Mark = { tripId: string; id: string; status: ItemStatus; at: number };

function read(): Mark[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(list: Mark[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: the marks stay only in memory for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Queue marks for later (the latest mark for a stop wins). */
export function queueMarks(tripId: string, changes: [string, ItemStatus][]) {
  const now = Date.now();
  const ids = new Set(changes.map(([id]) => id));
  write([...read().filter((m) => !ids.has(m.id)), ...changes.map(([id, status]) => ({ tripId, id, status, at: now }))]);
}

export const pendingFor = (tripId: string) => read().filter((m) => m.tripId === tripId);

/** The trip with any queued marks applied (what the traveller last saw). */
export function withQueued(trip: TripDetail): TripDetail {
  if (typeof window === "undefined") return trip;
  const marks = pendingFor(trip.id);
  if (!marks.length) return trip;
  const by = new Map(marks.map((m) => [m.id, m.status]));
  const set = <T extends { id: string; status: ItemStatus }>(i: T) => (by.has(i.id) ? { ...i, status: by.get(i.id)! } : i);
  return { ...trip, pool: trip.pool.map(set), days: trip.days.map((d) => ({ ...d, items: d.items.map(set) })) };
}

/** A failed request that never reached the server (no connection) rather than one the server refused. */
export const isOffline = (e: unknown) => (e instanceof ApiError && e.status === 0) || (typeof navigator !== "undefined" && navigator.onLine === false);

let flushing: Promise<number> | null = null;
/** Sends every queued mark; resolves to how many were synced. */
export function flushMarks(): Promise<number> {
  flushing ??= (async () => {
    let synced = 0;
    const byTrip = new Map<string, Mark[]>();
    for (const m of read()) byTrip.set(m.tripId, [...(byTrip.get(m.tripId) ?? []), m]);
    for (const [tripId, marks] of byTrip) {
      try {
        await api.patch(`/trips/${tripId}/items/status`, { items: marks.map(({ id, status }) => ({ id, status })) });
        synced += marks.length;
      } catch (e) {
        if (isOffline(e)) break; // still offline: try again later
        // Refused (a stop was deleted, access lost): send the ones that still can go, one by one.
        for (const m of marks) {
          try {
            await api.patch(`/trips/${tripId}/items/status`, { items: [{ id: m.id, status: m.status }] });
            synced++;
          } catch (err) {
            if (isOffline(err)) return synced;
          }
        }
      }
      const done = new Set(marks.map((m) => m.id));
      write(read().filter((m) => !(m.tripId === tripId && done.has(m.id) && marks.find((x) => x.id === m.id)?.at === m.at)));
    }
    return synced;
  })().finally(() => (flushing = null));
  return flushing;
}

/** Online / offline, and the number of marks waiting for this trip; syncs them when the connection returns. */
export function useOffline(tripId: string, onSynced?: (n: number) => void) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const notify = useRef(onSynced);
  useEffect(() => {
    notify.current = onSynced;
  });
  const busy = useRef(false);
  const sync = useCallback(async () => {
    if (busy.current || !pendingFor(tripId).length || navigator.onLine === false) return;
    busy.current = true;
    try {
      const n = await flushMarks();
      if (n) {
        notify.current?.(n);
        void qc.invalidateQueries({ queryKey: ["trip", tripId] });
      }
    } finally {
      busy.current = false;
    }
  }, [tripId, qc]);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setPending(pendingFor(tripId).length);
    };
    const back = () => {
      update();
      void sync();
    };
    update();
    void sync();
    window.addEventListener("online", back);
    window.addEventListener("offline", update);
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", update);
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [tripId, sync]);
  return { online, pending };
}

/**
 * Registers the service worker (production builds, or dev with NEXT_PUBLIC_SW=1 — it would fight hot reload).
 *
 * Its scope is /trips only: offline matters for trip pages (their scripts and data still go through it, since
 * a controlled page's requests do). Other pages stay uncontrolled on purpose — under a service worker the home page
 * now and then failed to hydrate (React #418, the hydration cursor ending up in <head>), and nothing else needs it.
 * An earlier registration for the whole site ("/") is removed.
 */
const SW_SCOPE = "/trips";
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW !== "1") return;
  const sw = navigator.serviceWorker;
  void (async () => {
    try {
      const wanted = new URL(SW_SCOPE, location.origin).href;
      for (const r of await sw.getRegistrations()) if (r.scope !== wanted) await r.unregister();
      await sw.register("/sw.js", { scope: SW_SCOPE });
    } catch {
      /* offline support is best-effort */
    }
  })();
}

/** Drop the cached trips and photos (not the queued marks). */
function clearOfflineCaches() {
  // The cache is the origin's, so any page can drop it — logout often happens outside the worker's /trips scope.
  if (typeof caches !== "undefined")
    void caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("golaly-data-") || k.startsWith("golaly-media-")).map((k) => caches.delete(k))))
      .catch(() => undefined);
  navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
}

const OWNER = "golaly-offline-owner";

/**
 * False only when this browser has certainly no session: no `golaly_si` hint cookie (set with the session cookies,
 * see the API's common/cookies.ts) and nobody recorded as signed in here before (sessions from before the hint
 * existed). Anything else — including storage errors — means "ask the API".
 */
export function mightBeSignedIn(): boolean {
  try {
    return document.cookie.split("; ").some((c) => c.startsWith("golaly_si=")) || localStorage.getItem(OWNER) !== null;
  } catch {
    return true;
  }
}

/** Forget cached trips and queued marks (on logout: the next person on this device mustn't see them). */
export function clearOfflineData() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OWNER);
  } catch {
    /* ignore */
  }
  clearOfflineCaches();
}

/**
 * Whose trips the offline copies are. Called whenever the server has said who is signed in: a different person
 * (someone else logged in, Google sign-in, a new account) or nobody (the session ended or was revoked elsewhere)
 * clears what the previous person left on this device — not only an explicit logout. Network errors don't count.
 */
export function syncOfflineOwner(userId: string | null) {
  try {
    const prev = localStorage.getItem(OWNER);
    if (prev === userId) return;
    if (userId === null) return clearOfflineData();
    // Someone else's queued marks must not be sent as this person's; our own (first run) are kept.
    if (prev !== null) localStorage.removeItem(KEY);
    clearOfflineCaches();
    localStorage.setItem(OWNER, userId);
  } catch {
    clearOfflineCaches();
  }
}
