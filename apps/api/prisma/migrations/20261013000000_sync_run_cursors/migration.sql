-- Resume (catalog phase 3): where each partition of a run got to. Written in the same transaction as the batch it
-- describes, so after a crash the cursor never claims a batch that wasn't committed. A retried task skips the
-- batches already loaded (and whole partitions already done) and keeps the totals it had.
CREATE TABLE "sync_run_cursors" (
    "run_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "partition_key" TEXT NOT NULL,
    "batches" INTEGER NOT NULL DEFAULT 0,
    "last_key" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_run_cursors_pkey" PRIMARY KEY ("run_id", "provider", "partition_key")
);
ALTER TABLE "sync_run_cursors" ADD CONSTRAINT "sync_run_cursors_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
