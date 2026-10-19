"""Photos from Wikimedia Commons, against a fake Wikidata + Commons (httpx.MockTransport).

Runs after test_pipeline.py (file order), on the catalog it built around Hội An. All Q-ids, files,
authors and URLs here are invented.
"""

from __future__ import annotations

import dataclasses
import json
import re
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from golaly_catalog.photos import file_title_from_url, sync_photos, usable_license

pytestmark = pytest.mark.integration

BRIDGE_QI = "File:Bridge at dusk QI.jpg"


def item(qid, lat, lng, names, image=None, category=None):
    b = {"item": {"value": f"http://www.wikidata.org/entity/{qid}"}, "coord": {"value": f"Point({lng} {lat})"}, "names": {"value": "\u001f".join(names)}}
    if image:
        b["image"] = {"value": "http://commons.wikimedia.org/wiki/Special:FilePath/" + image.replace(" ", "%20")}
    if category:
        b["category"] = {"value": category}
    return b


ITEMS = [
    # Linked from the OSM way's wikidata tag → exact match, whatever its labels say.
    item("Q900001", 15.8774, 108.3258, ["Cầu Nhật Bản"], "Japanese bridge main.jpg", "Japanese Covered Bridge"),
    # Name matches ~40 m and ~80 m away → published.
    item("Q900002", 15.8775, 108.3310, ["Hội quán Phúc Kiến", "Phúc Kiến Assembly Hall"], "Phuc Kien hall.jpg"),
    item("Q900003", 15.8777, 108.3282, ["Phố cổ Hội An", "Hoi An Ancient Town"], "Old town lanterns.jpg"),
    # ~200 m away → queued for review.
    item("Q900004", 15.8783, 108.3712, ["Rừng dừa Bảy Mẫu", "Bảy Mẫu Coconut Forest"], "Coconut boats.jpg"),
    # Non-commercial licence → skipped.
    item("Q900005", 15.8797, 108.3302, ["Hội An Museum"], "Museum NC.jpg"),
    # ~450 m away → too far to trust a name match.
    item("Q900006", 15.9180, 108.3420, ["An Bàng Beach"], "Beach far.jpg"),
    # No place with that name.
    item("Q900007", 15.8800, 108.3300, ["Somewhere Else"], "Elsewhere.jpg"),
]

FILES = {
    "File:Japanese bridge main.jpg": dict(
        width=4000, height=2667, license="CC BY-SA 4.0", artist='<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a>'
    ),
    BRIDGE_QI: dict(width=3000, height=2000, license="CC BY 4.0", artist="Tran Van A", quality=True),
    "File:Bridge small QI.jpg": dict(width=1200, height=800, license="CC BY 4.0", artist="B", quality=True),
    "File:Bridge portrait QI.jpg": dict(width=2000, height=3000, license="CC BY 4.0", artist="C", quality=True),
    "File:Bridge snapshot.jpg": dict(width=3000, height=2000, license="CC BY 4.0", artist="D"),
    "File:Phuc Kien hall.jpg": dict(width=2400, height=1600, license="CC0", artist="E"),
    "File:Old town lanterns.jpg": dict(width=1800, height=1200, license="Public domain", artist="F"),
    "File:Coconut boats.jpg": dict(width=2000, height=1333, license="CC BY-SA 3.0", artist="G"),
    "File:Museum NC.jpg": dict(width=2000, height=1333, license="CC BY-NC-SA 4.0", artist="H"),
    "File:Beach far.jpg": dict(width=2000, height=1333, license="CC BY 4.0", artist="I"),
    "File:Elsewhere.jpg": dict(width=2000, height=1333, license="CC BY 4.0", artist="J"),
}


_CORNER = re.compile(r"Point\(([-\d.]+) ([-\d.]+)\)")


class FakeWikimedia:
    """Fake WDQS + Commons. WDQS answers only items inside the queried box, and times out (like the real
    service after 60 s) for boxes wider than `max_span` degrees, or always for boxes containing `broken`."""

    def __init__(self, max_span: float = 10.0, broken: tuple[float, float] | None = None, read_timeout: bool = False):
        self.files = json.loads(json.dumps(FILES))
        self.requests: list[httpx.Request] = []
        self.max_span = max_span
        self.broken = broken
        self.read_timeout = read_timeout

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        q = {k: v[0] for k, v in parse_qs(urlparse(str(request.url)).query).items()}
        if request.url.host == "query.wikidata.org":
            assert "wikibase:box" in q["query"]
            (x0, y0), (x1, y1) = [(float(a), float(b)) for a, b in _CORNER.findall(q["query"])]
            if x1 - x0 > self.max_span or (self.broken and x0 <= self.broken[1] <= x1 and y0 <= self.broken[0] <= y1):
                if self.read_timeout:
                    raise httpx.ReadTimeout("The read operation timed out", request=request)
                return httpx.Response(500, text="java.util.concurrent.TimeoutException")
            inside = [
                b
                for b in ITEMS
                if x0 <= float(_CORNER.search(b["coord"]["value"]).group(1)) <= x1 and y0 <= float(_CORNER.search(b["coord"]["value"]).group(2)) <= y1
            ]
            return httpx.Response(200, json={"results": {"bindings": inside}})
        if q.get("list") == "categorymembers":
            assert q["cmtitle"] == "Category:Japanese Covered Bridge"
            return httpx.Response(200, json={"query": {"categorymembers": [{"title": t} for t in FILES if t.startswith("File:Bridge")]}})
        pages = []
        for title in q["titles"].split("|"):
            f = self.files.get(title)
            if not f:
                pages.append({"title": title, "missing": True})
                continue
            name = title.removeprefix("File:").replace(" ", "_")
            pages.append(
                {
                    "title": title,
                    "categories": [{"title": "Category:Quality images"}] if f.get("quality") else [],
                    "imageinfo": [
                        {
                            "url": f"https://upload.wikimedia.org/wikipedia/commons/a/ab/{name}",
                            "thumburl": f"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/{name}/2400px-{name}",
                            "descriptionurl": f"https://commons.wikimedia.org/wiki/{title.replace(' ', '_')}",
                            "width": f["width"],
                            "height": f["height"],
                            "mime": "image/jpeg",
                            "extmetadata": {
                                "Artist": {"value": f["artist"]},
                                "LicenseShortName": {"value": f["license"]},
                                "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
                                "ImageDescription": {"value": "<p>A <b>fine</b> view</p>"},
                            },
                        }
                    ],
                }
            )
        return httpx.Response(200, json={"query": {"pages": pages}})


@pytest.fixture()
def fake():
    return FakeWikimedia()


@pytest.fixture()
def photo_settings(settings, database):
    return dataclasses.replace(settings, wikimedia_delay=0, contact="https://example.com/golaly-ops")


def run(photo_settings, fake, **kw):
    return sync_photos(photo_settings, "hoi-an", None, client=httpx.Client(transport=httpx.MockTransport(fake)), **kw)


def photos(db):
    return {
        r["source_id"]: r
        for r in db.execute(
            "SELECT ph.*, p.name AS place FROM place_photos ph JOIN places p ON p.id = ph.place_id WHERE ph.source = 'wikimedia' ORDER BY ph.score DESC"
        ).fetchall()
    }


def test_license_filter():
    assert usable_license("CC BY-SA 4.0") and usable_license("CC0") and usable_license("Public domain") and usable_license("CC BY 2.0")
    assert not usable_license("CC BY-NC-SA 4.0") and not usable_license("CC BY-ND 4.0") and not usable_license("Fair use")
    assert not usable_license("GFDL") and not usable_license(None)
    assert not usable_license("CC BY 4.0", restrictions="trademarked")
    assert file_title_from_url("http://commons.wikimedia.org/wiki/Special:FilePath/Ch%C3%B9a_C%E1%BA%A7u.jpg") == "File:Chùa Cầu.jpg"


def test_dry_run_writes_nothing(photo_settings, fake, db):
    out = run(photo_settings, fake, dry_run=True)
    assert out["dry_run"] and out["added"] > 0
    db.rollback()
    assert db.execute("SELECT count(*) AS n FROM place_photos WHERE source = 'wikimedia'").fetchone()["n"] == 0


def test_queues_licensed_photos_for_matched_places(photo_settings, fake, db):
    out = run(photo_settings, fake)
    assert out["items"] == 7 and out["matched"] == 5  # far beach and the unknown name aren't matched
    ua = fake.requests[0].headers["user-agent"]
    assert "Golaly-catalog" in ua and "https://example.com/golaly-ops" in ua
    p = photos(db)

    main = p["File:Japanese bridge main.jpg"]
    assert main["place"] == "Chùa Cầu" and main["status"] == "APPROVED" and main["score"] == 1.5
    assert main["remote_url"].endswith("/2400px-Japanese_bridge_main.jpg")  # a 2400 px rendition, not the 4000 px original
    assert main["author"] == "Jane Doe" and main["author_url"] == "https://commons.wikimedia.org/wiki/User:Jane"
    assert main["license"] == "CC BY-SA 4.0" and main["title"] == "Japanese bridge main"
    assert main["caption"] == "A fine view" and main["media_id"] is None

    # From the category: only the large landscape quality image.
    assert p[BRIDGE_QI]["place"] == "Chùa Cầu" and p[BRIDGE_QI]["score"] == 1.0
    assert not {"File:Bridge small QI.jpg", "File:Bridge portrait QI.jpg", "File:Bridge snapshot.jpg"} & set(p)

    assert p["File:Phuc Kien hall.jpg"]["place"] == "Phúc Kiến Assembly Hall" and p["File:Phuc Kien hall.jpg"]["status"] == "APPROVED"
    assert p["File:Old town lanterns.jpg"]["place"] == "Hội An Ancient Town"
    assert p["File:Coconut boats.jpg"]["status"] == "PENDING"  # matched by name ~200 m away: a moderator checks it
    assert "File:Museum NC.jpg" not in p and "File:Beach far.jpg" not in p and "File:Elsewhere.jpg" not in p

    run_row = db.execute("SELECT status, params, stats FROM sync_runs WHERE trigger = 'photos' ORDER BY started_at DESC LIMIT 1").fetchone()
    assert run_row["status"] == "succeeded" and run_row["params"]["kind"] == "photos" and run_row["stats"]["added"] == 5


def test_rerun_is_idempotent_and_keeps_moderation(photo_settings, fake, db):
    db.execute("UPDATE place_photos SET status = 'APPROVED' WHERE source_id = 'File:Coconut boats.jpg'")
    db.execute("UPDATE place_photos SET status = 'HIDDEN' WHERE source_id = 'File:Old town lanterns.jpg'")
    db.commit()
    out = run(photo_settings, fake)
    assert out["added"] == 0 and out["updated"] == 0 and out["hidden"] == 0
    p = photos(db)
    assert p["File:Coconut boats.jpg"]["status"] == "APPROVED" and p["File:Old town lanterns.jpg"]["status"] == "HIDDEN"


def test_licence_change_hides_the_photo(photo_settings, fake, db):
    fake.files["File:Phuc Kien hall.jpg"]["license"] = "CC BY-NC 4.0"
    fake.files["File:Japanese bridge main.jpg"]["artist"] = "Jane Q. Doe"
    out = run(photo_settings, fake)
    assert out["hidden"] == 1 and out["updated"] == 1
    p = photos(db)
    assert p["File:Phuc Kien hall.jpg"]["status"] == "HIDDEN"
    assert p["File:Japanese bridge main.jpg"]["author"] == "Jane Q. Doe" and p["File:Japanese bridge main.jpg"]["status"] == "APPROVED"


def test_unknown_area(photo_settings, fake):
    from golaly_catalog.pipeline import ScopeError

    with pytest.raises(ScopeError):
        sync_photos(photo_settings, "atlantis", None, client=httpx.Client(transport=httpx.MockTransport(fake)))


def test_refuses_to_run_without_a_contact(photo_settings, fake):
    from golaly_catalog.photos import ContactMissing

    for contact in (None, "", "me", "set CATALOG_CONTACT"):
        with pytest.raises(ContactMissing, match="CATALOG_CONTACT"):
            run(dataclasses.replace(photo_settings, contact=contact), fake)
    assert fake.requests == []  # nothing was sent to Wikimedia
    assert "(+https://example.com/golaly-ops) httpx/" in photo_settings.user_agent
    assert "(+an@example.com)" in dataclasses.replace(photo_settings, contact="an@example.com").user_agent


def test_403_explains_the_user_agent_policy(photo_settings, db):
    refused = httpx.MockTransport(lambda r: httpx.Response(403, text="Please respect our robot policy"))
    with pytest.raises(PermissionError, match="403.*CATALOG_CONTACT"):
        sync_photos(photo_settings, "hoi-an", None, client=httpx.Client(transport=refused))
    row = db.execute("SELECT status, error FROM sync_runs WHERE trigger = 'photos' ORDER BY started_at DESC LIMIT 1").fetchone()
    assert row["status"] == "failed" and "403" in row["error"]


def test_big_areas_are_queried_in_tiles_that_split_on_timeout(photo_settings, db):
    """A whole region in one query times out on the real service (ReadTimeout / 500): tiles, then quarters."""
    from golaly_catalog.models import BBox
    from golaly_catalog.photos import Wikimedia, tiles, wikidata_items

    assert len(tiles(BBox(0, 0, 2, 1))) == 8  # 0.5° tiles
    for fake in (FakeWikimedia(max_span=0.1), FakeWikimedia(max_span=0.1, read_timeout=True)):
        wm = Wikimedia(photo_settings, httpx.Client(transport=httpx.MockTransport(fake)))
        failed: list = []
        items = wikidata_items(wm, BBox(108.0, 15.6, 108.6, 16.1), failed)
        assert {i.qid for i in items} == {b["item"]["value"].rsplit("/", 1)[-1] for b in ITEMS}  # nothing lost
        assert failed == [] and len(fake.requests) > 4


def test_a_tile_that_never_answers_is_skipped_and_reported(photo_settings, db):
    # Every query covering the Phúc Kiến hall's coordinates times out, even the smallest tile.
    fake = FakeWikimedia(broken=(15.8775, 108.3310))
    out = run(photo_settings, fake)
    assert out["status"] == "partial" and out["skipped_tiles"] == 1
    assert out["matched"] >= 2  # items outside the broken ~3 km tile (the bridge, the coconut forest) still match
    row = db.execute("SELECT status, stats FROM sync_runs WHERE trigger = 'photos' ORDER BY started_at DESC LIMIT 1").fetchone()
    assert row["status"] == "partial"
