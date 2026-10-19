"""`golaly-catalog verify --area vn`: has a big sync reached the phase 3 "done" bar, and where is review needed?

Checks the area's last real (non-dry) run and the catalog it produced:

1. the run finished cleanly (`succeeded`; `partial` / `failed` / `cancelled` can be resumed);
2. every partition loaded (cursors done = partitions planned);
3. the quality checks raised no warnings ((0, 0) points, places outside every boundary, leftover same-name pairs);
4. every region (province) has published places.

It also lists, per region, the duplicate pairs waiting for an admin (`merge_candidates` PENDING), busiest first —
that is the review queue for the tourist cities.
"""

from __future__ import annotations

from typing import Any

from . import db
from .config import Settings


def verify_area(settings: Settings, area: str) -> dict[str, Any]:
    slug = area.strip().lower()
    with db.connect(settings.database_url) as conn:
        g = conn.execute("SELECT id, name, level::text AS level FROM geo_areas WHERE slug = %s", [slug]).fetchone()
        if not g:
            raise LookupError(f"No geo area '{slug}'. Import its boundaries first (golaly-catalog boundaries --country …).")
        regions = conn.execute(
            """SELECT r.id, r.slug, r.name,
                      (SELECT count(*) FROM places p WHERE p.area_id = r.id AND p.status = 'ACTIVE' AND p.merged_into_id IS NULL) AS places
               FROM geo_areas r WHERE r.parent_id = %(id)s OR (r.id = %(id)s AND NOT EXISTS (SELECT 1 FROM geo_areas c WHERE c.parent_id = %(id)s))
               ORDER BY r.name""",
            {"id": g["id"]},
        ).fetchall()
        run = conn.execute(
            """SELECT id::text AS id, trigger, status, progress, stats, error, started_at, finished_at,
                      (SELECT count(*) FROM sync_run_errors e WHERE e.run_id = s.id) AS errors,
                      (SELECT count(*) FROM sync_run_cursors c WHERE c.run_id = s.id AND c.done) AS partitions_done,
                      (SELECT count(*) FROM sync_run_cursors c WHERE c.run_id = s.id AND c.failed) AS partitions_retried
               FROM sync_runs s
               WHERE lower(params->>'area') = %s AND trigger <> 'dry_run' AND coalesce((params->>'dry_run')::boolean, false) = false
               ORDER BY started_at DESC LIMIT 1""",
            [slug],
        ).fetchone()
        queue = conn.execute(
            """WITH pending AS (
                 SELECT m.score, coalesce(CASE WHEN ga.parent_id = %(id)s OR ga.id = %(id)s THEN ga.slug END, gp.slug) AS region
                 FROM merge_candidates m
                 JOIN places a ON a.id = m.place_a AND a.merged_into_id IS NULL
                 JOIN places b ON b.id = m.place_b AND b.merged_into_id IS NULL
                 JOIN geo_areas ga ON ga.id = a.area_id
                 LEFT JOIN geo_areas gp ON gp.id = ga.parent_id
                 WHERE m.status = 'PENDING' AND (ga.id = %(id)s OR ga.parent_id = %(id)s OR gp.parent_id = %(id)s))
               SELECT region, count(*) AS pairs, count(*) FILTER (WHERE score >= 0.75) AS likely
               FROM pending GROUP BY region ORDER BY pairs DESC""",
            {"id": g["id"]},
        ).fetchall()

    checks: list[dict[str, Any]] = []

    def check(name: str, ok: bool, detail: Any = None) -> None:
        checks.append({"check": name, "ok": ok, **({"detail": detail} if detail is not None else {})})

    if not run:
        check("a sync has run for this area", False, f"run: golaly-catalog sync --area {slug}  (or catalog_sync with {{'area': '{slug}'}})")
    else:
        progress = run["progress"] or {}
        stats = run["stats"] or {}
        check(
            "last run finished cleanly",
            run["status"] == "succeeded",
            None
            if run["status"] == "succeeded"
            else f"status {run['status']} — continue it: golaly-catalog resume {run['id']} (or Resume on the admin run page)",
        )
        total = int(progress.get("total") or 0)
        done = int(run["partitions_done"] or progress.get("done") or 0)
        check("every partition loaded", total > 0 and done == total, f"{done}/{total} partitions")
        warnings = (stats.get("quality") or {}).get("warnings") or []
        check("quality checks pass", not warnings, warnings or None)
    empty = [r["slug"] for r in regions if not r["places"]]
    check("every region has places", not empty, empty or f"{len(regions)} regions")

    duration = None
    if run and run["finished_at"]:
        duration = round((run["finished_at"] - run["started_at"]).total_seconds() / 3600, 2)
    return {
        "area": slug,
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
        "run": None
        if not run
        else {
            "id": run["id"],
            "trigger": run["trigger"],
            "status": run["status"],
            "hours": duration,
            "record_errors": run["errors"],
            "partitions_retried": run["partitions_retried"],
        },
        "places": {r["slug"]: r["places"] for r in regions},
        "review_queue": {
            "pending_pairs": sum(q["pairs"] for q in queue),
            "by_region": [{"region": q["region"], "pairs": q["pairs"], "likely_same": q["likely"]} for q in queue],
            "how": "Admin → Duplicates, filter by region slug; or golaly-catalog merges list --area <region>",
        },
    }
