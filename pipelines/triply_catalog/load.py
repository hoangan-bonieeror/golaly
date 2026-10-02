"""Load step: normalised records → place_sources (staging), idempotently.

Rows are COPY'd into a temp table, then upserted on (provider, external_id). A row only counts as
"changed" (and is re-published) when its content hash or resolved category actually changed.
"""

from __future__ import annotations

import json
from typing import Any

import psycopg

from .models import NormalizedPlace


def _json(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, default=str)


def load_batch(conn: psycopg.Connection, run_id: str, batch: list[NormalizedPlace], license: str, attribution: str) -> dict[str, int]:
    if not batch:
        return {"fetched": 0, "inserted": 0, "changed": 0}
    conn.execute(
        """
        CREATE TEMP TABLE IF NOT EXISTS stage (
          provider text, external_id text, raw jsonb, normalized jsonb, content_hash text,
          lat double precision, lng double precision, category_candidates text[], operating_status text
        ) ON COMMIT DELETE ROWS
        """
    )
    conn.execute("DELETE FROM stage")  # dry runs never commit, so clear explicitly
    with conn.cursor().copy(
        "COPY stage (provider, external_id, raw, normalized, content_hash, lat, lng, category_candidates, operating_status) FROM STDIN"
    ) as copy:
        for p in batch:
            copy.write_row([p.provider, p.external_id, _json(p.raw), _json(p.normalized()), p.hash(), p.lat, p.lng, p.category_candidates, p.operating_status])
    row = conn.execute(
        """
        WITH dedup AS (
          SELECT DISTINCT ON (provider, external_id) * FROM stage ORDER BY provider, external_id
        ), resolved AS (
          SELECT d.*, (
            SELECT cm.category_id FROM unnest(d.category_candidates) WITH ORDINALITY AS c(k, ord)
            JOIN category_maps cm ON cm.provider = d.provider AND cm.external_category = c.k
            ORDER BY c.ord LIMIT 1
          ) AS category_id
          FROM dedup d
        ), up AS (
          INSERT INTO place_sources AS ps (id, provider, external_id, raw, normalized, content_hash, lat, lng, category_id,
                                     license, attribution, operating_status, first_seen_at, last_seen_at, last_run_id, changed_run_id, missing_runs)
          SELECT gen_random_uuid(), provider, external_id, raw, normalized, content_hash, lat, lng, category_id,
                 %(license)s, %(attribution)s, operating_status, now(), now(), %(run)s::uuid, %(run)s::uuid, 0
          FROM resolved
          ON CONFLICT (provider, external_id) DO UPDATE SET
            raw = EXCLUDED.raw, normalized = EXCLUDED.normalized, content_hash = EXCLUDED.content_hash,
            lat = EXCLUDED.lat, lng = EXCLUDED.lng, category_id = EXCLUDED.category_id,
            operating_status = EXCLUDED.operating_status, license = EXCLUDED.license, attribution = EXCLUDED.attribution,
            last_seen_at = now(), last_run_id = EXCLUDED.last_run_id, missing_runs = 0,
            changed_run_id = CASE
              WHEN ps.content_hash IS DISTINCT FROM EXCLUDED.content_hash OR ps.category_id IS DISTINCT FROM EXCLUDED.category_id
                OR ps.missing_runs > 0
              THEN EXCLUDED.changed_run_id ELSE ps.changed_run_id END
          RETURNING (xmax = 0) AS inserted, (changed_run_id = %(run)s::uuid) AS changed
        )
        SELECT count(*) AS total, count(*) FILTER (WHERE inserted) AS inserted,
               count(*) FILTER (WHERE changed AND NOT inserted) AS changed
        FROM up
        """,
        {"run": run_id, "license": license, "attribution": attribution},
    ).fetchone()
    assert row
    return {"fetched": len(batch), "inserted": row["inserted"], "changed": row["changed"]}


def assign_areas(conn: psycopg.Connection, run_id: str) -> int:
    """Smallest administrative area containing each new/changed source record."""
    cur = conn.execute(
        """
        UPDATE place_sources s SET area_id = (
          SELECT g.id FROM geo_areas g
          WHERE g.boundary IS NOT NULL AND ST_Contains(g.boundary, ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326))
          ORDER BY g.level DESC LIMIT 1
        )
        WHERE s.changed_run_id = %s
        """,
        [run_id],
    )
    return cur.rowcount
