-- Accent-aware place search: "phở" should find "Phở Thìn", not every "Phố …" / "Thành phố …".

ALTER TABLE "places" ADD COLUMN "search_accent" TEXT NOT NULL DEFAULT '';

-- Province/city names go into the search text without their "Thành phố" / "Tỉnh" prefix: "pho" matched
-- every place in a "Thành phố". search_text ends with the (accent-free) area name.
UPDATE "places" p SET "search_text" = regexp_replace(p."search_text", ' (thanh pho|tinh) ([^,]*)$', ' \2')
FROM "geo_areas" g
WHERE g."id" = p."area_id" AND g."name" ~ '^(Thành phố|Tỉnh)\s';

-- Back-fill: the same parts as search_text (name, other names, address, destination, area), accents kept.
-- The catalog pipeline and the API keep it up to date from here on.
UPDATE "places" p SET "search_accent" = left(trim(regexp_replace(lower(normalize(concat_ws(' ',
    p."name",
    (SELECT string_agg(n."name", ' ') FROM "place_names" n WHERE n."place_id" = p."id" AND n."name" <> p."name"),
    p."address",
    (SELECT d."name" || ' ' || d."country" FROM "destinations" d WHERE d."id" = p."destination_id"),
    (SELECT regexp_replace(g."name", '^(Thành phố|Tỉnh)\s+', '') FROM "geo_areas" g WHERE g."id" = p."area_id")
  ), NFC)), '\s+', ' ', 'g')), 4000);
