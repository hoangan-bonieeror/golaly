"""Scored duplicate detection, merging and unmerging (catalog phase 2).

Unit tests for the scoring, then integration tests on synthetic places in Đà Nẵng (away from the Hội An fixtures
the other tests use). Runs after test_pipeline.py (file order) on the catalog database it built.
"""

from __future__ import annotations

import csv
import dataclasses
import json
import uuid

import pytest

from golaly_catalog import dedupe
from golaly_catalog.config import Settings
from golaly_catalog.dedupe import P, address_score, core_name, name_score, score_pair, similarity

S = Settings()


def place(pid="a", name="banh mi phuong", lat=16.05, lng=108.2, cat="c-banhmi", group="food", **kw) -> P:
    return P(id=pid, name=name, names={name}, lat=lat, lng=lng, category_id=cat, group=group, address=kw.pop("address", None), phone=None, website=None, **kw)


# ── unit ─────────────────────────────────────────────────────────────────────


def test_text_signals():
    assert core_name("quan banh mi phuong") == "banh mi phuong" and core_name("quan") == "quan"
    assert similarity("banh mi phuong", "banh mi phuong") == 1.0
    assert 0.5 < similarity("hoi quan phuc kien", "hoi quan phuoc kien") < 1
    assert similarity("chua cau", "pho co") < 0.2
    assert name_score({"nha hang madam khanh"}, {"madam khanh"}) == 1.0  # the generic word doesn't count
    assert name_score({"chua cau", "japanese covered bridge"}, {"japanese bridge"}) > 0.5  # any language
    assert address_score("2B Phan Châu Trinh, Hội An", "2b phan chau trinh") == 1.0
    assert address_score("2B Phan Châu Trinh", "14 Phan Châu Trinh") == 0.0
    assert address_score(None, "14 Phan Châu Trinh") is None


def test_scores_and_blocking_rules():
    a = place("a", "banh mi phuong", 16.05, 108.2)
    close = place("b", "quan banh mi phuong", 16.05010, 108.2)  # ~11 m, same category
    p = score_pair(a, close, S)
    assert p and p.score >= S.merge_auto and not p.blocked and "address" not in p.signals  # missing address isn't held against it

    far = place("c", "banh mi phuong", 16.0505, 108.2)  # ~55 m
    assert S.merge_review <= score_pair(a, far, S).score < 1
    assert score_pair(a, place("d", "banh mi phuong", 16.0515, 108.2), S) is None  # ~170 m: not a candidate

    hotel = place("e", "banh mi phuong", 16.05005, 108.2, cat="c-hotel", group="lodging")
    assert score_pair(a, hotel, S).blocked == "different_kind"  # a hotel and its restaurant are two places
    cafe = place("f", "banh mi phuong", 16.05005, 108.2, cat="c-cafe", group="drink")
    assert not score_pair(a, cafe, S).blocked  # food and drink can be the same place

    twin_a = place("g", ids={"osm": {"n1"}})
    twin_b = place("h", lat=16.05003, ids={"osm": {"n2"}})
    assert score_pair(twin_a, twin_b, S).blocked == "same_provider"  # OSM itself lists them as two places

    ovt = place("i", "phuc kien assembly hall", refs={"osm:w42"})
    osm = place("j", "hoi quan phuc kien", lat=16.0510, ids={"osm": {"w42"}})  # ~110 m, names differ
    sure = score_pair(ovt, osm, S)
    assert sure.score == 1.0 and sure.signals["sure"] == "external_id"

    pa, pb = place("k", "aaa"), place("l", "zzz", lat=16.0508)
    pa.phone = pb.phone = "+842350000009"
    assert score_pair(pa, pb, S).signals["sure"] == "phone"


def test_overture_source_refs():
    refs = dedupe._refs(
        [
            {"dataset": "OpenStreetMap", "record_id": "w123@4"},
            {"dataset": "OpenStreetMap", "record_id": "node/77"},
            {"dataset": "Foursquare", "record_id": "4b5f@2"},
            {"dataset": "meta", "record_id": "999"},
        ]
    )
    assert refs == {"osm:w123", "osm:n77", "fsq:4b5f"}


def test_winner_is_the_place_with_more_links():
    a, b = place("a", links=0, sources=3), place("b", links=2, sources=1)
    assert dedupe.pick_winner(a, b)[0].id == "b"
    c, d = place("c", links=0, sources=1, manual=True), place("d", links=0, sources=1)
    c.created_at = d.created_at = 1
    assert dedupe.pick_winner(d, c)[0].id == "c"  # curated wins a tie


# ── integration ──────────────────────────────────────────────────────────────


@pytest.fixture()
def cat(db):
    return {r["key"]: r["id"] for r in db.execute("SELECT key, id::text AS id FROM categories").fetchall()}


def add_place(db, cat, name, lat, lng, key="food.vietnamese", provider="overture", ext=None, address=None, phone=None, raw=None):
    pid, ext = str(uuid.uuid4()), ext or f"t-{uuid.uuid4().hex[:10]}"
    from golaly_catalog.normalize import normalize_search

    norm = normalize_search(name)
    db.execute(
        """INSERT INTO places (id, name, name_norm, category, category_id, lat, lng, address, phone, search_text, search_accent)
           VALUES (%s, %s, %s, 'RESTAURANT', %s, %s, %s, %s, %s, %s, %s)""",
        [pid, name, norm, cat[key], lat, lng, address or "", phone, norm, name.lower()],
    )
    db.execute(
        """INSERT INTO place_sources (id, place_id, provider, external_id, raw, normalized, content_hash, lat, lng, category_id, license, attribution)
           VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, 'x', %s, %s, %s, 'test', 'test')""",
        [pid, provider, ext, json.dumps(raw or {}), json.dumps({"name": name, "names_norm": [norm], "address": address, "phone": phone}), lat, lng, cat[key]],
    )
    return pid


@pytest.fixture()
def demo_user(db):
    u = db.execute("SELECT id::text AS id FROM users ORDER BY created_at LIMIT 1").fetchone()["id"]
    day = db.execute("SELECT id::text AS id FROM trip_days LIMIT 1").fetchone()["id"]
    return u, day


@pytest.mark.integration
def test_merges_moves_links_and_unmerges(db, cat, demo_user, settings):
    user, day = demo_user
    s = dataclasses.replace(settings)
    keep = add_place(db, cat, "Bánh Xèo Bà Dưỡng", 16.0601, 108.2101, address="K280/23 Hoàng Diệu")
    dup = add_place(db, cat, "Quán Bánh Xèo Bà Dưỡng", 16.06015, 108.21012, provider="osm", address="K280/23 Hoàng Diệu")
    item = str(uuid.uuid4())
    db.execute(
        "INSERT INTO itinerary_items (id, trip_id, day_id, type, title, place_id, sort_order, updated_at)"
        " SELECT %s, d.trip_id, d.id, 'RESTAURANT', 'Lunch', %s, 99, now() FROM trip_days d WHERE d.id = %s",
        [item, dup, day],
    )
    db.execute("INSERT INTO saved_places (user_id, place_id) VALUES (%s, %s), (%s, %s)", [user, dup, user, keep])

    out = dedupe.dedupe(db, s, [keep])
    assert out["merged"] == 1
    # The itinerary pointed at `dup`, so `dup` (more links) survives and `keep` is merged into it.
    winner, loser = dup, keep
    row = db.execute("SELECT merged_into_id::text AS m FROM places WHERE id = %s", [loser]).fetchone()
    assert row["m"] == winner
    assert db.execute("SELECT count(*) AS n FROM place_sources WHERE place_id = %s", [winner]).fetchone()["n"] == 2
    assert db.execute("SELECT count(*) AS n FROM saved_places WHERE user_id = %s AND place_id IN (%s, %s)", [user, winner, loser]).fetchone()["n"] == 1
    m = db.execute("SELECT id::text AS id, moved FROM place_merges WHERE loser_id = %s", [loser]).fetchone()
    assert m["moved"]["saved_dropped"] == [user]  # the user had saved both: one save is enough
    assert db.execute("SELECT status::text AS s FROM merge_candidates WHERE place_a = least(%s::uuid, %s::uuid)", [winner, loser]).fetchone()["s"] == "MERGED"

    # Running again changes nothing.
    assert dedupe.dedupe(db, s, [winner])["merged"] == 0

    undone = dedupe.unmerge(db, s, m["id"], "test")
    assert undone["restored"]["sources"] == 1
    assert db.execute("SELECT merged_into_id FROM places WHERE id = %s", [loser]).fetchone()["merged_into_id"] is None
    assert db.execute("SELECT count(*) AS n FROM saved_places WHERE user_id = %s AND place_id IN (%s, %s)", [user, winner, loser]).fetchone()["n"] == 2
    assert db.execute("SELECT place_id::text AS p FROM itinerary_items WHERE id = %s", [item]).fetchone()["p"] == winner  # it was never moved
    # A pair someone pulled apart is never merged again automatically.
    assert dedupe.dedupe(db, s, [winner, loser])["merged"] == 0
    db.rollback()


@pytest.mark.integration
def test_uncertain_and_blocked_pairs_wait_for_review(db, cat, settings):
    a = add_place(db, cat, "Cơm Gà Bà Buội", 16.0701, 108.2201)
    b = add_place(db, cat, "Com Ga Ba Buoi 2", 16.07055, 108.22012, provider="osm")  # ~50 m, a "2"
    h = add_place(db, cat, "Cơm Gà Bà Buội", 16.07012, 108.22011, key="lodging.hotel", provider="osm")  # same name, a hotel
    out = dedupe.dedupe(db, settings, [a])
    assert out["merged"] == 0 and out["queued"] == 2 and out["blocked"] == 1
    rows = {
        frozenset((r["a"], r["b"])): r
        for r in db.execute("SELECT place_a::text AS a, place_b::text AS b, status::text AS status, signals FROM merge_candidates").fetchall()
    }
    assert rows[frozenset((a, h))]["signals"]["blocked"] == "different_kind"
    assert rows[frozenset((a, b))]["status"] == "PENDING"
    db.rollback()


@pytest.mark.integration
def test_overture_record_built_from_an_osm_way_is_the_same_place(db, cat, settings):
    ovt = add_place(
        db, cat, "Phuc Kien Assembly Hall", 16.0801, 108.2301, key="culture.pagoda", raw={"sources": [{"dataset": "OpenStreetMap", "record_id": "w9001@3"}]}
    )
    osm = add_place(db, cat, "Hội quán Phúc Kiến", 16.08085, 108.2301, key="culture.pagoda", provider="osm", ext="w9001")  # ~95 m
    assert dedupe.dedupe(db, settings, [ovt])["merged"] == 1
    merged = db.execute("SELECT count(*) AS n FROM places WHERE id IN (%s, %s) AND merged_into_id IS NOT NULL", [ovt, osm]).fetchone()["n"]
    assert merged == 1
    db.rollback()


@pytest.mark.integration
def test_sample_and_evaluate(db, cat, settings, tmp_path):
    ids = [
        add_place(db, cat, "Mì Quảng Ếch Bếp Trang", 16.0901, 108.2401),
        add_place(db, cat, "Mi Quang Ech Bep Trang", 16.09012, 108.24011, provider="osm"),
        add_place(db, cat, "Bếp Trang Mì Quảng", 16.09045, 108.2401, provider="osm"),
    ]
    path = tmp_path / "pairs.csv"
    counts = dedupe.sample(db, settings, ids, 30, str(path))
    assert sum(counts.values()) >= 2
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    assert {"pair", "score", "decision", "label", "name_a", "name_b"} <= set(rows[0])
    for r in rows:  # pretend a person labelled them: only the near-identical names are the same place
        r["label"] = "same" if float(r["score"]) >= 0.85 else "different"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    ev = dedupe.evaluate(str(path))
    t85 = next(t for t in ev["thresholds"] if t["threshold"] == 0.85)
    assert ev["labelled"] == len(rows) and t85["precision"] in (1.0, None)
    db.rollback()


@pytest.mark.integration
def test_cli_review_flow(db, cat, settings, monkeypatch, capsys):
    from golaly_catalog import cli

    a = add_place(db, cat, "Hải Sản Bé Mặn", 16.1001, 108.2501)
    b = add_place(db, cat, "Hai San Be Man 2", 16.10055, 108.25012, provider="osm")
    db.commit()
    monkeypatch.setenv("DATABASE_URL", settings.database_url)
    try:
        assert cli.main(["dedupe", "--bbox", "108.24,16.09,108.26,16.11"]) == 0
        assert cli.main(["merges", "list", "--bbox", "108.24,16.09,108.26,16.11"]) == 0
        listed = json.loads(capsys.readouterr().out.split("\n}\n", 1)[1])
        assert len(listed) == 1 and {listed[0]["place_a"], listed[0]["place_b"]} == {a, b}
        assert cli.main(["merges", "decide", listed[0]["id"], "merge"]) == 0
        decided = json.loads(capsys.readouterr().out)
        assert decided["status"] == "MERGED"
        assert cli.main(["merges", "decide", listed[0]["id"], "reject"]) == 2  # already decided
        assert cli.main(["merges", "undo", decided["merge"]]) == 0
        capsys.readouterr()
        assert cli.main(["merges", "list", "--status", "REJECTED", "--bbox", "108.24,16.09,108.26,16.11"]) == 0
        assert len(json.loads(capsys.readouterr().out)) == 1
    finally:
        db.rollback()
        db.execute("DELETE FROM place_sources WHERE place_id IN (%s, %s)", [a, b])
        db.execute("DELETE FROM places WHERE id IN (%s, %s)", [a, b])
        db.commit()


@pytest.mark.integration
def test_sync_runs_dedupe_on_what_it_touched(settings, database):
    from golaly_catalog.pipeline import run_sync

    out = run_sync(settings, "hoi-an", None, ["overture", "osm"], dry_run=True)
    assert set(out["publish"]["dedupe"]) == {"pairs", "merged", "queued", "blocked"}


@pytest.mark.integration
def test_foursquare_joins_the_same_places(settings, database, db):
    """A sync with Foursquare attaches its records to the places Overture/OSM already made, adds the new ones, and
    Foursquare's finer category wins (FIELD_PRIORITY)."""
    from golaly_catalog.pipeline import run_sync

    out = run_sync(settings, "hoi-an", None, ["overture", "osm", "fsq"], dry_run=True)
    assert out["loaded"]["fsq/hoi-an"]["fetched"] == 5
    # Bánh Mì Phượng (and the tea house, which the demo seed already has) attach; the tailor shop is new; the dentist
    # has no travel category and the closed noodle shop isn't published.
    assert out["publish"]["fsq"] == {"attached": 2, "created": 1}
