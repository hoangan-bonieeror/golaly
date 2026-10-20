"use client";

import { useQuery } from "@tanstack/react-query";
import type { DirectionsMode, DirectionsView } from "@golaly/shared";
import { ApiError, api } from "@/lib/api/client";
import { useMe } from "@/lib/api/queries";
import { useI18n } from "@/i18n/client";
import { formatKm, formatMinutes, haversineKm } from "@/lib/trip-geo";
import { useCallback, useState } from "react";
import { Bike, Car, Footprints, Loader2, LocateFixed, X } from "lucide-react";
import { cx } from "../ui";

export type LatLng = { lat: number; lng: number };

type GeoError = "denied" | "unavailable" | "timeout" | "insecure" | "unsupported";
export type GeoState = { status: "idle" } | { status: "locating" } | { status: "ok"; at: LatLng; accuracyM: number } | { status: "error"; error: GeoError };

/** One position fix on request (not continuous tracking): enough to route from, and gentler on battery and privacy. */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const request = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return setState({ status: "error", error: "unsupported" });
    if (!window.isSecureContext) return setState({ status: "error", error: "insecure" });
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => setState({ status: "ok", at: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracyM: p.coords.accuracy }),
      (e) => setState({ status: "error", error: e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);
  return { state, request, reset: () => setState({ status: "idle" }) };
}

/** Walking for short hops, driving beyond (the user can switch). */
export const defaultMode = (from: LatLng, to: LatLng): DirectionsMode => (haversineKm(from, to) <= 2.5 ? "walk" : "car");

const r5 = (n: number) => n.toFixed(5);

/** The route from the API (OpenRouteService behind it). Signed-in users only. */
export function useDirections(from: LatLng | null, to: LatLng, mode: DirectionsMode) {
  const me = useMe().data;
  return useQuery({
    queryKey: ["directions", from && `${r5(from.lat)},${r5(from.lng)}`, `${r5(to.lat)},${r5(to.lng)}`, mode],
    queryFn: () => api.get<DirectionsView>(`/directions?from=${r5(from!.lat)},${r5(from!.lng)}&to=${r5(to.lat)},${r5(to.lng)}&mode=${mode}`),
    enabled: !!from && !!me,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/**
 * Hand-off to a navigation app for turn-by-turn guidance. Google Maps' URL works everywhere (app or web);
 * Apple Maps is offered on Apple devices. Without an origin, the app starts from the device's own location.
 */
export function mapsLinks(to: LatLng, from: LatLng | null, mode: DirectionsMode) {
  const travel = { walk: "walking", bike: "bicycling", car: "driving" }[mode];
  const g = new URL("https://www.google.com/maps/dir/");
  g.searchParams.set("api", "1");
  if (from) g.searchParams.set("origin", `${from.lat},${from.lng}`);
  g.searchParams.set("destination", `${to.lat},${to.lng}`);
  g.searchParams.set("travelmode", travel);
  const a = new URL("https://maps.apple.com/");
  if (from) a.searchParams.set("saddr", `${from.lat},${from.lng}`);
  a.searchParams.set("daddr", `${to.lat},${to.lng}`);
  // Apple Maps URLs have no cycling flag; walking is the closer guess.
  a.searchParams.set("dirflg", mode === "car" ? "d" : "w");
  return { google: g.toString(), apple: a.toString() };
}

const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const MODE_ICON: Record<DirectionsMode, React.ElementType> = { walk: Footprints, bike: Bike, car: Car };

/** The directions part of the selected-stop card: mode switch, time and distance, hand-off buttons. */
export function DirectionsPanel({
  name,
  to,
  geo,
  mode,
  onMode,
  route,
  onRetry,
  onClose,
}: {
  name: string;
  to: LatLng;
  geo: GeoState;
  mode: DirectionsMode;
  onMode: (m: DirectionsMode) => void;
  route: ReturnType<typeof useDirections>;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const t = m.trips.map.directions;
  const me = useMe().data;
  const from = geo.status === "ok" ? geo.at : null;
  const links = mapsLinks(to, from, mode);
  const busy = geo.status === "locating" || (route.isFetching && !route.data);
  const err = route.error instanceof ApiError ? route.error.message : route.error ? m.common.errors.generic : null;

  return (
    <section aria-label={t.title(name)} className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label={t.modes} className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-sand-2 p-1">
          {(["walk", "bike", "car"] as const).map((md) => {
            const Icon = MODE_ICON[md];
            const on = md === mode;
            return (
              <button
                key={md}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onMode(md)}
                className={cx("flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-semibold transition-colors", on ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink")}
              >
                <Icon className="size-4" aria-hidden /> {t.mode[md]}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} aria-label={t.close} className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-sand-2 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 min-h-[44px]" aria-live="polite">
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {geo.status === "locating" ? t.locating : t.routing}
          </p>
        ) : geo.status === "error" ? (
          <p className="text-sm text-ink-2">{t.errors[geo.error]}</p>
        ) : !me && from ? (
          <p className="text-sm text-ink-2">{t.errors.login}</p>
        ) : err ? (
          <p className="text-sm text-ink-2">{err}</p>
        ) : route.data ? (
          <div>
            <div className="font-mono text-lg font-semibold text-ink">{t.summary(formatMinutes(Math.max(1, Math.round(route.data.durationS / 60)), m), formatKm(route.data.distanceM / 1000, locale))}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <LocateFixed className="size-3.5" aria-hidden /> {t.fromYou}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a href={links.google} target="_blank" rel="noreferrer" className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-600">
          {from ? t.start : t.openMaps}
        </a>
        {isApple() && (
          <a href={links.apple} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sand-2">
            {t.apple}
          </a>
        )}
        {(geo.status === "error" || err) && (
          <button type="button" onClick={onRetry} className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-sand-2">
            {t.retry}
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        {t.privacy}
        {route.data && <span className="block">{route.data.attribution}</span>}
      </p>
    </section>
  );
}
