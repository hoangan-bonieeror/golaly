"""Test setup. Integration tests need PostgreSQL with PostGIS (TEST_DATABASE_URL, default
postgresql://triply:triply@localhost:5432/triply_catalog_test — recreated from the Prisma migrations
on every session) and Node.js to load the app's demo seed."""

from __future__ import annotations

import dataclasses
import os
import shutil
import subprocess
from pathlib import Path

import psycopg
import pytest

from triply_catalog.config import Settings

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / "fixtures"
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql://triply:triply@localhost:5432/triply_catalog_test")


@pytest.fixture(scope="session")
def settings() -> Settings:
    return dataclasses.replace(
        Settings(),
        database_url=TEST_DB,
        overture_base=str(FIXTURES / "overture"),
        overture_release="fixture",
        osm_source=str(FIXTURES / "osm" / "hoian.osm"),
        batch_size=4,  # several batches even on tiny fixtures
    )


def _admin_url(url: str) -> tuple[str, str]:
    base, name = url.rsplit("/", 1)
    return f"{base}/postgres", name


@pytest.fixture(scope="session")
def database(settings: Settings) -> str:
    admin, name = _admin_url(settings.database_url)
    try:
        with psycopg.connect(admin, autocommit=True, connect_timeout=3) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            c.execute(f'CREATE DATABASE "{name}"')
    except psycopg.OperationalError as e:
        pytest.skip(f"PostgreSQL not reachable for integration tests: {e}")
    with psycopg.connect(settings.database_url, autocommit=True) as c:
        for m in sorted((ROOT / "apps/api/prisma/migrations").glob("*/migration.sql")):
            c.execute(m.read_text("utf-8"))
    npx = shutil.which("npx")  # the full path: on Windows it's npx.cmd, which subprocess won't find by name
    if not npx:
        pytest.skip("Node.js is needed to load the app's demo seed")
    subprocess.run(
        [npx, "tsx", "prisma/seed.ts"],
        cwd=ROOT / "apps/api",
        env={**os.environ, "DATABASE_URL": settings.database_url, "NODE_ENV": "test"},
        check=True,
        capture_output=True,
    )
    return settings.database_url


@pytest.fixture()
def db(database: str):
    with psycopg.connect(database, row_factory=psycopg.rows.dict_row) as conn:
        yield conn
