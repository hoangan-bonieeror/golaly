"""Overture Maps Places (GeoParquet on S3, CDLA-Permissive-2.0), read with DuckDB.

DuckDB filters on the `bbox` struct, so only the row groups for the requested area are downloaded.
The schema changed over releases (`categories` → `basic_category` + `taxonomy` in September 2026);
the query adapts to whichever columns the release has.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

import duckdb

from ..config import LICENSES, Settings
from ..models import NormalizedPlace, Partition
from ..normalize import clean_text, lang_tag, normalize_phone, normalize_website

log = logging.getLogger(__name__)

DEFAULT_RELEASE = "2026-09-23.1"
WANTED = ["id", "names", "basic_category", "taxonomy", "categories", "confidence", "websites", "phones", "addresses", "operating_status", "sources", "bbox"]


def duck(settings: Settings) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    # Read GeoParquet geometry as raw WKB bytes (no spatial extension needed; PostGIS parses it).
    con.execute("SET enable_geoparquet_conversion = false")
    if settings.overture_base.startswith("s3://"):
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-west-2'")
    return con


def release_path(settings: Settings, theme: str, type_: str) -> str:
    release = settings.overture_release or DEFAULT_RELEASE
    return f"{settings.overture_base.rstrip('/')}/{release}/theme={theme}/type={type_}/*"


def as_dict(value: Any) -> dict[str, Any]:
    """DuckDB returns MAP columns either as a dict or as {'key': [...], 'value': [...]}."""
    if isinstance(value, dict) and set(value) == {"key", "value"} and isinstance(value["key"], list):
        return dict(zip(value["key"], value["value"], strict=False))
    return value if isinstance(value, dict) else {}


def category_candidates(row: dict[str, Any]) -> list[str]:
    out: list[str] = []
    tax = row.get("taxonomy") or {}
    if tax.get("primary"):
        out.append(tax["primary"])
    if row.get("basic_category"):
        out.append(row["basic_category"])
    out.extend(reversed(tax.get("hierarchy") or []))  # leaf → root
    out.extend(tax.get("alternates") or [])
    legacy = row.get("categories") or {}  # releases before 2026-09
    if legacy.get("primary"):
        out.append(legacy["primary"])
    out.extend(legacy.get("alternate") or [])
    return list(dict.fromkeys(c for c in out if c))


def to_place(row: dict[str, Any], local_lang: str = "vi") -> NormalizedPlace | None:
    names = row.get("names") or {}
    primary = clean_text(names.get("primary"), 200)
    if not primary:
        return None
    translations = {lang_tag(k): clean_text(v, 200) for k, v in as_dict(names.get("common")).items() if clean_text(v, 200)}
    translations.setdefault(local_lang, primary)
    bbox = row["bbox"]
    addr = (row.get("addresses") or [None])[0] or {}
    address = clean_text(addr.get("freeform"))
    if address and addr.get("locality") and addr["locality"] not in address:
        address = f"{address}, {addr['locality']}"
    phones = row.get("phones") or []
    websites = row.get("websites") or []
    return NormalizedPlace(
        provider="overture",
        external_id=row["id"],
        lat=(bbox["ymin"] + bbox["ymax"]) / 2,
        lng=(bbox["xmin"] + bbox["xmax"]) / 2,
        name=primary,
        names=translations,  # type: ignore[arg-type]
        category_candidates=category_candidates(row),
        address=address,
        phone=next((p for p in (normalize_phone(x) for x in phones) if p), None),
        website=next((w for w in (normalize_website(x) for x in websites) if w), None),
        operating_status=row.get("operating_status") or "open",
        confidence=row.get("confidence"),
        raw=row,
    )


class OvertureProvider:
    key = "overture"
    license, attribution = LICENSES["overture"]

    def __init__(self, settings: Settings):
        self.settings = settings

    def partitions(self, scope: list[Partition]) -> list[Partition]:
        return [Partition(self.key, p.key, p.bbox, p.area_id) for p in scope]

    def fetch(self, partition: Partition) -> Iterator[list[NormalizedPlace]]:
        con = duck(self.settings)
        path = release_path(self.settings, "places", "place")
        available = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}', hive_partitioning = 1)").fetchall()}
        cols = [c for c in WANTED if c in available]
        b = partition.bbox
        cur = con.execute(
            f"""
            SELECT {", ".join(cols)} FROM read_parquet('{path}', hive_partitioning = 1)
            WHERE bbox.xmin >= ? AND bbox.xmax <= ? AND bbox.ymin >= ? AND bbox.ymax <= ?
              AND coalesce(confidence, 1) >= ?
            """,
            [b.min_lng, b.max_lng, b.min_lat, b.max_lat, self.settings.overture_min_confidence],
        )
        while rows := cur.fetchmany(self.settings.batch_size):
            batch = [p for p in (to_place(dict(zip(cols, r, strict=False))) for r in rows) if p]
            if batch:
                yield batch
        con.close()
