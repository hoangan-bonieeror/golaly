"""Administrative boundaries from Overture Maps `divisions` (country + regions) → geo_areas.

For Vietnam this yields the country and its 34 provincial-level units (post-2025 merger), as far as
the Overture release reflects it. Re-running updates names and boundaries in place.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

import psycopg

from .config import Settings
from .normalize import clean_text, english_area_name, lang_tag, name_key, normalize_search, short_area_name, slugify
from .providers.overture import as_dict, duck, release_path
from .publish import reassign_areas

log = logging.getLogger(__name__)

LOCAL_LANG = {"VN": "vi", "JP": "ja", "KR": "ko", "TH": "th", "CN": "zh", "TW": "zh-Hant", "PT": "pt", "FR": "fr", "DE": "de"}
#: Cover colours for destinations created from boundaries (same family as the curated ones), picked by slug.
PALETTES = [
    ("#0f5257", "#9fd8cb"),
    ("#7a2e1f", "#f2b134"),
    ("#a4471f", "#f5cd5b"),
    ("#3d1e6d", "#f26b4e"),
    ("#1f3b73", "#e8657a"),
    ("#5b2a3c", "#e7a35b"),
    ("#1b4965", "#f4a259"),
    ("#283d3b", "#c44536"),
    ("#264653", "#e9c46a"),
    ("#6a2c70", "#f9a03f"),
]
#: Countries with a single time zone (others are left empty rather than guessed).
TIMEZONE = {
    "VN": "Asia/Ho_Chi_Minh",
    "JP": "Asia/Tokyo",
    "KR": "Asia/Seoul",
    "TH": "Asia/Bangkok",
    "SG": "Asia/Singapore",
    "FR": "Europe/Paris",
    "DE": "Europe/Berlin",
}


def area_slug(country: str, names: dict[str, Any], region_code: str | None, external_id: str, taken: dict[str, str]) -> str:
    """A readable, unique, ASCII slug for a region, e.g. "vn-da-nang", "jp-tokyo".

    Tries the primary name (fine for Latin scripts), then the English name (Japanese, Thai, Korean … primary
    names slugify to nothing), then the ISO 3166-2 code ("JP-13" → "jp-13"), then the provider id. If another
    area already uses the slug, the region code (or a short id) is appended. `taken` maps slug → external id.
    """
    cc = country.lower()
    common = as_dict(names.get("common"))
    code = (region_code or "").split("-", 1)[-1].lower() if region_code else ""
    candidates = [slugify(str(names.get("primary") or "")), slugify(str(common.get("en") or "")), slugify(code)]
    base = next((c for c in candidates if c), "") or slugify(external_id)[-8:] or "area"
    slug = f"{cc}-{base}"
    for suffix in (slugify(code), slugify(external_id)[-8:]):
        if taken.get(slug, external_id) == external_id:
            break
        slug = f"{cc}-{base}-{suffix}" if suffix else slug
    if taken.get(slug, external_id) != external_id:
        slug = f"{cc}-{base}-{len(taken)}"
    taken[slug] = external_id
    return slug


def fetch_divisions(settings: Settings, country: str) -> list[dict[str, Any]]:
    con = duck(settings)
    path = release_path(settings, "divisions", "division_area")
    cols = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}', hive_partitioning = 1)").fetchall()}
    div_id = "division_id" if "division_id" in cols else "id"
    rows = con.execute(
        f"""
        SELECT {div_id} AS external_id, subtype, names, country, region, bbox, geometry
        FROM read_parquet('{path}', hive_partitioning = 1)
        WHERE country = ? AND subtype IN ('country', 'region') AND coalesce(class, 'land') = 'land'
        """,
        [country],
    ).fetchall()
    con.close()
    keys = ["external_id", "subtype", "names", "country", "region", "bbox", "geometry"]
    return [dict(zip(keys, r, strict=False)) for r in rows]


def import_boundaries(conn: psycopg.Connection, settings: Settings, country: str = "VN") -> dict[str, int]:
    rows = fetch_divisions(settings, country)
    if not rows:
        raise RuntimeError(f"No Overture divisions found for {country} in release {settings.overture_release or 'default'}")
    rows.sort(key=lambda r: r["subtype"] != "country")  # country first, it's the parent
    local = LOCAL_LANG.get(country, "en")
    country_id: str | None = None
    counts = {"country": 0, "region": 0}
    # Slugs already in use (stable across re-runs), so new ones never collide with them.
    taken = {r["slug"]: r["external_id"] for r in conn.execute("SELECT slug, external_id FROM geo_areas WHERE source = 'overture'").fetchall()}
    for r in rows:
        names = r["names"] or {}
        name = clean_text(names.get("primary"), 200) or r["external_id"]
        level = "COUNTRY" if r["subtype"] == "country" else "REGION"
        slug = country.lower() if level == "COUNTRY" else area_slug(country, names, r.get("region"), r["external_id"], taken)
        b = r["bbox"]
        row = conn.execute(
            """
            INSERT INTO geo_areas (id, parent_id, level, country_code, iso_code, name, slug, timezone, source, external_id,
                                   min_lng, min_lat, max_lng, max_lat, boundary)
            VALUES (gen_random_uuid(), %(parent)s, %(level)s::"GeoAreaLevel", %(country)s, %(iso)s, %(name)s, %(slug)s, %(tz)s,
                    'overture', %(ext)s, %(x0)s, %(y0)s, %(x1)s, %(y1)s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(%(wkb)s, 4326)), 3)))
            ON CONFLICT (source, external_id) DO UPDATE SET parent_id = EXCLUDED.parent_id, level = EXCLUDED.level,
              -- Slugs are kept stable, except broken ones from older versions ("jp-" for non-Latin names).
              slug = CASE WHEN geo_areas.slug ~ '-$' OR geo_areas.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN EXCLUDED.slug ELSE geo_areas.slug END,
              iso_code = EXCLUDED.iso_code, name = EXCLUDED.name, timezone = EXCLUDED.timezone,
              min_lng = EXCLUDED.min_lng, min_lat = EXCLUDED.min_lat, max_lng = EXCLUDED.max_lng, max_lat = EXCLUDED.max_lat,
              boundary = EXCLUDED.boundary, updated_at = now()
            RETURNING id::text AS id
            """,
            {
                "parent": None if level == "COUNTRY" else country_id,
                "level": level,
                "country": country,
                "iso": r.get("region") if level == "REGION" else country,
                "name": name,
                "slug": slug,
                "tz": TIMEZONE.get(country),
                "ext": r["external_id"],
                "x0": b["xmin"],
                "y0": b["ymin"],
                "x1": b["xmax"],
                "y1": b["ymax"],
                "wkb": bytes(r["geometry"]),
            },
        ).fetchone()
        assert row
        if level == "COUNTRY":
            country_id = row["id"]
        translations = {lang_tag(k): v for k, v in as_dict(names.get("common")).items() if clean_text(v)}
        translations.setdefault(local, name)
        for lang, value in translations.items():
            conn.execute(
                """INSERT INTO geo_area_names (area_id, lang, name) VALUES (%s, %s, %s)
                   ON CONFLICT (area_id, lang) DO UPDATE SET name = EXCLUDED.name""",
                [row["id"], lang, value],
            )
        counts["country" if level == "COUNTRY" else "region"] += 1
    if country_id:
        box = conn.execute("SELECT min_lng, min_lat, max_lng, max_lat FROM geo_areas WHERE id = %s::uuid", [country_id]).fetchone()
        assert box
        # The smallest area containing the destination's centre — or, for a centre just off the coast
        # (Hạ Long Bay is in the water), the nearest area within `destination_radius_km` (km → degrees of
        # longitude, which is ≥ the latitude distance, so ST_DWithin can use the GiST index).
        counts["destinations_refiled"] = conn.execute(
            """
            UPDATE destinations d SET area_id = a.id
            FROM (SELECT d2.id AS dest_id, (
                    SELECT g.id FROM geo_areas g, LATERAL (SELECT ST_SetSRID(ST_MakePoint(d2.lng, d2.lat), 4326) AS pt) x
                    WHERE g.boundary IS NOT NULL AND ST_DWithin(g.boundary, x.pt, %s / (111.32 * cos(radians(d2.lat))))
                    ORDER BY ST_Contains(g.boundary, x.pt) DESC, g.level DESC, g.boundary <-> x.pt LIMIT 1) AS id
                  FROM destinations d2) a
            WHERE d.id = a.dest_id AND a.id IS NOT NULL AND d.area_id IS DISTINCT FROM a.id
            """,
            [settings.destination_radius_km],
        ).rowcount
        counts.update(sync_area_destinations(conn, country_id, country))
        counts["places_refiled"] = reassign_areas(conn, settings, (box["min_lng"], box["min_lat"], box["max_lng"], box["max_lat"]))
    conn.commit()
    log.info("boundaries for %s: %s", country, counts)
    return counts


def sync_area_destinations(conn: psycopg.Connection, country_id: str, country: str) -> dict[str, int]:
    """One destination per province/city of the country, named in English ("Da Nang", "Lam Dong").

    - A curated destination that IS the area (inside it, same name in any spelling: "Hanoi" ↔ "Thành phố Hà Nội")
      is linked through `represents_area_id`, never renamed.
    - Areas without one get a new destination (`auto_created`). Re-runs only follow name/centre changes of
      those, so blurbs and colours edited by hand are kept.
    - Destinations inside an area under another name (Hội An in Đà Nẵng) stay separate.
    """
    country_en = conn.execute(
        """SELECT coalesce(n.name, g.name) AS name FROM geo_areas g LEFT JOIN geo_area_names n ON n.area_id = g.id AND n.lang = 'en'
           WHERE g.id = %s::uuid""",
        [country_id],
    ).fetchone()["name"]  # type: ignore[index]
    regions = conn.execute(
        """SELECT g.id::text AS id, g.slug, g.name, coalesce(n.name, g.name) AS en,
                  ST_Y(ST_PointOnSurface(g.boundary)) AS lat, ST_X(ST_PointOnSurface(g.boundary)) AS lng
           FROM geo_areas g LEFT JOIN geo_area_names n ON n.area_id = g.id AND n.lang = 'en'
           WHERE g.parent_id = %s::uuid AND g.boundary IS NOT NULL ORDER BY g.slug""",
        [country_id],
    ).fetchall()
    dests = conn.execute(
        """SELECT id::text AS id, slug, name, country, lat, lng, area_id::text AS area_id,
                  represents_area_id::text AS represents_area_id, auto_created FROM destinations"""
    ).fetchall()
    represented = {d["represents_area_id"]: d for d in dests if d["represents_area_id"]}
    slugs = {d["slug"] for d in dests}
    counts = {"destinations_linked": 0, "destinations_created": 0, "destinations_updated": 0}
    for r in regions:
        name = english_area_name(r["en"], country)
        lat, lng = round(r["lat"], 5), round(r["lng"], 5)
        search = normalize_search(f"{name} {short_area_name(r['name'])} {country_en}")
        d = represented.get(r["id"])
        if d is None:
            keys = {name_key(r["name"]), name_key(r["en"])}
            match = next(
                (x for x in dests if not x["represents_area_id"] and not x["auto_created"] and x["area_id"] == r["id"] and name_key(x["name"]) in keys),
                None,
            )
            if match:
                conn.execute("UPDATE destinations SET represents_area_id = %s::uuid WHERE id = %s::uuid", [r["id"], match["id"]])
                match["represents_area_id"] = r["id"]
                counts["destinations_linked"] += 1
                continue
            # Non-Latin names without an English one slugify to nothing: fall back to the area's own slug.
            slug = base = slugify(name) or r["slug"]
            n = 1
            while slug in slugs:  # "georgia" the state vs the country: add the country code, then a number
                n += 1
                slug = f"{base}-{country.lower()}" if n == 2 else f"{base}-{country.lower()}-{n}"
            slugs.add(slug)
            a, b = PALETTES[int(hashlib.md5(slug.encode()).hexdigest(), 16) % len(PALETTES)]
            conn.execute(
                """INSERT INTO destinations (id, slug, name, country, lat, lng, palette_a, palette_b, search_text, area_id, represents_area_id, auto_created)
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s::uuid, true)""",
                [slug, name, country_en, lat, lng, a, b, search, r["id"], r["id"]],
            )
            counts["destinations_created"] += 1
        elif d["auto_created"] and (d["name"], d["country"], d["lat"], d["lng"]) != (name, country_en, lat, lng):
            conn.execute(
                "UPDATE destinations SET name = %s, country = %s, lat = %s, lng = %s, search_text = %s, area_id = %s::uuid WHERE id = %s::uuid",
                [name, country_en, lat, lng, search, r["id"], d["id"]],
            )
            counts["destinations_updated"] += 1
    return counts
