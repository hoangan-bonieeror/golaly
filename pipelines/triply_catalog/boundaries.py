"""Administrative boundaries from Overture Maps `divisions` (country + regions) → geo_areas.

For Vietnam this yields the country and its 34 provincial-level units (post-2025 merger), as far as
the Overture release reflects it. Re-running updates names and boundaries in place.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from .config import Settings
from .normalize import clean_text, lang_tag, slugify
from .providers.overture import as_dict, duck, release_path
from .publish import reassign_areas

log = logging.getLogger(__name__)

LOCAL_LANG = {"VN": "vi"}
TIMEZONE = {"VN": "Asia/Ho_Chi_Minh"}


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
    for r in rows:
        names = r["names"] or {}
        name = clean_text(names.get("primary"), 200) or r["external_id"]
        level = "COUNTRY" if r["subtype"] == "country" else "REGION"
        slug = country.lower() if level == "COUNTRY" else f"{country.lower()}-{slugify(name)}"
        b = r["bbox"]
        row = conn.execute(
            """
            INSERT INTO geo_areas (id, parent_id, level, country_code, iso_code, name, slug, timezone, source, external_id,
                                   min_lng, min_lat, max_lng, max_lat, boundary)
            VALUES (gen_random_uuid(), %(parent)s, %(level)s::"GeoAreaLevel", %(country)s, %(iso)s, %(name)s, %(slug)s, %(tz)s,
                    'overture', %(ext)s, %(x0)s, %(y0)s, %(x1)s, %(y1)s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(%(wkb)s, 4326)), 3)))
            ON CONFLICT (source, external_id) DO UPDATE SET parent_id = EXCLUDED.parent_id, level = EXCLUDED.level,
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
        counts["destinations_refiled"] = conn.execute(
            """
            UPDATE destinations d SET area_id = a.id
            FROM (SELECT d2.id AS dest_id, (SELECT g.id FROM geo_areas g WHERE g.boundary IS NOT NULL
                                              AND ST_Contains(g.boundary, ST_SetSRID(ST_MakePoint(d2.lng, d2.lat), 4326))
                                            ORDER BY g.level DESC LIMIT 1) AS id FROM destinations d2) a
            WHERE d.id = a.dest_id AND a.id IS NOT NULL AND d.area_id IS DISTINCT FROM a.id
            """
        ).rowcount
        counts["places_refiled"] = reassign_areas(conn, settings, (box["min_lng"], box["min_lat"], box["max_lng"], box["max_lat"]))
    conn.commit()
    log.info("boundaries for %s: %s", country, counts)
    return counts
