-- Counts of published places per area / per category (Explore facets and totals, the Where picker, admin Areas and
-- Categories) as index-only scans instead of reading the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "places_area_category_idx" ON "places" ("area_id", "category_id") WHERE "status" = 'ACTIVE' AND "merged_into_id" IS NULL;
