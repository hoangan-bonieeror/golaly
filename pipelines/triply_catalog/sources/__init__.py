"""Source registry. Adding a source = one module here implementing PlaceSource or PhotoSource + one line below.

Modules are imported on demand, and keep heavy libraries (DuckDB, pyosmium) out of their import path, so
reading manifests is cheap (the Airflow DAG file and `triply-catalog sources` do it).
"""

from __future__ import annotations

import importlib
from typing import Any

from ..config import Settings
from .base import (
    MANUAL,
    Manifest,
    NormalizedPhoto,
    PhotoBatch,
    PhotoSource,
    PlaceRef,
    PlaceSource,
    QueryTooBig,
    RateLimited,
    Source,
    SourceConfigError,
    SourceError,
    SourceRefused,
    SourceUnavailable,
    Subject,
    SubjectBatch,
)

#: key → "module:Class" inside this package.
SOURCES: dict[str, str] = {
    "overture": "overture:OvertureSource",
    "osm": "osm:OsmSource",
    "wikimedia": "wikimedia:WikimediaSource",
}


def source_class(key: str) -> Any:
    if key not in SOURCES:
        raise SourceConfigError(f"Unknown source {key!r} (available: {', '.join(SOURCES)})")
    module, cls = SOURCES[key].split(":")
    return getattr(importlib.import_module(f"{__name__}.{module}"), cls)


def manifest(key: str) -> Manifest:
    if key == MANUAL.key:
        return MANUAL
    m: Manifest = source_class(key).manifest
    return m


def manifests() -> dict[str, Manifest]:
    return {k: manifest(k) for k in SOURCES}


def keys(provides: str) -> list[str]:
    """Registered sources of one kind ("places" or "photos"), in registry order."""
    return [k for k, m in manifests().items() if provides in m.provides]


def get_source(key: str, settings: Settings, **kwargs: Any) -> Any:
    return source_class(key)(settings, **kwargs)


def check_keys(selected: list[str], provides: str) -> list[str]:
    """Validate a run's source list against the registry (DAG params, CLI flags)."""
    if not selected:
        raise SourceConfigError(f"Choose at least one {provides} source ({', '.join(keys(provides))}).")
    wrong = [k for k in selected if k not in SOURCES or provides not in manifest(k).provides]
    if wrong:
        raise SourceConfigError(f"Not {provides} sources: {', '.join(wrong)} (available: {', '.join(keys(provides))})")
    return list(dict.fromkeys(selected))


def check_ready(selected: list[str], settings: Settings) -> None:
    """Configuration problems of the selected sources, all at once, before anything is fetched."""
    problems = [f"{k}: {p}" for k in selected for p in get_source(k, settings).check()]
    if problems:
        raise SourceConfigError("; ".join(problems))


def status(settings: Settings) -> list[dict[str, Any]]:
    """Manifest + configuration state of every source (`triply-catalog sources`)."""
    out = []
    for k in SOURCES:
        problems = get_source(k, settings).check()
        out.append({**manifest(k).as_dict(), "ready": not problems, "problems": problems})
    return out


__all__ = [
    "MANUAL",
    "SOURCES",
    "Manifest",
    "NormalizedPhoto",
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
    "check_keys",
    "check_ready",
    "get_source",
    "keys",
    "manifest",
    "manifests",
    "source_class",
    "status",
]
