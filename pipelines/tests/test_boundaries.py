from triply_catalog.boundaries import area_slug


def test_latin_primary_names_keep_their_slug():
    assert area_slug("VN", {"primary": "Đà Nẵng"}, "VN-DN", "ovt-1", {}) == "vn-da-nang"


def test_non_latin_names_use_english_then_the_region_code():
    assert area_slug("JP", {"primary": "東京都", "common": {"en": "Tokyo", "ja": "東京都"}}, "JP-13", "a", {}) == "jp-tokyo"
    assert area_slug("JP", {"primary": "大阪府"}, "JP-27", "b", {}) == "jp-27"
    assert area_slug("TH", {"primary": "กรุงเทพมหานคร"}, None, "overture-xyz-12345678", {}).startswith("th-")


def test_slugs_are_unique_and_stable():
    taken: dict[str, str] = {}
    a = area_slug("JP", {"primary": "府中", "common": {"en": "Fuchu"}}, "JP-34", "x1", taken)
    b = area_slug("JP", {"primary": "府中", "common": {"en": "Fuchu"}}, "JP-13", "x2", taken)
    assert (a, b) == ("jp-fuchu", "jp-fuchu-13")
    # Re-importing the same area gives the same slug.
    assert area_slug("JP", {"primary": "府中", "common": {"en": "Fuchu"}}, "JP-13", "x2", taken) == "jp-fuchu-13"
    # Every Japanese prefecture used to become "jp-": no two areas may share a slug any more.
    seen = {area_slug("JP", {"primary": n}, None, f"id{i}", taken) for i, n in enumerate(["北海道", "青森県", "岩手県"])}
    assert len(seen) == 3 and "jp-" not in seen
