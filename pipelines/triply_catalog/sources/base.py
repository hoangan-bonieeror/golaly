"""The standard source interface.

Every data source — places or photos, open or paid — is one adapter that declares a `Manifest` and implements
`PlaceSource` or `PhotoSource`. An adapter only does the source's own work: split the scope into partitions and
return normalised records. It never touches the database; matching, merging, saving, credits and licence checks
are shared (`load.py` / `publish.py` for places, `photos.py` for photos).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

from ..models import BBox, NormalizedPlace, Partition

Kind = Literal["places", "photos"]
#: store      — records (and photo files) may be copied into TRIPLY's database and media.
#: reference  — keep ids, credits and links only; the app shows the source's own content (e.g. a hotlinked photo).
#: id_only    — keep the source's id and nothing else (Google Places terms).
Storage = Literal["store", "reference", "id_only"]
#: extract — one file for the whole scope (an OSM country extract); region — one partition per province/area;
#: tiles — the source answers small boxes only, so partitions are queried in tiles that split when too big.
Partitioning = Literal["extract", "region", "tiles"]

KINDS: tuple[str, ...] = ("places", "photos")
STORAGE: tuple[str, ...] = ("store", "reference", "id_only")
PARTITIONING: tuple[str, ...] = ("extract", "region", "tiles")


@dataclass(frozen=True)
class Manifest:
    """What a source is. The pipeline reads this instead of branching on `provider == "..."`."""

    key: str  # place_sources.provider / place_photos.source
    name: str  # shown in credits and the admin UI
    provides: frozenset[str]
    license: str  # SPDX id for datasets; "per file" when every record carries its own licence (photos)
    attribution: str
    storage: str = "store"
    partitioning: str = "region"
    license_url: str | None = None
    #: Polite request rate (requests per second) for API sources; None for file sources.
    rate: float | None = None
    #: Environment variables that must be set before the source sends anything.
    requires: tuple[str, ...] = ()
    coverage: str = "global"
    cost: str = "free"
    homepage: str | None = None
    #: Used when a run doesn't name its sources. False for sources that need an account or cost money.
    default: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "provides": sorted(self.provides),
            "license": self.license,
            "license_url": self.license_url,
            "attribution": self.attribution,
            "storage": self.storage,
            "partitioning": self.partitioning,
            "rate": self.rate,
            "requires": list(self.requires),
            "coverage": self.coverage,
            "cost": self.cost,
            "homepage": self.homepage,
            "default": self.default,
        }


#: Places created by hand or by the demo seed. Not a fetchable source, but it takes part in matching and survivorship.
MANUAL = Manifest(key="manual", name="TRIPLY", provides=frozenset({"places"}), license="TRIPLY", attribution="TRIPLY", partitioning="extract")


# ── errors ───────────────────────────────────────────────────────────────────


class SourceError(Exception):
    """Base class: what went wrong, in words an operator can act on."""


class SourceConfigError(SourceError, ValueError):
    """Missing or invalid configuration. Raised before any request is sent; stops the whole run."""


class SourceRefused(SourceError, PermissionError):
    """The source refused us (HTTP 403, revoked key). Retrying won't help; stops the whole run."""


class SourceUnavailable(SourceError, RuntimeError):
    """The source didn't answer (network, 5xx after retries). Only this partition fails; the run is `partial`."""


class RateLimited(SourceUnavailable):
    """Still rate limited after waiting as long as the source asked. Treated like SourceUnavailable."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class QueryTooBig(SourceError, RuntimeError):
    """The source gave up on a query (timeout, too many results): ask again for a smaller box."""


# ── records ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PlaceRef:
    """How to find the TRIPLY place a photo belongs to: external ids, names, coordinates — whatever the source knows."""

    #: e.g. {"wikidata": "Q…"} (matched against OSM `wikidata` tags) or {"osm": "w123"} / {"fsq": "…"} (place_sources ids).
    ids: dict[str, str] = field(default_factory=dict)
    names: frozenset[str] = frozenset()
    lat: float | None = None
    lng: float | None = None


@dataclass
class Subject:
    """Something a photo source has photos of (a Wikidata item, a Mapillary sequence point, a Google place)."""

    key: str
    ref: PlaceRef
    #: The adapter's own handle for fetching the photos later (e.g. the item's main image and Commons category).
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class SubjectBatch:
    subjects: list[Subject]
    #: Parts of the partition the source couldn't answer (reported; the rest of the partition still counts).
    skipped: list[BBox] = field(default_factory=list)


@dataclass
class NormalizedPhoto:
    source_id: str  # "File:Chùa Cầu.jpg"
    subject: str  # Subject.key it was found for
    remote_url: str
    page_url: str
    width: int
    height: int
    license: str
    title: str | None = None
    author: str | None = None
    author_url: str | None = None
    license_url: str | None = None
    #: Extra restrictions the source lists (trademark, personality rights…). Any value makes the photo unusable.
    restrictions: str | None = None
    caption: str | None = None
    #: The source's own ranking (higher first). 0 = known to the source but not worth showing (too small, portrait…):
    #: it is still licence-checked so a row queued earlier is hidden if its licence changed.
    score: float = 0.0


@dataclass
class PhotoBatch:
    photos: list[NormalizedPhoto]
    #: Source ids the source no longer has (deleted files): rows queued earlier are hidden.
    gone: set[str] = field(default_factory=set)


# ── the interface ────────────────────────────────────────────────────────────


@runtime_checkable
class Source(Protocol):
    manifest: Manifest

    def check(self) -> list[str]:
        """Configuration problems, in words the operator can act on. Must not send any request."""
        ...

    def partitions(self, scope: list[Partition]) -> list[Partition]:
        """Split the run's scope into units of work (one Airflow mapped task each)."""
        ...


@runtime_checkable
class PlaceSource(Source, Protocol):
    def fetch_places(self, partition: Partition) -> Iterator[list[NormalizedPlace]]:
        """Batches of normalised places inside the partition's box."""
        ...


@runtime_checkable
class PhotoSource(Source, Protocol):
    def find_subjects(self, partition: Partition, focus: list[tuple[float, float]] | None = None) -> SubjectBatch:
        """What the source has photos of inside the partition. With `focus` (lat, lng points), the source may look
        only near those points — an incremental run passes the places that need checking."""
        ...

    def fetch_photos(self, subjects: list[Subject]) -> PhotoBatch:
        """Photos (with licence and credits) for the subjects that matched a place. Called only for matched
        subjects, so a source doesn't pay for photos of things TRIPLY doesn't know."""
        ...


def covers(boxes: list[BBox], box: BBox) -> bool:
    """True when the corners and centre of `box` each fall inside one of `boxes` (contract tests, scope checks)."""
    cx, cy = (box.min_lng + box.max_lng) / 2, (box.min_lat + box.max_lat) / 2
    points = [(box.min_lng, box.min_lat), (box.max_lng, box.max_lat), (box.min_lng, box.max_lat), (box.max_lng, box.min_lat), (cx, cy)]
    return all(any(b.contains(x, y) for b in boxes) for x, y in points)


__all__ = [
    "MANUAL",
    "BBox",
    "Manifest",
    "NormalizedPhoto",
    "NormalizedPlace",
    "Partition",
    "PhotoBatch",
    "PhotoSource",
    "PlaceRef",
    "PlaceSource",
    "QueryTooBig",
    "RateLimited",
    "Source",
    "SourceConfigError",
    "SourceError",
    "SourceRefused",
    "SourceUnavailable",
    "Subject",
    "SubjectBatch",
    "covers",
]
