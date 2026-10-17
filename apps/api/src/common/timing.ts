import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../config/env";

/**
 * Per-request timing (performance work, 2026-10): how long the API spent on a request and how much of that was
 * database time, so a slow page can be pinned on queries or on code.
 *
 * - `Server-Timing: app;dur=…, db;dur=…;desc="N queries"` on every response (not on /auth/*: query counts there
 *   would tell whether an account exists). Browsers show it in DevTools → Network → Timing, and pages on WEB_ORIGIN
 *   can read it (Timing-Allow-Origin).
 * - Requests slower than SLOW_REQUEST_MS are logged (method, route pattern, status, times — never the query string).
 * - Recent durations per route are kept in memory for the admin endpoint GET /admin/diagnostics/timings.
 *
 * DB time is wall-clock time with at least one statement in flight (see timedAdapter in PrismaService) — Prisma runs
 * an include's queries in parallel, so summing them would overstate it. It includes waiting for a pooled connection.
 */
export interface RequestTiming {
  db: number;
  queries: number;
  /** Statements in flight right now, and when that number last rose from zero. */
  active: number;
  busySince: number;
}

const store = new AsyncLocalStorage<RequestTiming>();
const log = new Logger("Timing");

/** Called by the database adapter wrapper around every statement; returns the matching "done" callback. */
export function queryStarted(): () => void {
  const t = store.getStore();
  if (!t) return () => undefined;
  t.queries += 1;
  if (t.active++ === 0) t.busySince = performance.now();
  return () => {
    if (--t.active === 0) t.db += performance.now() - t.busySince;
  };
}

// ── Recent samples per route (bounded) ───────────────────────────────────────────────────────────────────────────
const SAMPLES_PER_ROUTE = 300;
const MAX_ROUTES = 300;
type Sample = { ms: number; db: number; queries: number };
const samples = new Map<string, Sample[]>();
const since = new Date();

function remember(route: string, s: Sample) {
  let list = samples.get(route);
  if (!list) {
    if (samples.size >= MAX_ROUTES) return;
    samples.set(route, (list = []));
  }
  list.push(s);
  if (list.length > SAMPLES_PER_ROUTE) list.shift();
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Per-route summary of the recent samples, slowest (p95) first. */
export function timingSummary() {
  const routes = [...samples].map(([route, list]) => {
    const ms = list.map((s) => s.ms).sort((a, b) => a - b);
    const avg = (f: (s: Sample) => number) => list.reduce((a, s) => a + f(s), 0) / list.length;
    return { route, count: list.length, p50: r1(pct(ms, 0.5)), p95: r1(pct(ms, 0.95)), max: r1(ms[ms.length - 1]), avgDb: r1(avg((s) => s.db)), avgQueries: r1(avg((s) => s.queries)) };
  });
  return { since: since.toISOString(), slowRequestMs: env.SLOW_REQUEST_MS, routes: routes.sort((a, b) => b.p95 - a.p95) };
}

// ── Middleware ───────────────────────────────────────────────────────────────────────────────────────────────────
export function timingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  const t: RequestTiming = { db: 0, queries: 0, active: 0, busySince: 0 };
  const elapsed = () => Number(process.hrtime.bigint() - start) / 1e6;
  const hidden = req.path.startsWith("/api/v1/auth/");

  // Headers are written once: set Server-Timing at that moment, so it covers everything up to the response.
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => Response;
  res.writeHead = ((...args: unknown[]) => {
    if (!hidden && !res.headersSent) {
      res.setHeader("Server-Timing", `app;dur=${elapsed().toFixed(1)}, db;dur=${t.db.toFixed(1)};desc="${t.queries} queries"`);
      res.setHeader("Timing-Allow-Origin", env.WEB_ORIGIN);
    }
    return writeHead(...args);
  }) as Response["writeHead"];

  res.on("finish", () => {
    const ms = elapsed();
    // The route pattern (/api/v1/trips/:id), not the URL: no ids or search terms in logs or summaries.
    const pattern = (req.route as { path?: string } | undefined)?.path;
    const route = `${req.method} ${pattern ?? (res.statusCode === 404 ? "(not found)" : req.baseUrl || "(static)")}`;
    remember(route, { ms, db: t.db, queries: t.queries });
    if (ms >= env.SLOW_REQUEST_MS) log.warn(`slow ${route} → ${res.statusCode} in ${ms.toFixed(0)} ms (db ${t.db.toFixed(0)} ms, ${t.queries} queries)`);
  });

  store.run(t, next);
}
