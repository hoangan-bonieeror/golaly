"""Deprecated: sources live in `triply_catalog.sources` now. Kept so older imports keep working."""

from __future__ import annotations

from ..config import Settings
from ..models import BBox, NormalizedPlace, Partition
from ..sources import check_keys, get_source
from ..sources.base import PlaceSource

PlaceProvider = PlaceSource


def get_provider(key: str, settings: Settings) -> PlaceSource:
    check_keys([key], "places")
    src: PlaceSource = get_source(key, settings)
    return src


__all__ = ["BBox", "NormalizedPlace", "Partition", "PlaceProvider", "get_provider"]
