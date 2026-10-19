"""Publish step: place_sources → places (the canonical rows the app reads).

Attaching stays conservative: a source record joins an existing place only when one of its names, normalised,
equals the place's normalised name AND it lies within `same_place_meters`; everything else becomes a new place.
Places that are nevertheless the same are found afterwards by the scored duplicate detection (`dedupe.py`):
merged automatically when the score is high, queued for review in `merge_candidates` when it's uncertain.

All steps are incremental: only places touched by records that changed in this run are recomputed,
so a re-run over unchanged data writes nothing.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from .config import FIELD_PRIORITY, PUBLISH_ORDER, Settings
from .normalize import accent_search, normalize_search, short_area_name

log = logging.getLogger(__name__)

ELIGIBLE = """
  s.category_id IS NOT NULL
  AND s.normalized->>'name' IS NOT NULL
  AND s.operating_status <> 'permanently_closed'
  AND (NOT %(require_area)s OR s.area_id IS NOT NULL)
  AND (cardinality(%(cats)s::text[]) = 0 OR s.category_id IN (
       SELECT c.id FROM categories c LEFT JOIN categories g ON g.id = c.parent_id WHERE c.key = ANY(%(cats)s) OR g.key = ANY(%(cats)s)))
"""


def attach_and_create(
    conn: psycopg.Connection, settings: Settings, run_id: str, provider: str, require_area: bool, category_keys: list[str] | None = None
) -> dict[str, int]:
    params = {"run": run_id, "provider": provider, "m": settings.same_place_meters, "require_area": require_area, "cats": list(category_keys or [])}
    # A) Attach to an existing place: same normalised name (any language), close by, and that place
    #    doesn't already have a record from this provider (one provider never lists the same place twice).
    attached = conn.execute(
        f"""
        WITH cand AS (
          SELECT s.id AS sid, (
            SELECT p.id FROM places p
            WHERE p.merged_into_id IS NULL
              AND p.name_norm IN (SELECT jsonb_array_elements_text(s.normalized->'names_norm'))
              AND ST_DWithin(p.location, s.location, %(m)s)
              AND NOT EXISTS (SELECT 1 FROM place_sources o WHERE o.place_id = p.id AND o.provider = s.provider)
            ORDER BY p.location <-> s.location LIMIT 1
          ) AS pid
          FROM place_sources s
          WHERE s.provider = %(provider)s AND s.place_id IS NULL AND s.changed_run_id = %(run)s::uuid AND {ELIGIBLE}
        )
        UPDATE place_sources s SET place_id = cand.pid FROM cand WHERE s.id = cand.sid AND cand.pid IS NOT NULL
        """,
        params,
    ).rowcount
    # B) Everything still unattached becomes a new place (fields are filled by refresh_places).
    created = conn.execute(
        f"""
        WITH new AS (
          SELECT s.id AS sid, gen_random_uuid() AS pid FROM place_sources s
          WHERE s.provider = %(provider)s AND s.place_id IS NULL AND s.changed_run_id = %(run)s::uuid AND {ELIGIBLE}
        ), ins AS (
          INSERT INTO places (id, name, name_norm, category, category_id, lat, lng, area_id)
          SELECT new.pid, s.normalized->>'name', s.normalized->>'name_norm', c.item_type, s.category_id, s.lat, s.lng, s.area_id
          FROM new JOIN place_sources s ON s.id = new.sid JOIN categories c ON c.id = s.category_id
          RETURNING id
        )
        UPDATE place_sources s SET place_id = new.pid FROM new WHERE s.id = new.sid
        """,
        params,
    ).rowcount
    return {"attached": attached, "created": created}


def _pick(field: str, value_sql: str) -> str:
    order = ", ".join(f"'{p}'" for p in FIELD_PRIORITY[field])
    return (
        f"(array_agg({value_sql} ORDER BY array_position(ARRAY[{order}]::text[], s.provider), s.last_seen_at DESC) FILTER (WHERE {value_sql} IS NOT NULL))[1]"
    )


def _pick_provider(field: str, value_sql: str) -> str:
    return _pick(field, value_sql).replace(f"array_agg({value_sql} ", "array_agg(s.provider ", 1)


def refresh_places(conn: psycopg.Connection, settings: Settings, run_id: str) -> int:
    """Recompute published fields (survivorship) for every place with a record that changed in this run."""
    fields = {
        "name": "s.normalized->>'name'",
        "address": "s.normalized->>'address'",
        "phone": "s.normalized->>'phone'",
        "website": "s.normalized->>'website'",
        "opening_hours": "s.normalized->>'opening_hours'",
        "category": "s.category_id::text",
    }
    picks = ",\n".join(f"{_pick(f, v)} AS {f}, {_pick_provider(f, v)} AS {f}_src" for f, v in fields.items())
    sql = f"""
    WITH touched AS (
      SELECT DISTINCT place_id FROM place_sources WHERE changed_run_id = %(run)s::uuid AND place_id IS NOT NULL
    ), agg AS (
      SELECT s.place_id,
        {picks},
        {_pick("coords", "s.lat")} AS lat,
        {_pick("coords", "s.lng")} AS lng,
        {_pick_provider("coords", "s.lat")} AS coords_src,
        count(DISTINCT s.provider) AS providers,
        max(s.last_seen_at) AS last_seen,
        bool_and(s.operating_status = 'permanently_closed' OR s.missing_runs >= %(gone)s) AS all_gone
      FROM place_sources s JOIN touched t ON t.place_id = s.place_id
      GROUP BY s.place_id
    ), next AS (
      SELECT p.id,
        CASE WHEN 'name' = ANY(p.locked_fields) THEN p.name ELSE coalesce(a.name, p.name) END AS name,
        CASE WHEN 'address' = ANY(p.locked_fields) THEN p.address ELSE coalesce(a.address, p.address) END AS address,
        CASE WHEN 'phone' = ANY(p.locked_fields) THEN p.phone ELSE a.phone END AS phone,
        CASE WHEN 'website' = ANY(p.locked_fields) THEN p.website ELSE a.website END AS website,
        CASE WHEN 'opening_hours' = ANY(p.locked_fields) THEN p.opening_hours ELSE a.opening_hours END AS opening_hours,
        CASE WHEN 'category' = ANY(p.locked_fields) THEN p.category_id ELSE coalesce(a.category::uuid, p.category_id) END AS category_id,
        CASE WHEN 'coords' = ANY(p.locked_fields) THEN p.lat ELSE coalesce(a.lat, p.lat) END AS lat,
        CASE WHEN 'coords' = ANY(p.locked_fields) THEN p.lng ELSE coalesce(a.lng, p.lng) END AS lng,
        CASE WHEN p.status = 'HIDDEN' THEN p.status WHEN a.all_gone THEN 'CLOSED'::"PlaceStatus" ELSE 'ACTIVE'::"PlaceStatus" END AS status,
        jsonb_strip_nulls(jsonb_build_object('name', a.name_src, 'address', a.address_src, 'phone', a.phone_src,
          'website', a.website_src, 'opening_hours', a.opening_hours_src, 'category', a.category_src, 'coords', a.coords_src)) AS field_sources,
        least(1.0, 0.25 * a.providers
          + 0.15 * (a.phone IS NOT NULL)::int + 0.15 * (a.website IS NOT NULL)::int
          + 0.15 * (a.address IS NOT NULL)::int + 0.15 * (a.opening_hours IS NOT NULL)::int) AS quality_score,
        a.last_seen
      FROM places p JOIN agg a ON a.place_id = p.id
    )
    UPDATE places p SET
      name = n.name, address = n.address, phone = n.phone, website = n.website, opening_hours = n.opening_hours,
      category_id = n.category_id, category = c.item_type, lat = n.lat, lng = n.lng, status = n.status,
      field_sources = n.field_sources, quality_score = n.quality_score, last_seen_at = n.last_seen, updated_at = now()
    FROM next n JOIN categories c ON c.id = n.category_id
    WHERE p.id = n.id AND (p.name, p.address, p.phone, p.website, p.opening_hours, p.category_id, p.lat, p.lng, p.status, p.field_sources, p.quality_score)
      IS DISTINCT FROM (n.name, n.address, n.phone, n.website, n.opening_hours, n.category_id, n.lat, n.lng, n.status, n.field_sources, n.quality_score)
    RETURNING p.id
    """
    rows = conn.execute(sql, {"run": run_id, "gone": settings.missing_runs_to_close}).fetchall()
    return len(rows)


def refresh_names_and_search(conn: psycopg.Connection, settings: Settings, run_id: str | None, ids: list[str] | None = None) -> int:
    """Area, destination, place_names, name_norm, search_text and search_accent for touched places (those whose sources changed in
    `run_id`, or the explicit `ids`).

    Text normalisation runs in Python so it is byte-for-byte the app's `normalizeSearch`.
    """
    if ids is None:
        ids = [
            r["id"]
            for r in conn.execute(
                "SELECT DISTINCT place_id::text AS id FROM place_sources WHERE changed_run_id = %s::uuid AND place_id IS NOT NULL", [run_id]
            ).fetchall()
        ]
    if not ids:
        return 0
    # Administrative area: the smallest one containing the published point.
    conn.execute(
        """
        UPDATE places p SET area_id = a.id
        FROM (SELECT p2.id AS place_id, (SELECT g.id FROM geo_areas g WHERE g.boundary IS NOT NULL AND ST_Contains(g.boundary, p2.location::geometry)
                                         ORDER BY g.level DESC LIMIT 1) AS id
              FROM places p2 WHERE p2.id = ANY(%s::uuid[])) a
        WHERE p.id = a.place_id AND p.area_id IS DISTINCT FROM a.id
        """,
        [ids],
    )
    # Curated destination: the nearest one within the radius (only fills gaps; never moves a place).
    # Destinations created for a whole province/city get their places through the area instead.
    conn.execute(
        """
        UPDATE places p SET destination_id = (
          SELECT d.id FROM destinations d
          WHERE NOT d.auto_created AND ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography, %(r)s)
          ORDER BY p.location <-> ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography LIMIT 1)
        WHERE p.id = ANY(%(ids)s::uuid[]) AND p.destination_id IS NULL
        """,
        {"ids": ids, "r": settings.destination_radius_km * 1000},
    )
    touched = conn.execute(
        """
        SELECT p.id::text AS id, p.name, p.address, p.search_text, d.name AS dest_name, d.country AS dest_country, g.name AS area_name,
               jsonb_agg(s.normalized->'names' ORDER BY array_position(%(order)s::text[], s.provider)) AS names_list
        FROM places p
        JOIN place_sources s ON s.place_id = p.id
        LEFT JOIN destinations d ON d.id = p.destination_id
        LEFT JOIN geo_areas g ON g.id = p.area_id
        WHERE p.id = ANY(%(ids)s::uuid[])
        GROUP BY p.id, d.name, d.country, g.name
        """,
        {"ids": ids, "order": FIELD_PRIORITY["name"]},
    ).fetchall()
    rows_names: list[tuple[str, str, str]] = []
    rows_text: list[dict[str, Any]] = []
    for t in touched:
        merged: dict[str, str] = {}
        for names in t["names_list"]:
            for lang, value in (names or {}).items():
                merged.setdefault(lang, value)  # highest-priority provider first
        rows_names.extend((t["id"], lang, value) for lang, value in merged.items())
        words = [
            t["name"],
            *[v for v in merged.values() if v != t["name"]],
            t["address"] or "",
            t["dest_name"] or "",
            t["dest_country"] or "",
            short_area_name(t["area_name"]),  # "Đà Nẵng", not "Thành phố Đà Nẵng": "phố" isn't what the place is
        ]
        joined = " ".join(words)
        rows_text.append({"id": t["id"], "norm": normalize_search(t["name"]), "text": normalize_search(joined)[:4000], "accent": accent_search(joined)[:4000]})
    conn.execute("DELETE FROM place_names WHERE place_id = ANY(%s::uuid[]) AND source = 'import'", [ids])
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO place_names (place_id, lang, kind, name, source) VALUES (%s, %s, 'primary', %s, 'import')
               ON CONFLICT (place_id, lang, kind) DO NOTHING""",
            rows_names,
        )
        cur.executemany(
            """UPDATE places SET name_norm = %(norm)s, search_text = %(text)s, search_accent = %(accent)s
               WHERE id = %(id)s::uuid AND (name_norm, search_text, search_accent) IS DISTINCT FROM (%(norm)s, %(text)s, %(accent)s)""",
            rows_text,
        )
    return len(ids)


def reassign_areas(conn: psycopg.Connection, settings: Settings, bbox: tuple[float, float, float, float]) -> int:
    """After boundaries change: re-file every place inside `bbox` whose smallest containing area is different."""
    ids = [
        r["id"]
        for r in conn.execute(
            """
        SELECT p.id::text AS id FROM places p
        WHERE p.location IS NOT NULL AND p.location::geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
          AND p.area_id IS DISTINCT FROM (
            SELECT g.id FROM geo_areas g WHERE g.boundary IS NOT NULL AND ST_Contains(g.boundary, p.location::geometry)
            ORDER BY g.level DESC LIMIT 1)
        """,
            list(bbox),
        ).fetchall()
    ]
    for i in range(0, len(ids), settings.batch_size):
        refresh_names_and_search(conn, settings, None, ids[i : i + settings.batch_size])
    return len(ids)


def mark_missing(conn: psycopg.Connection, settings: Settings, run_id: str, provider: str, boxes: list[list[float]]) -> dict[str, Any]:
    """After a COMPLETE run: records of this provider inside the scope that weren't seen get missing_runs + 1.

    Safety brake: if this would close more than `max_close_ratio` of the active places in scope, nothing is
    applied and the caller marks the run needs_review (usually a broken source file or a wrong bbox).
    """
    box_sql = " OR ".join("(s.lng BETWEEN %s AND %s AND s.lat BETWEEN %s AND %s)" for _ in boxes)
    box_params = [v for b in boxes for v in (b[0], b[2], b[1], b[3])]
    scope = f"s.provider = %s AND s.last_run_id IS DISTINCT FROM %s::uuid AND ({box_sql})"
    conn.execute("SAVEPOINT mark_missing")
    rows = conn.execute(
        f"UPDATE place_sources s SET missing_runs = missing_runs + 1 WHERE {scope} RETURNING s.id, s.place_id, s.missing_runs",
        [provider, run_id, *box_params],
    ).fetchall()
    newly_gone = [r for r in rows if r["missing_runs"] == settings.missing_runs_to_close and r["place_id"]]
    closing = 0
    if newly_gone:
        closing = conn.execute(
            """
            SELECT count(*) AS n FROM places p WHERE p.id = ANY(%(ids)s::uuid[]) AND p.status = 'ACTIVE'
              AND NOT EXISTS (SELECT 1 FROM place_sources o WHERE o.place_id = p.id
                              AND o.operating_status <> 'permanently_closed' AND o.missing_runs < %(gone)s)
            """,
            {"ids": [r["place_id"] for r in newly_gone], "gone": settings.missing_runs_to_close},
        ).fetchone()["n"]  # type: ignore[index]
    active = conn.execute(
        f"""SELECT count(DISTINCT p.id) AS n FROM places p JOIN place_sources s ON s.place_id = p.id
            WHERE p.status = 'ACTIVE' AND ({box_sql})""",
        box_params,
    ).fetchone()["n"]  # type: ignore[index]
    if active and closing / active > settings.max_close_ratio:
        conn.execute("ROLLBACK TO SAVEPOINT mark_missing")
        return {"missing": 0, "would_close": closing, "active": active, "blocked": True}
    if newly_gone:  # re-publish those places so their status is recomputed
        conn.execute("UPDATE place_sources SET changed_run_id = %s::uuid WHERE id = ANY(%s::uuid[])", [run_id, [r["id"] for r in newly_gone]])
    conn.execute("RELEASE SAVEPOINT mark_missing")
    return {"missing": len(rows), "would_close": closing, "active": active, "blocked": False}


def publish(
    conn: psycopg.Connection,
    settings: Settings,
    run_id: str,
    providers: list[str],
    require_area: bool,
    dedupe: bool = True,
    category_keys: list[str] | None = None,
) -> dict[str, Any]:
    """`category_keys` (a job's filter): only records in those Golaly groups / categories become or join places."""
    stats: dict[str, Any] = {}
    for provider in [p for p in PUBLISH_ORDER if p in providers]:
        stats[provider] = attach_and_create(conn, settings, run_id, provider, require_area, category_keys)
    stats["updated"] = refresh_places(conn, settings, run_id)
    stats["indexed"] = refresh_names_and_search(conn, settings, run_id)
    if dedupe:
        from .dedupe import dedupe as run_dedupe

        touched = [
            r["id"]
            for r in conn.execute(
                "SELECT DISTINCT place_id::text AS id FROM place_sources WHERE changed_run_id = %s::uuid AND place_id IS NOT NULL", [run_id]
            ).fetchall()
        ]
        stats["dedupe"] = run_dedupe(conn, settings, touched)
    return stats
