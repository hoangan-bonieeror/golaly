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
from .config import LICENSES, Settings
from .load import assign_areas, load_batch
from .models import BBox, NormalizedPlace, Partition
from .providers import get_provider
from .publish import mark_missing, publish
from .taxonomy import sync_taxonomy

log = logging.getLogger(__name__)


class ScopeError(ValueError):
    pass


def resolve_scope(conn: psycopg.Connection, settings: Settings, area: str | None, bbox: str | None) -> tuple[list[Partition], bool]:
    """Returns (partitions, require_area).

    - a geo area slug ("vn", "vn-da-nang"): one partition per region with a known boundary; only records
      inside the boundaries are published (bbox corners outside the country are dropped).
    - a destination slug ("hoi-an"): a box of `destination_radius_km` around its centre.
    - --bbox "minLng,minLat,maxLng,maxLat".
    """
    if bbox:
        x0, y0, x1, y1 = (float(v) for v in bbox.split(","))
        return [Partition("", "bbox", BBox(x0, y0, x1, y1))], False
    if not area:
        raise ScopeError("Give --area (geo area or destination slug) or --bbox.")
    g = conn.execute("SELECT id::text AS id, level::text AS level, slug, min_lng, min_lat, max_lng, max_lat FROM geo_areas WHERE slug = %s", [area]).fetchone()
    if g:
        rows = [g]
        if g["level"] == "COUNTRY":
            children = conn.execute(
                """SELECT id::text AS id, slug, min_lng, min_lat, max_lng, max_lat FROM geo_areas
                   WHERE parent_id = %s AND boundary IS NOT NULL ORDER BY slug""",
                [g["id"]],
            ).fetchall()
            rows = children or rows
        parts = [Partition("", r["slug"], BBox(r["min_lng"], r["min_lat"], r["max_lng"], r["max_lat"]), r["id"]) for r in rows if r["min_lng"] is not None]
        if not parts:
            raise ScopeError(f"Geo area {area!r} has no bounding box — run `triply-catalog boundaries` first.")
        return parts, True
    d = conn.execute("SELECT slug, lat, lng FROM destinations WHERE slug = %s", [area]).fetchone()
    if d:
        r = settings.destination_radius_km
        dlat, dlng = r / 111.32, r / (111.32 * math.cos(math.radians(d["lat"])))
        return [Partition("", d["slug"], BBox(d["lng"] - dlng, d["lat"] - dlat, d["lng"] + dlng, d["lat"] + dlat))], False
    raise ScopeError(f"No geo area or destination with slug {area!r}.")


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
        load_batch(conn, run_id, batch, *LICENSES["manual"])
        conn.execute(
            "UPDATE place_sources SET place_id = external_id::uuid WHERE provider = 'manual' AND place_id IS NULL AND changed_run_id = %s::uuid",
            [run_id],
        )
    return len(batch)


# ── steps ────────────────────────────────────────────────────────────────────


def start(settings: Settings, params: dict[str, Any], trigger: str) -> str:
    with db.connect(settings.database_url) as conn:
        sync_taxonomy(conn)
        return db.start_run(conn, trigger, params)


def plan(settings: Settings, run_id: str, area: str | None, bbox: str | None, providers: list[str]) -> list[dict[str, Any]]:
    with db.connect(settings.database_url) as conn:
        scope, require_area = resolve_scope(conn, settings, area, bbox)
        adopted = adopt_manual_places(conn, run_id)
        conn.commit()
    out = []
    for key in providers:
        for p in get_provider(key, settings).partitions(scope):
            out.append({**asdict(p), "require_area": require_area})
    log.info("run %s: %d partition(s), adopted %d manual place(s)", run_id, len(out), adopted)
    return out


def _partition(d: dict[str, Any]) -> Partition:
    return Partition(d["provider"], d["key"], BBox(**d["bbox"]), d.get("area_id"))


def extract_load(settings: Settings, run_id: str, part: dict[str, Any], conn: psycopg.Connection | None = None) -> dict[str, int]:
    """One partition: fetch from the provider and upsert into place_sources, a batch per transaction."""
    partition = _partition(part)
    provider = get_provider(partition.provider, settings)
    own = conn is None
    conn = conn or db.connect(settings.database_url)
    totals = {"fetched": 0, "inserted": 0, "changed": 0}
    t0 = time.monotonic()
    try:
        for batch in provider.fetch(partition):
            stats = load_batch(conn, run_id, batch, provider.license, provider.attribution)
            for k in totals:
                totals[k] += stats[k]
            if own:
                conn.commit()
    finally:
        if own:
            conn.close()
    log.info("%s/%s: %s in %.1fs", partition.provider, partition.key, totals, time.monotonic() - t0)
    return totals


def finalize(
    settings: Settings, run_id: str, parts: list[dict[str, Any]], providers: list[str], complete: bool = True, conn: psycopg.Connection | None = None
) -> dict[str, Any]:
    own = conn is None
    conn = conn or db.connect(settings.database_url)
    try:
        stats: dict[str, Any] = {"areas_assigned": assign_areas(conn, run_id)}
        blocked = False
        if complete:
            for provider in providers:
                boxes = [p["bbox"] for p in parts if p["provider"] == provider]
                if boxes:
                    m = mark_missing(conn, settings, run_id, provider, [[b["min_lng"], b["min_lat"], b["max_lng"], b["max_lat"]] for b in boxes])
                    stats[f"{provider}_missing"] = m
                    blocked = blocked or m["blocked"]
        require_area = any(p.get("require_area") for p in parts)
        stats["publish"] = publish(conn, settings, run_id, ["manual", *providers], require_area)
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


# ── one-shot run (CLI) ───────────────────────────────────────────────────────


def run_sync(settings: Settings, area: str | None, bbox: str | None, providers: list[str], dry_run: bool = False, trigger: str = "cli") -> dict[str, Any]:
    params = {"area": area, "bbox": bbox, "providers": providers, "dry_run": dry_run}
    if dry_run:
        # Everything in one transaction that is rolled back: real numbers, no writes.
        run_id = str(uuid.uuid4())
        with db.connect(settings.database_url) as conn:
            sync_taxonomy(conn)  # commits taxonomy only; harmless and idempotent
            scope, require_area = resolve_scope(conn, settings, area, bbox)
            adopt_manual_places(conn, run_id)
            parts = [{**asdict(p), "require_area": require_area} for k in providers for p in get_provider(k, settings).partitions(scope)]
            loaded = {f"{p['provider']}/{p['key']}": extract_load(settings, run_id, p, conn) for p in parts}
            stats = finalize(settings, run_id, parts, providers, complete=True, conn=conn)
            conn.rollback()
        return {"run_id": None, "dry_run": True, "loaded": loaded, **stats}
    run_id = start(settings, params, trigger)
    try:
        with db.connect(settings.database_url) as lock_conn, db.advisory_lock(lock_conn, f"catalog:{area or bbox}"):
            parts = plan(settings, run_id, area, bbox, providers)
            loaded = {f"{p['provider']}/{p['key']}": extract_load(settings, run_id, p) for p in parts}
            stats = finalize(settings, run_id, parts, providers)
        result = {"run_id": run_id, "loaded": loaded, **stats}
        finish(settings, run_id, stats["status"], result)
        return result
    except Exception as e:
        finish(settings, run_id, "failed", {}, f"{type(e).__name__}: {e}"[:2000])
        raise
