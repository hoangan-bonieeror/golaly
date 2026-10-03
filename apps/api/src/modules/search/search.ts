import { Controller, Get, Injectable, Module, Param, Query } from "@nestjs/common";
import {
  normalizeSearch,
  searchQuerySchema,
  type DestinationPage,
  type DestinationView,
  type SearchResults,
  type TripSummary,
} from "@triply/shared";
import { z } from "zod";
import { Public, ViewerId } from "../../common/auth";
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
    // The rankers take the query as typed: accents decide whether "phở" may match "phố".
    const s = normalizeSearch(q);
    const want = (t: string) => type === "all" || type === t;
    const [tripIds, placeIds, peopleIds] = await Promise.all([
      want("trips") && s ? this.rank.trips(q, limit) : null,
      want("places") && s ? this.rank.places(q, limit) : null,
      want("people") && s ? this.rank.people(q, limit) : null,
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
    const ids = normalizeSearch(q) ? await this.rank.destinations(q, limit) : null;
    const rows = await this.prisma.destination.findMany({
      where: ids ? { id: { in: ids } } : {},
      include: { _count: { select: { trips: { where: { trip: DISCOVERABLE } } } } },
    });
    const views: DestinationView[] = rows.map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.name,
      country: d.country,
      lat: d.lat,
      lng: d.lng,
      blurb: d.blurb,
      palette: [d.paletteA, d.paletteB],
      tripCount: d._count.trips,
      kind: d.autoCreated ? "area" : "curated",
    }));
    // Without a query: most travelled first, and hand-picked destinations before the province/city ones.
    const browseOrder = (a: DestinationView, b: DestinationView) => b.tripCount - a.tripCount || Number(a.kind === "area") - Number(b.kind === "area") || a.name.localeCompare(b.name);
    return (ids ? byRank(views, ids) : views.sort(browseOrder)).slice(0, limit);
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

  /** A curated destination's own places, or every place inside the province/city an auto-created one stands for. */
  private async destinationPlaces(d: { id: string; autoCreated: boolean; representsAreaId: string | null }): Promise<Prisma.PlaceWhereInput> {
    if (!d.autoCreated || !d.representsAreaId) return { destinationId: d.id };
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE t AS (SELECT id FROM geo_areas WHERE id = ${d.representsAreaId}::uuid
                           UNION ALL SELECT g.id FROM geo_areas g JOIN t ON g.parent_id = t.id)
      SELECT id::text AS id FROM t`;
    return { areaId: { in: ids.map((r) => r.id) } };
  }

  async destination(slug: string, viewerId: string | null): Promise<DestinationPage> {
    const d = await this.prisma.destination.findUnique({ where: { slug } });
    if (!d) throw Errors.notFound("That destination");
    const tripWhere = { ...DISCOVERABLE, destinations: { some: { destinationId: d.id } } };
    const [popular, remixable, places, posts] = await Promise.all([
      this.prisma.trip.findMany({ where: tripWhere, orderBy: { saveCount: "desc" }, take: 9, include: tripSummaryInclude(viewerId) }),
      this.prisma.trip.findMany({ where: { ...tripWhere, allowFork: true }, orderBy: { forkCount: "desc" }, take: 6, include: tripSummaryInclude(viewerId) }),
      this.prisma.place.findMany({ where: { ...(await this.destinationPlaces(d)), ...listablePlace }, orderBy: [{ rating: { sort: "desc", nulls: "last" } }], take: 12, include: placeInclude(viewerId) }),
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
}

@Controller()
export class SearchController {
  constructor(
    private readonly search: PostgresSearchProvider,
    private readonly explore: ExploreService,
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
}

@Module({ controllers: [SearchController], providers: [PostgresSearchProvider, ExploreService], exports: [ExploreService] })
export class SearchModule {}

// Re-export for tests that want typed results.
export type { TripSummary };
