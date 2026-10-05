-- When a place's photos were last looked for (catalog_photos). Incremental photo runs — the automatic one after a
-- catalog sync — only look at places never checked, renamed or moved since, or checked long ago.
ALTER TABLE "places" ADD COLUMN "photos_checked_at" TIMESTAMP(3);

-- A new name or position may match different photos: forget the last check.
CREATE OR REPLACE FUNCTION places_photos_recheck() RETURNS trigger AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng THEN
    NEW.photos_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER places_photos_recheck
  BEFORE UPDATE OF name, lat, lng ON "places"
  FOR EACH ROW EXECUTE FUNCTION places_photos_recheck();
