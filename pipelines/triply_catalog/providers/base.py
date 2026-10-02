"""Provider adapter interface. Adding a source = one module implementing PlaceProvider."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol

from ..config import Settings
from ..models import BBox, NormalizedPlace, Partition


class PlaceProvider(Protocol):
    key: str
    license: str
    attribution: str

    def partitions(self, scope: list[Partition]) -> list[Partition]:
        """Split the run's scope into units of work (one per region for file sources, one for a single extract)."""
        ...

    def fetch(self, partition: Partition) -> Iterator[list[NormalizedPlace]]:
        """Yield batches of normalised records inside the partition's bounding box."""
        ...


def get_provider(key: str, settings: Settings) -> PlaceProvider:
    if key == "overture":
        from .overture import OvertureProvider

        return OvertureProvider(settings)
    if key == "osm":
        from .osm import OsmProvider

        return OsmProvider(settings)
    raise ValueError(f"Unknown provider {key!r} (available: overture, osm)")


__all__ = ["BBox", "NormalizedPlace", "Partition", "PlaceProvider", "get_provider"]
