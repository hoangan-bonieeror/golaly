"""Contract tests: run for every source in the registry. A new source passes these before it can be used.

Each source needs a fixture factory below (`FIXTURES`): an offline instance (fixture files or a fake HTTP
transport) and a partition its fixture data covers.
"""

from __future__ import annotations

import dataclasses
import socket
import urllib.request

import httpx
import pytest

from triply_catalog.models import BBox, NormalizedPlace, Partition
from triply_catalog.sources import SOURCES, check_keys, get_source, keys, manifest, manifests
from triply_catalog.sources.base import KINDS, PARTITIONING, STORAGE, PhotoSource, PlaceSource, SourceConfigError, covers

HOI_AN = BBox(108.2, 15.75, 108.45, 16.0)
DA_NANG = BBox(108.1, 15.95, 108.35, 16.15)

#: Environment variable → Settings field, for the "missing configuration" check.
ENV_FIELDS = {"CATALOG_CONTACT": "contact"}


def _wikimedia(settings):
    from tests.test_pipeline_photos import FakeWikimedia

    fake = FakeWikimedia()
    s = dataclasses.replace(settings, wikimedia_delay=0, contact="https://example.com/triply-ops")
    return get_source("wikimedia", s, client=httpx.Client(transport=httpx.MockTransport(fake))), fake


FIXTURES = {
    "overture": lambda settings: (get_source("overture", settings), None),
    "osm": lambda settings: (get_source("osm", settings), None),
    "wikimedia": _wikimedia,
}


@pytest.fixture()
def offline(monkeypatch):
    """Any network access fails the test."""

    def refuse(*a, **kw):
        raise AssertionError("a source sent a request during check()")

    monkeypatch.setattr(httpx.Client, "send", refuse)
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def test_every_source_has_a_fixture():
    assert set(FIXTURES) == set(SOURCES)


@pytest.mark.parametrize("key", list(SOURCES))
def test_manifest_is_complete(key):
    m = manifest(key)
    assert m.key == key and m.name and m.license and m.attribution
    assert m.provides and set(m.provides) <= set(KINDS)
    assert m.storage in STORAGE and m.partitioning in PARTITIONING
    assert m.coverage and m.cost
    assert all(env in ENV_FIELDS for env in m.requires), "add the setting to ENV_FIELDS so the check below covers it"
    if m.partitioning == "tiles":
        assert m.rate, "API sources declare a polite request rate"


@pytest.mark.parametrize("key", list(SOURCES))
def test_implements_what_it_provides(key, settings):
    src, _ = FIXTURES[key](settings)
    assert ("places" in src.manifest.provides) == isinstance(src, PlaceSource)
    assert ("photos" in src.manifest.provides) == isinstance(src, PhotoSource)


@pytest.mark.parametrize("key", list(SOURCES))
def test_check_reports_missing_configuration_without_requests(key, settings, offline):
    src, _ = FIXTURES[key](settings)
    assert src.check() == []
    for env in manifest(key).requires:
        broken = get_source(key, dataclasses.replace(src.settings, **{ENV_FIELDS[env]: None}))
        problems = broken.check()
        assert problems and env in " ".join(problems)


@pytest.mark.parametrize("key", list(SOURCES))
def test_partitions_cover_the_scope(key, settings):
    src, _ = FIXTURES[key](settings)
    scope = [Partition("", "hoi-an", HOI_AN, "a1"), Partition("", "vn-da-nang", DA_NANG, "a2")]
    parts = src.partitions(scope)
    assert parts and all(p.provider == key and p.key for p in parts)
    for s in scope:
        assert covers([p.bbox for p in parts], s.bbox)


@pytest.mark.parametrize("key", keys("places"))
def test_place_records_are_valid_and_stable(key, settings):
    src, _ = FIXTURES[key](settings)
    part = Partition(key, "hoi-an", HOI_AN)

    def fetch() -> list[NormalizedPlace]:
        return [p for batch in src.fetch_places(part) for p in batch]

    first = fetch()
    assert first
    for p in first:
        assert p.provider == key and p.external_id and p.name
        assert HOI_AN.contains(p.lng, p.lat)
        assert p.operating_status in ("open", "permanently_closed", "temporarily_closed")
    assert sorted(p.hash() for p in first) == sorted(p.hash() for p in fetch())  # same input, same records


@pytest.mark.parametrize("key", keys("photos"))
def test_photo_records_are_valid_and_stable(key, settings):
    src, _ = FIXTURES[key](settings)
    part = Partition(key, "hoi-an", HOI_AN)
    found = src.find_subjects(part)
    assert found.subjects and found.skipped == []
    for s in found.subjects:
        assert s.key and (s.ref.ids or s.ref.names or s.ref.lat is not None)
        if s.ref.lat is not None:
            assert HOI_AN.contains(s.ref.lng, s.ref.lat)
    batch = src.fetch_photos(found.subjects[:3])
    subjects = {s.key for s in found.subjects[:3]}
    assert batch.photos
    for p in batch.photos:
        assert p.source_id and p.subject in subjects and p.license
        assert p.remote_url.startswith("https://") and p.page_url.startswith("https://")
        assert p.width > 0 and p.height > 0 and p.score >= 0
    again = src.fetch_photos(found.subjects[:3])
    assert [(p.source_id, p.score) for p in again.photos] == [(p.source_id, p.score) for p in batch.photos]


def test_focus_limits_the_area_asked(settings):
    src, fake = FIXTURES["wikimedia"](settings)
    big = Partition("wikimedia", "box", BBox(107.0, 15.0, 109.0, 17.0))  # 16 tiles of 0.5°
    src.find_subjects(big, focus=[(15.8774, 108.3258)])
    assert len(fake.requests) == 1  # only the tile around the one place that needs checking
    src.find_subjects(big, focus=[])
    assert len(fake.requests) == 1  # nothing to check, nothing asked


def test_registry_validates_selections():
    assert keys("places") == ["overture", "osm"] and keys("photos") == ["wikimedia"]
    assert set(manifests()) == set(SOURCES)
    assert check_keys(["osm", "overture", "osm"], "places") == ["osm", "overture"]
    with pytest.raises(SourceConfigError, match="Not places sources: wikimedia"):
        check_keys(["wikimedia"], "places")
    with pytest.raises(SourceConfigError, match="foursquare"):
        check_keys(["foursquare"], "places")
    with pytest.raises(SourceConfigError):
        check_keys([], "photos")


def test_cli_lists_sources(capsys, monkeypatch):
    from triply_catalog import cli

    monkeypatch.setenv("CATALOG_CONTACT", "")
    assert cli.main(["sources"]) == 0
    out = capsys.readouterr().out
    assert '"key": "wikimedia"' in out and '"ready": false' in out and "CATALOG_CONTACT" in out


def test_old_provider_imports_still_work(settings):
    from triply_catalog.providers import get_provider
    from triply_catalog.providers.osm import OsmProvider

    p = get_provider("osm", settings)
    assert isinstance(p, OsmProvider) and p.license == "ODbL-1.0" and p.attribution == "© OpenStreetMap contributors"
    with pytest.raises(SourceConfigError):
        get_provider("wikimedia", settings)
