import { Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { km, nextQuerySchema, openStateAt, slotForTime, SLOT_RANK, type ItemSlot, type NextCandidate, type NextQuery, type NextSuggestions } from "@triply/shared";
import { ViewerId } from "../../common/auth";
import { fromDate } from "../../common/dates";
import { ZodPipe } from "../../common/http";
import { listablePlace, placeInclude, toPlaceView, type PlaceRow } from "../../common/presenters";
import { PrismaService } from "../../prisma/prisma.service";
import { ProductEventsService } from "../activity/product-events";
import { TripAccessService } from "../trips/trip-access.service";
import { TripsModule } from "../trips/trips.controller";

const Uuid = new ParseUUIDPipe();
/** Walking: straight line × 1.3 at 4.8 km/h. */
const walkMinutes = (m: number) => Math.round((m * 1.3) / 80);
/** "Nearby" is a short walk. */
const NEARBY_METRES = 1200;
const LIMITS = { plan: 8, pool: 6, nearby: 5 };

/**
 * "Where to now?" (roadmap phase 2): what's left of today's plan and the ideas, ranked by what's open and
 * how close it is, plus a few well-rated places around the traveller that aren't in the trip. The clock is
 * the traveller's (their device sends its local date and time) — opening hours are local to the place, and
 * the traveller is there. Read-only; the location is used for this answer and never stored.
 */
@Injectable()
export class NextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly events: ProductEventsService,
  ) {}

  async next(tripId: string, viewerId: string | null, q: NextQuery): Promise<NextSuggestions> {
    const trip = await this.access.require("itinerary.view", tripId, viewerId);
    this.events.openedOnTrip(viewerId, trip);
    const here = q.near ? { lat: q.near[0], lng: q.near[1] } : null;
    const slot = slotForTime(q.time);

    const [days, items] = await Promise.all([
      this.prisma.tripDay.findMany({ where: { tripId }, select: { id: true, date: true } }),
      this.prisma.itineraryItem.findMany({
        where: { tripId, placeId: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { place: { include: placeInclude(viewerId) } },
      }),
    ]);
    const today = days.find((d) => d.date && fromDate(d.date) === q.date) ?? null;

    const candidate = (place: PlaceRow, item: (typeof items)[number] | null): NextCandidate => {
      const distanceM = here ? Math.round(km(here, place) * 1000) : null;
      return {
        item: item && { id: item.id, title: item.title, dayId: item.dayId, slot: item.slot, startTime: item.startTime },
        place: toPlaceView(place),
        distanceM,
        walkMin: distanceM === null ? null : walkMinutes(distanceM),
        open: openStateAt(place.openingHours, q.date, q.time),
      };
    };
    // Open (or unknown) before closed; then nearest when we know where they are, else the plan's order —
    // with the part of the day it is now (and "any time") ahead of later parts.
    const rank = (list: NextCandidate[], useSlot: boolean) => {
      const later = (s: ItemSlot) => (s === "ANY" || s === slot ? 0 : SLOT_RANK[s] > SLOT_RANK[slot] ? 1 : 0);
      return list
        .map((c, i) => ({ c, i }))
        .sort(
          (a, b) =>
            Number(a.c.open.state === "closed") - Number(b.c.open.state === "closed") ||
            (useSlot ? later(a.c.item!.slot) - later(b.c.item!.slot) : 0) ||
            (here ? a.c.distanceM! - b.c.distanceM! : a.i - b.i),
        )
        .map((x) => x.c);
    };

    const open = items.filter((i) => i.status === "PLANNED" && i.place);
    const plan = today ? rank(open.filter((i) => i.dayId === today.id).map((i) => candidate(i.place!, i)), true) : [];
    const pool = rank(open.filter((i) => !i.dayId).map((i) => candidate(i.place!, i)), false);

    let nearby: NextCandidate[] = [];
    if (here) {
      const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${here.lng}, ${here.lat}), 4326)::geography`;
      const inTrip = [...new Set(items.map((i) => i.placeId!))];
      // A KNN walk of the GIST index, cut at a short walk; rated places only (the catalog has plenty of noise).
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id::text AS id FROM places p
        WHERE p.status = 'ACTIVE' AND p.merged_into_id IS NULL AND p.rating >= 4.0
          AND ST_DWithin(p.location, ${point}, ${NEARBY_METRES})
          ${inTrip.length ? Prisma.sql`AND p.id <> ALL(${inTrip}::uuid[])` : Prisma.empty}
        ORDER BY p.location <-> ${point} LIMIT 30`;
      const places = await this.prisma.place.findMany({ where: { id: { in: rows.map((r) => r.id) }, ...listablePlace }, include: placeInclude(viewerId) });
      nearby = places
        .map((p) => candidate(p, null))
        .filter((c) => c.open.state !== "closed")
        // Rating and closeness, blended; known-open ahead of unknown hours.
        .sort((a, b) => score(b) - score(a))
        .slice(0, LIMITS.nearby);
    }
    return {
      date: q.date,
      slot,
      dayId: today?.id ?? null,
      located: !!here,
      plan: plan.slice(0, LIMITS.plan),
      pool: pool.slice(0, LIMITS.pool),
      nearby,
    };
  }
}

function score(c: NextCandidate) {
  const rating = (c.place.rating ?? 3.8) / 5;
  const near = 1 - Math.min((c.distanceM ?? NEARBY_METRES) / NEARBY_METRES, 1);
  return rating * 0.55 + near * 0.35 + (c.open.state === "open" ? 0.1 : 0);
}

@Controller()
export class NextController {
  constructor(private readonly svc: NextService) {}

  /** `?date=YYYY-MM-DD&time=HH:mm[&near=lat,lng]` — the traveller's clock and (optionally) position. */
  @Get("trips/:id/next")
  next(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Query(new ZodPipe(nextQuerySchema)) q: NextQuery) {
    return this.svc.next(id, me, q);
  }
}

@Module({ imports: [TripsModule], controllers: [NextController], providers: [NextService] })
export class NextModule {}
