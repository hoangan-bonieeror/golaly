import { requestLocale } from "../../common/locale";
import { Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  normalizeSearch,
  placeBrowseQuerySchema,
  splitAreaName,
  type CategoryView,
  type GeoAreaOption,
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
import { PLACE_COLUMNS, TrigramRanker, byRank, placeCandidates, relevance } from "../search/ranker";

/** Default search radius (km) around a destination / around the device. */
const RADIUS = { destination: 10, near: 5 } as const;
const NEARBY_METRES = 1500;
/** Taxonomy, area trees and whole-area counts change only when the catalog pipeline runs. */
const CACHE_MS = 5 * 60_000;
const COUNT_CACHE_MAX = 500;

interface CategoryRef {
  id: string;
  key: string;
  /** The group it belongs to (its parent's key), or its own key for a group. */
  groupKey: string;
}

/** `p.area_id` in a set of areas; a single id stays an equality so the (area_id, …) indexes are used in order. */
export function areaIn(ids: string[]): Prisma.Sql {
  return ids.length === 1 ? Prisma.sql`p.area_id = ${ids[0]}::uuid` : Prisma.sql`p.area_id = ANY(${ids}::uuid[])`;
}
const TRIP_NEARBY_KM = 50;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

@Injectable()
export class PlacesService {
  private categoryCache: { at: number; tree: CategoryView[] } | null = null;
  private areaCache: { at: number; list: GeoAreaOption[] } | null = null;
  private categoryIndexCache: { at: number; byKey: Map<string, CategoryRef>; byId: Map<string, CategoryRef> } | null = null;
  private subtreeCache = new Map<string, { at: number; ids: string[] }>();
  /** Per-category counts of a whole area (or everywhere): no text, no radius. These change only when a sync runs. */
  private countCache = new Map<string, { at: number; counts: Map<string | null, number> }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Category ids by key and the reverse, with each category's group (parent) key. Cached like the tree. */
  private async categoryIndex() {
    if (this.categoryIndexCache && Date.now() - this.categoryIndexCache.at < CACHE_MS) return this.categoryIndexCache;
    const rows = await this.prisma.category.findMany({ select: { id: true, key: true, parent: { select: { key: true } } } });
    const refs = rows.map((r): CategoryRef => ({ id: r.id, key: r.key, groupKey: r.parent?.key ?? r.key }));
    this.categoryIndexCache = { at: Date.now(), byKey: new Map(refs.map((r) => [r.key, r])), byId: new Map(refs.map((r) => [r.id, r])) };
    return this.categoryIndexCache;
  }

  /** An area and every area below it (a country's provinces, a province's districts). */
  async subtree(areaId: string): Promise<string[]> {
    const hit = this.subtreeCache.get(areaId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE t AS (SELECT id FROM geo_areas WHERE id = ${areaId}::uuid UNION ALL SELECT g.id FROM geo_areas g JOIN t ON g.parent_id = t.id)
      SELECT id::text AS id FROM t`;
    const ids = rows.map((r) => r.id);
    this.subtreeCache.set(areaId, { at: Date.now(), ids });
    return ids;
  }

  /** The two-level taxonomy (groups → categories). Changes only when the catalog pipeline runs, so it's cached briefly. */
  async categories(): Promise<CategoryView[]> {
    // The cache holds both labels; `label` is picked per request, in the interface language.
    const vi = requestLocale() === "vi";
    const localise = (tree: CategoryView[]): CategoryView[] =>
      vi ? tree.map((g) => ({ ...g, label: g.labelVi, children: g.children?.map((c) => ({ ...c, label: c.labelVi })) })) : tree;
    if (this.categoryCache && Date.now() - this.categoryCache.at < CACHE_MS) return localise(this.categoryCache.tree);
    const rows = await this.prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
    const view = (c: (typeof rows)[number]): CategoryView => ({ key: c.key, label: c.labelEn, labelVi: c.labelVi, itemType: c.itemType });
    const tree = rows.filter((c) => !c.parentId).map((g) => ({ ...view(g), children: rows.filter((c) => c.parentId === g.id).map(view) }));
    this.categoryCache = { at: Date.now(), tree };
    return localise(tree);
  }

  /** Countries, provinces and cities with their place counts (rolled up to parents). Cached briefly like categories. */
  async areas(): Promise<GeoAreaOption[]> {
    if (this.areaCache && Date.now() - this.areaCache.at < CACHE_MS) return this.areaCache.list;
    const [rows, counts] = await Promise.all([
      this.prisma.geoArea.findMany({
        select: {
          id: true,
          parentId: true,
          slug: true,
          name: true,
          level: true,
          countryCode: true,
          names: { where: { lang: "en" }, select: { name: true } },
          represented: { select: { name: true } },
        },
      }),
      this.prisma.$queryRaw<{ area_id: string; n: bigint }[]>`
        SELECT area_id::text AS area_id, count(*) AS n FROM places
        WHERE area_id IS NOT NULL AND status = 'ACTIVE' AND merged_into_id IS NULL GROUP BY 1`,
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const total = new Map<string, number>();
    for (const c of counts) {
      // Add each area's own places to it and every ancestor.
      for (let a = byId.get(c.area_id), depth = 0; a && depth < 6; a = a.parentId ? byId.get(a.parentId) : undefined, depth++) {
        total.set(a.id, (total.get(a.id) ?? 0) + Number(c.n));
      }
    }
    const list = rows
      .map((r): GeoAreaOption => {
        const { short, kind } = splitAreaName(r.name);
        return {
          slug: r.slug,
          name: r.name,
          shortName: short,
          displayName: r.represented?.name ?? (r.level === "COUNTRY" ? r.names[0]?.name : undefined) ?? short,
          kind: r.level === "COUNTRY" ? "country" : (kind ?? "region"),
          countryCode: r.countryCode,
          parentSlug: r.parentId ? (byId.get(r.parentId)?.slug ?? null) : null,
          placeCount: total.get(r.id) ?? 0,
        };
      })
      .sort((a, b) => a.countryCode.localeCompare(b.countryCode) || normalizeSearch(a.displayName).localeCompare(normalizeSearch(b.displayName)));
    this.areaCache = { at: Date.now(), list };
    return list;
  }

  async browse(q: PlaceBrowseQuery, viewerId: string | null): Promise<PlaceBrowse> {
    // Where: a destination's centre, a point (the device), a province/city, or everywhere.
    let center: PlaceBrowse["center"] = null;
    let radiusKm: number | null = null;
    // Typed by assertion so TypeScript doesn't narrow it to null (it's set inside `useArea`).
    let area = null as { id: string; slug: string; name: string } | null;
    const areaSelect = { id: true, slug: true, name: true, minLat: true, minLng: true, maxLat: true, maxLng: true } as const;
    const useArea = (g: Prisma.GeoAreaGetPayload<{ select: typeof areaSelect }>, label: string) => {
      area = g;
      if (g.minLat != null && g.maxLat != null && g.minLng != null && g.maxLng != null) {
        center = { lat: (g.minLat + g.maxLat) / 2, lng: (g.minLng + g.maxLng) / 2, label };
      }
    };
    if (q.area) {
      const g = await this.prisma.geoArea.findUnique({ where: { slug: q.area }, select: areaSelect });
      if (!g) throw Errors.notFound("That area");
      useArea(g, splitAreaName(g.name).short);
    } else if (q.destination) {
      const d = await this.prisma.destination.findUnique({
        where: { slug: q.destination },
        select: { name: true, lat: true, lng: true, autoCreated: true, representsArea: { select: areaSelect } },
      });
      if (!d) throw Errors.notFound("That destination");
      if (d.autoCreated && d.representsArea) {
        // A destination made for a whole province/city covers that area, not a circle around its centre.
        useArea(d.representsArea, d.name);
      } else {
        center = { lat: d.lat, lng: d.lng, label: d.name };
        radiusKm = q.radius ?? RADIUS.destination;
      }
    } else if (q.near) {
      center = { lat: q.near[0], lng: q.near[1], label: requestLocale() === "vi" ? "vị trí của bạn" : "your location" };
      radiusKm = q.radius ?? RADIUS.near;
    }
    // An area's centre only places the map; distances are measured from destinations and the device.
    const point = center && !area ? Prisma.sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography` : null;

    // Areas and categories are resolved to ids here (small, cached lookups), so the main query has no joins and
    // can walk the partial (area_id, rating, …) / (rating, …) indexes in order instead of sorting a whole province.
    const scope: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE' AND p.merged_into_id IS NULL`];
    if (point && radiusKm) scope.push(Prisma.sql`ST_DWithin(p.location, ${point}, ${radiusKm * 1000})`);
    const areaIds = area ? await this.subtree((area as { id: string }).id) : null;
    if (areaIds) scope.push(areaIn(areaIds));
    const cats = await this.categoryIndex();
    const wanted = q.category
      ? [...cats.byKey.values()].filter((c) => c.key === q.category)
      : q.group
        ? [...cats.byKey.values()].filter((c) => c.groupKey === q.group)
        : null;
    const filters = [...scope];
    if (wanted) filters.push(wanted.length ? Prisma.sql`p.category_id = ANY(${wanted.map((c) => c.id)}::uuid[])` : Prisma.sql`FALSE`);
    // A text query narrows to a bounded set of candidates first (see placeCandidates), for the page and for the counts.
    const found = await placeCandidates(this.prisma, q.q, filters);
    const foundInScope = found && (wanted ? await placeCandidates(this.prisma, q.q, scope) : found);
    if (found) {
      filters.push(Prisma.sql`p.id = ANY(${found.ids}::uuid[])`);
      scope.push(Prisma.sql`p.id = ANY(${foundInScope!.ids}::uuid[])`);
    }

    const where = (parts: Prisma.Sql[]) => Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
    const dist = point ? Prisma.sql`ST_Distance(p.location, ${point})` : Prisma.sql`NULL::float8`;
    const sort = q.sort === "distance" && !point ? "recommended" : q.sort;
    const rel = relevance(q.q, PLACE_COLUMNS);
    const order =
      sort === "distance"
        ? // KNN order of the GIST index: the nearest come first without sorting everything in the radius.
          Prisma.sql`p.location <-> ${point} ASC, p.name ASC`
        : sort === "rating"
          ? Prisma.sql`p.rating DESC NULLS LAST, p.quality_score DESC, dist ASC NULLS LAST, p.name ASC`
          : rel
            ? // Recommended for a text search: best match first, then the usual signals.
              Prisma.sql`${rel} DESC, p.rating DESC NULLS LAST, p.quality_score DESC, dist ASC NULLS LAST, p.name ASC`
          : point && radiusKm
            ? // Recommended around a point: rating (unrated ≈ average), data quality and closeness, blended.
              Prisma.sql`(coalesce(p.rating, 3.8) / 5.0 * 0.6 + p.quality_score * 0.15 + (1 - least(${dist} / ${radiusKm * 1000}, 1)) * 0.25) DESC, p.name ASC`
            : // Same keys as places_listable_rank_idx / places_area_rank_idx, so no sort is needed.
              Prisma.sql`p.rating DESC NULLS LAST, p.quality_score DESC, p.name ASC`;
    const offset = q.cursor ? Number(q.cursor) : 0;

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; dist: number | null }[]>`
        SELECT p.id::text AS id, ${dist} AS dist FROM places p ${where(filters)}
        ORDER BY ${order} LIMIT ${q.limit + 1} OFFSET ${offset}`,
      this.counts(scope, !found && !point ? (areaIds?.join(",") ?? "*") : null),
    ]);
    // Facets (per group) and the total come from one count per category.
    const facetMap = new Map<string, number>();
    let total = 0;
    const want = wanted && new Set(wanted.map((c) => c.id));
    for (const [id, n] of counts) {
      const ref = id ? cats.byId.get(id) : undefined;
      if (ref) facetMap.set(ref.groupKey, (facetMap.get(ref.groupKey) ?? 0) + n);
      if (!want || (id && want.has(id))) total += n;
    }
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
      area: area && { slug: area.slug, name: area.name },
      radiusKm,
      facets: [...facetMap].map(([key, count]) => ({ key, count })),
      total,
      // A very broad text query was ranked on a sample: the counts are "at least".
      totalIsEstimate: !!found?.capped || !!foundInScope?.capped,
    };
  }

  /**
   * Places per category (null = uncategorised) in a scope. A whole area or everywhere (`cacheKey`) is counted once
   * per CACHE_MS — an index-only scan of places_area_category_idx, still the slowest part of a country-wide browse.
   */
  private async counts(scope: Prisma.Sql[], cacheKey: string | null): Promise<Map<string | null, number>> {
    const hit = cacheKey ? this.countCache.get(cacheKey) : undefined;
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.counts;
    const rows = await this.prisma.$queryRaw<{ id: string | null; n: bigint }[]>`
      SELECT p.category_id::text AS id, count(*) AS n FROM places p WHERE ${Prisma.join(scope, " AND ")} GROUP BY 1`;
    const counts = new Map(rows.map((r) => [r.id, Number(r.n)]));
    if (cacheKey) {
      if (this.countCache.size >= COUNT_CACHE_MAX) this.countCache.delete(this.countCache.keys().next().value!);
      this.countCache.set(cacheKey, { at: Date.now(), counts });
    }
    return counts;
  }

  /** Place search for the itinerary editor — boosts places in the trip's destinations. */
  async search(q: string, viewerId: string | null, opts: { destinationIds?: string[]; limit: number }): Promise<PlaceView[]> {
    const ids = normalizeSearch(q) ? await new TrigramRanker(this.prisma).places(q, 50) : null;
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
        categoryRef: { select: { key: true, labelEn: true, labelVi: true, parent: { select: { key: true, labelEn: true, labelVi: true } } } },
        names: { where: { kind: "primary" }, select: { lang: true, name: true }, orderBy: { lang: "asc" } },
        sources: { where: { provider: { not: "manual" } }, select: { attribution: true }, distinct: ["attribution"] },
      },
    });
    const tripWhere = { ...DISCOVERABLE, days: { some: { items: { some: { placeId } } } } };
    const [nearIds, trips, tripCount, photos] = await Promise.all([
      // The 6 nearest by a KNN walk of the GIST index (`<->`), then cut at NEARBY_METRES. Collecting everything within
      // the radius first and sorting it took seconds in dense cities (Tokyo: ~6,500 places within 1.5 km).
      this.prisma.$queryRaw<{ id: string; dist: number }[]>`
        SELECT n.id, n.dist FROM places p CROSS JOIN LATERAL (
          SELECT o.id::text AS id, ST_Distance(o.location, p.location) AS dist FROM places o
          WHERE o.id <> p.id AND o.status = 'ACTIVE' AND o.merged_into_id IS NULL
          ORDER BY o.location <-> p.location LIMIT 6) n
        WHERE p.id = ${placeId}::uuid AND n.dist <= ${NEARBY_METRES}
        ORDER BY n.dist`,
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
      groupLabel: (requestLocale() === "vi" ? p.categoryRef?.parent?.labelVi : p.categoryRef?.parent?.labelEn) ?? null,
      destinationSlug: p.destination?.slug ?? null,
      areaName: p.area?.name ?? null,
      names: p.names.filter((n) => n.name !== p.name && n.name !== base.name),
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
  @Get("areas")
  areas() {
    return this.places.areas();
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
