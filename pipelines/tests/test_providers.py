"""Adapters against the synthetic fixtures (tests/fixtures/make_fixtures.py)."""

from pathlib import Path

from triply_catalog.models import BBox, Partition
from triply_catalog.providers.osm import category_candidates, to_place
from triply_catalog.providers.overture import category_candidates as ovt_candidates

FIXTURES_DIR = Path(__file__).parent / "fixtures"
HOI_AN = BBox(108.2, 15.75, 108.45, 16.0)


def fetch(settings, provider):
    from triply_catalog.providers import get_provider

    return {p.external_id: p for batch in get_provider(provider, settings).fetch(Partition(provider, "hoi-an", HOI_AN)) for p in batch}


def test_overture_reads_bbox_and_skips_low_confidence(settings):
    places = fetch(settings, "overture")
    assert "ovt-low-confidence" not in places  # confidence 0.2 < 0.6
    assert "ovt-dragon-bridge" not in places  # outside the box (Đà Nẵng city)
    p = places["ovt-banh-mi-phuong"]
    assert p.name == "Bánh Mì Phượng"
    assert p.names == {"en": "Banh Mi Phuong", "vi": "Bánh Mì Phượng"}
    assert p.category_candidates[0] == "vietnamese_restaurant"
    assert p.phone == "+842350000001"
    assert p.website == "https://banhmiphuong.example/"  # tracking parameter dropped
    assert p.address == "2B Phan Châu Trinh, Hội An"
    assert places["ovt-closed-cafe"].operating_status == "permanently_closed"


def test_overture_candidates_cover_old_and_new_schema():
    new = {
        "basic_category": "restaurant",
        "taxonomy": {"primary": "pho_restaurant", "hierarchy": ["food_and_drink", "restaurant", "pho_restaurant"], "alternates": ["noodles_restaurant"]},
    }
    assert ovt_candidates(new) == ["pho_restaurant", "restaurant", "food_and_drink", "noodles_restaurant"]
    old = {"categories": {"primary": "cafe", "alternate": ["coffee_shop"]}}
    assert ovt_candidates(old) == ["cafe", "coffee_shop"]


def test_osm_nodes_and_ways(settings):
    places = fetch(settings, "osm")
    assert set(places) == {"n1001", "n1002", "n1003", "n1006", "w3001"}  # unnamed / unmapped tags dropped
    bridge = places["w3001"]
    assert round(bridge.lat, 4) == 15.8773 and round(bridge.lng, 4) == 108.3258  # way → average of its nodes
    assert "prefix" not in bridge.names and bridge.names["ja"] == "来遠橋"
    assert places["n1001"].opening_hours == "Mo-Su 06:30-21:30"
    assert places["n1002"].address == "106 Nguyễn Thái Học"
    assert places["n1006"].operating_status == "permanently_closed"


def test_osm_category_candidates_most_specific_first():
    tags = {"amenity": "restaurant", "cuisine": "vietnamese;noodle"}
    assert category_candidates(tags) == ["amenity=restaurant;cuisine=vietnamese", "amenity=restaurant;cuisine=noodle", "amenity=restaurant"]


def test_osm_name_fallback_to_translation():
    p = to_place("n9", 15.0, 108.0, {"amenity": "cafe", "name:en": "Only English"})
    assert p and p.name == "Only English"
    assert to_place("n10", 15.0, 108.0, {"amenity": "cafe"}) is None


def test_foursquare_filters_and_normalises(settings):
    places = fetch(settings, "fsq")
    # stale (not refreshed for years) and flagged-as-nonexistent listings are skipped; the Đà Nẵng one is outside the box
    assert set(places) == {"fsq-banh-mi", "fsq-reaching-out", "fsq-tailor", "fsq-closed", "fsq-dentist"}
    p = places["fsq-banh-mi"]
    assert p.name == "Bánh Mì Phượng" and p.names == {"vi": "Bánh Mì Phượng"}
    assert p.phone == "+842350000001" and p.address == "2B Phan Châu Trinh, Hội An"
    assert p.category_candidates == [
        "Dining and Drinking > Restaurant > Asian Restaurant > Vietnamese Restaurant",
        "Dining and Drinking > Restaurant > Asian Restaurant",
        "Dining and Drinking > Restaurant",
        "Dining and Drinking",
    ]
    assert places["fsq-closed"].operating_status == "permanently_closed"
    assert places["fsq-reaching-out"].website == "https://reachingoutvietnam.example/"


def test_foursquare_needs_a_token_for_hugging_face(settings):
    import dataclasses

    from triply_catalog.sources import get_source

    hf = dataclasses.replace(settings, fsq_base="hf://datasets/foursquare/fsq-os-places/release", hf_token=None)
    assert "HF_TOKEN" in get_source("fsq", hf).check()[0]
    assert get_source("fsq", dataclasses.replace(hf, hf_token="hf_x")).check() == []


def test_osm_picks_the_geofabrik_extract_of_each_country(settings, tmp_path):
    import dataclasses

    import pytest

    from triply_catalog.sources import SourceConfigError, get_source
    from triply_catalog.sources.osm import geofabrik_url

    auto = dataclasses.replace(settings, osm_source="", geofabrik_index=str(FIXTURES_DIR / "osm" / "geofabrik-index.json"), data_dir=tmp_path)
    assert geofabrik_url(auto, "cn").endswith("/asia/china-latest.osm.pbf")
    assert geofabrik_url(auto, "SG").endswith("/malaysia-singapore-brunei-latest.osm.pbf")  # the smallest extract covering it
    with pytest.raises(SourceConfigError, match="no extract"):
        geofabrik_url(auto, "ZZ")

    src = get_source("osm", auto)
    assert src.check() == []
    scope = [
        Partition("", "vn-da-nang", BBox(107.8, 15.9, 108.4, 16.2), "a1", "VN"),
        Partition("", "vn-ha-noi", BBox(105.3, 20.6, 106.0, 21.4), "a2", "VN"),
        Partition("", "cn-yunnan", BBox(97.5, 21.1, 106.2, 29.3), "a3", "CN"),
    ]
    parts = src.partitions(scope)
    assert [(p.country, p.key) for p in parts] == [("VN", "vn-da-nang+vn-ha-noi"), ("CN", "cn-yunnan")]  # one pass per country file
    assert src.source_url(parts[1]).endswith("china-latest.osm.pbf")
    with pytest.raises(SourceConfigError, match="boundaries"):
        src.source_url(Partition("osm", "bbox", BBox(0, 0, 1, 1)))
    # A fixed OSM_SOURCE still means one file for everything.
    fixed = get_source("osm", dataclasses.replace(auto, osm_source=settings.osm_source))
    assert len(fixed.partitions(scope)) == 1
