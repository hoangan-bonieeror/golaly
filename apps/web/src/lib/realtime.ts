"use client";

/**
 * Realtime collaboration client (spec §31). Events tell us *what* changed; we refetch the
 * affected queries from the REST API, which stays the single source of truth.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationView, TripEvent } from "@triply/shared";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
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
  socket = io(realtimeUrl(), { path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"], reconnectionDelayMax: 10_000 });
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
