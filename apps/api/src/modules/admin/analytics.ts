import { Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import {
  analyticsQuerySchema,
  type AnalyticsDay,
  type AnalyticsDestinationRow,
  type AnalyticsFunnelRow,
  type AnalyticsKpi,
  type AnalyticsOverview,
  type AnalyticsRange,
} from "@triply/shared";
import { ViewerId } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { AdminGuard } from "./catalog";

/** Results are shared by every admin for a few minutes: the queries scan whole tables. */
const CACHE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

type DailyRow = { date: string; signups: number; active: number; trips: number; happened: number; collab: number };

/**
 * Admin analytics, phase 1: computed live from the app's own tables, aggregated only (counts — no names,
 * no e-mails, nothing about what a private trip contains). Days are UTC. "Active" means the person did
 * something that leaves a row: changed a trip (trip_events), signed in (sessions), posted, commented or liked.
 *
 * Phase 2 moves the trend numbers to nightly marts (dbt) built from product events; this endpoint keeps
 * serving the same shape.
 */
@Injectable()
export class AnalyticsService {
  private cache = new Map<AnalyticsRange, { at: number; data: AnalyticsOverview }>();

  constructor(private readonly prisma: PrismaService) {}

  async overview(days: AnalyticsRange, now = new Date()): Promise<AnalyticsOverview> {
    const hit = this.cache.get(days);
    if (hit && now.getTime() - hit.at < CACHE_MS) return hit.data;
    const data = await this.compute(days, now);
    this.cache.set(days, { at: now.getTime(), data });
    return data;
  }

  /** For tests. */
  clearCache() {
    this.cache.clear();
  }

  private async compute(days: AnalyticsRange, now: Date): Promise<AnalyticsOverview> {
    const today = new Date(`${iso(now)}T00:00:00Z`);
    const to = iso(today);
    const from = iso(new Date(today.getTime() - (days - 1) * DAY_MS));
    const prevFrom = iso(new Date(today.getTime() - (2 * days - 1) * DAY_MS));

    const [daily, distinct, funnel, destinations, catalog, ops] = await Promise.all([
      this.daily(prevFrom, to),
      this.distinctActive(prevFrom, from, to),
      this.funnel(from, to),
      this.destinations(from, to),
      this.catalog(),
      this.ops(from, to),
    ]);

    const cur = daily.filter((d) => d.date >= from);
    const prev = daily.filter((d) => d.date < from);
    const sum = (rows: DailyRow[], k: keyof Omit<DailyRow, "date">) => rows.reduce((n, r) => n + r[k], 0);
    const rate = (rows: DailyRow[]) => {
      const trips = sum(rows, "trips");
      return trips ? Math.round((sum(rows, "collab") / trips) * 1000) / 10 : 0;
    };
    const kpis: AnalyticsKpi[] = [
      { key: "newUsers", value: sum(cur, "signups"), previous: sum(prev, "signups"), series: cur.map((d) => d.signups) },
      { key: "activeUsers", value: distinct.current, previous: distinct.previous, series: cur.map((d) => d.active) },
      { key: "tripsCreated", value: sum(cur, "trips"), previous: sum(prev, "trips"), series: cur.map((d) => d.trips) },
      { key: "collabRate", value: rate(cur), previous: rate(prev), series: null },
      { key: "tripsHappened", value: sum(cur, "happened"), previous: sum(prev, "happened"), series: cur.map((d) => d.happened) },
    ];

    return {
      range: { days, from, to },
      generatedAt: now.toISOString(),
      kpis,
      daily: cur.map(({ date, signups, active, trips }): AnalyticsDay => ({ date, signups, active, trips })),
      funnel,
      topDestinations: destinations,
      catalog,
      ops,
    };
  }

  /** Per UTC day over both periods (the previous one first). */
  private async daily(start: string, end: string): Promise<DailyRow[]> {
    return this.prisma.$queryRaw<DailyRow[]>`
      WITH d AS (SELECT generate_series(${start}::date, ${end}::date, interval '1 day')::date AS day),
      s AS (SELECT created_at::date AS day, count(*)::int AS n FROM users WHERE created_at >= ${start}::date GROUP BY 1),
      t AS (SELECT created_at::date AS day, count(*)::int AS n FROM trips WHERE created_at >= ${start}::date GROUP BY 1),
      c AS (
        SELECT tr.created_at::date AS day, count(*)::int AS n FROM trips tr
        WHERE tr.created_at >= ${start}::date AND (SELECT count(*) FROM trip_members m WHERE m.trip_id = tr.id) >= 2
        GROUP BY 1
      ),
      h AS (
        SELECT start_date AS day, count(*)::int AS n FROM trips
        WHERE deleted_at IS NULL AND start_date BETWEEN ${start}::date AND ${end}::date GROUP BY 1
      ),
      act AS (${sqlActivity(start)}),
      a AS (SELECT day, count(DISTINCT uid)::int AS n FROM act GROUP BY 1)
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
        coalesce(s.n, 0) AS signups, coalesce(a.n, 0) AS active, coalesce(t.n, 0) AS trips,
        coalesce(h.n, 0) AS happened, coalesce(c.n, 0) AS collab
      FROM d LEFT JOIN s USING (day) LEFT JOIN a USING (day) LEFT JOIN t USING (day) LEFT JOIN h USING (day) LEFT JOIN c USING (day)
      ORDER BY d.day`;
  }

  /** Distinct active people across each whole period (not the sum of the daily counts). */
  private async distinctActive(start: string, from: string, end: string) {
    const [r] = await this.prisma.$queryRaw<{ current: number; previous: number }[]>`
      WITH act AS (${sqlActivity(start)})
      SELECT count(DISTINCT uid) FILTER (WHERE day >= ${from}::date AND day <= ${end}::date)::int AS current,
             count(DISTINCT uid) FILTER (WHERE day < ${from}::date)::int AS previous
      FROM act`;
    return r ?? { current: 0, previous: 0 };
  }

  /** People who signed up in the period, and how many of them got to each step (at any time since). */
  private async funnel(from: string, to: string): Promise<AnalyticsFunnelRow[]> {
    const [r] = await this.prisma.$queryRaw<Record<string, number>[]>`
      WITH u AS (SELECT id FROM users WHERE created_at >= ${from}::date AND created_at < ${to}::date + 1)
      SELECT
        (SELECT count(*) FROM u)::int AS registered,
        (SELECT count(*) FROM u WHERE EXISTS (SELECT 1 FROM trips t WHERE t.owner_id = u.id))::int AS "createdTrip",
        (SELECT count(*) FROM u WHERE EXISTS (SELECT 1 FROM itinerary_items i WHERE i.added_by = u.id))::int AS "plannedStop",
        (SELECT count(*) FROM u WHERE EXISTS (
          SELECT 1 FROM trip_members m WHERE m.user_id = u.id
            AND (SELECT count(*) FROM trip_members m2 WHERE m2.trip_id = m.trip_id) >= 2))::int AS collaborated,
        (SELECT count(*) FROM u WHERE EXISTS (
          SELECT 1 FROM trip_members m JOIN trips t ON t.id = m.trip_id
          WHERE m.user_id = u.id AND t.deleted_at IS NULL AND t.start_date <= current_date))::int AS "tripHappened",
        (SELECT count(*) FROM u WHERE EXISTS (
          SELECT 1 FROM trip_events e WHERE e.actor_id = u.id AND e.type = 'item.status'))::int AS "markedStop",
        (SELECT count(*) FROM u WHERE
          EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id AND p.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM trips t WHERE t.owner_id = u.id AND t.visibility = 'PUBLIC' AND t.deleted_at IS NULL))::int AS shared`;
    const steps = ["registered", "createdTrip", "plannedStop", "collaborated", "tripHappened", "markedStop", "shared"] as const;
    return steps.map((step) => ({ step, users: Number(r?.[step] ?? 0) }));
  }

  /** Where the trips created in the period go. */
  private destinations(from: string, to: string) {
    return this.prisma.$queryRaw<AnalyticsDestinationRow[]>`
      SELECT d.slug, d.name, d.country, count(DISTINCT t.id)::int AS trips
      FROM trips t
      JOIN trip_destinations td ON td.trip_id = t.id
      JOIN destinations d ON d.id = td.destination_id
      WHERE t.created_at >= ${from}::date AND t.created_at < ${to}::date + 1 AND t.deleted_at IS NULL
      GROUP BY d.id
      ORDER BY trips DESC, d.name
      LIMIT 8`;
  }

  private async catalog(): Promise<AnalyticsOverview["catalog"]> {
    const [counts] = await this.prisma.$queryRaw<{ places: number; withPhoto: number; withHours: number; photosPending: number; duplicatesPending: number }[]>`
      SELECT
        count(*)::int AS places,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM place_photos ph WHERE ph.place_id = p.id AND ph.status = 'APPROVED' AND ph.media_id IS NOT NULL))::int AS "withPhoto",
        count(*) FILTER (WHERE p.opening_hours IS NOT NULL)::int AS "withHours",
        (SELECT count(*) FROM place_photos WHERE status = 'PENDING')::int AS "photosPending",
        (SELECT count(*) FROM merge_candidates WHERE status = 'PENDING')::int AS "duplicatesPending"
      FROM places p
      WHERE p.status = 'ACTIVE' AND p.merged_into_id IS NULL`;
    const last = await this.prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true } });
    return {
      ...(counts ?? { places: 0, withPhoto: 0, withHours: 0, photosPending: 0, duplicatesPending: 0 }),
      lastRun: last ? { status: last.status, startedAt: last.startedAt.toISOString(), finishedAt: last.finishedAt?.toISOString() ?? null } : null,
    };
  }

  private async ops(from: string, to: string): Promise<AnalyticsOverview["ops"]> {
    const [r] = await this.prisma.$queryRaw<AnalyticsOverview["ops"][]>`
      SELECT
        (SELECT count(*) FROM users WHERE locked_until > now())::int AS "lockedNow",
        (SELECT count(*) FROM audit_logs WHERE action = 'user.login_locked'
           AND created_at >= ${from}::date AND created_at < ${to}::date + 1)::int AS "loginLocks",
        (SELECT count(*) FROM audit_logs WHERE action = 'session.reuse_detected'
           AND created_at >= ${from}::date AND created_at < ${to}::date + 1)::int AS "tokenReuse",
        (SELECT count(*) FROM sessions WHERE revoked_at >= ${from}::date AND revoked_at < ${to}::date + 1)::int AS "revokedSessions",
        (SELECT count(*) FROM reports WHERE created_at >= ${from}::date AND created_at < ${to}::date + 1)::int AS reports`;
    return r ?? { lockedNow: 0, loginLocks: 0, tokenReuse: 0, revokedSessions: 0, reports: 0 };
  }
}

/** One row per action someone took since `start`: (uid, day). */
function sqlActivity(start: string) {
  return Prisma.sql`
    SELECT actor_id AS uid, at::date AS day FROM trip_events WHERE at >= ${start}::date AND actor_id IS NOT NULL
    UNION ALL SELECT user_id, created_at::date FROM sessions WHERE created_at >= ${start}::date
    UNION ALL SELECT user_id, created_at::date FROM posts WHERE created_at >= ${start}::date
    UNION ALL SELECT user_id, created_at::date FROM post_comments WHERE created_at >= ${start}::date
    UNION ALL SELECT user_id, created_at::date FROM post_likes WHERE created_at >= ${start}::date`;
}

@Controller("admin/analytics")
@UseGuards(AdminGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  @Get("overview")
  async overview(@ViewerId() me: string, @Query(new ZodPipe(analyticsQuerySchema)) q: { days: AnalyticsRange }) {
    const data = await this.analytics.overview(q.days);
    // Who looked at the numbers, and when (aggregates only, but still worth a trail).
    await this.audit.log(me, "admin.analytics.viewed", "user", me, { days: q.days });
    return data;
  }
}
