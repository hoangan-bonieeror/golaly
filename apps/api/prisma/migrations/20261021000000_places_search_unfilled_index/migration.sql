-- The search backfill (SearchIndexService, on every API start) looks for places whose search columns are empty.
-- Without an index that's a full read of the catalog at each boot — seconds of database work, on a small database
-- right when a woken-up API is answering its first visitors. This partial index holds only those rows (normally
-- none), so the check is instant. The backfill writes its condition as literal '' so the planner can use it.
-- CONCURRENTLY: doesn't block catalog writes while it builds; it must be the only statement in its file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "places_search_unfilled_idx" ON "places" ("id") WHERE "search_text" = '' OR "search_accent" = '';
