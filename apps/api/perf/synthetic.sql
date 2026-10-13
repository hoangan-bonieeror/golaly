-- Synthetic catalog at production scale, for measuring queries (not for any real database).
--   psql -d triply_perf -v places=1800000 -f perf/synthetic.sql
-- Shape: 3 countries (VN 34 provinces, CN 31, MX 32), places skewed towards a few big cities, Vietnamese names with
-- diacritics, almost no ratings (open data has none), one source record per place plus unmapped records, and a
-- duplicate review queue. Deterministic (setseed), so runs are comparable.
\set ON_ERROR_STOP on
\if :{?places}
\else
  \set places 1800000
\endif
BEGIN;
SELECT setseed(0.42);

-- Countries and regions (a grid of boxes inside each country's bbox).
CREATE TEMP TABLE c (code text, name text, slug text, min_lng float8, min_lat float8, max_lng float8, max_lat float8, regions int, share float8);
INSERT INTO c VALUES ('VN', 'Việt Nam', 'vn', 102.2, 8.6, 109.4, 23.3, 34, 0.6), ('CN', 'China', 'cn', 98, 21, 122, 41, 31, 0.2), ('MX', 'México', 'mx', -115, 15, -87, 31, 32, 0.2);
INSERT INTO geo_areas (id, level, country_code, name, slug, source, min_lng, min_lat, max_lng, max_lat)
SELECT gen_random_uuid(), 'COUNTRY', code, name, slug, 'perf', min_lng, min_lat, max_lng, max_lat FROM c;
INSERT INTO geo_areas (id, parent_id, level, country_code, name, slug, source, min_lng, min_lat, max_lng, max_lat)
SELECT gen_random_uuid(), g.id, 'REGION', c.code, 'Tỉnh Perf ' || c.code || ' ' || i, c.slug || '-perf-' || i, 'perf',
       c.min_lng, c.min_lat + (c.max_lat - c.min_lat) * i / c.regions, c.max_lng, c.min_lat + (c.max_lat - c.min_lat) * (i + 1) / c.regions
FROM c JOIN geo_areas g ON g.slug = c.slug, generate_series(0, c.regions - 1) i;
-- Each region stands for an auto-created destination (like the boundaries import does).
INSERT INTO destinations (id, slug, name, country, lat, lng, blurb, palette_a, palette_b, auto_created, represents_area_id, search_text)
SELECT gen_random_uuid(), 'd-' || r.slug, r.name, c.name, (r.min_lat + r.max_lat) / 2, (r.min_lng + r.max_lng) / 2, '', '#333333', '#999999', true, r.id, lower(r.slug)
FROM geo_areas r JOIN c ON c.code = r.country_code WHERE r.level = 'REGION' AND r.source = 'perf';

-- Name pools: (accented, plain).
CREATE TEMP TABLE w (i int, acc text, plain text);
INSERT INTO w SELECT row_number() OVER () - 1, a, p FROM (VALUES
  ('Phở','pho'),('Bún','bun'),('Cơm Tấm','com tam'),('Bánh Mì','banh mi'),('Cà Phê','ca phe'),('Quán','quan'),('Nhà Hàng','nha hang'),
  ('Khách Sạn','khach san'),('Tiệm','tiem'),('Chợ','cho'),('Chùa','chua'),('Đền','den'),('Bảo Tàng','bao tang'),('Công Viên','cong vien'),
  ('Hải Sản','hai san'),('Lẩu','lau'),('Bia','bia'),('Trà Sữa','tra sua'),('Kem','kem'),('Spa','spa'),('Homestay','homestay'),('Bar','bar'),
  ('Coffee','coffee'),('Hotel','hotel'),('Restaurant','restaurant'),('Market','market'),('Shop','shop'),('Studio','studio'),('Garden','garden'),
  ('Thìn','thin'),('Lý','ly'),('Hà','ha'),('Minh','minh'),('Phượng','phuong'),('Hồng','hong'),('Lan','lan'),('Sơn','son'),('Hải','hai'),
  ('Ngọc','ngoc'),('Thu','thu'),('Bảy','bay'),('Tám','tam'),('Xưa','xua'),('Mới','moi'),('Ngon','ngon'),('Sài Gòn','sai gon'),('Hà Nội','ha noi'),
  ('Huế','hue'),('Hội An','hoi an'),('Đà Lạt','da lat'),('Biển','bien'),('Núi','nui'),('Sông','song'),('Phố','pho'),('Làng','lang'),
  ('Golden','golden'),('Lotus','lotus'),('Bamboo','bamboo'),('Sunrise','sunrise'),('Ocean','ocean'),('Central','central'),('Royal','royal'),
  ('Panda','panda'),('Dragon','dragon'),('Taco','taco'),('Casa','casa'),('Mercado','mercado'),('Café','cafe'),('Plaza','plaza'),('Jardín','jardin')
) v(a, p);
CREATE TEMP TABLE leaf AS SELECT id, item_type, row_number() OVER (ORDER BY key) - 1 AS i FROM categories WHERE parent_id IS NOT NULL;
CREATE TEMP TABLE reg AS SELECT r.*, c.share, row_number() OVER (PARTITION BY r.country_code ORDER BY r.slug) - 1 AS i, c.regions
  FROM geo_areas r JOIN c ON c.code = r.country_code WHERE r.level = 'REGION' AND r.source = 'perf';

-- Places. Region: skewed (random()^3 → a few busy provinces). Position: uniform in the region's box.
CREATE TEMP TABLE np AS
SELECT gen_random_uuid() AS id, n,
       (SELECT acc FROM w WHERE i = (n * 7919) % 70) AS a1, (SELECT plain FROM w WHERE i = (n * 7919) % 70) AS p1,
       (SELECT acc FROM w WHERE i = 29 + (n * 104729) % 41) AS a2, (SELECT plain FROM w WHERE i = 29 + (n * 104729) % 41) AS p2,
       (SELECT acc FROM w WHERE i = (n * 1299709) % 70) AS a3, (SELECT plain FROM w WHERE i = (n * 1299709) % 70) AS p3,
       CASE WHEN random() < 0.6 THEN 'VN' WHEN random() < 0.5 THEN 'CN' ELSE 'MX' END AS cc,
       random() AS rr, random() AS rx, random() AS ry
FROM generate_series(1::bigint, :places) n;
CREATE TEMP TABLE np2 AS
SELECT np.*, r.id AS area_id, r.name AS area_name,
       r.min_lng + (r.max_lng - r.min_lng) * rx AS lng, r.min_lat + (r.max_lat - r.min_lat) * ry AS lat
FROM np JOIN reg r ON r.country_code = np.cc AND r.i = floor(r.regions * rr ^ 3)::int;

INSERT INTO places (id, name, name_norm, category, category_id, area_id, address, lat, lng, rating, status, quality_score,
                    search_text, search_accent, field_sources, updated_at, created_at)
SELECT p.id, p.a1 || ' ' || p.a2 || CASE WHEN p.n % 3 = 0 THEN ' ' || p.a3 ELSE '' END,
       p.p1 || ' ' || p.p2 || CASE WHEN p.n % 3 = 0 THEN ' ' || p.p3 ELSE '' END,
       l.item_type, l.id, p.area_id, (p.n % 300) || ' Đường ' || p.a3, p.lat, p.lng,
       CASE WHEN p.n % 50 = 0 THEN round((3 + random() * 2)::numeric, 1) END,
       (CASE WHEN p.n % 97 = 0 THEN 'CLOSED' ELSE 'ACTIVE' END)::"PlaceStatus", round(random()::numeric, 3),
       p.p1 || ' ' || p.p2 || CASE WHEN p.n % 3 = 0 THEN ' ' || p.p3 ELSE '' END || ' ' || (p.n % 300) || ' duong ' || p.p3 || ' ' || lower(p.area_name),
       lower(p.a1 || ' ' || p.a2 || CASE WHEN p.n % 3 = 0 THEN ' ' || p.a3 ELSE '' END || ' ' || (p.n % 300) || ' đường ' || p.a3),
       '{"name":"overture"}', now() - (p.n % 10000) * interval '1 minute', now()
FROM np2 p JOIN leaf l ON l.i = p.n % (SELECT count(*) FROM leaf);

-- One source record per place, plus records whose category has no mapping (never published).
INSERT INTO place_sources (id, place_id, provider, external_id, raw, normalized, content_hash, license, attribution, lat, lng, category_id, area_id)
SELECT gen_random_uuid(), p.id, CASE WHEN p.n % 3 = 0 THEN 'osm' ELSE 'overture' END, 'perf-' || p.n, '{}',
       jsonb_build_object('name', p.p1, 'category_candidates', jsonb_build_array('cat_' || (p.n % 40))), md5(p.n::text), 'CDLA', 'perf', p.lat, p.lng,
       (SELECT id FROM leaf WHERE i = p.n % (SELECT count(*) FROM leaf)), p.area_id
FROM np2 p;
INSERT INTO place_sources (id, place_id, provider, external_id, raw, normalized, content_hash, license, attribution, lat, lng, area_id)
SELECT gen_random_uuid(), NULL, 'osm', 'perf-unmapped-' || p.n, '{}', jsonb_build_object('category_candidates', jsonb_build_array('amenity=x' || (p.n % 300))),
       md5(p.n::text), 'ODbL', 'perf', p.lat, p.lng, p.area_id
FROM np2 p WHERE p.n % 12 = 0;

-- Duplicate review queue.
INSERT INTO merge_candidates (id, place_a, place_b, score, signals, updated_at)
SELECT gen_random_uuid(), least(a.id, b.id), greatest(a.id, b.id), 0.6 + random() * 0.25, '{"name": 0.8}', now()
FROM np2 a JOIN np2 b ON b.n = a.n + 1 WHERE a.n % 60 = 0 AND a.n < :places
ON CONFLICT DO NOTHING;

COMMIT;
ANALYZE;
SELECT (SELECT count(*) FROM places) AS places, (SELECT count(*) FROM place_sources) AS sources, (SELECT count(*) FROM merge_candidates) AS pairs,
       pg_size_pretty(pg_database_size(current_database())) AS size;
