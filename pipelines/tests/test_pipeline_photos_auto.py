"""Incremental photo runs (the automatic one after a sync), the sync → photos hand-over, and storage modes.

Runs after test_pipeline_photos.py (file order), on the catalog and photos it built around Hội An.
"""

from __future__ import annotations

import dataclasses

import httpx
import pytest

from golaly_catalog.photos import Candidate, count_due, row_values, save, sync_photos
from golaly_catalog.pipeline import photo_scope, run_sync
from golaly_catalog.sources import SourceConfigError
from golaly_catalog.sources.base import Manifest, NormalizedPhoto

from .test_pipeline_photos import FakeWikimedia

pytestmark = pytest.mark.integration


@pytest.fixture()
def photo_settings(settings, database):
    return dataclasses.replace(settings, wikimedia_delay=0, contact="https://example.com/golaly-ops")


def run(photo_settings, fake, **kw):
    return sync_photos(photo_settings, "hoi-an", None, client=httpx.Client(transport=httpx.MockTransport(fake)), **kw)


def place_id(db, name):
    return db.execute("SELECT id::text AS id FROM places WHERE name = %s", [name]).fetchone()["id"]


def all_checked(db):
    db.execute("UPDATE places SET photos_checked_at = now()")
    db.commit()


def test_a_new_name_or_position_forgets_the_last_check(db):
    all_checked(db)
    pid = place_id(db, "Chùa Cầu")
    checked = lambda: db.execute("SELECT photos_checked_at FROM places WHERE id = %s", [pid]).fetchone()["photos_checked_at"]  # noqa: E731
    db.execute("UPDATE places SET address = address || ' ' WHERE id = %s", [pid])
    assert checked() is not None  # other fields don't matter
    db.execute("UPDATE places SET lat = lat + 0.00001 WHERE id = %s", [pid])
    assert checked() is None
    db.rollback()


def test_nothing_due_means_no_requests(photo_settings, db):
    all_checked(db)
    fake = FakeWikimedia()
    out = run(photo_settings, fake, only_due=True)
    assert fake.requests == [] and out["due"] == 0 and out["status"] == "succeeded"
    assert count_due(photo_settings, ["hoi-an"], None) == 0


def test_only_due_places_are_looked_at(photo_settings, db):
    all_checked(db)
    bridge = place_id(db, "Chùa Cầu")
    db.execute("DELETE FROM place_photos WHERE place_id = %s AND source = 'wikimedia'", [bridge])
    db.execute("UPDATE places SET photos_checked_at = NULL WHERE id = %s", [bridge])  # e.g. new since the last run
    # Checked long ago → due again; but its photos are already queued, so nothing new.
    db.execute("UPDATE places SET photos_checked_at = now() - interval '40 days' WHERE name = 'Phúc Kiến Assembly Hall'")
    before = {r["source_id"]: r["updated_at"] for r in db.execute("SELECT source_id, updated_at FROM place_photos WHERE source = 'wikimedia'")}
    db.commit()
    assert count_due(photo_settings, ["hoi-an"], None) == 2

    fake = FakeWikimedia()
    out = run(photo_settings, fake, only_due=True)
    assert out["due"] == 2 and out["matched"] == 2 and out["added"] == 2  # the bridge's main image + its quality image
    after = {r["source_id"]: r for r in db.execute("SELECT source_id, updated_at, place_id::text AS place FROM place_photos WHERE source = 'wikimedia'")}
    assert {k for k, r in after.items() if r["place"] == bridge} == {"File:Japanese bridge main.jpg", "File:Bridge at dusk QI.jpg"}
    assert all(after[k]["updated_at"] == v for k, v in before.items() if k in after)  # other places' rows untouched
    assert count_due(photo_settings, ["hoi-an"], None) == 0
    row = db.execute("SELECT params FROM sync_runs WHERE trigger = 'photos' ORDER BY started_at DESC LIMIT 1").fetchone()
    assert row["params"]["only_due"] is True


def test_several_areas_in_one_run(photo_settings, db):
    all_checked(db)
    fake = FakeWikimedia()
    out = sync_photos(photo_settings, areas=["hoi-an", "hoi-an"], only_due=True, client=httpx.Client(transport=httpx.MockTransport(fake)))
    assert list(out["partitions"]) == ["hoi-an"]


def test_sync_hands_its_areas_to_photos(settings, database):
    out = run_sync(settings, "hoi-an", None, ["overture", "osm"])
    assert out["photo_scope"] == {"areas": ["hoi-an"], "bbox": None}


def test_photo_scope_after_a_partial_sync():
    parts = [
        {"provider": "overture", "key": "vn-da-nang", "covers": ["vn-da-nang"]},
        {"provider": "overture", "key": "vn-quang-nam", "covers": ["vn-quang-nam"]},
        {"provider": "osm", "key": "vn-da-nang+vn-quang-nam", "covers": ["vn-da-nang", "vn-quang-nam"]},
    ]
    everything = {"overture/vn-da-nang", "overture/vn-quang-nam", "osm/vn-da-nang+vn-quang-nam"}
    assert photo_scope("vn", None, parts, everything) == {"areas": ["vn"], "bbox": None}
    assert photo_scope("vn", None, parts, everything - {"overture/vn-quang-nam"}) == {"areas": ["vn-da-nang"], "bbox": None}
    assert photo_scope("vn", None, parts, everything - {"osm/vn-da-nang+vn-quang-nam"}) is None  # OSM covers both
    box = [{"provider": "overture", "key": "bbox", "covers": ["bbox"]}]
    assert photo_scope(None, "1,2,3,4", box, {"overture/bbox"}) == {"areas": [], "bbox": "1,2,3,4"}
    assert photo_scope(None, "1,2,3,4", box, set()) is None


def _candidate(place: str) -> Candidate:
    p = NormalizedPhoto(
        source_id="ref-1",
        subject="s1",
        remote_url="https://example.com/1.jpg",
        page_url="https://example.com/1",
        width=2000,
        height=1500,
        license="CC BY 4.0",
        author="Someone",
        caption="A caption",
    )
    return Candidate(place, p, 1.0, approved=False)


def test_storage_modes_are_enforced_when_saving(db):
    reference = Manifest(key="test-reference", name="Ref", provides=frozenset({"photos"}), license="terms", attribution="Ref", storage="reference")
    id_only = dataclasses.replace(reference, key="test-ids", storage="id_only")
    pid = place_id(db, "Chùa Cầu")
    v = row_values(reference, _candidate(pid))
    assert v["remote_url"] is None and v["caption"] is None and v["author"] == "Someone" and v["page_url"]
    v = row_values(id_only, _candidate(pid))
    assert all(v[k] is None for k in ("remote_url", "page_url", "title", "author", "license", "caption")) and v["source_id"] == "ref-1"

    save(db, reference, [_candidate(pid)], set())
    row = db.execute("SELECT * FROM place_photos WHERE source = 'test-reference'").fetchone()
    assert row["remote_url"] is None and row["media_id"] is None  # nothing for the ingester to download
    db.rollback()


def test_place_records_from_non_store_sources_are_refused(db):
    from golaly_catalog.load import load_batch

    with pytest.raises(SourceConfigError, match="can't be stored"):
        load_batch(db, "00000000-0000-0000-0000-000000000000", [], "terms", "x", storage="id_only")
