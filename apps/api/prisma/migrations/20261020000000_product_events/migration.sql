-- Product events for analytics (admin dashboard, phase 2): one row per meaningful thing someone did outside a trip's
-- plan (signed up, logged in, created / remixed / published a trip, accepted an invitation, posted). Facts only:
-- ids and small enums in `props`, never free text, names or e-mails. Trip-plan changes stay in trip_events.
CREATE TABLE "product_events" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "user_id" UUID,
    "trip_id" UUID,
    "props" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_events_at_idx" ON "product_events"("at");
CREATE INDEX "product_events_type_at_idx" ON "product_events"("type", "at");
-- Deleting an account keeps the (anonymous) fact that something happened.
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
