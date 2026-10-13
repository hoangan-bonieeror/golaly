-- Text search: places whose name starts with the query, found by an ordered walk of the name (search/ranker.ts).
-- COLLATE "C" because LIKE 'abc%' can only use a btree in C order (the database collation usually isn't).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "places_name_c_idx" ON "places" (("name_norm" COLLATE "C")) WHERE "merged_into_id" IS NULL;
