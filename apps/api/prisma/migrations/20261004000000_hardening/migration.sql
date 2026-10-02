-- Email verification + per-account login lockout
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "locked_until" TIMESTAMP(3);

-- Refresh-token reuse detection
ALTER TABLE "sessions" ADD COLUMN "prev_token_hash" TEXT,
ADD COLUMN "rotated_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "sessions_prev_token_hash_key" ON "sessions"("prev_token_hash");

-- Accounts that existed before verification was introduced are grandfathered in.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "deleted_at" IS NULL;

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Missing foreign-key / feed indexes
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX "trips_forked_from_id_idx" ON "trips"("forked_from_id");
CREATE INDEX "trip_invitations_invited_by_idx" ON "trip_invitations"("invited_by");
CREATE INDEX "posts_visibility_deleted_at_created_at_idx" ON "posts"("visibility", "deleted_at", "created_at");
CREATE INDEX "post_media_media_id_idx" ON "post_media"("media_id");
CREATE INDEX "saved_trips_trip_id_idx" ON "saved_trips"("trip_id");
CREATE INDEX "saved_posts_post_id_idx" ON "saved_posts"("post_id");
