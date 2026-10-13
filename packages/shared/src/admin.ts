/**
 * Catalog admin (phase 3): the contract between /api/v1/admin/* and the admin screens.
 * Everything here is ADMIN-only; the API checks the role on every request.
 */
import { z } from "zod";

// ── cron (same grammar as pipelines/triply_catalog/cron.py) ──────────────────

const MACROS = new Set(["@hourly", "@daily", "@midnight", "@weekly", "@monthly"]);
const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const NAMES: Record<number, string[]> = {
  3: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  4: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
};

function cronValue(text: string, field: number): number | null {
  const names = NAMES[field];
  const i = names?.indexOf(text.toLowerCase()) ?? -1;
  if (i >= 0) return field === 3 ? i + 1 : i;
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** null when valid, else a message. 5 fields (UTC): minute hour day-of-month month day-of-week, or a macro. */
export function cronProblem(expr: string): string | null {
  const t = expr.trim();
  if (MACROS.has(t.toLowerCase())) return null;
  const parts = t.split(/\s+/);
  if (parts.length !== 5) return "A schedule has 5 fields: minute hour day-of-month month day-of-week (UTC).";
  for (let f = 0; f < 5; f++) {
    const [lo, hi] = RANGES[f]!;
    for (const part of parts[f]!.split(",")) {
      const [base = "", step] = part.split("/");
      if (step !== undefined && !/^[1-9]\d*$/.test(step)) return `Bad step in "${part}".`;
      let a: number | null;
      let b: number | null;
      if (base === "*") [a, b] = [lo, hi];
      else if (base.includes("-")) [a, b] = base.split("-", 2).map((x) => cronValue(x, f)) as [number | null, number | null];
      else [a, b] = [cronValue(base, f), step !== undefined ? hi : cronValue(base, f)];
      if (a === null || b === null || a < lo || b > hi || a > b) return `"${part}" is out of range ${lo}-${hi}.`;
    }
  }
  return null;
}

const cron = z
  .string()
  .trim()
  .max(100)
  .refine((v) => cronProblem(v) === null, { message: "That schedule isn't valid cron (e.g. \"0 3 * * mon\")." });

const bbox = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "A box is minLng,minLat,maxLng,maxLat.");

// ── inputs ───────────────────────────────────────────────────────────────────

export const syncJobSchema = z
  .object({
    name: z.string().trim().min(2, "Give the job a name.").max(80),
    area: z.string().trim().toLowerCase().max(80).nullish(),
    bbox: bbox.nullish(),
    providers: z.array(z.string().trim().min(1)).min(1, "Choose at least one source.").max(10),
    categoryKeys: z.array(z.string().trim().min(1)).max(80).default([]),
    schedule: cron.nullish(),
    enabled: z.boolean().default(true),
    photos: z.boolean().default(true),
  })
  .refine((j) => !!j.area || !!j.bbox, { message: "Choose an area (or a box).", path: ["area"] });
export type SyncJobInput = z.infer<typeof syncJobSchema>;
export const syncJobPatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  area: z.string().trim().toLowerCase().max(80).nullish(),
  bbox: bbox.nullish(),
  providers: z.array(z.string().trim().min(1)).min(1).max(10).optional(),
  categoryKeys: z.array(z.string().trim().min(1)).max(80).optional(),
  schedule: cron.nullish(),
  enabled: z.boolean().optional(),
  photos: z.boolean().optional(),
});
export type SyncJobPatch = z.infer<typeof syncJobPatchSchema>;
export const runJobSchema = z.object({ dryRun: z.boolean().default(false) });

export const mergeDecisionSchema = z.object({ decision: z.enum(["merge", "reject"]) });

/** Fields an admin can set on a place; each one set is locked against imports. `unlock` hands fields back to the sources. */
export const LOCKABLE_FIELDS = ["name", "address", "phone", "website", "opening_hours", "category", "coords"] as const;
export type LockableField = (typeof LOCKABLE_FIELDS)[number];
export const adminPlacePatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  website: z.url("That website isn't a valid URL.").max(500).nullable().optional(),
  openingHours: z.string().trim().max(255).nullable().optional(),
  categoryKey: z.string().trim().min(1).max(60).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  status: z.enum(["ACTIVE", "HIDDEN", "CLOSED"]).optional(),
  unlock: z.array(z.enum(LOCKABLE_FIELDS)).optional(),
});
export type AdminPlacePatch = z.infer<typeof adminPlacePatchSchema>;

export const categoryMapSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  externalCategory: z.string().trim().min(1).max(300),
  /** null removes the mapping. */
  categoryKey: z.string().trim().min(1).max(60).nullable(),
});

export const adminListQuerySchema = z.object({
  cursor: z.uuid("That page link is invalid.").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  q: z.string().trim().max(100).optional(),
  area: z.string().trim().toLowerCase().max(80).optional(),
  status: z.string().trim().max(30).optional(),
  category: z.string().trim().max(60).optional(),
  jobId: z.uuid().optional(),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

// ── views ────────────────────────────────────────────────────────────────────

export type SyncRunStatus = "queued" | "running" | "succeeded" | "partial" | "needs_review" | "failed" | "cancelled" | "dry_run";

export interface SyncProgress {
  total?: number;
  done?: number;
  failed?: number;
  current?: string;
}

export interface SyncJobView {
  id: string;
  name: string;
  area: string | null;
  bbox: string | null;
  providers: string[];
  categoryKeys: string[];
  schedule: string | null;
  enabled: boolean;
  photos: boolean;
  nextRunAt: string | null;
  lastRun: SyncRunSummary | null;
  createdAt: string;
}

export interface SyncRunSummary {
  id: string;
  jobId: string | null;
  jobName: string | null;
  trigger: string;
  status: SyncRunStatus | (string & {});
  area: string | null;
  providers: string[];
  progress: SyncProgress;
  errorCount: number;
  startedAt: string;
  finishedAt: string | null;
  requestedBy: string | null;
}

export interface SyncRunDetail extends SyncRunSummary {
  params: Record<string, unknown>;
  stats: Record<string, unknown>;
  error: string | null;
  cancelRequested: boolean;
  /** Failed, partial or cancelled real sync: "Resume" continues it where it stopped. */
  resumable: boolean;
}

export interface SyncRunErrorView {
  id: string;
  provider: string | null;
  externalId: string | null;
  stage: string;
  message: string;
  createdAt: string;
}

export interface AdminAreaView {
  slug: string;
  name: string;
  level: "COUNTRY" | "REGION" | "CITY" | "DISTRICT" | (string & {});
  countryCode: string;
  parentSlug: string | null;
  hasBoundary: boolean;
  bbox: [number, number, number, number] | null;
  places: number;
  /** Children (provinces of a country). */
  regions: number;
  lastRun: SyncRunSummary | null;
}

export interface MergePlaceSide {
  id: string;
  name: string;
  address: string;
  categoryKey: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  sources: { provider: string; externalId: string }[];
  links: number;
}

export interface MergeCandidateView {
  id: string;
  score: number;
  signals: Record<string, unknown>;
  status: "PENDING" | "MERGED" | "REJECTED";
  a: MergePlaceSide;
  b: MergePlaceSide;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface AdminPlaceView {
  id: string;
  name: string;
  address: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  areaName: string | null;
  status: "ACTIVE" | "CLOSED" | "HIDDEN";
  qualityScore: number;
  lockedFields: string[];
  sourceCount: number;
  mergedIntoId: string | null;
  updatedAt: string;
}

export interface AdminPlaceDetail extends AdminPlaceView {
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  fieldSources: Record<string, string>;
  sources: {
    id: string;
    provider: string;
    externalId: string;
    name: string | null;
    categoryKey: string | null;
    lat: number;
    lng: number;
    lastSeenAt: string;
    missingRuns: number;
    operatingStatus: string;
  }[];
  history: { kind: "edit" | "merge" | "unmerge"; at: string; actor: string | null; detail: Record<string, unknown> }[];
  merges: { id: string; otherId: string; otherName: string; role: "winner" | "loser"; at: string; undoneAt: string | null }[];
}

export interface UnmappedCategoryView {
  provider: string;
  externalCategory: string;
  records: number;
}

export interface UnmappedCategoriesView {
  items: UnmappedCategoryView[];
  /** When the background count last ran; null = never (press Recount, or it runs after the next sync). */
  refreshedAt: string | null;
  /** A recount is running now. */
  refreshing: boolean;
}

export interface CategoryMapView {
  provider: string;
  externalCategory: string;
  categoryKey: string;
}

export interface AdminCategoryView {
  key: string;
  labelEn: string;
  labelVi: string;
  parentKey: string | null;
  places: number;
  maps: number;
}
