"""Database access (psycopg 3). The schema itself is owned by the Prisma migrations in apps/api."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    conn.execute("SET application_name = 'triply-catalog'")
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


def start_run(conn: psycopg.Connection, trigger: str, params: dict[str, Any]) -> str:
    row = conn.execute(
        "INSERT INTO sync_runs (id, trigger, params) VALUES (gen_random_uuid(), %s, %s) RETURNING id::text AS id",
        [trigger, jsonb(params)],
    ).fetchone()
    conn.commit()
    assert row
    return row["id"]


def finish_run(conn: psycopg.Connection, run_id: str, status: str, stats: dict[str, Any], error: str | None = None) -> None:
    conn.execute(
        "UPDATE sync_runs SET status = %s, stats = %s, error = %s, finished_at = now() WHERE id = %s",
        [status, jsonb(stats), error, run_id],
    )
    conn.commit()
