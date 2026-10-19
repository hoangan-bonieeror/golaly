import json
from pathlib import Path

import pytest

from golaly_catalog.models import NormalizedPlace
from golaly_catalog.normalize import (
    accent_search,
    content_hash,
    english_area_name,
    lang_tag,
    name_key,
    normalize_phone,
    normalize_search,
    normalize_website,
    short_area_name,
    slugify,
)

CASES = json.loads((Path(__file__).parents[2] / "packages/shared/fixtures/normalize-cases.json").read_text("utf-8"))["cases"]


@pytest.mark.parametrize("text,expected", CASES)
def test_normalize_search_matches_the_app(text, expected):
    # Same file the TypeScript test reads: search in the app and matching in the pipeline agree.
    assert normalize_search(text) == expected


def test_accent_search_keeps_diacritics():
    assert accent_search("  Phở   Thìn ") == "phở thìn"
    assert accent_search("Phở") == "phở"  # NFD input → NFC, like the app


def test_short_area_name():
    assert short_area_name("Thành phố Đà Nẵng") == "Đà Nẵng"
    assert short_area_name("Tỉnh Lâm Đồng") == "Lâm Đồng"
    assert short_area_name("Île-de-France") == "Île-de-France"
    assert short_area_name(None) == ""


def test_english_area_name():
    assert english_area_name("Cà Mau Province", "VN") == "Ca Mau"
    assert english_area_name("Bắc Ninh City", "VN") == "Bac Ninh"
    assert english_area_name("Đà Nẵng", "VN") == "Da Nang"
    assert english_area_name("Ho Chi Minh City", "VN") == "Ho Chi Minh City"  # "City" is part of that name
    assert english_area_name("Provence-Alpes-Côte d'Azur", "FR") == "Provence-Alpes-Côte d'Azur"  # English keeps French accents


def test_name_key_ignores_spelling_and_type():
    assert name_key("Hanoi") == name_key("Thành phố Hà Nội")
    assert name_key("Ho Chi Minh City") == name_key("Thành phố Hồ Chí Minh")
    assert name_key("Hội An") != name_key("Thành phố Đà Nẵng")


def test_slugify():
    assert slugify("Đà Nẵng") == "da-nang"
    assert slugify("Bà Rịa – Vũng Tàu") == "ba-ria-vung-tau"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0235 3861 234", "+842353861234"),
        ("+84 235 3861 234; 0905 123 456", "+842353861234"),
        ("not a number", None),
        (None, None),
    ],
)
def test_phone_e164(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("example.com", "https://example.com/"),
        ("HTTP://Example.com/menu?utm_source=fb&page=2#top", "http://example.com/menu?page=2"),
        ("mailto:a@b.c", None),
        ("  ", None),
    ],
)
def test_website(raw, expected):
    assert normalize_website(raw) == expected


def test_lang_tag():
    assert lang_tag("zh_hans") == "zh-Hans"
    assert lang_tag("PT-br") == "pt-BR"


def test_hash_is_stable_and_content_sensitive():
    a = NormalizedPlace("osm", "n1", 15.1, 108.2, "Quán A", {"en": "A"}, ["amenity=cafe"])
    b = NormalizedPlace("osm", "n1", 15.1, 108.2, "Quán A", {"en": "A"}, ["amenity=cafe"], raw={"different": "raw"})
    assert a.hash() == b.hash()  # raw payload doesn't affect the hash
    c = NormalizedPlace("osm", "n1", 15.1, 108.2, "Quán B", {"en": "A"}, ["amenity=cafe"])
    assert a.hash() != c.hash()
    assert content_hash({"b": 1, "a": 2}) == content_hash({"a": 2, "b": 1})


def test_normalized_collects_every_name_for_matching():
    p = NormalizedPlace("overture", "x", 0, 0, "An Bàng Beach", {"vi": "Bãi biển An Bàng"}, [])
    n = p.normalized()
    assert n["name_norm"] == "an bang beach"
    assert n["names_norm"] == ["an bang beach", "bai bien an bang"]
