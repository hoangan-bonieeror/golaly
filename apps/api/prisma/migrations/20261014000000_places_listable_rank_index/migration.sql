-- Explore, destination pages and "recommended" lists: active places, best rated first. Without it Postgres sorts the
-- whole catalog for every Explore visit (~1.5 s at 1.8M places). `status` is a column rather than part of the WHERE:
-- Prisma sends the enum as CAST($1 AS "PlaceStatus"), which the planner can't match against a partial predicate.
-- CONCURRENTLY: doesn't block catalog writes while it builds; it must be the only statement in its file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "places_listable_rank_idx" ON "places" ("status", "rating" DESC NULLS LAST, "quality_score" DESC, "name") WHERE "merged_into_id" IS NULL;
