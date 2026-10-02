import { Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  normalizeSearch,
  searchQuerySchema,
  type DestinationPage,
  type DestinationView,
  type PlaceView,
  type SearchResults,
  type TripSummary,
} from "@triply/shared";
import { z } from "zod";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { Errors, ZodPipe } from "../../common/http";
import { listablePlace, placeInclude, postInclude, toPlaceView, toPostView, toTripSummary, tripSummaryInclude, userSummarySelect, toUserSummary } from "../../common/presenters";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { TrigramRanker, byRank } from "./ranker";

/** Only PUBLIC, non-deleted trips are ever discoverable (LINK_ONLY is unlisted — spec §34). */
export const DISCOVERABLE: Prisma.TripWhereInput = { visibility: "PUBLIC", deletedAt: null };

/**
 * SearchService abstraction (spec §33). The Postgres implementation ranks with pg_trgm over
 * accent-free `search_text` columns (typo-tolerant, "hoi an" finds "Hội An"); swap in
 * Elasticsearch/OpenSearch/Algolia by implementing the same interface.
 */
export interface SearchProvider {
  search(q: string, type: "all" | "trips" | "places" | "people" | "destinations", limit: number, viewerId: string | null): Promise<SearchResults>;
}

@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  private readonly rank: TrigramRanker;
  constructor(private readonly prisma: PrismaService) {
    this.rank = new TrigramRanker(prisma);
  }

  async search(q: string, type: "all" | "trips" | "places" | "people" | "destinations", limit: number, viewerId: string | null): Promise<SearchResults> {
    const s = normalizeSearch(q);
    const want = (t: string) => type === "all" || type === t;
    const [tripIds, placeIds, peopleIds] = await Promise.all([
      want("trips") && s ? this.rank.trips(s, limit) : null,
      want("places") && s ? this.rank.places(s, limit) : null,
      want("people") && s ? this.rank.people(s, limit) : null,
    ]);
    const [trips, places, people, destinations] = await Promise.all([
      want("trips")
        ? this.prisma.trip.findMany({
            where: { ...DISCOVERABLE, ...(tripIds ? { id: { in: tripIds } } : {}) },
            orderBy: [{ saveCount: "desc" }, { updatedAt: "desc" }],
            take: limit,
            include: tripSummaryInclude(viewerId),
          })
        : [],
      want("places")
        ? this.prisma.place.findMany({
            where: { ...listablePlace, ...(placeIds ? { id: { in: placeIds } } : {}) },
            orderBy: [{ rating: { sort: "desc", nulls: "last" } }, { name: "asc" }],
            take: limit,
            include: placeInclude(viewerId),
          })
        : [],
      want("people")
        ? this.prisma.user.findMany({
            where: { deletedAt: null, ...(peopleIds ? { id: { in: peopleIds } } : {}) },
            take: limit,
            orderBy: { createdAt: "asc" },
            select: { ...userSummarySelect, profile: { select: { displayName: true, avatarHue: true, homeBase: true, avatar: { select: { storageKey: true, thumbKey: true } } } } },
          })
        : [],
      want("destinations") ? this.destinations(q, limit) : [],
    ]);
    return {
      trips: byRank(trips, tripIds).map((t) => toTripSummary(t, viewerId)),
      places: byRank(places, placeIds).map(toPlaceView),
      people: byRank(people, peopleIds).map((u) => ({ ...toUserSummary(u), homeBase: u.profile?.homeBase ?? null })),
      destinations,
    };
  }

  async destinations(q: string, limit: number): Promise<DestinationView[]> {
    const s = normalizeSearch(q);
    const ids = s ? await this.rank.destinations(s, limit) : null;
    const rows = await this.prisma.destination.findMany({
      where: ids ? { id: { in: ids } } : {},
      include: { _count: { select: { trips: { where: { trip: DISCOVERABLE } } } } },
    });
    const views = rows.map((d) => ({ id: d.id, slug: d.slug, name: d.name, country: d.country, lat: d.lat, lng: d.lng, blurb: d.blurb, palette: [d.paletteA, d.paletteB] as [string, string], tripCount: d._count.trips }));
    return (ids ? byRank(views, ids) : views.sort((a, b) => b.tripCount - a.tripCount || a.name.localeCompare(b.name))).slice(0, limit);
  }
}

@Injectable()
export class ExploreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: PostgresSearchProvider,
  ) {}

  async explore(viewerId: string | null) {
    const [destinations, trips, places] = await Promise.all([
      this.search.destinations("", 12),
      this.prisma.trip.findMany({ where: DISCOVERABLE, orderBy: [{ saveCount: "desc" }], take: 12, include: tripSummaryInclude(viewerId) }),
      this.prisma.place.findMany({ where: listablePlace, orderBy: [{ rating: { sort: "desc", nulls: "last" } }], take: 9, include: placeInclude(viewerId) }),
    ]);
    return { destinations, trips: trips.map((t) => toTripSummary(t, viewerId)), places: places.map(toPlaceView) };
  }

  async destination(slug: string, viewerId: string | null): Promise<DestinationPage> {
    const d = await this.prisma.destination.findUnique({ where: { slug } });
    if (!d) throw Errors.notFound("That destination");
    const tripWhere = { ...DISCOVERABLE, destinations: { some: { destinationId: d.id } } };
    const [popular, remixable, places, posts] = await Promise.all([
      this.prisma.trip.findMany({ where: tripWhere, orderBy: { saveCount: "desc" }, take: 9, include: tripSummaryInclude(viewerId) }),
      this.prisma.trip.findMany({ where: { ...tripWhere, allowFork: true }, orderBy: { forkCount: "desc" }, take: 6, include: tripSummaryInclude(viewerId) }),
      this.prisma.place.findMany({ where: { destinationId: d.id, ...listablePlace }, orderBy: [{ rating: { sort: "desc", nulls: "last" } }], take: 12, include: placeInclude(viewerId) }),
      this.prisma.post.findMany({
        where: { deletedAt: null, visibility: "PUBLIC", OR: [{ destinationId: d.id }, { trip: tripWhere }] },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: postInclude(viewerId),
      }),
    ]);
    return {
      destination: { id: d.id, slug: d.slug, name: d.name, country: d.country, lat: d.lat, lng: d.lng, blurb: d.blurb, palette: [d.paletteA, d.paletteB] },
      popularTrips: popular.map((t) => toTripSummary(t, viewerId)),
      remixable: remixable.map((t) => toTripSummary(t, viewerId)),
      places: places.map(toPlaceView),
      posts: posts.map((p) => toPostView(p, viewerId)),
    };
  }

  /** Place search for the itinerary editor — boosts places in the trip's destinations. */
  async places(q: string, viewerId: string | null, opts: { destinationIds?: string[]; limit: number }): Promise<PlaceView[]> {
    const s = normalizeSearch(q);
    const ids = s ? await new TrigramRanker(this.prisma).places(s, 50) : null;
    const rows = await this.prisma.place.findMany({
      where: { ...listablePlace, ...(ids ? { id: { in: ids } } : opts.destinationIds?.length ? { destinationId: { in: opts.destinationIds } } : {}) },
      take: 50,
      orderBy: [{ rating: { sort: "desc", nulls: "last" } }],
      include: placeInclude(viewerId),
    });
    const boost = new Set(opts.destinationIds ?? []);
    const ranked = ids ? byRank(rows, ids) : rows;
    // Stable sort: places in the trip's own destinations first, then by relevance/rating.
    return ranked
      .map((p, i) => ({ p, i }))
      .sort((a, b) => Number(!!b.p.destinationId && boost.has(b.p.destinationId)) - Number(!!a.p.destinationId && boost.has(a.p.destinationId)) || a.i - b.i)
      .slice(0, opts.limit)
      .map(({ p }) => toPlaceView(p));
  }

  async place(id: string, viewerId: string | null, depth = 0): Promise<PlaceView> {
    const p = await this.prisma.place.findUnique({ where: { id }, include: placeInclude(viewerId) });
    if (!p || p.status === "HIDDEN") throw Errors.notFound("That place");
    // A place merged into another one answers with the surviving record (old links keep working).
    if (p.mergedIntoId && depth < 5) return this.place(p.mergedIntoId, viewerId, depth + 1);
    return toPlaceView(p);
  }

  async setPlaceSaved(id: string, viewerId: string, on: boolean) {
    await this.place(id, viewerId);
    if (on) await this.prisma.savedPlace.upsert({ where: { userId_placeId: { userId: viewerId, placeId: id } }, create: { userId: viewerId, placeId: id }, update: {} });
    else await this.prisma.savedPlace.deleteMany({ where: { userId: viewerId, placeId: id } });
    return this.place(id, viewerId);
  }

  async savedPlaces(viewerId: string) {
    const rows = await this.prisma.place.findMany({ where: { savedBy: { some: { userId: viewerId } } }, include: placeInclude(viewerId) });
    return rows.map(toPlaceView);
  }
}

const placeQuery = z.object({
  q: z.string().trim().max(100).default(""),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(8),
});

@Controller()
export class SearchController {
  constructor(
    private readonly search: PostgresSearchProvider,
    private readonly explore: ExploreService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get("search")
  run(@Query(new ZodPipe(searchQuerySchema)) q: z.infer<typeof searchQuerySchema>, @ViewerId() me: string | null) {
    return this.search.search(q.q, q.type, q.limit, me);
  }

  @Public()
  @Get("explore")
  home(@ViewerId() me: string | null) {
    return this.explore.explore(me);
  }

  @Public()
  @Get("destinations")
  destinations() {
    return this.search.destinations("", 100);
  }

  @Public()
  @Get("destinations/:slug")
  destination(@Param("slug") slug: string, @ViewerId() me: string | null) {
    return this.explore.destination(slug, me);
  }

  @Public()
  @Get("places/search")
  async places(@Query(new ZodPipe(placeQuery)) q: z.infer<typeof placeQuery>, @ViewerId() me: string | null) {
    // Trip destinations are only used for ranking, and only if the viewer may see the trip.
    let destinationIds: string[] | undefined;
    if (q.tripId) {
      const trip = await this.prisma.trip.findFirst({
        where: { id: q.tripId, deletedAt: null, OR: [{ visibility: { not: "PRIVATE" } }, ...(me ? [{ members: { some: { userId: me } } }] : [])] },
        select: { destinations: { select: { destinationId: true } } },
      });
      destinationIds = trip?.destinations.map((d) => d.destinationId);
    }
    return this.explore.places(q.q, me, { destinationIds, limit: q.limit });
  }

  @Get("places/saved")
  saved(@ViewerId() me: string | null) {
    return this.explore.savedPlaces(requireUser(me));
  }

  @Public()
  @Get("places/:id")
  place(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.explore.place(id, me);
  }

  @Post("places/:id/save")
  save(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.explore.setPlaceSaved(id, requireUser(me), true);
  }

  @Delete("places/:id/save")
  unsave(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.explore.setPlaceSaved(id, requireUser(me), false);
  }
}

@Module({ controllers: [SearchController], providers: [PostgresSearchProvider, ExploreService], exports: [ExploreService] })
export class SearchModule {}

// Re-export for tests that want typed results.
export type { TripSummary };
