-- Every province/city gets a destination page: the boundary import links curated destinations that ARE an
-- area (Hanoi ↔ Thành phố Hà Nội) and creates the missing ones.

ALTER TABLE "destinations" ADD COLUMN "represents_area_id" UUID;
ALTER TABLE "destinations" ADD COLUMN "auto_created" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "destinations_represents_area_id_key" ON "destinations"("represents_area_id");

ALTER TABLE "destinations" ADD CONSTRAINT "destinations_represents_area_id_fkey"
  FOREIGN KEY ("represents_area_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
