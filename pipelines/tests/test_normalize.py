import json
from pathlib import Path

import pytest

from triply_catalog.models import NormalizedPlace
from triply_catalog.normalize import (
    content_hash,
    lang_tag,
    normalize_phone,
    normalize_search,
    normalize_website,
    slugify,
)

CASES = json.loads((Path(__file__).parents[2] / "packages/shared/fixtures/normalize-cases.json").read_text("utf-8"))["cases"]


@pytest.mark.parametrize("text,expected", CASES)
def test_normalize_search_matches_the_app(text, expected):
    # Same file the TypeScript test reads: search in the app and matching in the pipeline agree.
    assert normalize_search(text) == expected


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
