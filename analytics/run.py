"""Run dbt against DATABASE_URL (the same variable the app and the catalog pipeline use).

    uv run python run.py build            # models + tests (what the nightly job runs)
    uv run python run.py docs generate    # lineage docs into target/

Splits DATABASE_URL into the PG* variables profiles.yml reads, then hands over to dbt.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from dbt.cli.main import dbtRunner

HERE = Path(__file__).resolve().parent


def env_from_url(url: str) -> dict[str, str]:
    u = urlparse(url)
    if u.scheme not in ("postgres", "postgresql"):
        raise SystemExit("DATABASE_URL must be a postgresql:// URL")
    q = parse_qs(u.query)
    env = {
        "PGHOST": u.hostname or "localhost",
        "PGPORT": str(u.port or 5432),
        "PGUSER": unquote(u.username or ""),
        "PGPASSWORD": unquote(u.password or ""),
        "PGDATABASE": (u.path or "/").lstrip("/") or "postgres",
    }
    if "sslmode" in q:
        env["PGSSLMODE"] = q["sslmode"][0]
    return env


def main(argv: list[str]) -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set")
    os.environ.update(env_from_url(url))
    args = argv or ["build"]
    result = dbtRunner().invoke([*args, "--project-dir", str(HERE), "--profiles-dir", str(HERE)])
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
