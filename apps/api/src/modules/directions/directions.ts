import { Controller, Get, Injectable, Logger, Module, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { directionsQuerySchema, type DirectionsMode, type DirectionsQuery, type DirectionsView } from "@golaly/shared";
import { requireUser, ViewerId } from "../../common/auth";
import { AppError, ZodPipe } from "../../common/http";
import { env } from "../../config/env";

const PROFILE: Record<DirectionsMode, string> = { walk: "foot-walking", bike: "cycling-regular", car: "driving-car" };
const ATTRIBUTION = "© openrouteservice.org by HeiGIT · © OpenStreetMap contributors";
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;

/**
 * Directions from the viewer's position to a stop, through OpenRouteService (OpenStreetMap data, free key with a
 * daily quota). The API holds the key, so it never reaches the browser; answers are cached briefly by rounded
 * coordinates (~10 m), which also keeps a planner re-opening the same route from spending quota.
 * Only signed-in users can ask, with a per-user limit, for the same reason.
 */
@Injectable()
export class DirectionsService {
  private readonly log = new Logger("Directions");
  private readonly cache = new Map<string, { at: number; view: DirectionsView }>();
  /** Replaced in tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  async route(q: DirectionsQuery): Promise<DirectionsView> {
    if (!env.ORS_API_KEY) throw new AppError(503, "Directions aren't set up on this server.");
    const r = (n: number) => n.toFixed(4);
    const key = `${q.mode}:${r(q.from[0])},${r(q.from[1])}:${r(q.to[0])},${r(q.to[1])}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.view;

    let res: Response;
    try {
      res = await this.fetchImpl(`${env.ORS_API_URL.replace(/\/$/, "")}/v2/directions/${PROFILE[q.mode]}/geojson`, {
        method: "POST",
        headers: { Authorization: env.ORS_API_KEY, "Content-Type": "application/json", Accept: "application/geo+json, application/json" },
        // ORS takes [lng, lat].
        body: JSON.stringify({ coordinates: [[q.from[1], q.from[0]], [q.to[1], q.to[0]]], instructions: false, units: "m" }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(502, "Couldn't reach the directions service. Try again.");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
      const code = body.error?.code;
      // 2004: route longer than the profile allows; 2009/2010: no route / point not near a road.
      if (code === 2004) throw new AppError(422, "That's too far for this way of travelling. Try another mode.");
      if (code === 2009 || code === 2010 || res.status === 404) throw new AppError(422, "No route found between these points. You may be too far from a road or path.");
      if (res.status === 429) throw new AppError(503, "The directions service is busy. Try again in a minute.");
      this.log.warn(`OpenRouteService HTTP ${res.status}${code ? ` (code ${code})` : ""}`);
      throw new AppError(502, "Couldn't reach the directions service. Try again.");
    }
    const data = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number][] }; properties?: { summary?: { distance?: number; duration?: number } } }[] };
    const f = data.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (!f || !coords?.length) throw new AppError(422, "No route found between these points. You may be too far from a road or path.");
    const view: DirectionsView = {
      mode: q.mode,
      distanceM: Math.round(f.properties?.summary?.distance ?? 0),
      durationS: Math.round(f.properties?.summary?.duration ?? 0),
      // ~1 m precision is plenty for drawing and keeps the answer small.
      geometry: coords.map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]),
      attribution: ATTRIBUTION,
    };
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), view });
    return view;
  }
}

@Controller("directions")
export class DirectionsController {
  constructor(private readonly svc: DirectionsService) {}

  /** GET /directions?from=lat,lng&to=lat,lng&mode=walk|bike|car */
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  route(@ViewerId() me: string | null, @Query(new ZodPipe(directionsQuerySchema)) q: DirectionsQuery) {
    requireUser(me);
    return this.svc.route(q);
  }
}

@Module({ providers: [DirectionsService], controllers: [DirectionsController] })
export class DirectionsModule {}
