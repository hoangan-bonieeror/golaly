"""Phase 3 done criterion: stop a run in the middle, continue it, and get the same result as a run that was never
interrupted. Each side runs on its own copy of the test database (CREATE DATABASE … TEMPLATE), so both start
from exactly the same state."""

from __future__ import annotations

import dataclasses
from collections.abc import Iterator
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from golaly_catalog import db, pipeline
from golaly_catalog.sources.osm import OsmSource
from golaly_catalog.sources.overture import OvertureSource

pytestmark = pytest.mark.integration


def _clone(database: str, name: str) -> str:
    parts = urlsplit(database)
    admin = urlunsplit(parts._replace(path="/postgres"))
    template = parts.path.lstrip("/")
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        # Nobody else may be connected to the template while it is copied.
        c.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()", [template])
        c.execute(f'CREATE DATABASE "{name}" TEMPLATE "{template}"')
    return urlunsplit(parts._replace(path=f"/{name}"))


def _drop(database: str, name: str) -> None:
    admin = urlunsplit(urlsplit(database)._replace(path="/postgres"))
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _fingerprint(url: str, run_id: str) -> dict[str, object]:
    with db.connect(url) as c:
        q = lambda sql: c.execute(sql, {"r": run_id}).fetchone()["n"]  # noqa: E731
        return {
            "sources_seen": q("SELECT count(*) AS n FROM place_sources WHERE last_run_id = %(r)s::uuid"),
            "sources_changed": q("SELECT count(*) AS n FROM place_sources WHERE changed_run_id = %(r)s::uuid"),
            "sources_published": q("SELECT count(*) AS n FROM place_sources WHERE last_run_id = %(r)s::uuid AND place_id IS NOT NULL"),
            "places": q("SELECT count(*) AS n FROM places WHERE status = 'ACTIVE' AND merged_into_id IS NULL"),
            "place_names": q("SELECT count(*) AS n FROM place_names"),
            "pending_pairs": q("SELECT count(*) AS n FROM merge_candidates WHERE status = 'PENDING'"),
        }


def _comparable(stats: dict) -> dict:
    """A run's stats without what naturally differs between two runs (ids)."""
    return {k: v for k, v in stats.items() if k not in ("run_id", "photo_scope")}


@pytest.fixture()
def twin_databases(database: str) -> Iterator[tuple[str, str]]:
    names = ("golaly_resume_a", "golaly_resume_b")
    urls = tuple(_clone(database, n) for n in names)
    yield urls  # type: ignore[misc]
    for n in names:
        _drop(database, n)


def _crash_after(cls: type, batches: int, monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Make `cls.fetch_places` die (like a killed worker) after yielding `batches` batches — once."""
    real = cls.fetch_places
    calls: list[int] = []

    def flaky(self, partition):  # type: ignore[no-untyped-def]
        calls.append(1)
        for i, batch in enumerate(real(self, partition)):
            if len(calls) == 1 and i == batches:
                raise ConnectionError("worker lost")
            yield batch

    monkeypatch.setattr(cls, "fetch_places", flaky)
    return calls


def test_a_resumed_run_matches_an_uninterrupted_one(settings, twin_databases, monkeypatch):
    a_url, b_url = twin_databases
    small = dataclasses.replace(settings, batch_size=2)  # many batches from the small fixtures

    # A: never interrupted.
    a = pipeline.run_sync(dataclasses.replace(small, database_url=a_url), "hoi-an", None, ["overture", "osm"])
    assert a["status"] == "succeeded"

    # B: Overture finishes, then OSM dies after 2 batches; the run fails like a crashed CLI process.
    b_settings = dataclasses.replace(small, database_url=b_url)
    ovt_calls = _crash_after(OvertureSource, 10_000, monkeypatch)  # only counts reads
    osm_calls = _crash_after(OsmSource, 2, monkeypatch)
    with pytest.raises(ConnectionError):
        pipeline.run_sync(b_settings, "hoi-an", None, ["overture", "osm"])
    with db.connect(b_url) as c:
        run = c.execute("SELECT id::text AS id, status FROM sync_runs ORDER BY started_at DESC LIMIT 1").fetchone()
        cursors = c.execute("SELECT provider, batches, done, failed FROM sync_run_cursors WHERE run_id = %s::uuid", [run["id"]]).fetchall()
    assert run["status"] == "failed"
    by = {cur["provider"]: cur for cur in cursors}
    assert by["overture"]["done"]
    assert by["osm"]["batches"] == 2 and not by["osm"]["done"] and by["osm"]["failed"]  # stopped mid-partition

    # Continue it (what `golaly-catalog resume <id>` and an Airflow retry do).
    p = pipeline.resume_params(b_settings, run["id"])
    b = pipeline.run_sync(b_settings, p["area"], p["bbox"], p["providers"], category_keys=p["category_keys"], sync_run_id=run["id"])
    assert b["status"] == "succeeded"
    assert len(ovt_calls) == 1  # Overture's finished partition wasn't read again
    assert len(osm_calls) == 2  # OSM was read again, its first 2 batches skipped

    assert _comparable(b) == _comparable(a)
    assert _fingerprint(b_url, b["run_id"]) == _fingerprint(a_url, a["run_id"])
    with db.connect(b_url) as c:
        progress = c.execute("SELECT progress FROM sync_runs WHERE id = %s::uuid", [b["run_id"]]).fetchone()["progress"]
        assert progress["done"] == progress["total"] and progress["failed"] == 0
        assert c.execute("SELECT bool_and(done) AS ok FROM sync_run_cursors WHERE run_id = %s::uuid", [b["run_id"]]).fetchone()["ok"]


def test_a_finished_partition_is_skipped_and_order_changes_reload(settings, database, monkeypatch):
    small = dataclasses.replace(settings, batch_size=2)
    with db.connect(database) as c:
        run_id = db.start_run(c, "test", {"area": "hoi-an"})
    parts = pipeline.plan(small, run_id, "hoi-an", None, ["osm"])
    first = pipeline.extract_load(small, run_id, parts[0])
    calls = _crash_after(OsmSource, 99, monkeypatch)  # counts reads; never crashes
    assert pipeline.extract_load(small, run_id, parts[0]) == first and not calls  # done → not read again

    # A cursor whose last id doesn't match what the source now yields: the partition is loaded again from the start.
    with db.connect(database) as c:
        c.execute("UPDATE sync_run_cursors SET done = false, batches = 1, last_key = 'not-what-the-source-says' WHERE run_id = %s::uuid", [run_id])
        c.commit()
    again = pipeline.extract_load(small, run_id, parts[0])
    assert again["fetched"] == first["fetched"]
    with db.connect(database) as c:
        err = c.execute("SELECT stage FROM sync_run_errors WHERE run_id = %s::uuid", [run_id]).fetchone()
        assert err["stage"] == "resume"


def test_only_unfinished_runs_can_be_resumed(settings, database):
    with db.connect(database) as c:
        ok = db.start_run(c, "test", {"area": "hoi-an", "providers": ["osm"]})
        c.execute("UPDATE sync_runs SET status = 'succeeded' WHERE id = %s::uuid", [ok])
        c.commit()
    with pytest.raises(pipeline.ResumeError, match="only failed"):
        pipeline.resume_params(settings, ok)
    with pytest.raises(pipeline.ResumeError, match="no sync run"):
        pipeline.resume_params(settings, "00000000-0000-4000-8000-000000000000")


def test_verify_reports_the_done_criteria_and_the_review_queue(settings, database):
    from golaly_catalog.verify import verify_area

    with db.connect(database) as c:
        country = c.execute("SELECT id FROM geo_areas WHERE slug = 'zv'").fetchone()
        if not country:
            c.execute(
                """INSERT INTO geo_areas (id, level, country_code, name, slug, source, min_lng, min_lat, max_lng, max_lat)
                   VALUES ('00000000-0000-4000-8000-00000000f001', 'COUNTRY', 'ZV', 'Verifyland', 'zv', 'manual', 108, 15, 109, 16),
                          ('00000000-0000-4000-8000-00000000f002', 'REGION', 'ZV', 'North', 'zv-north', 'manual', 108, 15.5, 109, 16),
                          ('00000000-0000-4000-8000-00000000f003', 'REGION', 'ZV', 'South', 'zv-south', 'manual', 108, 15, 109, 15.5)"""
            )
            c.execute("UPDATE geo_areas SET parent_id = '00000000-0000-4000-8000-00000000f001' WHERE slug IN ('zv-north', 'zv-south')")
        ids = [
            c.execute(
                """INSERT INTO places (id, name, category, lat, lng, address, area_id, updated_at)
                   VALUES (gen_random_uuid(), %s, 'RESTAURANT', 15.8, 108.3, '', '00000000-0000-4000-8000-00000000f002', now()) RETURNING id::text AS id""",
                [n],
            ).fetchone()["id"]
            for n in ("Phở A", "Pho A")
        ]
        a, b = sorted(ids)
        c.execute("INSERT INTO merge_candidates (id, place_a, place_b, score, updated_at) VALUES (gen_random_uuid(), %s, %s, 0.8, now())", [a, b])
        run = db.start_run(c, "test", {"area": "zv"})
        c.execute(
            """UPDATE sync_runs SET status = 'partial', progress = '{"total": 2, "done": 1}', stats = '{"quality": {"warnings": ["3 place(s) at (0, 0)"]}}'
               WHERE id = %s""",
            [run],
        )
        c.commit()
    out = verify_area(settings, "ZV")
    assert out["ok"] is False
    by = {x["check"]: x for x in out["checks"]}
    assert not by["last run finished cleanly"]["ok"] and f"resume {run}" in by["last run finished cleanly"]["detail"]
    assert by["every partition loaded"] == {"check": "every partition loaded", "ok": False, "detail": "1/2 partitions"}
    assert by["quality checks pass"]["detail"] == ["3 place(s) at (0, 0)"]
    assert by["every region has places"]["detail"] == ["zv-south"]
    assert out["places"] == {"zv-north": 2, "zv-south": 0}
    assert out["review_queue"]["by_region"] == [{"region": "zv-north", "pairs": 1, "likely_same": 1}]
    with pytest.raises(LookupError):
        verify_area(settings, "nowhere")
