-- Flexible plans (roadmap phases 0–1): a place pool per trip, parts of the day instead of clock
-- times, group votes, members' own dates, and an append-only log of plan activity.

CREATE TYPE "ItemSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'ANY');
CREATE TYPE "ItemStatus" AS ENUM ('PLANNED', 'VISITED', 'SKIPPED');
CREATE TYPE "VoteLevel" AS ENUM ('LOVE', 'OK', 'SKIP');

-- Items belong to the trip directly; day_id NULL = in the trip's pool.
ALTER TABLE "itinerary_items" ADD COLUMN "trip_id" UUID;
UPDATE "itinerary_items" i SET "trip_id" = d."trip_id" FROM "trip_days" d WHERE d."id" = i."day_id";
ALTER TABLE "itinerary_items" ALTER COLUMN "trip_id" SET NOT NULL;
ALTER TABLE "itinerary_items" ALTER COLUMN "day_id" DROP NOT NULL;
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "itinerary_items_trip_id_day_id_idx" ON "itinerary_items"("trip_id", "day_id");

ALTER TABLE "itinerary_items" ADD COLUMN "slot" "ItemSlot" NOT NULL DEFAULT 'ANY';
ALTER TABLE "itinerary_items" ADD COLUMN "status" "ItemStatus" NOT NULL DEFAULT 'PLANNED';
ALTER TABLE "itinerary_items" ADD COLUMN "added_by" UUID;
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "itinerary_items" SET "added_by" = "updated_by";

-- Existing plans keep their times (nothing is dropped). Timed items get the slot of their start time;
-- untimed ones take the slot of the nearest timed item before them in the day (else after, else ANY).
UPDATE "itinerary_items" SET "slot" = (CASE
  WHEN "start_time" < '12:00' THEN 'MORNING'
  WHEN "start_time" < '17:00' THEN 'AFTERNOON'
  ELSE 'EVENING' END)::"ItemSlot"
WHERE "start_time" IS NOT NULL;
UPDATE "itinerary_items" i SET "slot" = COALESCE(
  (SELECT p."slot" FROM "itinerary_items" p WHERE p."day_id" = i."day_id" AND p."start_time" IS NOT NULL AND p."sort_order" < i."sort_order" ORDER BY p."sort_order" DESC LIMIT 1),
  (SELECT n."slot" FROM "itinerary_items" n WHERE n."day_id" = i."day_id" AND n."start_time" IS NOT NULL AND n."sort_order" > i."sort_order" ORDER BY n."sort_order" ASC LIMIT 1),
  'ANY')
WHERE i."start_time" IS NULL;
-- Keep each day's order grouped by slot (morning, afternoon, evening, any time).
UPDATE "itinerary_items" i SET "sort_order" = o.rn FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "day_id" ORDER BY array_position(ARRAY['MORNING','AFTERNOON','EVENING','ANY']::"ItemSlot"[], "slot"), "sort_order") - 1 AS rn
  FROM "itinerary_items"
) o WHERE o."id" = i."id";

CREATE TABLE "item_votes" (
  "item_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "level" "VoteLevel" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "item_votes_pkey" PRIMARY KEY ("item_id", "user_id")
);
CREATE INDEX "item_votes_user_id_idx" ON "item_votes"("user_id");
ALTER TABLE "item_votes" ADD CONSTRAINT "item_votes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itinerary_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_votes" ADD CONSTRAINT "item_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_members" ADD COLUMN "arrive_on" DATE;
ALTER TABLE "trip_members" ADD COLUMN "leave_on" DATE;
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_dates_check" CHECK ("arrive_on" IS NULL OR "leave_on" IS NULL OR "arrive_on" <= "leave_on");

ALTER TABLE "user_profiles" ADD COLUMN "analytics_consent" BOOLEAN NOT NULL DEFAULT false;

-- Append-only: the application only ever INSERTs here.
CREATE TABLE "trip_events" (
  "id" BIGSERIAL NOT NULL,
  "trip_id" UUID NOT NULL,
  "actor_id" UUID,
  "item_id" UUID,
  "place_id" UUID,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trip_events_trip_id_at_idx" ON "trip_events"("trip_id", "at");
CREATE INDEX "trip_events_type_at_idx" ON "trip_events"("type", "at");
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
