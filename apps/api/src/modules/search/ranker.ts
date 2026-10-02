import { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * Relevance ranking with pg_trgm over the normalised `search_text` columns.
 * Every word of the query (2+ chars) must match — either as a substring or as a close
 * fuzzy match (word_similarity ≥ threshold, so "tokio" → "tokyo", "kyotto" → "kyoto").
 * Rows containing the whole phrase rank first, then by total similarity.
 * All values are bound parameters — never string-concatenated into SQL.
 */
const THRESHOLD = 0.4;
const MAX_WORDS = 6;

export function queryWords(q: string) {
  return [...new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2))].slice(0, MAX_WORDS);
}

function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export class TrigramRanker {
  constructor(private readonly prisma: PrismaService) {}

  private async run(table: "trips" | "places" | "destinations" | "user_profiles", idCol: "id" | "user_id", q: string, limit: number, extra: Prisma.Sql = Prisma.empty) {
    const words = queryWords(q);
    if (!words.length) return [];
    const phrase = likePattern(q);
    const matches = Prisma.join(
      words.map((w) => Prisma.sql`(search_text LIKE ${likePattern(w)} OR word_similarity(${w}, search_text) >= ${THRESHOLD})`),
      " AND ",
    );
    const score = Prisma.join(words.map((w) => Prisma.sql`word_similarity(${w}, search_text)`), " + ");
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT ${Prisma.raw(`"${idCol}"`)}::text AS id
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${matches} ${extra}
      ORDER BY (search_text LIKE ${phrase}) DESC, (${score}) DESC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  trips(q: string, limit: number) {
    return this.run("trips", "id", q, limit, Prisma.sql`AND visibility = 'PUBLIC' AND deleted_at IS NULL`);
  }
  places(q: string, limit: number) {
    return this.run("places", "id", q, limit);
  }
  destinations(q: string, limit: number) {
    return this.run("destinations", "id", q, limit);
  }
  people(q: string, limit: number) {
    return this.run("user_profiles", "user_id", q, limit, Prisma.sql`AND user_id IN (SELECT id FROM users WHERE deleted_at IS NULL)`);
  }
}

/** Re-orders rows to follow the ranked id list (no-op when ranks is null). */
export function byRank<T extends { id: string }>(rows: T[], ranks: string[] | null): T[] {
  if (!ranks) return rows;
  const pos = new Map(ranks.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}
