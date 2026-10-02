"""End-to-end: demo seed → bootstrap → boundaries → sync Hội An against the synthetic fixtures.

Tests in this module share one database and run in file order (each builds on the previous state).
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import duckdb
import pytest

from triply_catalog import db as catalog_db
from triply_catalog.boundaries import import_boundaries
from triply_catalog.config import Settings
from triply_catalog.pipeline import ScopeError, adopt_manual_places, run_sync
from triply_catalog.publish import publish
from triply_catalog.taxonomy import sync_taxonomy

pytestmark = pytest.mark.integration
PROVIDERS = ["overture", "osm"]


def bootstrap(settings: Settings) -> dict:
    with catalog_db.connect(settings.database_url) as conn:
        out = sync_taxonomy(conn)
        run_id = "00000000-0000-4000-8000-000000000000"
        out["adopted"] = adopt_manual_places(conn, run_id)
        out["publish"] = publish(conn, settings, run_id, ["manual"], require_area=False)
        conn.commit()
    return out


def snapshot_itineraries(conn) -> str:
    rows = conn.execute(
        """SELECT i.id, i.day_id, i.type, i.title, i.place_id, i.start_time, i.end_time, i.sort_order, i.updated_at,
                  p.status AS place_status, p.merged_into_id
           FROM itinerary_items i LEFT JOIN places p ON p.id = i.place_id ORDER BY i.id"""
    ).fetchall()
    return json.dumps(rows, default=str)


def place(conn, name: str) -> dict:
    row = conn.execute(
        """SELECT p.*, c.key AS cat, g.slug AS area, d.slug AS dest,
                  (SELECT array_agg(provider ORDER BY provider) FROM place_sources s WHERE s.place_id = p.id) AS providers
           FROM places p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN geo_areas g ON g.id = p.area_id
           LEFT JOIN destinations d ON d.id = p.destination_id
           WHERE p.name = %s""",
        [name],
    ).fetchall()
    assert len(row) == 1, f"{name}: {len(row)} places"
    return row[0]


@pytest.fixture(scope="module")
def state(settings, database):
    with catalog_db.connect(settings.database_url) as conn:
        before = {
            "itineraries": snapshot_itineraries(conn),
            "place_ids": {r["id"] for r in conn.execute("SELECT id::text FROM places").fetchall()},
            "seed_names": {r["id"]: r["name"] for r in conn.execute("SELECT id::text, name FROM places").fetchall()},
        }
    return {"before": before}


def test_bootstrap_adopts_every_seed_place(settings, state, db):
    out = bootstrap(settings)
    assert out["categories"] >= 60
    assert out["adopted"] == len(state["before"]["place_ids"])
    n = db.execute("SELECT count(*) AS n FROM place_sources WHERE provider = 'manual' AND place_id::text = external_id").fetchone()["n"]
    assert n == out["adopted"]
    assert db.execute("SELECT count(*) AS n FROM places WHERE category_id IS NULL").fetchone()["n"] == 0
    again = bootstrap(settings)
    assert again["adopted"] == 0 and again["publish"]["updated"] == 0


def test_boundaries_file_seed_places_and_destinations(settings, db):
    with db_conn(settings) as conn:
        out = import_boundaries(conn, settings, "VN")
    assert out["country"] == 1 and out["region"] == 2
    assert out["places_refiled"] > 0
    dest = db.execute("SELECT g.slug FROM destinations d JOIN geo_areas g ON g.id = d.area_id WHERE d.slug = 'hoi-an'").fetchone()
    assert dest["slug"] == "vn-da-nang"
    assert place(db, "BeBe Tailor")["area"] == "vn-da-nang"
    assert place(db, "BeBe Tailor")["search_text"].endswith("da nang")
    assert (
        db.execute("SELECT g.name FROM geo_area_names g JOIN geo_areas a ON a.id = g.area_id WHERE a.slug = 'vn-da-nang' AND g.lang = 'en'").fetchone()["name"]
        == "Da Nang"
    )
    with db_conn(settings) as conn:
        assert import_boundaries(conn, settings, "VN")["places_refiled"] == 0  # idempotent


def db_conn(settings):
    return catalog_db.connect(settings.database_url)


def test_unknown_area_is_a_scope_error(settings):
    with pytest.raises(ScopeError):
        run_sync(settings, "atlantis", None, PROVIDERS)


def test_first_sync_merges_sources(settings, state, db):
    out = run_sync(settings, "hoi-an", None, PROVIDERS)
    assert out["status"] == "succeeded"
    assert out["loaded"]["overture/hoi-an"]["fetched"] == 9  # low-confidence spam + Đà Nẵng bridge filtered out
    state["first"] = out

    bmp = place(db, "Bánh Mì Phượng")  # seed + Overture + OSM: one place, the seed id
    assert str(bmp["id"]) in state["before"]["place_ids"]
    assert bmp["providers"] == ["manual", "osm", "overture"]
    assert bmp["phone"] == "+842350000001" and bmp["field_sources"]["phone"] == "overture"
    assert bmp["opening_hours"] == "Mo-Su 06:30-21:30" and bmp["field_sources"]["opening_hours"] == "osm"
    assert bmp["cat"] == "food.vietnamese" and bmp["category"] == "RESTAURANT"
    assert bmp["dest"] == "hoi-an" and bmp["area"] == "vn-da-nang"
    assert float(bmp["quality_score"]) == 1.0

    town = place(db, "Hội An Ancient Town")  # OSM "Phố cổ Hội An" matched the seed through its English name
    assert town["providers"] == ["manual", "osm"]
    assert "pho co hoi an" in town["search_text"]
    names = {r["lang"]: r["name"] for r in db.execute("SELECT lang, name FROM place_names WHERE place_id = %s", [town["id"]]).fetchall()}
    assert names["vi"] == "Phố cổ Hội An"

    bridge = place(db, "Chùa Cầu")  # Overture + OSM way → one new place
    assert bridge["providers"] == ["osm", "overture"] and bridge["dest"] == "hoi-an"
    assert bridge["field_sources"]["coords"] == "osm"
    langs = {r["lang"] for r in db.execute("SELECT lang FROM place_names WHERE place_id = %s", [bridge["id"]]).fetchall()}
    assert {"vi", "en", "ja"} <= langs

    assert place(db, "An Bàng Beach")["cat"] == "nature.beach"  # real source refines the seed's coarse category
    assert place(db, "Morning Glory")["providers"] == ["osm"]

    unpublished = db.execute("SELECT external_id FROM place_sources WHERE place_id IS NULL AND provider <> 'manual' ORDER BY 1").fetchall()
    assert [r["external_id"] for r in unpublished] == ["n1006", "ovt-closed-cafe", "ovt-dentist"]
    assert db.execute("SELECT category_id FROM place_sources WHERE external_id = 'ovt-dentist'").fetchone()["category_id"] is None
    run = db.execute("SELECT status, stats FROM sync_runs WHERE id = %s", [out["run_id"]]).fetchone()
    assert run["status"] == "succeeded" and run["stats"]["publish"]["overture"]["created"] == 5


def test_second_sync_changes_nothing(settings, db):
    counts = lambda: db.execute(
        "SELECT (SELECT count(*) FROM places) AS p, (SELECT count(*) FROM place_sources) AS s, (SELECT count(*) FROM place_names) AS n"
    ).fetchone()
    before = counts()
    out = run_sync(settings, "hoi-an", None, PROVIDERS)
    for loaded in out["loaded"].values():
        assert loaded["inserted"] == 0 and loaded["changed"] == 0
    pub = out["publish"]
    assert pub["updated"] == 0 and pub["indexed"] == 0
    assert all(pub[p]["created"] == 0 and pub[p]["attached"] == 0 for p in ["manual", *PROVIDERS])
    assert counts() == before


def test_itineraries_and_seed_places_are_untouched(state, db):
    assert snapshot_itineraries(db) == state["before"]["itineraries"]
    rows = db.execute("SELECT id::text, name, status FROM places WHERE id = ANY(%s::uuid[])", [list(state["before"]["place_ids"])]).fetchall()
    assert len(rows) == len(state["before"]["place_ids"])
    assert {r["id"]: r["name"] for r in rows} == state["before"]["seed_names"]  # manual names win
    assert {r["status"] for r in rows} == {"ACTIVE"}


def test_dry_run_reports_without_writing(settings, db):
    before = db.execute(
        "SELECT (SELECT count(*) FROM places) AS p, (SELECT count(*) FROM place_sources) AS s, (SELECT count(*) FROM sync_runs) AS r"
    ).fetchone()
    out = run_sync(settings, "vn", None, ["overture"], dry_run=True)
    assert out["dry_run"] and out["publish"]["overture"]["created"] == 1  # Dragon Bridge, outside Hội An
    db.rollback()
    after = db.execute("SELECT (SELECT count(*) FROM places) AS p, (SELECT count(*) FROM place_sources) AS s, (SELECT count(*) FROM sync_runs) AS r").fetchone()
    assert after == before


def test_country_scope_publishes_places_without_a_destination(settings, db):
    out = run_sync(settings, "vn", None, ["overture"])
    assert out["status"] == "succeeded"
    assert set(out["loaded"]) == {"overture/vn-da-nang", "overture/vn-ha-noi"}  # one partition per province
    dragon = place(db, "Cầu Rồng")  # Dragon Bridge
    assert dragon["dest"] is None and dragon["destination_id"] is None and dragon["area"] == "vn-da-nang"


@pytest.fixture()
def changed_release(settings, tmp_path: Path) -> Settings:
    """A copy of the Overture fixture without Faifo Coffee and with a new phone for Bánh Mì Phượng."""
    src = Path(settings.overture_base) / settings.overture_release / "theme=places/type=place"
    out = tmp_path / "next" / "theme=places/type=place"
    out.mkdir(parents=True)
    con = duckdb.connect()
    con.execute("SET enable_geoparquet_conversion = false")
    con.execute(
        f"""COPY (SELECT * REPLACE (CASE WHEN id = 'ovt-banh-mi-phuong' THEN ['+84 235 0000 999'] ELSE phones END AS phones)
                 FROM read_parquet('{src}/*.parquet') WHERE id <> 'ovt-faifo')
            TO '{out}/part-00000.parquet' (FORMAT parquet)"""
    )
    return dataclasses.replace(settings, overture_base=str(tmp_path), overture_release="next")


def test_locked_fields_survive_a_source_change(changed_release, db):
    db.execute("UPDATE places SET phone = '+842351111111', locked_fields = '{phone}' WHERE name = 'Bánh Mì Phượng'")
    db.commit()
    out = run_sync(changed_release, "hoi-an", None, ["overture"])
    assert out["loaded"]["overture/hoi-an"]["changed"] == 1
    bmp = place(db, "Bánh Mì Phượng")
    assert bmp["phone"] == "+842351111111"
    src = db.execute("SELECT normalized->>'phone' AS phone FROM place_sources WHERE external_id = 'ovt-banh-mi-phuong'").fetchone()
    assert src["phone"] == "+842350000999"  # the new value is kept on the source record for review


def test_missing_three_runs_closes_with_safety_brake(changed_release, db):
    faifo = lambda: place(db, "Faifo Coffee")
    # The previous test was the first run without Faifo; one more keeps it open.
    run_sync(changed_release, "hoi-an", None, ["overture"])
    assert faifo()["status"] == "ACTIVE"
    assert db.execute("SELECT missing_runs FROM place_sources WHERE external_id = 'ovt-faifo'").fetchone()["missing_runs"] == 2

    strict = dataclasses.replace(changed_release, max_close_ratio=0.0)
    out = run_sync(strict, "hoi-an", None, ["overture"])
    assert out["status"] == "needs_review" and out["overture_missing"]["blocked"]
    assert faifo()["status"] == "ACTIVE"
    assert db.execute("SELECT status FROM sync_runs WHERE id = %s", [out["run_id"]]).fetchone()["status"] == "needs_review"

    out = run_sync(changed_release, "hoi-an", None, ["overture"])
    assert out["status"] == "succeeded" and out["overture_missing"]["would_close"] == 1
    assert faifo()["status"] == "CLOSED"


def test_reappearing_place_reopens(settings, db):
    run_sync(settings, "hoi-an", None, ["overture"])
    assert place(db, "Faifo Coffee")["status"] == "ACTIVE"
    assert db.execute("SELECT missing_runs FROM place_sources WHERE external_id = 'ovt-faifo'").fetchone()["missing_runs"] == 0
