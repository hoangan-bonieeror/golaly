/**
 * Catalog admin (phase 3): areas, sync jobs, runs, duplicate review, place curation and category maps.
 * Every endpoint is ADMIN-only (checked against the database on each request) and every change is audit-logged.
 *
 * Writes stay within what the design allows the API: starting runs (through Airflow), recording decisions
 * (merges/unmerges run the same database functions as the pipeline and flag the winner `needs_publish` — the
 * catalog_scheduler DAG recomputes its fields), and admin edits, which lock the field against imports.
 */
import {
  Body,
  type CanActivate,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  adminListQuerySchema,
  adminPlacePatchSchema,
  categoryMapSchema,
  mergeDecisionSchema,
  normalizeSearch,
  runJobSchema,
  syncJobPatchSchema,
  syncJobSchema,
  type AdminAreaView,
  type AdminCategoryView,
  type AdminListQuery,
  type AdminPlaceDetail,
  type AdminPlacePatch,
  type AdminPlaceView,
  type CategoryMapView,
  type MergeCandidateView,
  type MergePlaceSide,
  type Paged,
  type SyncJobInput,
  type SyncJobPatch,
  type SyncJobView,
  type SyncRunDetail,
  type SyncRunErrorView,
  type SyncRunSummary,
  type UnmappedCategoryView,
} from "@triply/shared";
import { z } from "zod";
import { ViewerId, requireUser } from "../../common/auth";
import { AppError, Errors, ZodPipe } from "../../common/http";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { SearchIndexService } from "../search/search-index";
import { AirflowClient, AirflowError } from "./airflow";

const PLACE_SOURCES = ["overture", "osm", "fsq"];

type RunRow = Prisma.SyncRunGetPayload<{ include: { job: { select: { name: true } }; requestedBy: { select: { username: true } }; _count: { select: { errors: true } } } }>;
const runInclude = { job: { select: { name: true } }, requestedBy: { select: { username: true } }, _count: { select: { errors: true } } } as const;

function toRunSummary(r: RunRow): SyncRunSummary {
  const params = (r.params ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    jobId: r.jobId,
    jobName: r.job?.name ?? null,
    trigger: r.trigger,
    status: r.status,
    area: (params.area as string | null | undefined) ?? (params.bbox as string | null | undefined) ?? (Array.isArray(params.areas) ? (params.areas as string[]).join(", ") : null),
    providers: Array.isArray(params.providers) ? (params.providers as string[]) : [],
    progress: (r.progress ?? {}) as SyncRunSummary["progress"],
    errorCount: r._count.errors,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    requestedBy: r.requestedBy?.username ?? null,
  };
}

@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly airflow: AirflowClient,
  ) {}

  async requireAdmin(viewerId: string | null): Promise<string> {
    const id = requireUser(viewerId);
    const ok = await this.prisma.user.count({ where: { id, role: "ADMIN", deletedAt: null } });
    if (!ok) throw Errors.forbidden("Only admins can do that.");
    return id;
  }

  // ── areas ──────────────────────────────────────────────────────────────────

  async areas(parentSlug: string | undefined): Promise<AdminAreaView[]> {
    const parent = parentSlug ? await this.prisma.geoArea.findUnique({ where: { slug: parentSlug.toLowerCase() }, select: { id: true } }) : null;
    if (parentSlug && !parent) throw Errors.notFound("That area");
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        slug: string;
        name: string;
        level: string;
        country_code: string;
        parent_slug: string | null;
        has_boundary: boolean;
        min_lng: number | null;
        min_lat: number | null;
        max_lng: number | null;
        max_lat: number | null;
        regions: bigint;
        places: bigint;
      }[]
    >`
      SELECT g.id::text AS id, g.slug, g.name, g.level::text AS level, g.country_code, p.slug AS parent_slug,
             g.boundary IS NOT NULL AS has_boundary, g.min_lng, g.min_lat, g.max_lng, g.max_lat,
             (SELECT count(*) FROM geo_areas c WHERE c.parent_id = g.id) AS regions,
             (SELECT count(*) FROM places pl WHERE pl.status = 'ACTIVE' AND pl.merged_into_id IS NULL
                AND pl.area_id IN (SELECT id FROM geo_areas d WHERE d.id = g.id OR d.parent_id = g.id)) AS places
      FROM geo_areas g LEFT JOIN geo_areas p ON p.id = g.parent_id
      WHERE ${parent ? Prisma.sql`g.parent_id = ${parent.id}::uuid` : Prisma.sql`g.parent_id IS NULL`}
      ORDER BY g.name`;
    const slugs = rows.map((r) => r.slug);
    const lastRuns = slugs.length
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT DISTINCT ON (lower(params->>'area')) id::text AS id FROM sync_runs
          WHERE lower(params->>'area') = ANY(${slugs}::text[]) ORDER BY lower(params->>'area'), started_at DESC`
      : [];
    const runs = await this.prisma.syncRun.findMany({ where: { id: { in: lastRuns.map((r) => r.id) } }, include: runInclude });
    const bySlug = new Map(runs.map((r) => [String(((r.params ?? {}) as Record<string, unknown>).area ?? "").toLowerCase(), toRunSummary(r)]));
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      level: r.level,
      countryCode: r.country_code,
      parentSlug: r.parent_slug,
      hasBoundary: r.has_boundary,
      bbox: r.min_lng === null ? null : [r.min_lng, r.min_lat!, r.max_lng!, r.max_lat!],
      places: Number(r.places),
      regions: Number(r.regions),
      lastRun: bySlug.get(r.slug) ?? null,
    }));
  }

  // ── jobs ───────────────────────────────────────────────────────────────────

  private async jobView(id: string): Promise<SyncJobView> {
    const j = await this.prisma.syncJob.findUnique({ where: { id }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1, include: runInclude } } });
    if (!j) throw Errors.notFound("That job");
    return this.toJob(j);
  }

  private toJob(j: Prisma.SyncJobGetPayload<{ include: { runs: { include: typeof runInclude } } }>): SyncJobView {
    return {
      id: j.id,
      name: j.name,
      area: j.area,
      bbox: j.bbox,
      providers: j.providers,
      categoryKeys: j.categoryKeys,
      schedule: j.schedule,
      enabled: j.enabled,
      photos: j.photos,
      nextRunAt: j.nextRunAt?.toISOString() ?? null,
      lastRun: j.runs[0] ? toRunSummary(j.runs[0]) : null,
      createdAt: j.createdAt.toISOString(),
    };
  }

  private async checkJob(input: { area?: string | null; providers?: string[]; categoryKeys?: string[] }) {
    if (input.providers?.some((p) => !PLACE_SOURCES.includes(p))) throw Errors.invalid(`Sources must be among ${PLACE_SOURCES.join(", ")}.`, { providers: "Unknown source." });
    if (input.area) {
      const known =
        (await this.prisma.geoArea.count({ where: { slug: input.area } })) + (await this.prisma.destination.count({ where: { slug: input.area } }));
      if (!known) throw Errors.invalid(`No area or destination "${input.area}". Import the country's boundaries first.`, { area: "Unknown area." });
    }
    if (input.categoryKeys?.length) {
      const n = await this.prisma.category.count({ where: { key: { in: input.categoryKeys } } });
      if (n !== new Set(input.categoryKeys).size) throw Errors.invalid("Some categories don't exist.", { categoryKeys: "Unknown category." });
    }
  }

  async jobs(): Promise<SyncJobView[]> {
    const rows = await this.prisma.syncJob.findMany({ orderBy: { name: "asc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1, include: runInclude } } });
    return rows.map((j) => this.toJob(j));
  }

  async createJob(adminId: string, input: SyncJobInput): Promise<SyncJobView> {
    await this.checkJob(input);
    try {
      const j = await this.prisma.syncJob.create({
        data: {
          name: input.name,
          area: input.area ?? null,
          bbox: input.bbox ?? null,
          providers: input.providers,
          categoryKeys: input.categoryKeys,
          schedule: input.schedule ?? null,
          enabled: input.enabled,
          photos: input.photos,
          createdById: adminId,
        },
      });
      await this.audit.log(adminId, "catalog.job.created", "sync_job", j.id, { name: j.name });
      return this.jobView(j.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("A job with that name already exists.");
      throw e;
    }
  }

  async updateJob(adminId: string, id: string, patch: SyncJobPatch): Promise<SyncJobView> {
    await this.checkJob(patch);
    const before = await this.prisma.syncJob.findUnique({ where: { id } });
    if (!before) throw Errors.notFound("That job");
    const area = patch.area !== undefined ? patch.area : before.area;
    const bbox = patch.bbox !== undefined ? patch.bbox : before.bbox;
    if (!area && !bbox) throw Errors.invalid("Choose an area (or a box).", { area: "Required." });
    const scheduleChanged = patch.schedule !== undefined && patch.schedule !== before.schedule;
    await this.prisma.syncJob.update({
      where: { id },
      data: {
        name: patch.name,
        area,
        bbox,
        providers: patch.providers,
        categoryKeys: patch.categoryKeys,
        schedule: patch.schedule,
        enabled: patch.enabled,
        photos: patch.photos,
        // The scheduler computes the next time from the new schedule (or when re-enabled).
        ...(scheduleChanged || patch.enabled === true ? { nextRunAt: null } : {}),
      },
    });
    await this.audit.log(adminId, "catalog.job.updated", "sync_job", id, { fields: Object.keys(patch) });
    return this.jobView(id);
  }

  async deleteJob(adminId: string, id: string) {
    const j = await this.prisma.syncJob.findUnique({ where: { id }, select: { name: true } });
    if (!j) throw Errors.notFound("That job");
    await this.prisma.syncJob.delete({ where: { id } });
    await this.audit.log(adminId, "catalog.job.deleted", "sync_job", id, { name: j.name });
  }

  /** Queue a run (a job's, or an ad-hoc one) and hand it to Airflow. */
  async startRun(
    adminId: string,
    spec: { jobId?: string; area?: string | null; bbox?: string | null; providers: string[]; categoryKeys: string[]; photos: boolean },
    dryRun: boolean,
  ): Promise<SyncRunDetail> {
    if (spec.jobId) {
      const busy = await this.prisma.syncRun.count({ where: { jobId: spec.jobId, status: { in: ["queued", "running"] } } });
      if (busy) throw Errors.conflict("This job already has a run in progress.");
    }
    const params = { area: spec.area ?? null, bbox: spec.bbox ?? null, providers: spec.providers, category_keys: spec.categoryKeys, photos: spec.photos, dry_run: dryRun };
    const run = await this.prisma.syncRun.create({ data: { trigger: dryRun ? "dry_run" : "admin", status: "queued", params, jobId: spec.jobId ?? null, requestedById: adminId } });
    const conf: Record<string, unknown> = { area: params.area, bbox: params.bbox, providers: params.providers, category_keys: params.category_keys, sync_run_id: run.id };
    if (!dryRun) conf.photos = params.photos;
    try {
      const dagRunId = await this.airflow.trigger(dryRun ? "catalog_dry_run" : "catalog_sync", conf);
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { params: { ...params, airflow_run_id: dagRunId } } });
    } catch (e) {
      const msg = e instanceof AirflowError ? e.message : "Couldn't start the run.";
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { status: "failed", error: msg, finishedAt: new Date() } });
      throw new AppError(502, msg);
    }
    await this.audit.log(adminId, "catalog.run.started", "sync_run", run.id, { jobId: spec.jobId ?? null, dryRun });
    return this.run(run.id);
  }

  async runJob(adminId: string, id: string, dryRun: boolean) {
    const j = await this.prisma.syncJob.findUnique({ where: { id } });
    if (!j) throw Errors.notFound("That job");
    return this.startRun(adminId, { jobId: j.id, area: j.area, bbox: j.bbox, providers: j.providers, categoryKeys: j.categoryKeys, photos: j.photos }, dryRun);
  }

  // ── runs ───────────────────────────────────────────────────────────────────

  async runs(q: AdminListQuery): Promise<Paged<SyncRunSummary>> {
    const rows = await this.prisma.syncRun.findMany({
      where: { ...(q.jobId ? { jobId: q.jobId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.area ? { params: { path: ["area"], equals: q.area } } : {}) },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: runInclude,
    });
    const page = rows.slice(0, q.limit);
    return { items: page.map(toRunSummary), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async run(id: string): Promise<SyncRunDetail> {
    const r = await this.prisma.syncRun.findUnique({ where: { id }, include: runInclude });
    if (!r) throw Errors.notFound("That run");
    const params = (r.params ?? {}) as Record<string, unknown>;
    const resumable = ["failed", "partial", "cancelled"].includes(r.status) && r.trigger !== "dry_run" && !params.dry_run;
    return { ...toRunSummary(r), params, stats: r.stats as Record<string, unknown>, error: r.error, cancelRequested: r.cancelRequested, resumable };
  }

  async runErrors(id: string): Promise<SyncRunErrorView[]> {
    const rows = await this.prisma.syncRunError.findMany({ where: { runId: id }, orderBy: { createdAt: "asc" }, take: 500 });
    return rows.map((e) => ({ id: e.id, provider: e.provider, externalId: e.externalId, stage: e.stage, message: e.message, createdAt: e.createdAt.toISOString() }));
  }

  /**
   * Continue a failed, partial or cancelled run where it stopped: the same sync_runs row goes back to Airflow,
   * whose partitions skip what their cursors (sync_run_cursors) say is already loaded.
   */
  async resumeRun(adminId: string, id: string): Promise<SyncRunDetail> {
    const r = await this.prisma.syncRun.findUnique({ where: { id } });
    if (!r) throw Errors.notFound("That run");
    const params = (r.params ?? {}) as Record<string, unknown>;
    if (!["failed", "partial", "cancelled"].includes(r.status) || r.trigger === "dry_run" || params.dry_run) {
      throw Errors.conflict("Only failed, partial or cancelled syncs can be resumed.");
    }
    const area = (params.area as string | null) ?? null;
    const bbox = (params.bbox as string | null) ?? null;
    const busy = await this.prisma.syncRun.count({
      where: { id: { not: id }, status: { in: ["queued", "running"] }, OR: [...(r.jobId ? [{ jobId: r.jobId }] : []), ...(area ? [{ params: { path: ["area"], equals: area } }] : [])] },
    });
    if (busy) throw Errors.conflict("Another run for this area is in progress.");
    await this.prisma.syncRun.update({ where: { id }, data: { status: "queued", error: null, finishedAt: null, cancelRequested: false } });
    const conf = {
      area,
      bbox,
      providers: Array.isArray(params.providers) ? params.providers : ["overture", "osm"],
      category_keys: Array.isArray(params.category_keys) ? params.category_keys : [],
      photos: params.photos !== false,
      sync_run_id: id,
    };
    try {
      await this.airflow.trigger("catalog_sync", conf);
    } catch (e) {
      const msg = e instanceof AirflowError ? e.message : "Couldn't resume the run.";
      await this.prisma.syncRun.update({ where: { id }, data: { status: r.status, error: msg, finishedAt: r.finishedAt ?? new Date() } });
      throw new AppError(502, msg);
    }
    await this.audit.log(adminId, "catalog.run.resumed", "sync_run", id, {});
    return this.run(id);
  }

  async cancelRun(adminId: string, id: string): Promise<SyncRunDetail> {
    const r = await this.prisma.syncRun.findUnique({ where: { id }, select: { status: true } });
    if (!r) throw Errors.notFound("That run");
    if (r.status === "queued") {
      await this.prisma.syncRun.update({ where: { id }, data: { status: "cancelled", cancelRequested: true, finishedAt: new Date(), error: "cancelled before it started" } });
    } else if (r.status === "running") {
      // The pipeline checks this between batches; what was loaded is published, nothing counts as missing.
      await this.prisma.syncRun.update({ where: { id }, data: { cancelRequested: true } });
    } else {
      throw Errors.conflict("That run has already finished.");
    }
    await this.audit.log(adminId, "catalog.run.cancelled", "sync_run", id, {});
    return this.run(id);
  }

  // ── duplicates ─────────────────────────────────────────────────────────────

  private async sides(ids: string[]): Promise<Map<string, MergePlaceSide>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.place.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        phone: true,
        website: true,
        categoryRef: { select: { key: true } },
        sources: { select: { provider: true, externalId: true } },
        _count: { select: { items: true, savedBy: true, photos: true } },
      },
    });
    return new Map(
      rows.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          address: p.address,
          categoryKey: p.categoryRef?.key ?? null,
          lat: p.lat,
          lng: p.lng,
          phone: p.phone,
          website: p.website,
          sources: p.sources,
          links: p._count.items + p._count.savedBy + p._count.photos,
        },
      ]),
    );
  }

  private async areaIds(slug: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE t AS (SELECT id FROM geo_areas WHERE slug = ${slug} UNION ALL SELECT g.id FROM geo_areas g JOIN t ON g.parent_id = t.id)
      SELECT id::text AS id FROM t`;
    if (!rows.length) throw Errors.notFound("That area");
    return rows.map((r) => r.id);
  }

  async mergeCandidates(q: AdminListQuery): Promise<Paged<MergeCandidateView>> {
    const status = (q.status?.toUpperCase() ?? "PENDING") as "PENDING" | "MERGED" | "REJECTED";
    if (!["PENDING", "MERGED", "REJECTED"].includes(status)) throw Errors.invalid("Unknown status.");
    const areaIds = q.area ? await this.areaIds(q.area) : null;
    const rows = await this.prisma.mergeCandidate.findMany({
      where: {
        status,
        ...(status === "PENDING" ? { placeA: { mergedIntoId: null }, placeB: { mergedIntoId: null } } : {}),
        ...(areaIds ? { OR: [{ placeA: { areaId: { in: areaIds } } }, { placeB: { areaId: { in: areaIds } } }] } : {}),
      },
      orderBy: [{ score: "desc" }, { id: "asc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    const sides = await this.sides(page.flatMap((c) => [c.placeAId, c.placeBId]));
    return {
      items: page
        .filter((c) => sides.has(c.placeAId) && sides.has(c.placeBId))
        .map((c) => ({
          id: c.id,
          score: c.score,
          signals: c.signals as Record<string, unknown>,
          status: c.status,
          a: sides.get(c.placeAId)!,
          b: sides.get(c.placeBId)!,
          decidedBy: c.decidedBy,
          decidedAt: c.decidedAt?.toISOString() ?? null,
        })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }

  async decide(adminId: string, id: string, decision: "merge" | "reject") {
    const c = await this.prisma.mergeCandidate.findUnique({ where: { id } });
    if (!c) throw Errors.notFound("That pair");
    if (c.status !== "PENDING") throw Errors.conflict("That pair was already decided.");
    if (decision === "reject") {
      await this.prisma.mergeCandidate.update({ where: { id }, data: { status: "REJECTED", decidedBy: adminId, decidedAt: new Date() } });
      await this.audit.log(adminId, "catalog.merge.decided", "merge", id, { decision });
      return { status: "REJECTED" as const, mergeId: null, winnerId: null };
    }
    try {
      const out = await this.prisma.$transaction(async (tx) => {
        const [{ w }] = await tx.$queryRaw<{ w: string }[]>`SELECT catalog_pick_winner(${c.placeAId}::uuid, ${c.placeBId}::uuid)::text AS w`;
        const loser = w === c.placeAId ? c.placeBId : c.placeAId;
        const [{ m }] = await tx.$queryRaw<{ m: string }[]>`
          SELECT catalog_merge_places(${w}::uuid, ${loser}::uuid, ${adminId}, ${c.score}, ${JSON.stringify(c.signals)}::jsonb)::text AS m`;
        return { winnerId: w, mergeId: m };
      });
      await this.audit.log(adminId, "catalog.merge.decided", "merge", id, { decision, ...out });
      return { status: "MERGED" as const, ...out };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
        throw Errors.conflict("One of the two places was merged or removed meanwhile.");
      }
      throw e;
    }
  }

  async undoMerge(adminId: string, mergeId: string) {
    try {
      const [{ r }] = await this.prisma.$queryRaw<{ r: { winner: string; loser: string; restored: Record<string, number> } }[]>`
        SELECT catalog_unmerge(${mergeId}::uuid, ${adminId}) AS r`;
      await this.audit.log(adminId, "catalog.merge.undone", "merge", mergeId, r);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("already undone")) throw Errors.conflict("That merge was already undone.");
      if (msg.includes("no merge")) throw Errors.notFound("That merge");
      throw e;
    }
  }

  // ── places ─────────────────────────────────────────────────────────────────

  async places(q: AdminListQuery): Promise<Paged<AdminPlaceView>> {
    const areaIds = q.area ? await this.areaIds(q.area) : null;
    const status = q.status?.toUpperCase();
    const where: Prisma.PlaceWhereInput = {
      mergedIntoId: null,
      ...(status && ["ACTIVE", "CLOSED", "HIDDEN"].includes(status) ? { status: status as "ACTIVE" | "CLOSED" | "HIDDEN" } : {}),
      ...(areaIds ? { areaId: { in: areaIds } } : {}),
      ...(q.category ? { OR: [{ categoryRef: { key: q.category } }, { categoryRef: { parent: { key: q.category } } }] } : {}),
      ...(q.q ? { searchText: { contains: normalizeSearch(q.q) } } : {}),
    };
    const rows = await this.prisma.place.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { categoryRef: { select: { key: true, labelEn: true } }, area: { select: { name: true } }, _count: { select: { sources: true } } },
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        categoryKey: p.categoryRef?.key ?? null,
        categoryLabel: p.categoryRef?.labelEn ?? null,
        areaName: p.area?.name ?? null,
        status: p.status,
        qualityScore: p.qualityScore,
        lockedFields: p.lockedFields,
        sourceCount: p._count.sources,
        mergedIntoId: p.mergedIntoId,
        updatedAt: p.updatedAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }

  async place(id: string): Promise<AdminPlaceDetail> {
    const p = await this.prisma.place.findUnique({
      where: { id },
      include: {
        categoryRef: { select: { key: true, labelEn: true } },
        area: { select: { name: true } },
        sources: { include: { category: { select: { key: true } } }, orderBy: { provider: "asc" } },
        edits: { orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { username: true } } } },
        mergesWon: { orderBy: { createdAt: "desc" }, include: { loser: { select: { id: true, name: true } } } },
        mergesLost: { orderBy: { createdAt: "desc" }, include: { winner: { select: { id: true, name: true } } } },
      },
    });
    if (!p) throw Errors.notFound("That place");
    const merges = [
      ...p.mergesWon.map((m) => ({ id: m.id, otherId: m.loser.id, otherName: m.loser.name, role: "winner" as const, at: m.createdAt.toISOString(), undoneAt: m.undoneAt?.toISOString() ?? null, actor: m.actor })),
      ...p.mergesLost.map((m) => ({ id: m.id, otherId: m.winner.id, otherName: m.winner.name, role: "loser" as const, at: m.createdAt.toISOString(), undoneAt: m.undoneAt?.toISOString() ?? null, actor: m.actor })),
    ];
    const history: AdminPlaceDetail["history"] = [
      ...p.edits.map((e) => ({ kind: "edit" as const, at: e.createdAt.toISOString(), actor: e.actor?.username ?? null, detail: { field: e.field, old: e.old, new: e.new } })),
      ...merges.map((m) => ({ kind: "merge" as const, at: m.at, actor: m.actor, detail: { with: m.otherName, role: m.role } })),
      ...merges.filter((m) => m.undoneAt).map((m) => ({ kind: "unmerge" as const, at: m.undoneAt!, actor: null, detail: { with: m.otherName } })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return {
      id: p.id,
      name: p.name,
      address: p.address,
      categoryKey: p.categoryRef?.key ?? null,
      categoryLabel: p.categoryRef?.labelEn ?? null,
      areaName: p.area?.name ?? null,
      status: p.status,
      qualityScore: p.qualityScore,
      lockedFields: p.lockedFields,
      sourceCount: p.sources.length,
      mergedIntoId: p.mergedIntoId,
      updatedAt: p.updatedAt.toISOString(),
      lat: p.lat,
      lng: p.lng,
      phone: p.phone,
      website: p.website,
      openingHours: p.openingHours,
      fieldSources: (p.fieldSources ?? {}) as Record<string, string>,
      sources: p.sources.map((s) => ({
        id: s.id,
        provider: s.provider,
        externalId: s.externalId,
        name: ((s.normalized ?? {}) as { name?: string }).name ?? null,
        categoryKey: s.category?.key ?? null,
        lat: s.lat,
        lng: s.lng,
        lastSeenAt: s.lastSeenAt.toISOString(),
        missingRuns: s.missingRuns,
        operatingStatus: s.operatingStatus,
      })),
      history,
      merges: merges.map(({ actor: _a, ...m }) => m),
    };
  }

  /** Admin edit: each field set is recorded (place_edits) and locked so imports never overwrite it. */
  async editPlace(adminId: string, id: string, patch: AdminPlacePatch): Promise<AdminPlaceDetail> {
    const p = await this.prisma.place.findUnique({
      where: { id },
      include: { categoryRef: { select: { key: true } }, destination: { select: { name: true, country: true } }, area: { select: { name: true } } },
    });
    if (!p) throw Errors.notFound("That place");
    if (p.mergedIntoId) throw Errors.conflict("That place was merged into another one; edit that one instead.");
    const data: Prisma.PlaceUpdateInput = {};
    const edits: { field: string; old: unknown; new: unknown }[] = [];
    const lock = new Set(p.lockedFields);
    const set = (field: string, lockAs: string | null, old: unknown, value: unknown, apply: () => void) => {
      if (value === undefined || JSON.stringify(old) === JSON.stringify(value)) return;
      apply();
      edits.push({ field, old: old ?? null, new: value ?? null });
      if (lockAs) lock.add(lockAs);
    };
    set("name", "name", p.name, patch.name, () => (data.name = patch.name!));
    set("address", "address", p.address, patch.address, () => (data.address = patch.address!));
    set("phone", "phone", p.phone, patch.phone, () => (data.phone = patch.phone ?? null));
    set("website", "website", p.website, patch.website, () => (data.website = patch.website ?? null));
    set("opening_hours", "opening_hours", p.openingHours, patch.openingHours, () => (data.openingHours = patch.openingHours ?? null));
    if (patch.categoryKey !== undefined && patch.categoryKey !== p.categoryRef?.key) {
      const cat = await this.prisma.category.findUnique({ where: { key: patch.categoryKey } });
      if (!cat) throw Errors.invalid("Unknown category.", { categoryKey: "Unknown category." });
      set("category", "category", p.categoryRef?.key ?? null, cat.key, () => {
        data.categoryRef = { connect: { id: cat.id } };
        data.category = cat.itemType;
      });
    }
    if ((patch.lat !== undefined || patch.lng !== undefined) && (patch.lat !== p.lat || patch.lng !== p.lng)) {
      set("coords", "coords", [p.lat, p.lng], [patch.lat ?? p.lat, patch.lng ?? p.lng], () => {
        data.lat = patch.lat ?? p.lat;
        data.lng = patch.lng ?? p.lng;
      });
    }
    set("status", null, p.status, patch.status, () => (data.status = patch.status!));
    for (const f of patch.unlock ?? []) {
      if (lock.delete(f)) edits.push({ field: `unlock:${f}`, old: null, new: null });
    }
    if (!edits.length) return this.place(id);
    const unlocked = (patch.unlock ?? []).length > 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.place.update({ where: { id }, data: { ...data, lockedFields: [...lock], ...(unlocked ? { needsPublish: true } : {}) } });
      await tx.placeEdit.createMany({ data: edits.map((e) => ({ placeId: id, field: e.field, old: e.old as Prisma.InputJsonValue, new: e.new as Prisma.InputJsonValue, actorId: adminId })) });
      if (data.name !== undefined || data.address !== undefined) {
        const t = SearchIndexService.placeText({ name: (data.name as string) ?? p.name, address: (data.address as string) ?? p.address, destination: p.destination, area: p.area });
        await tx.place.update({ where: { id }, data: { ...t, nameNorm: normalizeSearch((data.name as string) ?? p.name) } });
      }
    });
    await this.audit.log(adminId, "catalog.place.edited", "place", id, { fields: edits.map((e) => e.field) });
    return this.place(id);
  }

  // ── categories ─────────────────────────────────────────────────────────────

  async categories(): Promise<AdminCategoryView[]> {
    const rows = await this.prisma.$queryRaw<{ key: string; label_en: string; label_vi: string; parent_key: string | null; places: bigint; maps: bigint }[]>`
      SELECT c.key, c.label_en, c.label_vi, p.key AS parent_key,
             (SELECT count(*) FROM places pl WHERE pl.category_id = c.id AND pl.status = 'ACTIVE' AND pl.merged_into_id IS NULL) AS places,
             (SELECT count(*) FROM category_maps m WHERE m.category_id = c.id) AS maps
      FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      ORDER BY coalesce(p.sort_order, c.sort_order), p.key NULLS FIRST, c.sort_order`;
    return rows.map((r) => ({ key: r.key, labelEn: r.label_en, labelVi: r.label_vi, parentKey: r.parent_key, places: Number(r.places), maps: Number(r.maps) }));
  }

  async categoryMaps(provider?: string): Promise<CategoryMapView[]> {
    const rows = await this.prisma.categoryMap.findMany({
      where: provider ? { provider } : {},
      include: { category: { select: { key: true } } },
      orderBy: [{ provider: "asc" }, { externalCategory: "asc" }],
      take: 2000,
    });
    return rows.map((m) => ({ provider: m.provider, externalCategory: m.externalCategory, categoryKey: m.category.key }));
  }

  /** The most common source categories that have no mapping (their records aren't published). */
  async unmapped(provider?: string): Promise<UnmappedCategoryView[]> {
    const rows = await this.prisma.$queryRaw<{ provider: string; ext: string; n: bigint }[]>`
      SELECT provider, normalized->'category_candidates'->>0 AS ext, count(*) AS n
      FROM place_sources
      WHERE category_id IS NULL AND jsonb_array_length(coalesce(normalized->'category_candidates', '[]')) > 0
        ${provider ? Prisma.sql`AND provider = ${provider}` : Prisma.empty}
        -- Mapped since the last sync: those records get their category on the area's next run.
        AND NOT EXISTS (SELECT 1 FROM category_maps m WHERE m.provider = place_sources.provider AND m.external_category = normalized->'category_candidates'->>0)
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 200`;
    return rows.map((r) => ({ provider: r.provider, externalCategory: r.ext, records: Number(r.n) }));
  }

  /** Map (or unmap) a source category. Records pick it up on the next sync of their area (they count as changed). */
  async setCategoryMap(adminId: string, input: z.infer<typeof categoryMapSchema>) {
    const key = { provider_externalCategory: { provider: input.provider, externalCategory: input.externalCategory } };
    const before = await this.prisma.categoryMap.findUnique({ where: key });
    let categoryId: string | null = null;
    if (input.categoryKey === null) {
      if (before) await this.prisma.categoryMap.delete({ where: key });
    } else {
      const cat = await this.prisma.category.findUnique({ where: { key: input.categoryKey } });
      if (!cat) throw Errors.invalid("Unknown category.", { categoryKey: "Unknown category." });
      categoryId = cat.id;
      await this.prisma.categoryMap.upsert({ where: key, create: { provider: input.provider, externalCategory: input.externalCategory, categoryId }, update: { categoryId } });
    }
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM place_sources WHERE provider = ${input.provider} AND normalized->'category_candidates' ? ${input.externalCategory}`;
    // Audited against the category gaining (or, for a removal, losing) the mapping.
    const entity = categoryId ?? before?.categoryId;
    if (entity && categoryId !== (before?.categoryId ?? null)) {
      await this.audit.log(adminId, "catalog.category_map.changed", "category_map", entity, { ...input, previous: before?.categoryId ?? null });
    }
    return { ...input, records: Number(n) };
  }

}

const listQuery = new ZodPipe(adminListQuerySchema);
const uuid = new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 404 });

/** ADMIN-only, checked against the database before any body validation (so non-admins always get 403). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly svc: CatalogAdminService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{ user?: { id: string } }>();
    await this.svc.requireAdmin(req.user?.id ?? null);
    return true;
  }
}

@Controller("admin")
@UseGuards(AdminGuard)
export class CatalogAdminController {
  constructor(private readonly svc: CatalogAdminService) {}

  @Get("areas")
  async areas(@Query("parent") parent?: string) {
    return this.svc.areas(parent);
  }

  @Get("sync-jobs")
  async jobs() {
    return this.svc.jobs();
  }

  @Post("sync-jobs")
  async createJob(@ViewerId() me: string, @Body(new ZodPipe(syncJobSchema)) body: SyncJobInput) {
    return this.svc.createJob(me, body);
  }

  @Patch("sync-jobs/:id")
  async updateJob(@ViewerId() me: string, @Param("id", uuid) id: string, @Body(new ZodPipe(syncJobPatchSchema)) body: SyncJobPatch) {
    return this.svc.updateJob(me, id, body);
  }

  @Delete("sync-jobs/:id")
  @HttpCode(204)
  async deleteJob(@ViewerId() me: string, @Param("id", uuid) id: string) {
    await this.svc.deleteJob(me, id);
  }

  @Post("sync-jobs/:id/run")
  async runJob(@ViewerId() me: string, @Param("id", uuid) id: string, @Body(new ZodPipe(runJobSchema)) body: { dryRun: boolean }) {
    return this.svc.runJob(me, id, body.dryRun);
  }

  /** An ad-hoc run (no job): "Sync now" on an area. */
  @Post("sync-runs")
  async startRun(
    @ViewerId() me: string,
    @Body(new ZodPipe(z.object({ area: z.string().trim().toLowerCase().min(1).max(80), providers: z.array(z.string()).min(1).default(["overture", "osm"]), dryRun: z.boolean().default(false) })))
    body: { area: string; providers: string[]; dryRun: boolean },
  ) {
    return this.svc.startRun(me, { area: body.area, providers: body.providers, categoryKeys: [], photos: true }, body.dryRun);
  }

  @Get("sync-runs")
  async runs(@Query(listQuery) q: AdminListQuery) {
    return this.svc.runs(q);
  }

  @Get("sync-runs/:id")
  async run(@Param("id", uuid) id: string) {
    return this.svc.run(id);
  }

  @Get("sync-runs/:id/errors")
  async runErrors(@Param("id", uuid) id: string) {
    return this.svc.runErrors(id);
  }

  @Post("sync-runs/:id/resume")
  async resume(@ViewerId() me: string, @Param("id", uuid) id: string) {
    return this.svc.resumeRun(me, id);
  }

  @Post("sync-runs/:id/cancel")
  async cancel(@ViewerId() me: string, @Param("id", uuid) id: string) {
    return this.svc.cancelRun(me, id);
  }

  @Get("merge-candidates")
  async candidates(@Query(listQuery) q: AdminListQuery) {
    return this.svc.mergeCandidates(q);
  }

  @Post("merge-candidates/:id/decide")
  async decide(@ViewerId() me: string, @Param("id", uuid) id: string, @Body(new ZodPipe(mergeDecisionSchema)) body: { decision: "merge" | "reject" }) {
    return this.svc.decide(me, id, body.decision);
  }

  @Post("place-merges/:id/undo")
  async undo(@ViewerId() me: string, @Param("id", uuid) id: string) {
    return this.svc.undoMerge(me, id);
  }

  @Get("places")
  async places(@Query(listQuery) q: AdminListQuery) {
    return this.svc.places(q);
  }

  @Get("places/:id")
  async place(@Param("id", uuid) id: string) {
    return this.svc.place(id);
  }

  @Patch("places/:id")
  async editPlace(@ViewerId() me: string, @Param("id", uuid) id: string, @Body(new ZodPipe(adminPlacePatchSchema)) body: AdminPlacePatch) {
    return this.svc.editPlace(me, id, body);
  }

  @Get("categories")
  async categories() {
    return this.svc.categories();
  }

  @Get("category-maps")
  async maps(@Query("provider") provider?: string, @Query("unmapped") unmapped?: string) {
    return unmapped === "true" ? this.svc.unmapped(provider) : this.svc.categoryMaps(provider);
  }

  @Put("category-maps")
  async setMap(@ViewerId() me: string, @Body(new ZodPipe(categoryMapSchema)) body: z.infer<typeof categoryMapSchema>) {
    return this.svc.setCategoryMap(me, body);
  }
}

