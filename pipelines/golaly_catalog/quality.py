"""Data-quality checks run at the end of every sync, over the run's scope (shown on the admin run page).

- points at (0, 0) or outside every known boundary while inside the scope's boxes;
- completeness: share of active places with an address, opening hours, a website — per category group;
- likely duplicates left over: two active places with the same normalised name less than 20 m apart;
- average `quality_score`.

Thresholds turn into `warnings` (the run still succeeds; an admin looks at them).
"""

from __future__ import annotations

from typing import Any

import psycopg

from .config import Settings

MAX_LEFTOVER_DUPLICATE_RATIO = 0.02
MAX_OUTSIDE_RATIO = 0.01


def quality_checks(conn: psycopg.Connection, settings: Settings, boxes: list[dict[str, float]]) -> dict[str, Any]:
    if not boxes:
        return {}
    box_sql = " OR ".join("(p.lng BETWEEN %s AND %s AND p.lat BETWEEN %s AND %s)" for _ in boxes)
    params = [v for b in boxes for v in (b["min_lng"], b["max_lng"], b["min_lat"], b["max_lat"])]
    scope = f"p.status = 'ACTIVE' AND p.merged_into_id IS NULL AND ({box_sql})"
    totals = conn.execute(
        f"""SELECT count(*) AS places,
                   count(*) FILTER (WHERE p.lat = 0 AND p.lng = 0) AS zero_points,
                   count(*) FILTER (WHERE p.area_id IS NULL) AS outside_areas,
                   round(avg(p.quality_score)::numeric, 3) AS avg_quality
            FROM places p WHERE {scope}""",
        params,
    ).fetchone()
    groups = conn.execute(
        f"""SELECT coalesce(g.key, c.key, 'none') AS grp, count(*) AS n,
                   round(avg((p.address <> '')::int)::numeric, 3) AS address,
                   round(avg((p.opening_hours IS NOT NULL)::int)::numeric, 3) AS opening_hours,
                   round(avg((p.website IS NOT NULL)::int)::numeric, 3) AS website
            FROM places p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories g ON g.id = c.parent_id
            WHERE {scope} GROUP BY 1 ORDER BY 2 DESC""",
        params,
    ).fetchall()
    dupes = conn.execute(
        f"""SELECT count(*) AS n FROM places p JOIN places o
              ON o.id > p.id AND o.status = 'ACTIVE' AND o.merged_into_id IS NULL AND o.name_norm = p.name_norm AND o.name_norm <> ''
             AND ST_DWithin(o.location, p.location, 20)
            WHERE {scope}""",
        params,
    ).fetchone()["n"]  # type: ignore[index]
    n = int(totals["places"] or 0)  # type: ignore[index]
    out: dict[str, Any] = {
        "places": n,
        "zero_points": int(totals["zero_points"]),  # type: ignore[index]
        "outside_areas": int(totals["outside_areas"]),  # type: ignore[index]
        "avg_quality": float(totals["avg_quality"] or 0),  # type: ignore[index]
        "leftover_duplicates": int(dupes),
        "completeness": {r["grp"]: {k: float(r[k]) for k in ("address", "opening_hours", "website")} | {"places": r["n"]} for r in groups},
    }
    warnings = []
    if out["zero_points"]:
        warnings.append(f"{out['zero_points']} place(s) at (0, 0)")
    if n and out["outside_areas"] / n > MAX_OUTSIDE_RATIO:
        warnings.append(f"{out['outside_areas']} place(s) outside every known boundary")
    if n and out["leftover_duplicates"] / n > MAX_LEFTOVER_DUPLICATE_RATIO:
        warnings.append(f"{out['leftover_duplicates']} pair(s) with the same name less than 20 m apart")
    out["warnings"] = warnings
    return out
