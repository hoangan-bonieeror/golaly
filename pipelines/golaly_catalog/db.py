"""Database access (psycopg 3). The schema itself is owned by the Prisma migrations in apps/api."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    conn.execute("SET application_name = 'golaly-catalog'")
    conn.commit()
    return conn


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value, dumps=lambda v: json.dumps(v, ensure_ascii=False, default=str))


@contextmanager
def advisory_lock(conn: psycopg.Connection, key: str) -> Iterator[None]:
    """One run per scope at a time (e.g. two Airflow runs for the same area). Session-level lock."""
    conn.execute("SELECT pg_advisory_lock(hashtext(%s))", [key])
    try:
        yield
    finally:
        conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", [key])


def start_run(conn: psycopg.Connection, trigger: str, params: dict[str, Any], job_id: str | None = None, status: str = "running") -> str:
    row = conn.execute(
        "INSERT INTO sync_runs (id, trigger, params, job_id, status) VALUES (gen_random_uuid(), %s, %s, %s::uuid, %s) RETURNING id::text AS id",
        [trigger, jsonb(params), job_id, status],
    ).fetchone()
    conn.commit()
    assert row
    return row["id"]


def set_progress(conn: psycopg.Connection, run_id: str, **fields: Any) -> None:
    """Merge fields into sync_runs.progress (each update is NOTIFYed to the admin screens). Own transaction."""
    conn.execute("UPDATE sync_runs SET progress = progress || %s WHERE id = %s::uuid", [jsonb(fields), run_id])
    conn.commit()


def bump_progress(conn: psycopg.Connection, run_id: str, key: str, current: str | None = None, by: int = 1) -> None:
    conn.execute(
        """UPDATE sync_runs SET progress = progress
                  || jsonb_build_object(%(k)s::text, greatest(coalesce((progress->>%(k)s::text)::int, 0) + %(by)s::int, 0))
                  || CASE WHEN %(c)s::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('current', %(c)s::text) END
           WHERE id = %(id)s::uuid""",
        {"k": key, "c": current, "id": run_id, "by": by},
    )
    conn.commit()


# ── resume ───────────────────────────────────────────────────────────────────


@dataclass
class Cursor:
    """How far one partition of a run got. `batches` were committed; `totals` are their counts."""

    batches: int = 0
    last_key: str | None = None
    done: bool = False
    failed: bool = False
    totals: dict[str, int] = field(default_factory=dict)


def get_cursor(conn: psycopg.Connection, run_id: str, provider: str, key: str) -> Cursor:
    row = conn.execute(
        "SELECT batches, last_key, done, failed, totals FROM sync_run_cursors WHERE run_id = %s::uuid AND provider = %s AND partition_key = %s",
        [run_id, provider, key],
    ).fetchone()
    conn.commit()
    return Cursor(row["batches"], row["last_key"], row["done"], row["failed"], dict(row["totals"])) if row else Cursor()


def save_cursor(conn: psycopg.Connection, run_id: str, provider: str, key: str, c: Cursor) -> None:
    """Upsert, inside the caller's transaction: commit it together with the batch it describes."""
    conn.execute(
        """INSERT INTO sync_run_cursors (run_id, provider, partition_key, batches, last_key, done, failed, totals, updated_at)
           VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, now())
           ON CONFLICT (run_id, provider, partition_key) DO UPDATE SET batches = EXCLUDED.batches, last_key = EXCLUDED.last_key,
             done = EXCLUDED.done, failed = EXCLUDED.failed, totals = EXCLUDED.totals, updated_at = now()""",
        [run_id, provider, key, c.batches, c.last_key, c.done, c.failed, jsonb(c.totals)],
    )


def done_partitions(conn: psycopg.Connection, run_id: str) -> int:
    row = conn.execute("SELECT count(*) AS n FROM sync_run_cursors WHERE run_id = %s::uuid AND done", [run_id]).fetchone()
    conn.commit()
    return int(row["n"]) if row else 0


def add_error(conn: psycopg.Connection, run_id: str | None, stage: str, message: str, provider: str | None = None, external_id: str | None = None) -> None:
    """Record a failed record or partition (the run goes on). Own transaction; never raises."""
    if not run_id:
        return
    try:
        conn.execute(
            """INSERT INTO sync_run_errors (id, run_id, provider, external_id, stage, message)
               SELECT gen_random_uuid(), %s::uuid, %s, %s, %s, %s WHERE EXISTS (SELECT 1 FROM sync_runs WHERE id = %s::uuid)""",
            [run_id, provider, external_id, stage, message[:2000], run_id],
        )
        conn.commit()
    except psycopg.Error:
        conn.rollback()


class Cancelled(RuntimeError):
    """An admin asked to stop this run."""


def check_cancel(conn: psycopg.Connection, run_id: str | None) -> None:
    if not run_id:
        return
    row = conn.execute("SELECT cancel_requested FROM sync_runs WHERE id = %s::uuid", [run_id]).fetchone()
    if row and row["cancel_requested"]:
        raise Cancelled("cancelled by an admin")


def finish_run(conn: psycopg.Connection, run_id: str, status: str, stats: dict[str, Any], error: str | None = None) -> None:
    conn.execute(
        "UPDATE sync_runs SET status = %s, stats = %s, error = %s, finished_at = now() WHERE id = %s",
        [status, jsonb(stats), error, run_id],
    )
    conn.commit()
