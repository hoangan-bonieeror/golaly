"use client";

/**
 * Realtime collaboration client (spec §31). Events tell us *what* changed; we refetch the
 * affected queries from the REST API, which stays the single source of truth.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationView, TripEvent, TripPresence } from "@golaly/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, ApiError, refreshSession } from "./api/client";
import { keys } from "./api/queries";

let socket: Socket | null = null;
let ownerId: string | null = null;

/**
 * Where the socket connects. NEXT_PUBLIC_REALTIME_URL is either a URL, or "auto" (set by
 * `node scripts/dev-phone.mjs`): the dev server opened directly on :3000 talks to the API on :4000,
 * while a page served through the phone proxy or a tunnel uses its own origin, which forwards
 * /socket.io to the API. Unset = the dev default (API on :4000 next to the web app).
 */
function realtimeUrl() {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  const direct = `${window.location.protocol}//${window.location.hostname}:4000`;
  if (configured === "auto") return window.location.port === "3000" ? direct : window.location.origin;
  return configured || direct;
}

/**
 * A one-minute token for the handshake, fetched through the web app's own origin (so the HTTP-only
 * cookie goes with it). It's what lets the socket authenticate when the API is on another domain —
 * the browser won't send the API's cookie there (e.g. web on Vercel, API on Render). An expired
 * session is refreshed once; without a session the socket goes without a token (and is refused).
 */
async function socketToken(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await api.post<{ token: string }>("/auth/socket-token")).token;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401) || attempt || !(await refreshSession())) return null;
    }
  }
  return null;
}

/** One socket per signed-in user; replaced when the user changes. */
export function getSocket(userId: string | null): Socket | null {
  if (typeof window === "undefined") return null;
  if (!userId) {
    socket?.close();
    socket = null;
    ownerId = null;
    return null;
  }
  if (socket && ownerId === userId) return socket;
  socket?.close();
  ownerId = userId;
  const s = io(realtimeUrl(), {
    path: "/socket.io",
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 10_000,
    // Called before every (re)connect, so each handshake gets a fresh token.
    auth: (cb) => void socketToken().then((token) => cb(token ? { token } : {})),
  });
  // The socket authenticates with the access cookie or the token above. When the server rejects it
  // (expired on reconnect, or the session was revoked), refresh and reconnect; if the
  // refresh fails the user really is signed out and the next REST call sends them to login.
  let retrying = false;
  const reauth = async () => {
    if (retrying) return;
    retrying = true;
    const ok = await refreshSession();
    retrying = false;
    if (ok && socket === s && !s.connected) s.connect();
  };
  s.on("auth.error", reauth); // session revoked or expired while connected
  s.on("connect_error", (err) => {
    if (err.message === "unauthorized") void reauth(); // handshake rejected (e.g. expired cookie on reconnect)
  });
  socket = s;
  return socket;
}

export type PresenceUser = TripPresence["users"][number];

/**
 * Joins the trip room and refetches the trip whenever a collaborator changes it. Also tracks
 * who else has the trip open (`presence`) and lets this tab report which day it is editing.
 */
export function useTripRealtime(tripId: string, userId: string | null | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  // Re-sent after a reconnect so collaborators still see "editing Day N".
  const activity = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return;
    const s = getSocket(userId);
    if (!s) return;
    const join = () =>
      s.emit("trip.join", { tripId }, (r: { ok: boolean }) => {
        setLive(!!r?.ok);
        if (r?.ok && activity.current !== null) s.emit("trip.activity", { tripId, editingDay: activity.current });
      });
    const onEvent = (e: TripEvent) => {
      if (e.tripId !== tripId) return;
      void qc.invalidateQueries({ queryKey: keys.trip(tripId) });
      if (e.event.startsWith("trip.member")) void qc.invalidateQueries({ queryKey: ["trips"] });
    };
    const onPresence = (p: TripPresence) => p.tripId === tripId && setPresence(p.users);
    const onDisconnect = () => {
      setLive(false);
      setPresence([]);
    };
    if (s.connected) join();
    s.on("connect", join);
    s.on("disconnect", onDisconnect);
    s.on("trip.event", onEvent);
    s.on("trip.presence", onPresence);
    return () => {
      s.emit("trip.leave", { tripId });
      s.off("connect", join);
      s.off("disconnect", onDisconnect);
      s.off("trip.event", onEvent);
      s.off("trip.presence", onPresence);
      setPresence([]);
    };
  }, [tripId, userId, enabled, qc]);

  const reportActivity = useCallback(
    (editingDay: number | null) => {
      if (activity.current === editingDay) return;
      activity.current = editingDay;
      const s = userId ? getSocket(userId) : null;
      if (s?.connected) s.emit("trip.activity", { tripId, editingDay });
    },
    [tripId, userId],
  );
  return { live, presence, reportActivity };
}

/** Keeps the bell badge and notifications list fresh. */
export function useNotificationStream(userId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    const s = getSocket(userId ?? null);
    if (!s) return;
    const onNew = (_n: NotificationView) => void qc.invalidateQueries({ queryKey: keys.notifications });
    s.on("notification.new", onNew);
    return () => {
      s.off("notification.new", onNew);
    };
  }, [userId, qc]);
}

export interface SyncRunEvent {
  id: string;
  jobId: string | null;
  status: string;
  progress: { total?: number; done?: number; failed?: number; current?: string };
}

/**
 * Catalog admin screens: joins the `admin` room and calls `onRun` for every sync-run change
 * (status or progress) the pipeline writes. Returns whether live updates are on.
 */
export function useAdminRealtime(userId: string | null | undefined, onRun: (e: SyncRunEvent) => void) {
  const [live, setLive] = useState(false);
  const handler = useRef(onRun);
  useEffect(() => {
    handler.current = onRun;
  });
  useEffect(() => {
    const s = getSocket(userId ?? null);
    if (!s) return;
    const join = () => s.emit("admin.join", {}, (r: { ok: boolean }) => setLive(!!r?.ok));
    const onEvent = (e: SyncRunEvent) => handler.current(e);
    const onDisconnect = () => setLive(false);
    if (s.connected) join();
    s.on("connect", join);
    s.on("disconnect", onDisconnect);
    s.on("sync_run", onEvent);
    return () => {
      s.off("connect", join);
      s.off("disconnect", onDisconnect);
      s.off("sync_run", onEvent);
    };
  }, [userId]);
  return live;
}
