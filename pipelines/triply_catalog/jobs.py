"""Sync jobs: what an admin wants imported (area, sources, categories) and when (cron, UTC).

The `catalog_scheduler` DAG calls `start_due_jobs` every few minutes: each due job gets a `sync_runs` row (status
`queued`, linked to the job) and a `catalog_sync` run with that row's id; the job's `next_run_at` moves to the next
time its schedule matches. A job whose previous run is still queued or running is not started twice. The admin
API's "Run now" / "Dry run" create the same kind of row and trigger the DAG directly.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from . import db
from .cron import CronError, next_run

log = logging.getLogger(__name__)

#: A run still `queued` after this long never reached Airflow (trigger failed, DAG paused): it's marked failed.
STALE_QUEUED = timedelta(hours=6)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def run_conf(job: dict[str, Any], run_id: str) -> dict[str, Any]:
    """The catalog_sync config for a job's run."""
    return {
        "area": job["area"],
        "bbox": job["bbox"],
        "providers": list(job["providers"]),
        "category_keys": list(job["category_keys"]),
        "photos": bool(job["photos"]),
        "sync_run_id": run_id,
    }


def queue_run(conn: psycopg.Connection, job: dict[str, Any], trigger: str, requested_by: str | None = None, dry_run: bool = False) -> str:
    params = {k: v for k, v in run_conf(job, "").items() if k != "sync_run_id"} | {"job": job["name"], "dry_run": dry_run}
    row = conn.execute(
        """INSERT INTO sync_runs (id, trigger, params, job_id, status, requested_by)
           VALUES (gen_random_uuid(), %s, %s, %s::uuid, 'queued', %s::uuid) RETURNING id::text AS id""",
        [trigger, db.jsonb(params), job["id"], requested_by],
    ).fetchone()
    assert row
    return row["id"]


def start_due_jobs(conn: psycopg.Connection, now: datetime | None = None) -> list[dict[str, Any]]:
    """Queue a run for every enabled job whose time has come; returns the catalog_sync configs to trigger.
    Jobs without a next_run_at yet (new, or schedule changed) just get one. Commits."""
    now = now or _now()
    conn.execute(
        "UPDATE sync_runs SET status = 'failed', error = 'never started (Airflow did not pick it up)', finished_at = now() "
        "WHERE status = 'queued' AND started_at < %s",
        [now - STALE_QUEUED],
    )
    confs: list[dict[str, Any]] = []
    jobs = conn.execute(
        """SELECT id::text AS id, name, area, bbox, providers, category_keys, photos, schedule, next_run_at,
                  EXISTS (SELECT 1 FROM sync_runs r WHERE r.job_id = j.id AND r.status IN ('queued', 'running')) AS busy
           FROM sync_jobs j WHERE enabled AND schedule IS NOT NULL ORDER BY next_run_at NULLS FIRST, name FOR UPDATE SKIP LOCKED"""
    ).fetchall()
    for job in jobs:
        try:
            following = next_run(job["schedule"], now)
        except CronError as e:
            log.warning("job %s: bad schedule %r (%s); disabled", job["name"], job["schedule"], e)
            conn.execute("UPDATE sync_jobs SET enabled = false, updated_at = now() WHERE id = %s::uuid", [job["id"]])
            continue
        if job["next_run_at"] is None:
            conn.execute("UPDATE sync_jobs SET next_run_at = %s WHERE id = %s::uuid", [following, job["id"]])
            continue
        if job["next_run_at"] > now:
            continue
        conn.execute("UPDATE sync_jobs SET next_run_at = %s WHERE id = %s::uuid", [following, job["id"]])
        if job["busy"]:
            log.info("job %s: previous run still going; skipped this time", job["name"])
            continue
        run_id = queue_run(conn, job, "schedule")
        confs.append(run_conf(job, run_id))
        log.info("job %s: queued run %s (next %s)", job["name"], run_id, following)
    conn.commit()
    return confs


def create_job(conn: psycopg.Connection, name: str, area: str | None, bbox: str | None, providers: list[str], **kw: Any) -> dict[str, Any]:
    if kw.get("schedule"):
        next_run(kw["schedule"], _now())  # validates
    row = conn.execute(
        """INSERT INTO sync_jobs (id, name, area, bbox, providers, category_keys, schedule, enabled, photos, updated_at)
           VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, now()) RETURNING *""",
        [name, area, bbox, providers, kw.get("category_keys") or [], kw.get("schedule"), kw.get("enabled", True), kw.get("photos", True)],
    ).fetchone()
    conn.commit()
    return dict(row)  # type: ignore[arg-type]


def job(conn: psycopg.Connection, ref: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id::text AS id, name, area, bbox, providers, category_keys, photos, schedule, enabled, next_run_at FROM sync_jobs "
        "WHERE name = %s OR id::text = %s",
        [ref, ref],
    ).fetchone()
    if not row:
        raise LookupError(f"no job {ref!r}")
    return dict(row)
