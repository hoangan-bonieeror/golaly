-- The admin place list is ordered newest first. Without this index Postgres scans and sorts the whole catalog
-- (~10 s for 1.8M places), long enough for the web proxy to drop the request.
-- CONCURRENTLY: don't block catalog writes while it builds. It must be the only statement in this file
-- (it can't run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "places_updated_at_id_idx" ON "places"("updated_at" DESC, "id");
