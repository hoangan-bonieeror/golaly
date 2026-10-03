-- Photos on place pages: user uploads and open-licence imports (Wikimedia Commons), with credits.

-- Images imported from open sources belong to no user.
ALTER TABLE "media" ALTER COLUMN "owner_id" DROP NOT NULL;

ALTER TYPE "ReportTarget" ADD VALUE 'PLACE_PHOTO';

CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'APPROVED', 'HIDDEN');

CREATE TABLE "place_photos" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT,
    "media_id" UUID,
    "remote_url" TEXT,
    "page_url" TEXT,
    "title" TEXT,
    "author" TEXT,
    "author_url" TEXT,
    "license" TEXT,
    "license_url" TEXT,
    "caption" TEXT,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uploaded_by_id" UUID,
    "post_id" UUID,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "ingest_attempts" INTEGER NOT NULL DEFAULT 0,
    "ingest_error" TEXT,
    "next_ingest_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "place_photos_place_id_status_score_idx" ON "place_photos"("place_id", "status", "score");
CREATE INDEX "place_photos_status_created_at_idx" ON "place_photos"("status", "created_at");
CREATE INDEX "place_photos_media_id_idx" ON "place_photos"("media_id");
CREATE UNIQUE INDEX "place_photos_place_id_source_source_id_key" ON "place_photos"("place_id", "source", "source_id");
CREATE UNIQUE INDEX "place_photos_place_id_media_id_key" ON "place_photos"("place_id", "media_id");
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
