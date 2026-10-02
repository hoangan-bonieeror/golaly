-- Place catalog (design doc "Catalog địa điểm & công cụ đồng bộ dữ liệu", phase 1).
-- Needs PostGIS: the Docker image is postgis/postgis; native installs need the postgis package.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enums
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "PlaceStatus" AS ENUM ('ACTIVE', 'CLOSED', 'HIDDEN');
CREATE TYPE "GeoAreaLevel" AS ENUM ('COUNTRY', 'REGION', 'CITY', 'DISTRICT');

-- Users: admin role
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- Destinations ↔ administrative areas
ALTER TABLE "destinations" ADD COLUMN "area_id" UUID;

-- Places: existing ids and rows are kept; imported places may sit outside any curated destination.
ALTER TABLE "places" DROP CONSTRAINT "places_destination_id_fkey";
ALTER TABLE "places" ALTER COLUMN "destination_id" DROP NOT NULL,
ADD COLUMN "name_norm" TEXT NOT NULL DEFAULT '',
ADD COLUMN "category_id" UUID,
ADD COLUMN "area_id" UUID,
ADD COLUMN "location" geography(Point, 4326),
ADD COLUMN "phone" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "opening_hours" TEXT,
ADD COLUMN "status" "PlaceStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "locked_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "field_sources" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "merged_into_id" UUID,
ADD COLUMN "last_seen_at" TIMESTAMP(3),
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "geo_areas" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "level" "GeoAreaLevel" NOT NULL,
    "country_code" TEXT NOT NULL,
    "iso_code" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "min_lng" DOUBLE PRECISION,
    "min_lat" DOUBLE PRECISION,
    "max_lng" DOUBLE PRECISION,
    "max_lat" DOUBLE PRECISION,
    "boundary" geometry(MultiPolygon, 4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_areas_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "geo_area_names" (
    "area_id" UUID NOT NULL,
    "lang" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "geo_area_names_pkey" PRIMARY KEY ("area_id","lang")
);
-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "key" TEXT NOT NULL,
    "label_vi" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "item_type" "ItemType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "category_maps" (
    "provider" TEXT NOT NULL,
    "external_category" TEXT NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "category_maps_pkey" PRIMARY KEY ("provider","external_category")
);
-- CreateTable
CREATE TABLE "place_sources" (
    "id" UUID NOT NULL,
    "place_id" UUID,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "category_id" UUID,
    "area_id" UUID,
    "license" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "operating_status" TEXT NOT NULL DEFAULT 'open',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_id" UUID,
    "changed_run_id" UUID,
    "missing_runs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "place_sources_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "place_names" (
    "place_id" UUID NOT NULL,
    "lang" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'primary',
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "place_names_pkey" PRIMARY KEY ("place_id","lang","kind")
);
-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "places_area_id_category_id_status_idx" ON "places"("area_id", "category_id", "status");
CREATE INDEX "places_name_norm_idx" ON "places"("name_norm");
CREATE UNIQUE INDEX "geo_areas_slug_key" ON "geo_areas"("slug");
CREATE INDEX "geo_areas_parent_id_level_idx" ON "geo_areas"("parent_id", "level");
CREATE INDEX "geo_areas_country_code_level_idx" ON "geo_areas"("country_code", "level");
CREATE UNIQUE INDEX "geo_areas_source_external_id_key" ON "geo_areas"("source", "external_id");
CREATE UNIQUE INDEX "categories_key_key" ON "categories"("key");
CREATE INDEX "place_sources_place_id_idx" ON "place_sources"("place_id");
CREATE INDEX "place_sources_provider_area_id_idx" ON "place_sources"("provider", "area_id");
CREATE INDEX "place_sources_changed_run_id_idx" ON "place_sources"("changed_run_id");
CREATE UNIQUE INDEX "place_sources_provider_external_id_key" ON "place_sources"("provider", "external_id");
CREATE INDEX "sync_runs_started_at_idx" ON "sync_runs"("started_at");

-- Foreign keys
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "geo_areas" ADD CONSTRAINT "geo_areas_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "geo_area_names" ADD CONSTRAINT "geo_area_names_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "geo_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_maps" ADD CONSTRAINT "category_maps_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_sources" ADD CONSTRAINT "place_sources_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "place_sources" ADD CONSTRAINT "place_sources_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "place_sources" ADD CONSTRAINT "place_sources_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "place_names" ADD CONSTRAINT "place_names_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Spatial indexes (declared in schema.prisma as type: Gist) and the lat/lng → geography trigger
-- (triggers are not expressible in schema.prisma; Prisma leaves them alone).
CREATE INDEX "places_location_gist" ON "places" USING GIST ("location");
CREATE INDEX "place_sources_location_gist" ON "place_sources" USING GIST ("location");
CREATE INDEX "geo_areas_boundary_gist" ON "geo_areas" USING GIST ("boundary");

CREATE FUNCTION triply_sync_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END $$;

CREATE TRIGGER places_sync_location BEFORE INSERT OR UPDATE OF lat, lng ON "places"
  FOR EACH ROW EXECUTE FUNCTION triply_sync_location();
CREATE TRIGGER place_sources_sync_location BEFORE INSERT OR UPDATE OF lat, lng ON "place_sources"
  FOR EACH ROW EXECUTE FUNCTION triply_sync_location();

-- Backfill existing places.
UPDATE "places" SET "location" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography;
