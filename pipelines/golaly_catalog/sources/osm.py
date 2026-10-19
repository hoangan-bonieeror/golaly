"""OpenStreetMap (Geofabrik country extracts, ODbL), read with pyosmium.

Which extract: by default the one of each partition's country, looked up in Geofabrik's index (Vietnam →
asia/vietnam-latest.osm.pbf, China → asia/china-latest.osm.pbf); OSM_SOURCE pins one file for every run instead.

The extract is read once per run (one partition covering the whole scope); nodes and ways with a
name and a mapped tag are kept. Ways become a point at the average of their nodes.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from ..config import Settings
from ..models import BBox, NormalizedPlace, Partition
from ..normalize import clean_text, lang_tag, normalize_phone, normalize_website
from ..taxonomy import osm_keys
from .base import Manifest, SourceConfigError

log = logging.getLogger(__name__)

MANIFEST = Manifest(
    key="osm",
    name="OpenStreetMap",
    provides=frozenset({"places"}),
    license="ODbL-1.0",
    license_url="https://opendatacommons.org/licenses/odbl/1-0/",
    attribution="© OpenStreetMap contributors",
    storage="store",
    partitioning="extract",
    coverage="global (the Geofabrik extract of each country, or a fixed OSM_SOURCE)",
    cost="free",
    homepage="https://www.openstreetmap.org",
)

LANG = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
PRIMARY_KEYS = [
    "amenity",
    "tourism",
    "historic",
    "leisure",
    "natural",
    "shop",
    "aeroway",
    "railway",
    "waterway",
    "place",
    "craft",
    "boundary",
    "public_transport",
    "mountain_pass",
]
REFINE_KEYS = ["cuisine", "religion", "diet:vegetarian", "diet:vegan", "guest_house", "water", "train", "opening_hours:night"]


def category_candidates(tags: dict[str, str]) -> list[str]:
    out: list[str] = []
    for k in PRIMARY_KEYS:
        v = tags.get(k)
        if not v:
            continue
        base = f"{k}={v}"
        for rk in REFINE_KEYS:
            for rv in (tags.get(rk) or "").split(";"):
                if rv.strip():
                    out.append(f"{base};{rk}={rv.strip()}")
        out.append(base)
    return out


def to_place(osm_id: str, lat: float, lng: float, tags: dict[str, str], local_lang: str = "vi") -> NormalizedPlace | None:
    name = clean_text(tags.get("name"), 200)
    names = {lang_tag(k[5:]): clean_text(v, 200) for k, v in tags.items() if k.startswith("name:") and LANG.match(k[5:]) and clean_text(v, 200)}
    if not name:
        name = names.get(local_lang) or names.get("en")
    if not name:
        return None
    names.setdefault(local_lang, name)
    if tags.get("addr:full"):
        address = clean_text(tags["addr:full"])
    else:
        street = " ".join(x for x in [tags.get("addr:housenumber"), tags.get("addr:street")] if x)
        address = clean_text(", ".join(x for x in [street, tags.get("addr:city")] if x))
    closed = any(k.startswith(("disused:", "abandoned:", "was:")) for k in tags) or tags.get("opening_hours") == "closed"
    return NormalizedPlace(
        provider="osm",
        external_id=osm_id,
        lat=lat,
        lng=lng,
        name=name,
        names=names,  # type: ignore[arg-type]
        category_candidates=category_candidates(tags),
        address=address,
        phone=normalize_phone(tags.get("phone") or tags.get("contact:phone")),
        website=normalize_website(tags.get("website") or tags.get("contact:website")),
        opening_hours=clean_text(tags.get("opening_hours"), 255),
        operating_status="permanently_closed" if closed else "open",
        raw={"id": osm_id, "tags": tags},
    )


def _collector(boxes: list[BBox], wanted: set[str]) -> Any:
    """A pyosmium handler collecting named, mapped nodes and ways inside `boxes`. Built on demand so that importing
    this module (to read the manifest) doesn't need pyosmium."""
    import osmium

    class Collector(osmium.SimpleHandler):  # type: ignore[misc]
        def __init__(self) -> None:
            super().__init__()
            self.items: list[NormalizedPlace] = []

        def _keep(self, tags: Any) -> dict[str, str] | None:
            if "name" not in tags and not any(t.k.startswith("name:") for t in tags):
                return None
            d = {t.k: t.v for t in tags}
            return d if any(f"{k}={d[k]}" in wanted for k in PRIMARY_KEYS if k in d) else None

        def _add(self, osm_id: str, lat: float, lng: float, tags: dict[str, str]) -> None:
            if any(b.contains(lng, lat) for b in boxes):
                p = to_place(osm_id, lat, lng, tags)
                if p:
                    self.items.append(p)

        def node(self, n: Any) -> None:
            tags = self._keep(n.tags)
            if tags and n.location.valid():
                self._add(f"n{n.id}", n.location.lat, n.location.lon, tags)

        def way(self, w: Any) -> None:
            tags = self._keep(w.tags)
            if not tags:
                return
            pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
            if pts:
                self._add(f"w{w.id}", sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), tags)

    return Collector()


class OsmSource:
    manifest = MANIFEST
    key = MANIFEST.key  # older code read these three attributes
    license, attribution = MANIFEST.license, MANIFEST.attribution

    def __init__(self, settings: Settings):
        self.settings = settings

    def check(self) -> list[str]:
        src = self.settings.osm_source
        if not src:
            return []  # the Geofabrik extract of each partition's country
        if src.startswith(("http://", "https://")):
            return [] if src.endswith(".osm.pbf") else [f"OSM_SOURCE {src!r} should be a Geofabrik .osm.pbf extract URL"]
        return [] if Path(src).exists() else [f"OSM_SOURCE {src!r} does not exist (give a local .osm/.osm.pbf file or a Geofabrik URL)"]

    def partitions(self, scope: list[Partition]) -> list[Partition]:
        """One pass over an extract per country (its regions' bounding box); areas are assigned in SQL afterwards.
        With a fixed OSM_SOURCE, one pass over that file for the whole scope."""
        groups: dict[str | None, list[Partition]] = {}
        for p in scope:
            groups.setdefault(None if self.settings.osm_source else p.country, []).append(p)
        out = []
        for country, parts in groups.items():
            boxes = [p.bbox for p in parts]
            union = BBox(min(b.min_lng for b in boxes), min(b.min_lat for b in boxes), max(b.max_lng for b in boxes), max(b.max_lat for b in boxes))
            out.append(Partition(self.key, "+".join(p.key for p in parts)[:120], union, None, country))
        return out

    def source_url(self, partition: Partition) -> str:
        if self.settings.osm_source:
            return self.settings.osm_source
        if not partition.country:
            raise SourceConfigError(
                f"Don't know which country {partition.key!r} is in, so which OpenStreetMap extract to use. Import the country's "
                "boundaries first (golaly-catalog boundaries --country XX), or set OSM_SOURCE to a Geofabrik .osm.pbf URL."
            )
        return geofabrik_url(self.settings, partition.country)

    def source_file(self, partition: Partition | None = None) -> Path:
        src = self.source_url(partition) if partition else self.settings.osm_source
        if not src.startswith(("http://", "https://")):
            return Path(src)
        return _download(src, self.settings.data_dir / "osm" / Path(src).name)

    def fetch_places(self, partition: Partition) -> Iterator[list[NormalizedPlace]]:
        handler = _collector([partition.bbox], osm_keys())
        handler.apply_file(str(self.source_file(partition)), locations=True, idx="flex_mem")
        items = handler.items
        for i in range(0, len(items), self.settings.batch_size):
            yield items[i : i + self.settings.batch_size]

    fetch = fetch_places  # the pre-`sources` name


def _download(url: str, target: Path, max_age: float | None = None) -> Path:
    """Download once and keep; afterwards only when the server has a newer copy (If-Modified-Since), or — with
    `max_age` seconds — not at all while the cached copy is younger than that."""
    import time

    target.parent.mkdir(parents=True, exist_ok=True)
    if max_age is not None and target.exists() and time.time() - target.stat().st_mtime < max_age:
        return target
    req = urllib.request.Request(url)
    if target.exists():  # Geofabrik updates daily; only re-download when it changed
        req.add_header("If-Modified-Since", _http_date(target.stat().st_mtime))
    try:
        with urllib.request.urlopen(req, timeout=60) as resp, open(f"{target}.part", "wb") as f:
            shutil.copyfileobj(resp, f, 1 << 20)
        os.replace(f"{target}.part", target)
        log.info("downloaded %s", url)
    except urllib.error.HTTPError as e:
        if e.code != 304:
            raise
        target.touch()
        log.info("%s not modified", url)
    return target


def pick_extract(index: dict[str, Any], country: str) -> str:
    """The Geofabrik extract for one country: among the extracts that list it, the one covering the fewest
    countries (Malaysia → "malaysia-singapore-brunei"; a country never gets its continent)."""
    cc = country.upper()
    found = [
        f["properties"]
        for f in index.get("features", [])
        if cc in (f["properties"].get("iso3166-1:alpha2") or []) and f["properties"].get("urls", {}).get("pbf")
    ]
    if not found:
        raise SourceConfigError(f"Geofabrik has no extract for country {cc!r}; set OSM_SOURCE to an .osm.pbf that covers it.")
    best = min(found, key=lambda p: (len(p.get("iso3166-1:alpha2") or []), len(p["urls"]["pbf"])))
    return best["urls"]["pbf"]


def geofabrik_url(settings: Settings, country: str) -> str:
    import json

    src = settings.geofabrik_index
    path = Path(src) if not src.startswith(("http://", "https://")) else _download(src, settings.data_dir / "osm" / "geofabrik-index.json", max_age=86400)
    return pick_extract(json.loads(path.read_text("utf-8")), country)


def _http_date(ts: float) -> str:
    from email.utils import formatdate

    return formatdate(ts, usegmt=True)


OsmProvider = OsmSource
