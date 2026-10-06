"""Runtime configuration, read from the environment (same variables as the API where they overlap)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    #: The app database (the pipeline writes the catalog tables only).
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "postgresql://triply:triply@localhost:5432/triply"))  # type: ignore[arg-type]
    #: Overture release folder, e.g. "2026-09-23.1". Leave empty to use the newest one listed.
    overture_release: str | None = field(default_factory=lambda: _env("OVERTURE_RELEASE"))
    #: Where Overture parquet lives. Tests point this at local fixture files.
    overture_base: str = field(default_factory=lambda: _env("OVERTURE_BASE", "s3://overturemaps-us-west-2/release"))  # type: ignore[arg-type]
    #: Places below this Overture confidence are skipped (Overture recommends filtering low-confidence rows).
    overture_min_confidence: float = field(default_factory=lambda: float(_env("OVERTURE_MIN_CONFIDENCE", "0.6")))  # type: ignore[arg-type]
    #: Foursquare OS Places: the Hugging Face dataset (gated: accept its terms, then set HF_TOKEN) or a local copy.
    fsq_base: str = field(default_factory=lambda: _env("FSQ_BASE", "hf://datasets/foursquare/fsq-os-places/release"))  # type: ignore[arg-type]
    #: Release folder ("2026-09-15" for dt=2026-09-15); empty = the release this version was tested with.
    fsq_release: str | None = field(default_factory=lambda: _env("FSQ_RELEASE"))
    hf_token: str | None = field(default_factory=lambda: _env("HF_TOKEN"))
    #: Foursquare listings nobody refreshed for longer than this are skipped (stale venues are common).
    fsq_max_age_years: float = field(default_factory=lambda: float(_env("FSQ_MAX_AGE_YEARS", "3")))  # type: ignore[arg-type]
    #: OpenStreetMap extract: empty (default) = the Geofabrik extract of each partition's country, picked from the
    #: Geofabrik index; or one fixed local .osm/.pbf path or https URL for every run.
    osm_source: str = field(default_factory=lambda: _env("OSM_SOURCE", ""))  # type: ignore[arg-type]
    #: Geofabrik's list of extracts (id, ISO codes, download URLs); cached in CATALOG_DATA_DIR/osm for a day.
    geofabrik_index: str = field(default_factory=lambda: _env("GEOFABRIK_INDEX", "https://download.geofabrik.de/index-v1-nogeom.json"))  # type: ignore[arg-type]
    #: Working directory for downloads.
    data_dir: Path = field(default_factory=lambda: Path(_env("CATALOG_DATA_DIR", "./data")))  # type: ignore[arg-type]
    #: Rows per staging batch (one transaction each).
    batch_size: int = field(default_factory=lambda: int(_env("CATALOG_BATCH_SIZE", "5000")))  # type: ignore[arg-type]
    #: A place joins a curated destination when it lies within this distance of the destination's centre.
    destination_radius_km: float = field(default_factory=lambda: float(_env("CATALOG_DESTINATION_RADIUS_KM", "15")))  # type: ignore[arg-type]
    #: Two records with the same normalised name closer than this are the same place (phase 1 rule).
    same_place_meters: float = field(default_factory=lambda: float(_env("CATALOG_SAME_PLACE_METERS", "50")))  # type: ignore[arg-type]
    #: Safety brake: a run that would close more than this share of an area's places stops as needs_review.
    max_close_ratio: float = field(default_factory=lambda: float(_env("CATALOG_MAX_CLOSE_RATIO", "0.10")))  # type: ignore[arg-type]
    # ── Duplicate detection (phase 2) ────────────────────────────────────────
    #: Candidate places within this distance of each other are scored …
    merge_radius_m: float = field(default_factory=lambda: float(_env("CATALOG_MERGE_RADIUS_M", "75")))  # type: ignore[arg-type]
    #: … or this one when either is a sight / cultural or natural landmark (big footprints, imprecise points).
    merge_radius_landmark_m: float = field(default_factory=lambda: float(_env("CATALOG_MERGE_RADIUS_LANDMARK_M", "100")))  # type: ignore[arg-type]
    #: Same phone or website, or an external id that points at the other place, within this distance = the same place.
    merge_sure_m: float = field(default_factory=lambda: float(_env("CATALOG_MERGE_SURE_M", "150")))  # type: ignore[arg-type]
    #: Score at or above which two places are merged automatically (unless a blocking rule applies) …
    merge_auto: float = field(default_factory=lambda: float(_env("CATALOG_MERGE_AUTO", "0.85")))  # type: ignore[arg-type]
    #: … and from which a pair waits for review in merge_candidates.
    merge_review: float = field(default_factory=lambda: float(_env("CATALOG_MERGE_REVIEW", "0.6")))  # type: ignore[arg-type]
    #: Slack-compatible webhook told about failed / needs-review runs and quality warnings (optional).
    alert_webhook: str | None = field(default_factory=lambda: _env("CATALOG_ALERT_WEBHOOK"))
    #: Sources missing from this many complete runs in a row count as gone.
    missing_runs_to_close: int = 3

    # ── Photos (Wikimedia Commons via Wikidata) ──────────────────────────────
    wikidata_sparql: str = field(default_factory=lambda: _env("WIKIDATA_SPARQL", "https://query.wikidata.org/sparql"))  # type: ignore[arg-type]
    commons_api: str = field(default_factory=lambda: _env("COMMONS_API", "https://commons.wikimedia.org/w/api.php"))  # type: ignore[arg-type]
    #: Wikimedia requires a descriptive User-Agent with a way to reach the operator (URL or email).
    contact: str | None = field(default_factory=lambda: _env("CATALOG_CONTACT"))
    #: A Wikidata item matched to a place by name within this distance is published at once …
    photo_match_meters: float = field(default_factory=lambda: float(_env("CATALOG_PHOTO_MATCH_METERS", "100")))  # type: ignore[arg-type]
    #: … and up to this distance it is queued for review.
    photo_review_meters: float = field(default_factory=lambda: float(_env("CATALOG_PHOTO_REVIEW_METERS", "300")))  # type: ignore[arg-type]
    #: Most photos imported per place (the item's main image + quality images from its Commons category).
    photos_per_place: int = field(default_factory=lambda: int(_env("CATALOG_PHOTOS_PER_PLACE", "4")))  # type: ignore[arg-type]
    #: An automatic photo run (after a sync) re-checks a place after this many days; new, renamed or moved places at once.
    photo_recheck_days: int = field(default_factory=lambda: int(_env("CATALOG_PHOTO_RECHECK_DAYS", "30")))  # type: ignore[arg-type]
    #: Seconds between requests to Wikimedia (be a polite client).
    wikimedia_delay: float = field(default_factory=lambda: float(_env("CATALOG_WIKIMEDIA_DELAY", "1.0")))  # type: ignore[arg-type]

    @property
    def user_agent(self) -> str:
        # Wikimedia's User-Agent policy: "<client>/<version> (<contact>) <library>/<version>". Requests without
        # a way to reach the operator are refused with 403 ("Please respect our robot policy").
        import httpx

        return f"TRIPLY-catalog/0.2 (+{self.contact}) httpx/{httpx.__version__}"


#: Which provider wins for each published field (survivorship). "manual" = admin / seed data.
#: Stored here, not in SQL, so it can be tuned per field after measuring real data quality.
FIELD_PRIORITY: dict[str, list[str]] = {
    "name": ["manual", "fsq", "overture", "osm"],
    "coords": ["manual", "osm", "overture", "fsq"],
    # Seed/manual categories come from the app's coarse item type (PLACE → landmark), so real sources refine them;
    # an admin who wants a specific category locks the field instead. Foursquare's categories are the most detailed.
    "category": ["fsq", "overture", "osm", "manual"],
    "address": ["manual", "overture", "osm", "fsq"],
    "phone": ["manual", "overture", "fsq", "osm"],
    "website": ["manual", "overture", "fsq", "osm"],
    "opening_hours": ["manual", "osm", "overture"],
}

#: Merge-score weights (they're renormalised over the signals both places have: many OSM places have no address).
MERGE_WEIGHTS: dict[str, float] = {"name": 0.45, "distance": 0.25, "category": 0.15, "address": 0.15}

#: Category groups that may be the same place (a café that serves food); anything across families is never auto-merged.
GROUP_FAMILIES: list[set[str]] = [{"food", "drink", "nightlife"}, {"sights", "culture", "nature", "activity"}, {"lodging"}, {"shopping"}, {"transport"}]
#: Groups whose places get the larger candidate radius.
LANDMARK_GROUPS: set[str] = {"sights", "culture", "nature"}

#: Order in which providers are published within a run: later providers attach to places created by earlier ones.
PUBLISH_ORDER = ["manual", "overture", "fsq", "osm"]

#: Licences and attributions are declared by each source's manifest (triply_catalog/sources/).


def settings() -> Settings:
    return Settings()
