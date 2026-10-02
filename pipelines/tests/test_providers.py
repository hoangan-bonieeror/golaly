"""Adapters against the synthetic fixtures (tests/fixtures/make_fixtures.py)."""

from triply_catalog.models import BBox, Partition
from triply_catalog.providers.osm import category_candidates, to_place
from triply_catalog.providers.overture import category_candidates as ovt_candidates

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
