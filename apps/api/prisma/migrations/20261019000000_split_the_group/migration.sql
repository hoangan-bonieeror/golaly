-- During the trip (roadmap phase 2): who goes where when the group splits up, and where it meets again.

ALTER TABLE "itinerary_items" ADD COLUMN "meetup" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "item_assignees" (
  "item_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  CONSTRAINT "item_assignees_pkey" PRIMARY KEY ("item_id", "user_id")
);
CREATE INDEX "item_assignees_user_id_idx" ON "item_assignees"("user_id");
ALTER TABLE "item_assignees" ADD CONSTRAINT "item_assignees_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "itinerary_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_assignees" ADD CONSTRAINT "item_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
