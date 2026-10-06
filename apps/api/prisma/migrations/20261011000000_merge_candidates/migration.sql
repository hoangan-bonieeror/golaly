-- Catalog phase 2: scored duplicate detection. Pairs scoring between the review and auto thresholds wait in
-- merge_candidates; every merge (automatic or decided) is recorded in place_merges with what it moved, so it can
-- be undone exactly.

CREATE TYPE "MergeStatus" AS ENUM ('PENDING', 'MERGED', 'REJECTED');

CREATE TABLE "merge_candidates" (
    "id" UUID NOT NULL,
    "place_a" UUID NOT NULL,
    "place_b" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '{}',
    "status" "MergeStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merge_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merge_candidates_ordered" CHECK ("place_a" < "place_b")
);
CREATE UNIQUE INDEX "merge_candidates_place_a_place_b_key" ON "merge_candidates"("place_a", "place_b");
CREATE INDEX "merge_candidates_place_b_idx" ON "merge_candidates"("place_b");
CREATE INDEX "merge_candidates_status_score_idx" ON "merge_candidates"("status", "score");
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_place_a_fkey" FOREIGN KEY ("place_a") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merge_candidates" ADD CONSTRAINT "merge_candidates_place_b_fkey" FOREIGN KEY ("place_b") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "place_merges" (
    "id" UUID NOT NULL,
    "winner_id" UUID NOT NULL,
    "loser_id" UUID NOT NULL,
    "score" DOUBLE PRECISION,
    "signals" JSONB NOT NULL DEFAULT '{}',
    -- ids of what moved from the loser to the winner: {"sources": [...], "items": [...], "saved": [...], "saved_dropped": [...], "photos": [...]}
    "moved" JSONB NOT NULL DEFAULT '{}',
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "undone_by" TEXT,
    CONSTRAINT "place_merges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "place_merges_winner_id_idx" ON "place_merges"("winner_id");
CREATE INDEX "place_merges_loser_id_idx" ON "place_merges"("loser_id");
ALTER TABLE "place_merges" ADD CONSTRAINT "place_merges_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_merges" ADD CONSTRAINT "place_merges_loser_id_fkey" FOREIGN KEY ("loser_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
