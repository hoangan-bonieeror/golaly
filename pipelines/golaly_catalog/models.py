"""Plain data types shared by providers and the loader."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .normalize import content_hash, normalize_search


@dataclass(frozen=True)
class BBox:
    min_lng: float
    min_lat: float
    max_lng: float
    max_lat: float

    def contains(self, lng: float, lat: float) -> bool:
        return self.min_lng <= lng <= self.max_lng and self.min_lat <= lat <= self.max_lat

    def as_list(self) -> list[float]:
        return [self.min_lng, self.min_lat, self.max_lng, self.max_lat]


@dataclass(frozen=True)
class Partition:
    """A unit of extraction work: one provider × one bounding box (one Airflow mapped task)."""

    provider: str
    key: str  # e.g. "vn-da-nang" — stable, used in logs and task ids
    bbox: BBox
    area_id: str | None = None
    #: ISO 3166-1 alpha-2 of the country the partition is in, when known (picks the right OSM extract).
    country: str | None = None


@dataclass
class NormalizedPlace:
    provider: str
    external_id: str
    lat: float
    lng: float
    #: Local (on-the-ground) name.
    name: str | None
    #: Translations by BCP 47 language tag (the local name may also appear under its own language).
    names: dict[str, str] = field(default_factory=dict)
    #: Provider categories, most specific first; the first one with a mapping wins.
    category_candidates: list[str] = field(default_factory=list)
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    opening_hours: str | None = None
    operating_status: str = "open"
    confidence: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def normalized(self) -> dict[str, Any]:
        all_names = [n for n in [self.name, *self.names.values()] if n]
        norms = sorted({normalize_search(n) for n in all_names if normalize_search(n)})
        return {
            "name": self.name,
            "name_norm": normalize_search(self.name) if self.name else None,
            "names": dict(sorted(self.names.items())),
            "names_norm": norms,
            "search_terms": normalize_search(" ".join([*all_names, self.address or ""])),
            "category_candidates": self.category_candidates,
            "address": self.address,
            "phone": self.phone,
            "website": self.website,
            "opening_hours": self.opening_hours,
            "operating_status": self.operating_status,
            "confidence": self.confidence,
        }

    def hash(self) -> str:
        return content_hash({**self.normalized(), "lat": round(self.lat, 6), "lng": round(self.lng, 6)})
