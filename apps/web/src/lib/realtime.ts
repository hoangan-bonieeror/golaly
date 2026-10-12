"use client";

/**
 * Realtime collaboration client (spec §31). Events tell us *what* changed; we refetch the
 * affected queries from the REST API, which stays the single source of truth.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationView, TripEvent } from "@triply/shared";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { refreshSession } from "./api/client";
import { keys } from "./api/queries";

let socket: Socket | null = null;
let ownerId: string | null = null;

function realtimeUrl() {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  // Dev default: API on :4000 next to the web app on :3000.
  return `${window.location.protocol}//${window.location.hostname}:4000`;
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
  const s = io(realtimeUrl(), { path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"], reconnectionDelayMax: 10_000 });
  // The socket authenticates with the 15-minute access cookie. When the server rejects it
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

/** Joins the trip room and refetches the trip whenever a collaborator changes it. */
export function useTripRealtime(tripId: string, userId: string | null | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!enabled || !userId) return;
    const s = getSocket(userId);
    if (!s) return;
    const join = () => s.emit("trip.join", { tripId }, (r: { ok: boolean }) => setLive(!!r?.ok));
    const onEvent = (e: TripEvent) => {
      if (e.tripId !== tripId) return;
      void qc.invalidateQueries({ queryKey: keys.trip(tripId) });
      if (e.event.startsWith("trip.member")) void qc.invalidateQueries({ queryKey: ["trips"] });
    };
    const onDisconnect = () => setLive(false);
    if (s.connected) join();
    s.on("connect", join);
    s.on("disconnect", onDisconnect);
    s.on("trip.event", onEvent);
    return () => {
      s.emit("trip.leave", { tripId });
      s.off("connect", join);
      s.off("disconnect", onDisconnect);
      s.off("trip.event", onEvent);
    };
  }, [tripId, userId, enabled, qc]);
  return live;
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
