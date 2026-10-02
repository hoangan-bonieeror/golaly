-- P1: Google sign-in, fuzzy accent-insensitive search, responsive media.

-- Trigram matching for fuzzy search ("tokio" → Tokyo). Ships with PostgreSQL (contrib).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "destinations" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "dominant_color" TEXT,
ADD COLUMN     "medium_key" TEXT;

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_profiles_search_text_idx" ON "user_profiles" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "destinations_search_text_idx" ON "destinations" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "places_search_text_idx" ON "places" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "trips_search_text_idx" ON "trips" USING GIN ("search_text" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
