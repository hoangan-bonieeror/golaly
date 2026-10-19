"""Orchestration shared by the CLI and the Airflow DAG.

    start → plan (scope → partitions, adopt manual places) → extract_load × partitions → finalize
          (areas, missing records, publish) → finish

Each function opens its own connection so Airflow can run them as separate tasks/processes.
"""

from __future__ import annotations

import logging
import math
import time
import uuid
from dataclasses import asdict
from typing import Any

import psycopg

from . import db
from .config import Settings
from .load import assign_areas, load_batch
from .models import BBox, NormalizedPlace, Partition
from .publish import mark_missing, publish
from .quality import quality_checks
from .sources import MANUAL, check_keys, check_ready, get_source
from .taxonomy import sync_taxonomy

log = logging.getLogger(__name__)


class ScopeError(ValueError):
    pass


def resolve_scope(conn: psycopg.Connection, settings: Settings, area: str | None, bbox: str | None) -> tuple[list[Partition], bool]:
    """Returns (partitions, require_area).

    - a geo area slug ("vn", "vn-da-nang"): one partition per region with a known boundary; only records
      inside the boundaries are published (bbox corners outside the country are dropped).
    - a destination slug ("hoi-an"): a box of `destination_radius_km` around its centre — or, for a destination
      created from a province/city ("da-nang"), that area.
    - --bbox "minLng,minLat,maxLng,maxLat".
    """
    if bbox:
        x0, y0, x1, y1 = (float(v) for v in bbox.split(","))
        return [Partition("", "bbox", BBox(x0, y0, x1, y1), country=country_at(conn, (y0 + y1) / 2, (x0 + x1) / 2))], False
    if not area:
        raise ScopeError("Give --area (geo area or destination slug) or --bbox.")
    area = area.strip().lower()  # slugs are lower-case: "MX" means "mx"
    g = conn.execute(
        "SELECT id::text AS id, level::text AS level, slug, country_code, min_lng, min_lat, max_lng, max_lat FROM geo_areas WHERE slug = %s", [area]
    ).fetchone()
    if g:
        rows = [g]
        if g["level"] == "COUNTRY":
            children = conn.execute(
                """SELECT id::text AS id, slug, country_code, min_lng, min_lat, max_lng, max_lat FROM geo_areas
                   WHERE parent_id = %s AND boundary IS NOT NULL ORDER BY slug""",
                [g["id"]],
            ).fetchall()
            rows = children or rows
        parts = [
            Partition("", r["slug"], BBox(r["min_lng"], r["min_lat"], r["max_lng"], r["max_lat"]), r["id"], r["country_code"])
            for r in rows
            if r["min_lng"] is not None
        ]
        if not parts:
            raise ScopeError(f"Geo area {area!r} has no bounding box — run `golaly-catalog boundaries` first.")
        return parts, True
    d = conn.execute(
        """SELECT d.slug, d.lat, d.lng, g.slug AS area_slug FROM destinations d
           LEFT JOIN geo_areas g ON g.id = d.represents_area_id AND d.auto_created WHERE d.slug = %s""",
        [area],
    ).fetchone()
    if d and d["area_slug"]:  # a destination made for a whole province/city: its boundary, not a box around the centre
        return resolve_scope(conn, settings, d["area_slug"], None)
    if d:
        r = settings.destination_radius_km
        dlat, dlng = r / 111.32, r / (111.32 * math.cos(math.radians(d["lat"])))
        box = BBox(d["lng"] - dlng, d["lat"] - dlat, d["lng"] + dlng, d["lat"] + dlat)
        return [Partition("", d["slug"], box, country=country_at(conn, d["lat"], d["lng"]))], False
    if len(area) == 2 and area.isalpha():
        raise ScopeError(
            f"Country {area.upper()!r} has no boundaries yet. Import them first: `golaly-catalog boundaries --country {area.upper()}` "
            f'(or the catalog_bootstrap DAG with {{"country": "{area.upper()}"}}), then sync --area {area}.'
        )
    raise ScopeError(f"No geo area or destination with slug {area!r} (geo areas look like 'vn' or 'vn-da-nang', destinations like 'hoi-an').")


def country_at(conn: psycopg.Connection, lat: float, lng: float) -> str | None:
    """ISO code of the imported country containing the point (None when its boundaries aren't imported)."""
    row = conn.execute(
        """SELECT country_code FROM geo_areas WHERE boundary IS NOT NULL AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
           ORDER BY level LIMIT 1""",
        [lng, lat],
    ).fetchone()
    return row["country_code"] if row else None


def adopt_manual_places(conn: psycopg.Connection, run_id: str) -> int:
    """Places created by hand or by the demo seed get a 'manual' source record, so they take part in
    matching and survivorship like any other source (and keep priority over imports)."""
    rows = conn.execute(
        """SELECT p.id::text AS id, p.name, p.address, p.lat, p.lng, p.category::text AS category, c.key AS category_key
           FROM places p LEFT JOIN categories c ON c.id = p.category_id
           WHERE NOT EXISTS (SELECT 1 FROM place_sources s WHERE s.place_id = p.id) AND p.merged_into_id IS NULL"""
    ).fetchall()
    batch = [
        NormalizedPlace(
            provider="manual",
            external_id=r["id"],
            lat=r["lat"],
            lng=r["lng"],
            name=r["name"],
            category_candidates=[k for k in (r["category_key"], r["category"]) if k],
            address=r["address"] or None,
            raw={"place_id": r["id"]},
        )
        for r in rows
    ]
    if batch:
        load_batch(conn, run_id, batch, MANUAL.license, MANUAL.attribution)
        conn.execute(
            "UPDATE place_sources SET place_id = external_id::uuid WHERE provider = 'manual' AND place_id IS NULL AND changed_run_id = %s::uuid",
            [run_id],
        )
    return len(batch)


# ── steps ────────────────────────────────────────────────────────────────────


#: A run still "running" after this long was interrupted (its process is gone); it's marked failed.
STALE_RUNNING_HOURS = 48


def start(settings: Settings, params: dict[str, Any], trigger: str) -> str:
    with db.connect(settings.database_url) as conn:
        sync_taxonomy(conn)
        close_stale_runs(conn)
        return db.start_run(conn, trigger, params)


def reopen_run(conn: psycopg.Connection, run_id: str) -> None:
    """Mark an existing run (queued by the admin API / scheduler, or one being resumed) as running again."""
    conn.execute(
        """UPDATE sync_runs SET status = 'running', started_at = now(), finished_at = NULL, error = NULL, cancel_requested = false
           WHERE id = %s::uuid""",
        [run_id],
    )
    conn.commit()


RESUMABLE = ("failed", "partial", "cancelled", "running")


class ResumeError(LookupError):
    """The run doesn't exist or can't be resumed (the CLI prints the message)."""


def resume_params(settings: Settings, run_id: str) -> dict[str, Any]:
    """The parameters to resume a run with; refuses runs that finished cleanly or were dry runs."""
    with db.connect(settings.database_url) as conn:
        row = conn.execute("SELECT status, params, trigger FROM sync_runs WHERE id = %s::uuid", [run_id]).fetchone()
    if not row:
        raise ResumeError(f"no sync run {run_id}")
    if row["status"] not in RESUMABLE or row["trigger"] == "dry_run" or (row["params"] or {}).get("dry_run"):
        raise ResumeError(f"run {run_id} is {row['status']}; only failed, partial, cancelled or interrupted runs can be resumed")
    p = row["params"] or {}
    return {"area": p.get("area"), "bbox": p.get("bbox"), "providers": p.get("providers") or [], "category_keys": p.get("category_keys") or []}


def close_stale_runs(conn: psycopg.Connection) -> int:
    n = conn.execute(
        """UPDATE sync_runs SET status = 'failed', finished_at = now(), error = coalesce(error, 'interrupted (no result after %s h)')
           WHERE status = 'running' AND started_at < now() - make_interval(hours => %s)""",
        [STALE_RUNNING_HOURS, STALE_RUNNING_HOURS],
    ).rowcount
    conn.commit()
    return n


def _intersects(a: BBox, b: BBox) -> bool:
    return a.min_lng <= b.max_lng and b.min_lng <= a.max_lng and a.min_lat <= b.max_lat and b.min_lat <= a.max_lat


def partition_dicts(
    settings: Settings, scope: list[Partition], require_area: bool, providers: list[str], category_keys: list[str] | None = None
) -> list[dict[str, Any]]:
    """Each source's partitions as plain dicts (Airflow XCom), with the scope keys each one covers — so a partial
    run knows which areas were fully fetched — and the run's category filter."""
    out = []
    for key in providers:
        for p in get_source(key, settings).partitions(scope):
            covers = [s.key for s in scope if _intersects(s.bbox, p.bbox)]
            out.append({**asdict(p), "require_area": require_area, "covers": covers, "categories": list(category_keys or [])})
    return out


def plan(
    settings: Settings, run_id: str, area: str | None, bbox: str | None, providers: list[str], category_keys: list[str] | None = None
) -> list[dict[str, Any]]:
    providers = check_keys(providers, "places")
    check_ready(providers, settings)
    with db.connect(settings.database_url) as conn:
        scope, require_area = resolve_scope(conn, settings, area, bbox)
        adopted = adopt_manual_places(conn, run_id)
        conn.commit()
        out = partition_dicts(settings, scope, require_area, providers, category_keys)
        # A resumed run keeps the partitions it already finished (their cursors say done).
        failed = conn.execute("SELECT count(*) AS n FROM sync_run_cursors WHERE run_id = %s::uuid AND failed AND NOT done", [run_id]).fetchone()["n"]  # type: ignore[index]
        db.set_progress(conn, run_id, total=len(out), done=db.done_partitions(conn, run_id), failed=int(failed))
    log.info("run %s: %d partition(s), adopted %d manual place(s)", run_id, len(out), adopted)
    return out


def _partition(d: dict[str, Any]) -> Partition:
    return Partition(d["provider"], d["key"], BBox(**d["bbox"]), d.get("area_id"), d.get("country"))


def extract_load(settings: Settings, run_id: str, part: dict[str, Any], conn: psycopg.Connection | None = None) -> dict[str, int]:
    """One partition: fetch from the provider and upsert into place_sources, a batch per transaction.

    A real run (own connection) reports progress, stops between batches when an admin cancels, records a failure in
    sync_run_errors before re-raising, and **resumes**: each batch commits together with the partition's cursor
    (`sync_run_cursors`), so a retried task (worker died, Airflow restarted, task cleared) skips the partition if it
    finished, or the batches already loaded, and ends with the same totals as an uninterrupted run. Skipping relies on
    the source yielding records in a stable order; the last id of the last loaded batch is checked, and on a mismatch
    the partition is loaded again from the start (upserts are idempotent; only its counters may then differ).
    A dry run (caller's connection) does none of that."""
    partition = _partition(part)
    source = get_source(partition.provider, settings)
    m = source.manifest
    own = conn is None
    conn = conn or db.connect(settings.database_url)
    label = f"{partition.provider}/{partition.key}"
    cur = db.get_cursor(conn, run_id, partition.provider, partition.key) if own else db.Cursor()
    if cur.done:
        log.info("%s: already loaded in this run (%s), skipped", label, cur.totals)
        if own:
            conn.close()
        return {k: int(cur.totals.get(k, 0)) for k in ("fetched", "inserted", "changed")}
    resume_from = cur.batches
    totals = {k: int(cur.totals.get(k, 0)) for k in ("fetched", "inserted", "changed")}
    if resume_from:
        log.info("%s: resuming after batch %d (%s)", label, resume_from, totals)
    t0 = time.monotonic()
    try:
        for i, batch in enumerate(source.fetch_places(partition)):
            if i < resume_from:
                if i == resume_from - 1 and batch and batch[-1].external_id != cur.last_key:
                    log.warning("%s: source order changed since the interrupted attempt; loading the partition again", label)
                    db.add_error(conn, run_id, "resume", "source order changed; partition loaded again from the start", partition.provider, partition.key)
                    return _reload(settings, run_id, part, conn if own else None, own, cur)
                continue
            if own:
                db.check_cancel(conn, run_id)
            stats = load_batch(conn, run_id, batch, m.license, m.attribution, m.storage)
            for k in totals:
                totals[k] += stats[k]
            if own:
                cur.batches, cur.last_key, cur.totals = i + 1, batch[-1].external_id if batch else cur.last_key, dict(totals)
                db.save_cursor(conn, run_id, partition.provider, partition.key, cur)
                conn.commit()
        if own:
            was_failed = cur.failed
            cur.done, cur.failed, cur.totals = True, False, dict(totals)
            db.save_cursor(conn, run_id, partition.provider, partition.key, cur)
            conn.commit()
            db.bump_progress(conn, run_id, "done", label)
            if was_failed:  # an earlier attempt counted it as failed; this one succeeded
                db.bump_progress(conn, run_id, "failed", by=-1)
    except Exception as e:
        if own:
            conn.rollback()
            if not isinstance(e, db.Cancelled):
                db.add_error(conn, run_id, "extract", f"{type(e).__name__}: {e}", partition.provider, partition.key)
                if not cur.failed:  # retries of the same partition count once
                    cur.failed = True
                    db.save_cursor(conn, run_id, partition.provider, partition.key, cur)
                    conn.commit()
                    db.bump_progress(conn, run_id, "failed", label)
        raise
    finally:
        if own and not conn.closed:
            conn.close()
    log.info("%s: %s in %.1fs", label, totals, time.monotonic() - t0)
    return totals


def _reload(settings: Settings, run_id: str, part: dict[str, Any], conn: psycopg.Connection | None, own: bool, cur: db.Cursor) -> dict[str, int]:
    """Start the partition over (keeping its `failed` flag), after a resume found a different record order."""
    if own and conn is not None:
        db.save_cursor(conn, run_id, part["provider"], part["key"], db.Cursor(failed=cur.failed))
        conn.commit()
        conn.close()
    return extract_load(settings, run_id, part)


def finalize(
    settings: Settings, run_id: str, parts: list[dict[str, Any]], providers: list[str], complete: bool = True, conn: psycopg.Connection | None = None
) -> dict[str, Any]:
    own = conn is None
    conn = conn or db.connect(settings.database_url)
    try:
        # Records this run saw that were never published — loaded by an earlier run that stopped before its own
        # publish step (crash, timeout, Airflow restart). Their content didn't change since, so without this they
        # would never count as "changed" again and never become places.
        revived = conn.execute(
            """UPDATE place_sources SET changed_run_id = %(run)s::uuid
               WHERE last_run_id = %(run)s::uuid AND place_id IS NULL AND changed_run_id IS DISTINCT FROM %(run)s::uuid""",
            {"run": run_id},
        ).rowcount
        stats: dict[str, Any] = {"areas_assigned": assign_areas(conn, run_id), "revived": revived}
        blocked = False
        if complete:
            for provider in providers:
                boxes = [p["bbox"] for p in parts if p["provider"] == provider]
                if boxes:
                    m = mark_missing(conn, settings, run_id, provider, [[b["min_lng"], b["min_lat"], b["max_lng"], b["max_lat"]] for b in boxes])
                    stats[f"{provider}_missing"] = m
                    blocked = blocked or m["blocked"]
        require_area = any(p.get("require_area") for p in parts)
        categories = next((p.get("categories") for p in parts if p.get("categories")), [])
        stats["publish"] = publish(conn, settings, run_id, ["manual", *providers], require_area, category_keys=categories)
        stats["quality"] = quality_checks(conn, settings, [p["bbox"] for p in parts])
        stats["status"] = "needs_review" if blocked else "succeeded"
        if own:
            conn.commit()
        return stats
    finally:
        if own:
            conn.close()


def finish(settings: Settings, run_id: str, status: str, stats: dict[str, Any], error: str | None = None) -> None:
    with db.connect(settings.database_url) as conn:
        db.finish_run(conn, run_id, status, stats, error)
    alert(settings, run_id, status, stats, error)


def cancel_requested(settings: Settings, run_id: str) -> bool:
    with db.connect(settings.database_url) as conn:
        row = conn.execute("SELECT cancel_requested FROM sync_runs WHERE id = %s::uuid", [run_id]).fetchone()
        return bool(row and row["cancel_requested"])


def alert(settings: Settings, run_id: str, status: str, stats: dict[str, Any], error: str | None) -> None:
    """Post to CATALOG_ALERT_WEBHOOK (Slack-compatible {"text": …}) when a run fails, needs review or has quality
    warnings. Best effort: an unreachable webhook never fails the run."""
    warnings = (stats.get("quality") or {}).get("warnings") or []
    if not settings.alert_webhook or (status not in ("failed", "needs_review", "partial") and not warnings):
        return
    import httpx

    lines = [f"Golaly catalog run {run_id}: {status}"]
    if error:
        lines.append(error[:500])
    lines += [f"- {w}" for w in warnings]
    try:
        httpx.post(settings.alert_webhook, json={"text": "\n".join(lines)}, timeout=10)
    except httpx.HTTPError as e:
        log.warning("alert webhook failed: %s", e)


def photo_scope(area: str | None, bbox: str | None, parts: list[dict[str, Any]], done: set[str] | None = None) -> dict[str, Any] | None:
    """What a finished sync hands to the photo step: the areas whose places were fully fetched.

    `done` holds the "provider/key" of partitions that finished (None = all). A scope key (region or destination)
    counts when every partition covering it finished; nothing counts → None (don't look for photos).
    """
    finished = done if done is not None else {f"{p['provider']}/{p['key']}" for p in parts}
    if all(f"{p['provider']}/{p['key']}" in finished for p in parts):
        return {"areas": [area] if area else [], "bbox": None if area else bbox}
    keys = list(dict.fromkeys(k for p in parts for k in p.get("covers", [])))
    ok = [k for k in keys if all(f"{p['provider']}/{p['key']}" in finished for p in parts if k in p.get("covers", []))]
    if not ok:
        return None
    if bbox and not area:
        return {"areas": [], "bbox": bbox}
    return {"areas": ok, "bbox": None}


# ── one-shot run (CLI) ───────────────────────────────────────────────────────


def run_sync(
    settings: Settings,
    area: str | None,
    bbox: str | None,
    providers: list[str],
    dry_run: bool = False,
    trigger: str = "cli",
    category_keys: list[str] | None = None,
    job_id: str | None = None,
    sync_run_id: str | None = None,
) -> dict[str, Any]:
    """`sync_run_id`: an existing sync_runs row to report into (created by the admin API or the scheduler)."""
    params = {"area": area, "bbox": bbox, "providers": providers, "dry_run": dry_run, "category_keys": category_keys or []}
    if dry_run:
        try:
            out = _dry_run(settings, area, bbox, providers, category_keys)
        except Exception as e:
            if sync_run_id:
                finish(settings, sync_run_id, "failed", {}, f"{type(e).__name__}: {e}"[:2000])
            raise
        if sync_run_id:
            finish(settings, sync_run_id, "dry_run", out)
        return out
    if sync_run_id:
        with db.connect(settings.database_url) as conn:
            sync_taxonomy(conn)
            reopen_run(conn, sync_run_id)
        run_id = sync_run_id
    else:
        with db.connect(settings.database_url) as conn:
            sync_taxonomy(conn)
            run_id = db.start_run(conn, trigger, params, job_id)
    try:
        with db.connect(settings.database_url) as lock_conn, db.advisory_lock(lock_conn, f"catalog:{area or bbox}"):
            parts = plan(settings, run_id, area, bbox, providers, category_keys)
            loaded = {f"{p['provider']}/{p['key']}": extract_load(settings, run_id, p) for p in parts}
            stats = finalize(settings, run_id, parts, providers)
        result = {"run_id": run_id, "loaded": loaded, **stats}
        finish(settings, run_id, stats["status"], result)
        result["photo_scope"] = photo_scope(area, bbox, parts)
        return result
    except db.Cancelled:
        finish(settings, run_id, "cancelled", {}, "cancelled by an admin")
        raise
    except Exception as e:
        finish(settings, run_id, "failed", {}, f"{type(e).__name__}: {e}"[:2000])
        raise


def _dry_run(settings: Settings, area: str | None, bbox: str | None, providers: list[str], category_keys: list[str] | None) -> dict[str, Any]:
    """Everything in one transaction that is rolled back: real numbers, no writes."""
    run_id = str(uuid.uuid4())
    with db.connect(settings.database_url) as conn:
        sync_taxonomy(conn)  # commits taxonomy only; harmless and idempotent
        providers = check_keys(providers, "places")
        check_ready(providers, settings)
        scope, require_area = resolve_scope(conn, settings, area, bbox)
        adopt_manual_places(conn, run_id)
        parts = partition_dicts(settings, scope, require_area, providers, category_keys)
        loaded = {f"{p['provider']}/{p['key']}": extract_load(settings, run_id, p, conn) for p in parts}
        stats = finalize(settings, run_id, parts, providers, complete=True, conn=conn)
        conn.rollback()
    return {"run_id": None, "dry_run": True, "loaded": loaded, **stats}
