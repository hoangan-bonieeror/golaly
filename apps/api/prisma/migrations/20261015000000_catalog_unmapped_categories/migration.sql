-- Source categories with no TRIPLY mapping, counted in the background. Counting them live reads the jsonb of every
-- unmapped record (millions with real OpenStreetMap data: 20 s to 2 min), so the admin screen reads this summary.
-- Refreshed by catalog_scheduler after a sync finishes and by Admin → Categories → Recount.
CREATE TABLE "catalog_unmapped_categories" (
    "provider" TEXT NOT NULL,
    "external_category" TEXT NOT NULL,
    "records" INTEGER NOT NULL,

    CONSTRAINT "catalog_unmapped_categories_pkey" PRIMARY KEY ("provider", "external_category")
);

-- When each background summary was last computed.
CREATE TABLE "catalog_stats" (
    "key" TEXT NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_stats_pkey" PRIMARY KEY ("key")
);

-- Recount in one transaction (readers keep seeing the previous numbers until it commits). Returns the number of
-- categories, or -1 when another recount is already running.
CREATE OR REPLACE FUNCTION catalog_refresh_unmapped() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('catalog_refresh_unmapped')) THEN
    RETURN -1;
  END IF;
  DELETE FROM catalog_unmapped_categories;
  INSERT INTO catalog_unmapped_categories (provider, external_category, records)
  SELECT provider, normalized->'category_candidates'->>0, count(*)
  FROM place_sources
  WHERE category_id IS NULL AND normalized->'category_candidates'->>0 IS NOT NULL
  GROUP BY 1, 2;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO catalog_stats (key, refreshed_at) VALUES ('unmapped_categories', now())
  ON CONFLICT (key) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at;
  RETURN n;
END $$;
