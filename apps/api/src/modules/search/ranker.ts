import { accentSearch, normalizeSearch } from "@triply/shared";
import { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * Relevance ranking with pg_trgm over the normalised (accent-free) `search_text` columns.
 *
 * - Every word of the query must match the start of a word ("pho" finds "phở bò", not "Sapo"), or —
 *   for words of 4+ letters — be a close fuzzy match (word_similarity ≥ threshold, so "tokio" → "tokyo").
 * - Words typed WITH diacritics must match them too where the table keeps accented text ("phở" finds
 *   "Phở Thìn", not "Phố cổ"); names written without any accents ("Pho 24") still match.
 * - Ranking: name equals the query › name starts with it › name contains it › text contains it, then how
 *   many words hit the name, then total similarity.
 *
 * All values are bound parameters — never string-concatenated into SQL.
 */
const THRESHOLD = 0.4;
const FUZZY_MIN = 4;
const MAX_WORDS = 6;

export interface QueryWord {
  /** Accent-free, as stored in `search_text`. */
  plain: string;
  /** As typed (lower-case), when it carries diacritics; otherwise null. */
  accented: string | null;
}

export function queryWords(q: string): QueryWord[] {
  const seen = new Set<string>();
  const out: QueryWord[] = [];
  for (const raw of accentSearch(q).split(/[^\p{L}\p{N}]+/u)) {
    const plain = normalizeSearch(raw).replace(/[^a-z0-9]/g, "");
    // Single characters only count when they're numbers ("quận 7").
    if (!plain || (plain.length < 2 && !/^\d$/.test(plain))) continue;
    const accented = raw !== plain ? raw : null;
    const key = accented ?? plain;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ plain, accented });
  }
  return out.slice(0, MAX_WORDS);
}

function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Columns of one table the matcher reads. Every value must be a trusted SQL expression. */
export interface TextColumns {
  /** Accent-free searchable text (name + context). */
  text: string;
  /** Accent-free name, for ranking name hits first. Defaults to `text`. */
  name?: string;
  /** Lower-cased accented text, for accent-aware matching; omit when the table has none. */
  accent?: string;
  /** Accented original name; with `accent`, names written without any diacritics still match plain words. */
  rawName?: string;
}

/** Word-start regex; words are [a-z0-9] or letters/digits only, so nothing needs escaping. */
const wordStart = (w: string) => `\\m${w}`;

function wordMatch(w: QueryWord, cols: TextColumns): Prisma.Sql {
  const text = Prisma.raw(cols.text);
  const plain = w.plain.length >= FUZZY_MIN
    ? Prisma.sql`(${text} ~ ${wordStart(w.plain)} OR word_similarity(${w.plain}, ${text}) >= ${THRESHOLD})`
    : Prisma.sql`${text} ~ ${wordStart(w.plain)}`;
  if (!w.accented || !cols.accent) return plain;
  const accent = Prisma.raw(cols.accent);
  const name = Prisma.raw(cols.name ?? cols.text);
  // A name with no diacritics at all ("Pho 24") can't tell "phở" from "phố", so it matches on the plain word.
  const unaccentedName = cols.rawName
    ? Prisma.sql` OR (lower(${Prisma.raw(cols.rawName)}) = ${name} AND ${name} ~ ${wordStart(w.plain)})`
    : Prisma.empty;
  return Prisma.sql`(${plain} AND (${accent} ~ ${wordStart(w.accented)}${unaccentedName}))`;
}

/** "Every word matches" predicate, for filtering inside another query (e.g. Explore's place browser). */
export function textMatch(q: string, cols: TextColumns): Prisma.Sql | null {
  const words = queryWords(q);
  if (!words.length) return null;
  return Prisma.join(words.map((w) => wordMatch(w, cols)), " AND ");
}

/** Relevance score for ORDER BY … DESC (higher is better); null when the query has no usable words. */
export function relevance(q: string, cols: TextColumns): Prisma.Sql | null {
  const words = queryWords(q);
  if (!words.length) return null;
  const text = Prisma.raw(cols.text);
  const name = Prisma.raw(cols.name ?? cols.text);
  const phrase = normalizeSearch(q);
  const tier = Prisma.sql`(CASE WHEN ${name} = ${phrase} THEN 4 WHEN ${name} LIKE ${likePattern(phrase).slice(1)} THEN 3
    WHEN ${name} LIKE ${likePattern(phrase)} THEN 2 WHEN ${text} LIKE ${likePattern(phrase)} THEN 1 ELSE 0 END)`;
  const nameHits = Prisma.join(words.map((w) => Prisma.sql`(${name} ~ ${wordStart(w.plain)})::int`), " + ");
  // Exact-accent hits in the name rank "Phở Thìn" above "Pho 24" for "phở".
  const accentHits = cols.accent && cols.rawName && words.some((w) => w.accented)
    ? Prisma.join(words.filter((w) => w.accented).map((w) => Prisma.sql`(lower(${Prisma.raw(cols.rawName!)}) ~ ${wordStart(w.accented!)})::int`), " + ")
    : Prisma.sql`0`;
  const sim = Prisma.join(words.map((w) => Prisma.sql`word_similarity(${w.plain}, ${text})`), " + ");
  return Prisma.sql`(${tier} * 100 + (${nameHits}) * 10 + (${accentHits}) * 5 + (${sim}))`;
}

/** Search columns of the places table, aliased `p`. */
export const PLACE_COLUMNS: TextColumns = { text: "p.search_text", name: "p.name_norm", accent: "p.search_accent", rawName: "p.name" };

export class TrigramRanker {
  constructor(private readonly prisma: PrismaService) {}

  private async run(table: string, idCol: string, cols: TextColumns, q: string, limit: number, extra: Prisma.Sql = Prisma.empty, tiebreak: Prisma.Sql = Prisma.empty) {
    const matches = textMatch(q, cols);
    const score = relevance(q, cols);
    if (!matches || !score) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT ${Prisma.raw(idCol)}::text AS id
      FROM ${Prisma.raw(table)}
      WHERE ${matches} ${extra}
      ORDER BY ${score} DESC ${tiebreak}
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  trips(q: string, limit: number) {
    return this.run(`"trips"`, `"id"`, { text: "search_text" }, q, limit, Prisma.sql`AND visibility = 'PUBLIC' AND deleted_at IS NULL`);
  }
  places(q: string, limit: number) {
    return this.run(`"places" p`, "p.id", PLACE_COLUMNS, q, limit, Prisma.sql`AND p.status = 'ACTIVE' AND p.merged_into_id IS NULL`, Prisma.sql`, p.rating DESC NULLS LAST, p.quality_score DESC`);
  }
  destinations(q: string, limit: number) {
    // Curated names are often English ("Hanoi"), so accents only help ranking here, never filter.
    return this.run(`"destinations" d`, "d.id", { text: "d.search_text" }, q, limit);
  }
  people(q: string, limit: number) {
    return this.run(`"user_profiles"`, `"user_id"`, { text: "search_text" }, q, limit, Prisma.sql`AND user_id IN (SELECT id FROM users WHERE deleted_at IS NULL)`);
  }
}

/** Re-orders rows to follow the ranked id list (no-op when ranks is null). */
export function byRank<T extends { id: string }>(rows: T[], ranks: string[] | null): T[] {
  if (!ranks) return rows;
  const pos = new Map(ranks.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}
