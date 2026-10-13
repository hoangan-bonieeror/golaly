-- Interface language chosen in the app ("en" | "vi"); NULL until the user picks one (the device language is used).
-- Emails to this user are written in it, and the web adopts it after sign-in on a new device.
ALTER TABLE "user_profiles" ADD COLUMN "locale" TEXT;
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_locale_check" CHECK ("locale" IS NULL OR "locale" IN ('en', 'vi'));

-- What a notification says, as data ({"k":"item_added","item":…,"day":2,"trip":…}), so each reader sees it in
-- their own language. "text" keeps the English sentence for older rows and for logs.
ALTER TABLE "notifications" ADD COLUMN "params" JSONB;
