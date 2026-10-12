"""Foursquare Open Source Places (Apache 2.0), read with DuckDB.

The dataset is published as Parquet on Hugging Face (`foursquare/fsq-os-places`, one folder per monthly release:
`release/dt=YYYY-MM-DD/places/parquet/*.parquet`). It is *gated*: sign in to Hugging Face, accept the dataset's
terms once, and give the pipeline a read token (`HF_TOKEN`). `FSQ_BASE` may instead point at a local copy with the
same layout (or at any https/s3 mirror).

Records are filtered like Foursquare recommends for an open dataset: closed ones are kept as closed (so places can
close), records flagged as non-existent / private / inappropriate are skipped, and so are listings nobody has
refreshed for `fsq_max_age_years` (stale venues are common).
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..config import Settings
from ..models import NormalizedPlace, Partition
from ..normalize import clean_text, normalize_phone, normalize_website
from .base import Manifest

if TYPE_CHECKING:
    import duckdb

log = logging.getLogger(__name__)

MANIFEST = Manifest(
    key="fsq",
    name="Foursquare OS Places",
    provides=frozenset({"places"}),
    license="Apache-2.0",
    license_url="https://www.apache.org/licenses/LICENSE-2.0",
    attribution="© Foursquare",
    storage="store",
    partitioning="region",
    coverage="global (needs a Hugging Face account that accepted the dataset terms)",
    cost="free",
    homepage="https://opensource.foursquare.com/os-places/",
    default=False,  # opt-in: it needs an account and a token
)

DEFAULT_RELEASE = "2026-09-15"
SKIP_FLAGS = {"doesnt_exist", "privatevenue", "inappropriate"}
CLOSED_FLAGS = {"closed"}
COLUMNS = ["fsq_place_id", "name", "latitude", "longitude", "address", "locality", "tel", "website", "date_refreshed", "date_closed", "fsq_category_labels"]


def category_candidates(labels: list[str] | None) -> list[str]:
    """'Dining and Drinking > Restaurant > Asian Restaurant > Vietnamese Restaurant' → the full path, then each parent
    path: the most specific one with a mapping wins, so the map only needs the levels that matter."""
    out: list[str] = []
    for label in labels or []:
        parts = [p.strip() for p in label.split(">") if p.strip()]
        out.extend(" > ".join(parts[:i]) for i in range(len(parts), 0, -1))
    return list(dict.fromkeys(out))


def to_place(row: dict[str, Any], local_lang: str = "vi", today: date | None = None, max_age_years: float = 3) -> NormalizedPlace | None:
    name = clean_text(row.get("name"), 200)
    if not name or row.get("latitude") is None or row.get("longitude") is None:
        return None
    flags = {f.lower() for f in row.get("unresolved_flags") or []}
    if flags & SKIP_FLAGS:
        return None
    refreshed = row.get("date_refreshed")
    today = today or date.today()
    if isinstance(refreshed, date) and (today - refreshed).days > max_age_years * 365:
        return None
    address = clean_text(row.get("address"))
    if address and row.get("locality") and row["locality"] not in address:
        address = f"{address}, {row['locality']}"
    closed = bool(row.get("date_closed")) or bool(flags & CLOSED_FLAGS)
    return NormalizedPlace(
        provider=MANIFEST.key,
        external_id=row["fsq_place_id"],
        lat=float(row["latitude"]),
        lng=float(row["longitude"]),
        name=name,
        names={local_lang: name},  # Foursquare has one name per place
        category_candidates=category_candidates(row.get("fsq_category_labels")),
        address=address,
        phone=normalize_phone(row.get("tel")),
        website=normalize_website(row.get("website")),
        operating_status="permanently_closed" if closed else "open",
        raw={k: (v.isoformat() if isinstance(v, date) else v) for k, v in row.items()},
    )


class FoursquareSource:
    manifest = MANIFEST

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def path(self) -> str:
        release = self.settings.fsq_release or DEFAULT_RELEASE
        return f"{self.settings.fsq_base.rstrip('/')}/dt={release}/places/parquet/*.parquet"

    def check(self) -> list[str]:
        base = self.settings.fsq_base
        if base.startswith("hf://") and not self.settings.hf_token:
            return [
                "Foursquare OS Places is a gated Hugging Face dataset: accept its terms at "
                "https://huggingface.co/datasets/foursquare/fsq-os-places, create a read token and set HF_TOKEN"
            ]
        if not base.startswith(("hf://", "s3://", "http://", "https://")) and not Path(base).exists():
            return [f"FSQ_BASE {base!r} is neither a hf:// / s3:// / https:// location nor an existing folder"]
        return []

    def partitions(self, scope: list[Partition]) -> list[Partition]:
        return [Partition(self.manifest.key, p.key, p.bbox, p.area_id) for p in scope]

    def _duck(self) -> duckdb.DuckDBPyConnection:
        import duckdb  # here, so reading the manifest stays cheap

        con = duckdb.connect()
        base = self.settings.fsq_base
        if base.startswith(("hf://", "s3://", "http://", "https://")):
            con.execute("INSTALL httpfs; LOAD httpfs")
        if base.startswith("hf://") and self.settings.hf_token:
            con.execute("CREATE SECRET hf (TYPE huggingface, TOKEN ?)", [self.settings.hf_token])
        return con

    def fetch_places(self, partition: Partition) -> Iterator[list[NormalizedPlace]]:
        con = self._duck()
        available = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{self.path}')").fetchall()}
        cols = [c for c in [*COLUMNS, "unresolved_flags"] if c in available]
        b = partition.bbox
        # bbox (a struct) lets DuckDB skip row groups outside the box; fall back to the coordinates on old releases.
        where = (
            "bbox.xmin >= ? AND bbox.xmax <= ? AND bbox.ymin >= ? AND bbox.ymax <= ?"
            if "bbox" in available
            else "longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?"
        )
        params = [b.min_lng, b.max_lng, b.min_lat, b.max_lat]
        # A stable order lets a retried partition skip the batches it already loaded.
        cur = con.execute(f"SELECT {', '.join(cols)} FROM read_parquet('{self.path}') WHERE {where} ORDER BY fsq_place_id", params)
        today = date.today()
        while rows := cur.fetchmany(self.settings.batch_size):
            batch = [p for p in (to_place(dict(zip(cols, r, strict=False)), today=today, max_age_years=self.settings.fsq_max_age_years) for r in rows) if p]
            if batch:
                yield batch
        con.close()

    fetch = fetch_places
