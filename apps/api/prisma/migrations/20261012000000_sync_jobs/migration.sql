-- Catalog phase 3: scheduled sync jobs, per-run progress and errors, admin edit history, realtime run updates,
-- and merges/unmerges as database functions (shared by the pipeline and the admin API).

CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    -- geo area slug ("vn", "vn-da-nang") or destination slug ("hoi-an"); or a bbox "minLng,minLat,maxLng,maxLat"
    "area" TEXT,
    "bbox" TEXT,
    "providers" TEXT[] NOT NULL DEFAULT ARRAY['overture', 'osm']::TEXT[],
    -- empty = every category; otherwise TRIPLY group or category keys ("food", "sights.historic")
    "category_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- 5-field cron in UTC; NULL = run by hand only
    "schedule" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "photos" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB NOT NULL DEFAULT '{}',
    "next_run_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_jobs_scope" CHECK ("area" IS NOT NULL OR "bbox" IS NOT NULL)
);
CREATE UNIQUE INDEX "sync_jobs_name_key" ON "sync_jobs"("name");
CREATE INDEX "sync_jobs_enabled_next_run_at_idx" ON "sync_jobs"("enabled", "next_run_at");
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sync_runs"
    ADD COLUMN "job_id" UUID,
    -- {"total": 34, "done": 12, "failed": 1, "current": "osm/vn-da-nang"}
    ADD COLUMN "progress" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "requested_by" UUID;
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "sync_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sync_runs_job_id_started_at_idx" ON "sync_runs"("job_id", "started_at");
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");

CREATE TABLE "sync_run_errors" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "provider" TEXT,
    -- a record id, or the partition key when a whole partition failed
    "external_id" TEXT,
    -- extract | load | publish | photos
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_run_errors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_run_errors_run_id_idx" ON "sync_run_errors"("run_id");
ALTER TABLE "sync_run_errors" ADD CONSTRAINT "sync_run_errors_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "place_edits" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old" JSONB,
    "new" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "place_edits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "place_edits_place_id_created_at_idx" ON "place_edits"("place_id", "created_at");
ALTER TABLE "place_edits" ADD CONSTRAINT "place_edits_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "place_edits" ADD CONSTRAINT "place_edits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Places whose published fields must be recomputed by the pipeline (after an admin merge / unmerge).
ALTER TABLE "places" ADD COLUMN "needs_publish" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "places_needs_publish_idx" ON "places"("needs_publish") WHERE "needs_publish";

-- Realtime: every change to a run is announced; the API LISTENs and forwards it to the admin screens.
CREATE OR REPLACE FUNCTION sync_runs_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('sync_run', json_build_object('id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status, 'progress', NEW.progress)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sync_runs_notify AFTER INSERT OR UPDATE ON "sync_runs" FOR EACH ROW EXECUTE FUNCTION sync_runs_notify();

-- The place more of TRIPLY points at survives a merge: itinerary items, saves, approved photos; then more source
-- records, a curated (manual) one, the older one.
CREATE OR REPLACE FUNCTION catalog_pick_winner(a UUID, b UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT p.id FROM places p
  WHERE p.id IN (a, b)
  ORDER BY
    (SELECT count(*) FROM itinerary_items i WHERE i.place_id = p.id)
      + (SELECT count(*) FROM saved_places s WHERE s.place_id = p.id)
      + (SELECT count(*) FROM place_photos ph WHERE ph.place_id = p.id AND ph.status = 'APPROVED') DESC,
    (SELECT count(*) FROM place_sources s WHERE s.place_id = p.id) DESC,
    EXISTS (SELECT 1 FROM place_sources s WHERE s.place_id = p.id AND s.provider = 'manual') DESC,
    p.created_at, p.id
  LIMIT 1
$$;

-- Moves everything from the loser to the winner and records it in place_merges (for an exact undo).
CREATE OR REPLACE FUNCTION catalog_merge_places(p_winner UUID, p_loser UUID, p_actor TEXT, p_score DOUBLE PRECISION, p_signals JSONB)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_sources TEXT[]; v_items TEXT[]; v_saved TEXT[]; v_dropped TEXT[]; v_photos TEXT[];
  v_id UUID := gen_random_uuid();
BEGIN
  IF p_winner = p_loser THEN RAISE EXCEPTION 'a place cannot be merged into itself'; END IF;
  PERFORM 1 FROM places WHERE id IN (p_winner, p_loser) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM places WHERE id IN (p_winner, p_loser) AND merged_into_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'one of the places no longer exists or was already merged';
  END IF;
  WITH u AS (UPDATE place_sources SET place_id = p_winner WHERE place_id = p_loser RETURNING id::text)
    SELECT coalesce(array_agg(id), '{}') INTO v_sources FROM u;
  WITH u AS (UPDATE itinerary_items SET place_id = p_winner WHERE place_id = p_loser RETURNING id::text)
    SELECT coalesce(array_agg(id), '{}') INTO v_items FROM u;
  WITH u AS (UPDATE saved_places sp SET place_id = p_winner WHERE place_id = p_loser
             AND NOT EXISTS (SELECT 1 FROM saved_places x WHERE x.user_id = sp.user_id AND x.place_id = p_winner) RETURNING user_id::text)
    SELECT coalesce(array_agg(user_id), '{}') INTO v_saved FROM u;
  WITH d AS (DELETE FROM saved_places WHERE place_id = p_loser RETURNING user_id::text)
    SELECT coalesce(array_agg(user_id), '{}') INTO v_dropped FROM d;
  WITH u AS (UPDATE place_photos ph SET place_id = p_winner WHERE place_id = p_loser
             AND NOT EXISTS (SELECT 1 FROM place_photos x WHERE x.place_id = p_winner
                             AND ((ph.source_id IS NOT NULL AND x.source = ph.source AND x.source_id = ph.source_id)
                                  OR (ph.media_id IS NOT NULL AND x.media_id = ph.media_id))) RETURNING id::text)
    SELECT coalesce(array_agg(id), '{}') INTO v_photos FROM u;
  UPDATE places SET merged_into_id = p_winner, updated_at = now() WHERE id = p_loser;
  UPDATE places SET needs_publish = true WHERE id = p_winner;
  INSERT INTO place_merges (id, winner_id, loser_id, score, signals, moved, actor)
  VALUES (v_id, p_winner, p_loser, p_score, coalesce(p_signals, '{}'),
          jsonb_build_object('sources', to_jsonb(v_sources), 'items', to_jsonb(v_items), 'saved', to_jsonb(v_saved),
                             'saved_dropped', to_jsonb(v_dropped), 'photos', to_jsonb(v_photos)), p_actor);
  INSERT INTO merge_candidates (id, place_a, place_b, score, signals, status, decided_by, decided_at)
  VALUES (gen_random_uuid(), least(p_winner, p_loser), greatest(p_winner, p_loser), coalesce(p_score, 1), coalesce(p_signals, '{}'), 'MERGED', p_actor, now())
  ON CONFLICT (place_a, place_b) DO UPDATE SET status = 'MERGED', decided_by = EXCLUDED.decided_by, decided_at = now(), updated_at = now();
  RETURN v_id;
END;
$$;

-- Puts back what a merge moved (when it is still on the winner) and marks the pair rejected, so it isn't merged again.
CREATE OR REPLACE FUNCTION catalog_unmerge(p_merge UUID, p_actor TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE m place_merges%ROWTYPE; n_sources INT; n_items INT; n_saved INT; n_photos INT;
BEGIN
  SELECT * INTO m FROM place_merges WHERE id = p_merge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no merge %', p_merge; END IF;
  IF m.undone_at IS NOT NULL THEN RAISE EXCEPTION 'merge % was already undone', p_merge; END IF;
  UPDATE place_sources SET place_id = m.loser_id
    WHERE id::text IN (SELECT jsonb_array_elements_text(m.moved->'sources')) AND place_id = m.winner_id;
  GET DIAGNOSTICS n_sources = ROW_COUNT;
  UPDATE itinerary_items SET place_id = m.loser_id
    WHERE id::text IN (SELECT jsonb_array_elements_text(m.moved->'items')) AND place_id = m.winner_id;
  GET DIAGNOSTICS n_items = ROW_COUNT;
  UPDATE saved_places SET place_id = m.loser_id
    WHERE user_id::text IN (SELECT jsonb_array_elements_text(m.moved->'saved')) AND place_id = m.winner_id;
  GET DIAGNOSTICS n_saved = ROW_COUNT;
  INSERT INTO saved_places (user_id, place_id)
    SELECT u::uuid, m.loser_id FROM jsonb_array_elements_text(coalesce(m.moved->'saved_dropped', '[]')) u
    WHERE EXISTS (SELECT 1 FROM users WHERE id = u::uuid) ON CONFLICT DO NOTHING;
  UPDATE place_photos SET place_id = m.loser_id
    WHERE id::text IN (SELECT jsonb_array_elements_text(m.moved->'photos')) AND place_id = m.winner_id;
  GET DIAGNOSTICS n_photos = ROW_COUNT;
  UPDATE places SET merged_into_id = NULL, updated_at = now() WHERE id = m.loser_id AND merged_into_id = m.winner_id;
  UPDATE places SET needs_publish = true WHERE id IN (m.winner_id, m.loser_id);
  UPDATE place_merges SET undone_at = now(), undone_by = p_actor WHERE id = p_merge;
  UPDATE merge_candidates SET status = 'REJECTED', decided_by = p_actor, decided_at = now(), updated_at = now()
    WHERE place_a = least(m.winner_id, m.loser_id) AND place_b = greatest(m.winner_id, m.loser_id);
  RETURN jsonb_build_object('merge_id', p_merge, 'winner', m.winner_id, 'loser', m.loser_id,
    'restored', jsonb_build_object('sources', n_sources, 'items', n_items, 'saved', n_saved, 'photos', n_photos));
END;
$$;
