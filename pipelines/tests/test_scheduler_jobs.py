"""Phase 3: cron schedules, sync jobs and the scheduler, run progress / errors / cancel, quality checks,
category filters, and republishing places an admin merged."""

from __future__ import annotations

import dataclasses
import json
from datetime import datetime

import pytest

from triply_catalog import db, jobs
from triply_catalog.cron import CronError, next_run


def test_cron():
    t = datetime(2026, 10, 5, 10, 17)
    assert next_run("*/15 * * * *", t) == datetime(2026, 10, 5, 10, 30)
    assert next_run("0 3 * * *", t) == datetime(2026, 10, 6, 3, 0)
    assert next_run("0 3 * * mon", t) == datetime(2026, 10, 12, 3, 0)  # 5 Oct 2026 is a Monday, 03:00 has passed
    assert next_run("30 2 1 * *", t) == datetime(2026, 11, 1, 2, 30)
    assert next_run("@weekly", t) == datetime(2026, 10, 11, 0, 0)  # Sunday
    assert next_run("0 0 1,15 jan-mar *", t) == datetime(2027, 1, 1, 0, 0)
    assert next_run("0 9 * * 7", t) == datetime(2026, 10, 11, 9, 0)  # 7 = Sunday
    assert next_run("0 0 13 * 5", t) == datetime(2026, 10, 9, 0, 0)  # day 13 OR a Friday, like cron
    for bad in ("* * * *", "61 * * * *", "*/0 * * * *", "0 0 31 2 *x", "a b c d e"):
        with pytest.raises(CronError):
            next_run(bad, t)
    with pytest.raises(CronError, match="never"):
        next_run("0 0 31 2 *", t)


@pytest.fixture()
def clean_jobs(db_conn):
    yield
    db_conn.rollback()
    db_conn.execute("DELETE FROM sync_runs WHERE job_id IS NOT NULL")
    db_conn.execute("DELETE FROM sync_jobs")
    db_conn.commit()


@pytest.fixture()
def db_conn(database):
    with db.connect(database) as c:
        yield c


@pytest.mark.integration
def test_scheduler_starts_due_jobs_once(db_conn, clean_jobs):
    j = jobs.create_job(db_conn, "hoi-an weekly", "hoi-an", None, ["overture", "osm"], schedule="0 3 * * mon", category_keys=["food"])
    t = datetime(2026, 10, 5, 10, 0)
    assert jobs.start_due_jobs(db_conn, t) == []  # a new job only gets its next time
    nxt = db_conn.execute("SELECT next_run_at FROM sync_jobs WHERE id = %s", [j["id"]]).fetchone()["next_run_at"]
    assert nxt == datetime(2026, 10, 12, 3, 0)

    confs = jobs.start_due_jobs(db_conn, datetime(2026, 10, 12, 3, 5))
    assert len(confs) == 1
    c = confs[0]
    assert c["area"] == "hoi-an" and c["category_keys"] == ["food"] and c["providers"] == ["overture", "osm"]
    run = db_conn.execute("SELECT status, trigger, job_id::text AS job_id, params FROM sync_runs WHERE id = %s", [c["sync_run_id"]]).fetchone()
    assert run["status"] == "queued" and run["trigger"] == "schedule" and run["job_id"] == str(j["id"])
    # Next week it's due again, but the previous run is still queued: not started twice.
    db_conn.execute("UPDATE sync_runs SET started_at = '2026-10-19 01:00' WHERE id = %s", [c["sync_run_id"]])
    db_conn.commit()
    assert jobs.start_due_jobs(db_conn, datetime(2026, 10, 19, 3, 5)) == []
    # A queued run that Airflow never picked up is failed after a while, and the job runs again.
    db_conn.execute("UPDATE sync_runs SET started_at = '2026-10-01' WHERE id = %s", [c["sync_run_id"]])
    db_conn.commit()
    assert len(jobs.start_due_jobs(db_conn, datetime(2026, 10, 26, 3, 5))) == 1
    assert db_conn.execute("SELECT status FROM sync_runs WHERE id = %s", [c["sync_run_id"]]).fetchone()["status"] == "failed"


@pytest.mark.integration
def test_a_job_run_reports_progress_and_quality(settings, db_conn, clean_jobs):
    from triply_catalog.pipeline import run_sync

    j = jobs.create_job(db_conn, "hoi-an food", "hoi-an", None, ["overture", "osm"], category_keys=["food"])
    run_id = jobs.queue_run(db_conn, j, "admin")
    db_conn.commit()
    out = run_sync(settings, "hoi-an", None, ["overture", "osm"], category_keys=["food"], sync_run_id=run_id)
    row = db_conn.execute("SELECT status, progress, stats FROM sync_runs WHERE id = %s", [run_id]).fetchone()
    assert row["status"] in ("succeeded", "needs_review")
    assert row["progress"]["total"] == 2 and row["progress"]["done"] == 2 and row["progress"]["failed"] == 0
    q = out["quality"]
    assert q["places"] > 0 and "completeness" in q and isinstance(q["warnings"], list)


@pytest.mark.integration
def test_category_filter_only_publishes_those_groups(settings, db_conn):
    import uuid

    from triply_catalog.publish import attach_and_create

    run = str(uuid.uuid4())
    cats = {r["key"]: r["id"] for r in db_conn.execute("SELECT key, id::text AS id FROM categories").fetchall()}
    for ext, key, name in (("t-food", "food.noodles", "Mì Quảng Test"), ("t-hotel", "lodging.hotel", "Test Hotel")):
        db_conn.execute(
            """INSERT INTO place_sources (id, provider, external_id, raw, normalized, content_hash, lat, lng, category_id, license, attribution, changed_run_id)
               VALUES (gen_random_uuid(), 'osm', %s, '{}', %s, 'x', 16.2, 108.1, %s, 'ODbL-1.0', 'osm', %s)""",
            [ext, json.dumps({"name": name, "name_norm": name.lower(), "names_norm": [name.lower()]}), cats[key], run],
        )
    out = attach_and_create(db_conn, settings, run, "osm", require_area=False, category_keys=["food"])
    assert out == {"attached": 0, "created": 1}
    placed = {r["external_id"]: r["place_id"] for r in db_conn.execute("SELECT external_id, place_id FROM place_sources WHERE changed_run_id = %s", [run])}
    assert placed["t-food"] is not None and placed["t-hotel"] is None
    db_conn.rollback()


@pytest.mark.integration
def test_a_failing_partition_is_recorded_and_cancel_stops_a_run(settings, db_conn, clean_jobs):
    from triply_catalog.pipeline import extract_load, plan

    broken = dataclasses.replace(settings, osm_source=settings.osm_source + ".missing")
    run_id = db.start_run(db_conn, "test", {})
    parts = plan(settings, run_id, "hoi-an", None, ["overture", "osm"])
    osm = next(p for p in parts if p["provider"] == "osm")
    with pytest.raises(RuntimeError):
        extract_load(broken, run_id, osm)
    err = db_conn.execute("SELECT stage, provider, external_id, message FROM sync_run_errors WHERE run_id = %s", [run_id]).fetchone()
    assert err["stage"] == "extract" and err["provider"] == "osm" and err["external_id"] == osm["key"]
    assert db_conn.execute("SELECT progress FROM sync_runs WHERE id = %s", [run_id]).fetchone()["progress"]["failed"] == 1

    db_conn.execute("UPDATE sync_runs SET cancel_requested = true WHERE id = %s", [run_id])
    db_conn.commit()
    ovt = next(p for p in parts if p["provider"] == "overture")
    with pytest.raises(db.Cancelled):
        extract_load(settings, run_id, ovt)
    assert db_conn.execute("SELECT count(*) AS n FROM sync_run_errors WHERE run_id = %s", [run_id]).fetchone()["n"] == 1  # a stop isn't an error


@pytest.mark.integration
def test_run_changes_are_announced(db_conn, database):
    import psycopg

    with psycopg.connect(database, autocommit=True) as listener:
        listener.execute("LISTEN sync_run")
        run_id = db.start_run(db_conn, "test", {"area": "x"})
        db.set_progress(db_conn, run_id, total=3, done=1)
        got = [json.loads(n.payload) for n in listener.notifies(timeout=2, stop_after=2)]
    assert [g["id"] for g in got] == [run_id, run_id]
    assert got[1]["progress"] == {"total": 3, "done": 1}


@pytest.mark.integration
def test_admin_merge_is_republished_by_the_scheduler(settings, db_conn):
    from triply_catalog import dedupe

    a, b = [
        r["id"]
        for r in db_conn.execute(
            "SELECT id::text AS id FROM places WHERE status = 'ACTIVE' AND merged_into_id IS NULL AND EXISTS "
            "(SELECT 1 FROM place_sources s WHERE s.place_id = places.id) ORDER BY name LIMIT 2"
        ).fetchall()
    ]
    # What the admin API does: the database function, nothing else.
    w = db_conn.execute("SELECT catalog_pick_winner(%s, %s)::text AS w", [a, b]).fetchone()["w"]
    loser = b if w == a else a
    mid = db_conn.execute("SELECT catalog_merge_places(%s, %s, 'admin-test', NULL, '{}')::text AS id", [w, loser]).fetchone()["id"]
    assert db_conn.execute("SELECT needs_publish FROM places WHERE id = %s", [w]).fetchone()["needs_publish"]
    assert dedupe.republish_dirty(db_conn, settings) >= 1
    assert not db_conn.execute("SELECT needs_publish FROM places WHERE id = %s", [w]).fetchone()["needs_publish"]
    out = db_conn.execute("SELECT catalog_unmerge(%s, 'admin-test') AS r", [mid]).fetchone()["r"]
    assert out["loser"] == loser and out["restored"]["sources"] >= 1
    with pytest.raises(Exception, match="already undone"):
        db_conn.execute("SELECT catalog_unmerge(%s, 'admin-test')", [mid])
    db_conn.rollback()


@pytest.mark.integration
def test_cli_jobs(settings, monkeypatch, capsys, clean_jobs):
    from triply_catalog import cli

    for k, v in {
        "DATABASE_URL": settings.database_url,
        "OVERTURE_BASE": settings.overture_base,
        "OVERTURE_RELEASE": "fixture",
        "OSM_SOURCE": settings.osm_source,
    }.items():
        monkeypatch.setenv(k, v)
    assert cli.main(["jobs", "add", "test hoi-an", "--area", "hoi-an", "--schedule", "0 3 * * mon"]) == 0
    assert cli.main(["jobs", "add", "bad", "--area", "hoi-an", "--schedule", "every day"]) == 2
    assert cli.main(["jobs", "disable", "test hoi-an"]) == 0
    capsys.readouterr()
    assert cli.main(["jobs", "list"]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert [j["name"] for j in listed] == ["test hoi-an"] and listed[0]["enabled"] is False
    assert cli.main(["jobs", "run", "test hoi-an", "--dry-run"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["dry_run"] is True
    capsys.readouterr()
    assert cli.main(["jobs", "list"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["last_status"] == "dry_run"
