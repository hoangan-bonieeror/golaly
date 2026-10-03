import { Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  normalizeSearch,
  placeBrowseQuerySchema,
  type CategoryView,
  type PlaceBrowse,
  type PlaceBrowseQuery,
  type PlaceDetail,
  type PlaceView,
  type TripTarget,
} from "@triply/shared";
import { z } from "zod";
import { Public, ViewerId, requireUser } from "../../common/auth";
import { fromDate } from "../../common/dates";
import { Errors, ZodPipe } from "../../common/http";
import { listablePlace, photoOrder, placeInclude, placePhotoInclude, toPlacePhotoView, toPlaceView, toTripSummary, tripSummaryInclude } from "../../common/presenters";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { MediaModule } from "../media/media";
import { DISCOVERABLE } from "../search/search";
import { PhotoIngestService, PlacePhotosController, PlacePhotosService } from "./photos";
import { TrigramRanker, byRank, textMatch } from "../search/ranker";

/** Default search radius (km) around a destination / around the device. */
const RADIUS = { destination: 10, near: 5 } as const;
const NEARBY_METRES = 1500;
const TRIP_NEARBY_KM = 50;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

@Injectable()
export class PlacesService {
  private categoryCache: { at: number; tree: CategoryView[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The two-level taxonomy (groups → categories). Changes only when the catalog pipeline runs, so it's cached briefly. */
  async categories(): Promise<CategoryView[]> {
    if (this.categoryCache && Date.now() - this.categoryCache.at < 5 * 60_000) return this.categoryCache.tree;
    const rows = await this.prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
    const view = (c: (typeof rows)[number]): CategoryView => ({ key: c.key, label: c.labelEn, labelVi: c.labelVi, itemType: c.itemType });
    const tree = rows.filter((c) => !c.parentId).map((g) => ({ ...view(g), children: rows.filter((c) => c.parentId === g.id).map(view) }));
    this.categoryCache = { at: Date.now(), tree };
    return tree;
  }

  async browse(q: PlaceBrowseQuery, viewerId: string | null): Promise<PlaceBrowse> {
    // Where: a destination's centre, a point (the device), or everywhere.
    let center: PlaceBrowse["center"] = null;
    let radiusKm: number | null = null;
    if (q.destination) {
      const d = await this.prisma.destination.findUnique({ where: { slug: q.destination }, select: { name: true, lat: true, lng: true } });
      if (!d) throw Errors.notFound("That destination");
      center = { lat: d.lat, lng: d.lng, label: d.name };
      radiusKm = q.radius ?? RADIUS.destination;
    } else if (q.near) {
      center = { lat: q.near[0], lng: q.near[1], label: "your location" };
      radiusKm = q.radius ?? RADIUS.near;
    }
    const point = center ? Prisma.sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography` : null;

    const area: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE' AND p.merged_into_id IS NULL`];
    if (point && radiusKm) area.push(Prisma.sql`ST_DWithin(p.location, ${point}, ${radiusKm * 1000})`);
    const text = textMatch(normalizeSearch(q.q), "p.search_text");
    if (text) area.push(text);
    const filters = [...area];
    if (q.group) filters.push(Prisma.sql`(g.key = ${q.group} OR c.key = ${q.group})`);
    if (q.category) filters.push(Prisma.sql`c.key = ${q.category}`);

    const from = Prisma.sql`FROM places p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories g ON g.id = c.parent_id`;
    const where = (parts: Prisma.Sql[]) => Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
    const dist = point ? Prisma.sql`ST_Distance(p.location, ${point})` : Prisma.sql`NULL::float8`;
    const sort = q.sort === "distance" && !point ? "recommended" : q.sort;
    const order =
      sort === "distance"
        ? Prisma.sql`dist ASC, p.name ASC`
        : sort === "rating"
          ? Prisma.sql`p.rating DESC NULLS LAST, p.quality_score DESC, dist ASC NULLS LAST, p.name ASC`
          : point && radiusKm
            ? // Recommended around a point: rating (unrated ≈ average), data quality and closeness, blended.
              Prisma.sql`(coalesce(p.rating, 3.8) / 5.0 * 0.6 + p.quality_score * 0.15 + (1 - least(${dist} / ${radiusKm * 1000}, 1)) * 0.25) DESC, p.name ASC`
            : Prisma.sql`p.rating DESC NULLS LAST, p.quality_score DESC, p.name ASC`;
    const offset = q.cursor ? Number(q.cursor) : 0;

    const [rows, facets, totals] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; dist: number | null }[]>`
        SELECT p.id::text AS id, ${dist} AS dist ${from} ${where(filters)}
        ORDER BY ${order} LIMIT ${q.limit + 1} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ key: string; count: bigint }[]>`
        SELECT coalesce(g.key, c.key) AS key, count(*) AS count ${from} ${where(area)} AND c.id IS NOT NULL
        GROUP BY 1`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n ${from} ${where(filters)}`,
    ]);
    const page = rows.slice(0, q.limit);
    const views = await this.prisma.place.findMany({ where: { id: { in: page.map((r) => r.id) } }, include: placeInclude(viewerId) });
    const dists = new Map(page.map((r) => [r.id, r.dist]));
    return {
      items: byRank(views, page.map((r) => r.id)).map((p) => {
        const v = toPlaceView(p);
        const d = dists.get(p.id);
        return d == null ? v : { ...v, distanceM: Math.round(d) };
      }),
      nextCursor: rows.length > q.limit ? String(offset + q.limit) : null,
      center,
      radiusKm,
      facets: facets.map((f) => ({ key: f.key, count: Number(f.count) })),
      total: Number(totals[0]?.n ?? 0),
    };
  }

  /** Place search for the itinerary editor — boosts places in the trip's destinations. */
  async search(q: string, viewerId: string | null, opts: { destinationIds?: string[]; limit: number }): Promise<PlaceView[]> {
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

  /** The surviving, visible record for an id (merged ids redirect; hidden ones are 404). */
  private async resolveId(id: string): Promise<string> {
    let current = id;
    for (let depth = 0; depth < 5; depth++) {
      const p = await this.prisma.place.findUnique({ where: { id: current }, select: { status: true, mergedIntoId: true } });
      if (!p || p.status === "HIDDEN") throw Errors.notFound("That place");
      if (!p.mergedIntoId) return current;
      current = p.mergedIntoId;
    }
    throw Errors.notFound("That place");
  }

  async place(id: string, viewerId: string | null): Promise<PlaceView> {
    const p = await this.prisma.place.findUniqueOrThrow({ where: { id: await this.resolveId(id) }, include: placeInclude(viewerId) });
    return toPlaceView(p);
  }

  async detail(id: string, viewerId: string | null): Promise<PlaceDetail> {
    const placeId = await this.resolveId(id);
    const p = await this.prisma.place.findUniqueOrThrow({
      where: { id: placeId },
      include: {
        ...placeInclude(viewerId),
        destination: { select: { name: true, slug: true } },
        categoryRef: { select: { key: true, labelEn: true, parent: { select: { key: true, labelEn: true } } } },
        names: { where: { kind: "primary" }, select: { lang: true, name: true }, orderBy: { lang: "asc" } },
        sources: { where: { provider: { not: "manual" } }, select: { attribution: true }, distinct: ["attribution"] },
      },
    });
    const tripWhere = { ...DISCOVERABLE, days: { some: { items: { some: { placeId } } } } };
    const [nearIds, trips, tripCount, photos] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; dist: number }[]>`
        SELECT o.id::text AS id, ST_Distance(o.location, p.location) AS dist
        FROM places p JOIN places o ON o.id <> p.id AND o.status = 'ACTIVE' AND o.merged_into_id IS NULL
          AND ST_DWithin(o.location, p.location, ${NEARBY_METRES})
        WHERE p.id = ${placeId}::uuid
        ORDER BY dist ASC LIMIT 6`,
      this.prisma.trip.findMany({ where: tripWhere, orderBy: [{ saveCount: "desc" }, { updatedAt: "desc" }], take: 3, include: tripSummaryInclude(viewerId) }),
      this.prisma.trip.count({ where: tripWhere }),
      // Approved photos, plus the viewer's own while they wait for review.
      this.prisma.placePhoto.findMany({
        where: { placeId, mediaId: { not: null }, OR: [{ status: "APPROVED" }, ...(viewerId ? [{ uploadedById: viewerId, status: "PENDING" as const }] : [])] },
        orderBy: photoOrder,
        take: 12,
        include: placePhotoInclude,
      }),
    ]);
    const nearRows = await this.prisma.place.findMany({ where: { id: { in: nearIds.map((n) => n.id) } }, include: placeInclude(viewerId) });
    const nearDist = new Map(nearIds.map((n) => [n.id, n.dist]));
    const base = toPlaceView(p);
    return {
      ...base,
      phone: p.phone,
      website: p.website,
      openingHours: p.openingHours,
      groupKey: p.categoryRef?.parent?.key ?? p.categoryRef?.key ?? null,
      groupLabel: p.categoryRef?.parent?.labelEn ?? null,
      destinationSlug: p.destination?.slug ?? null,
      areaName: p.area?.name ?? null,
      names: p.names.filter((n) => n.name !== p.name),
      attribution: p.sources.map((s) => s.attribution).filter(Boolean),
      photos: photos.map((ph) => toPlacePhotoView(ph as typeof ph & { media: NonNullable<typeof ph.media> }, viewerId)),
      nearby: byRank(nearRows, nearIds.map((n) => n.id)).map((r) => ({ ...toPlaceView(r), distanceM: Math.round(nearDist.get(r.id) ?? 0) })),
      inTrips: trips.map((t) => toTripSummary(t, viewerId)),
      tripCount,
    };
  }

  /** Trips the viewer can add this place to (Owner/Editor), nearby and upcoming ones first. */
  async tripTargets(id: string, viewerId: string): Promise<TripTarget[]> {
    const placeId = await this.resolveId(id);
    const place = await this.prisma.place.findUniqueOrThrow({ where: { id: placeId }, select: { lat: true, lng: true } });
    const trips = await this.prisma.trip.findMany({
      where: { deletedAt: null, members: { some: { userId: viewerId, role: { in: ["OWNER", "EDITOR"] } } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        coverA: true,
        coverB: true,
        members: { where: { userId: viewerId }, select: { role: true } },
        destinations: { orderBy: { position: "asc" }, select: { destination: { select: { name: true, lat: true, lng: true } } } },
        days: {
          orderBy: { dayNumber: "asc" },
          select: { id: true, dayNumber: true, date: true, title: true, _count: { select: { items: true } }, items: { where: { placeId }, select: { id: true }, take: 1 } },
        },
      },
    });
    const today = new Date().toISOString().slice(0, 10);
    const views: TripTarget[] = trips.map((t) => ({
      id: t.id,
      title: t.title,
      startDate: fromDate(t.startDate),
      endDate: fromDate(t.endDate),
      role: t.members[0]?.role === "OWNER" ? "OWNER" : "EDITOR",
      destinations: t.destinations.map((d) => d.destination.name),
      cover: [t.coverA, t.coverB],
      days: t.days.map((d) => ({ id: d.id, dayNumber: d.dayNumber, date: fromDate(d.date), title: d.title, itemCount: d._count.items, hasPlace: d.items.length > 0 })),
      nearby: t.destinations.some((d) => distanceKm(d.destination, place) <= TRIP_NEARBY_KM),
    }));
    const rank = (t: TripTarget) => (t.nearby ? 0 : 2) + (t.endDate && t.endDate < today ? 1 : 0);
    return views.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map(({ t }) => t);
  }

  async setSaved(id: string, viewerId: string, on: boolean) {
    const placeId = await this.resolveId(id);
    if (on) await this.prisma.savedPlace.upsert({ where: { userId_placeId: { userId: viewerId, placeId } }, create: { userId: viewerId, placeId }, update: {} });
    else await this.prisma.savedPlace.deleteMany({ where: { userId: viewerId, placeId } });
    return this.place(placeId, viewerId);
  }

  async saved(viewerId: string) {
    const rows = await this.prisma.place.findMany({ where: { savedBy: { some: { userId: viewerId } } }, include: placeInclude(viewerId) });
    return rows.map(toPlaceView);
  }
}

const placeSearchQuery = z.object({
  q: z.string().trim().max(100).default(""),
  tripId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(8),
});

/** Every /places route lives here, static paths before `:id`, so the order is explicit. */
@Controller("places")
export class PlacesController {
  constructor(
    private readonly places: PlacesService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get("categories")
  categories() {
    return this.places.categories();
  }

  @Public()
  @Get("browse")
  browse(@Query(new ZodPipe(placeBrowseQuerySchema)) q: PlaceBrowseQuery, @ViewerId() me: string | null) {
    return this.places.browse(q, me);
  }

  @Public()
  @Get("search")
  async search(@Query(new ZodPipe(placeSearchQuery)) q: z.infer<typeof placeSearchQuery>, @ViewerId() me: string | null) {
    // Trip destinations are only used for ranking, and only if the viewer may see the trip.
    let destinationIds: string[] | undefined;
    if (q.tripId) {
      const trip = await this.prisma.trip.findFirst({
        where: { id: q.tripId, deletedAt: null, OR: [{ visibility: { not: "PRIVATE" } }, ...(me ? [{ members: { some: { userId: me } } }] : [])] },
        select: { destinations: { select: { destinationId: true } } },
      });
      destinationIds = trip?.destinations.map((d) => d.destinationId);
    }
    return this.places.search(q.q, me, { destinationIds, limit: q.limit });
  }

  @Get("saved")
  saved(@ViewerId() me: string | null) {
    return this.places.saved(requireUser(me));
  }

  @Public()
  @Get(":id")
  detail(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.places.detail(id, me);
  }

  @Get(":id/trip-targets")
  tripTargets(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.places.tripTargets(id, requireUser(me));
  }

  @Post(":id/save")
  save(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.places.setSaved(id, requireUser(me), true);
  }

  @Delete(":id/save")
  unsave(@Param("id", ParseUUIDPipe) id: string, @ViewerId() me: string | null) {
    return this.places.setSaved(id, requireUser(me), false);
  }
}

@Module({ imports: [MediaModule], controllers: [PlacesController, PlacePhotosController], providers: [PlacesService, PlacePhotosService, PhotoIngestService] })
export class PlacesModule {}
