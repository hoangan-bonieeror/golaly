-- The same order inside one province / city (Explore → an area, area destination pages): read in order, no sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "places_area_rank_idx" ON "places" ("area_id", "status", "rating" DESC NULLS LAST, "quality_score" DESC, "name") WHERE "merged_into_id" IS NULL;
