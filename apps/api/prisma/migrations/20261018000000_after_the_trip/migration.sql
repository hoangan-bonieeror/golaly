-- After the trip (roadmap phase 3): photos of stops, where a remixed item came from, and the group's
-- expenses with repayments.

-- A fork's items remember their original, so the fork can show what the original group did there.
ALTER TABLE "itinerary_items" ADD COLUMN "source_item_id" UUID;
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_source_item_id_fkey" FOREIGN KEY ("source_item_id") REFERENCES "itinerary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "itinerary_items_source_item_id_idx" ON "itinerary_items"("source_item_id");

CREATE TABLE "item_photos" (
  "id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "media_id" UUID NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "item_photos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "item_photos_item_id_media_id_key" ON "item_photos"("item_id", "media_id");
CREATE INDEX "item_photos_item_id_created_at_idx" ON "item_photos"("item_id", "created_at");
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itinerary_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "ExpenseCategory" AS ENUM ('FOOD', 'LODGING', 'TRANSPORT', 'ACTIVITY', 'SHOPPING', 'OTHER');

-- Amounts are integers of the currency's smallest unit (₫ 1, ¥ 1, $0.01).
CREATE TABLE "expenses" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "paid_by" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "description" TEXT NOT NULL,
  "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "spent_on" DATE,
  "item_id" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0)
);
CREATE INDEX "expenses_trip_id_spent_on_idx" ON "expenses"("trip_id", "spent_on");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itinerary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "expense_shares" (
  "expense_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  CONSTRAINT "expense_shares_pkey" PRIMARY KEY ("expense_id", "user_id"),
  CONSTRAINT "expense_shares_amount_check" CHECK ("amount" >= 0)
);
CREATE INDEX "expense_shares_user_id_idx" ON "expense_shares"("user_id");
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "settlements" (
  "id" UUID NOT NULL,
  "trip_id" UUID NOT NULL,
  "from_user" UUID NOT NULL,
  "to_user" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlements_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "settlements_parties_check" CHECK ("from_user" <> "to_user")
);
CREATE INDEX "settlements_trip_id_created_at_idx" ON "settlements"("trip_id", "created_at");
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_user_fkey" FOREIGN KEY ("from_user") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_user_fkey" FOREIGN KEY ("to_user") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
