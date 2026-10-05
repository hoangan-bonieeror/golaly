"""Photos for places, from any PhotoSource (today: Wikimedia Commons via Wikidata).

For each partition (a province or a destination box):

1. **Find** — the source lists what it has photos of in the box (`find_subjects`), each with a PlaceRef.
2. **Match** each subject to one place: exactly, when an external id is known (an OSM `wikidata=Q…` tag, or a
   place_sources id of the same provider); otherwise by name (any language, accents ignored) to the nearest place
   within `photo_review_meters`; coordinates alone only ever queue for review. Close name matches publish at once.
3. **Fetch** photos for the matched subjects only (`fetch_photos`), with licence and credits.
4. **Choose and save** — one licence filter for every source (CC0, public domain, CC BY, CC BY-SA); best-scored
   photos per place; rows in `place_photos` with `remote_url` and credits. The API's ingester downloads them into
   TRIPLY's own media (3 WebP sizes) — the pipeline never writes image files itself. Sources whose terms don't
   allow storing content (`storage` ≠ "store") get their content stripped here, at the save layer.

Re-runs refresh credits, keep moderators' decisions, and hide files whose licence is no longer usable.

**Incremental runs** (`only_due=True`, used automatically after a sync): only places that were never checked,
were renamed or moved since (a trigger clears `places.photos_checked_at`), or were checked more than
`photo_recheck_days` ago — and the source is only asked about the tiles around them.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg

from . import db
from .config import Settings
from .licenses import usable_license
from .models import BBox, Partition
from .normalize import normalize_search
from .sources import Manifest, NormalizedPhoto, PhotoBatch, SourceConfigError, SourceUnavailable, Subject, check_keys, get_source

# Re-exported: these lived here before the `sources` package.
from .sources.base import QueryTooBig
from .sources.http import MAX_SPLITS, TILE_DEGREES, ContactMissing, check_contact, quarter, tiles
from .sources.wikimedia import WikiItem, Wikimedia, category_files, file_infos, file_title_from_url, wikidata_items

log = logging.getLogger(__name__)


@dataclass
class Match:
    subject: Subject
    place_id: str
    distance_m: float
    exact: bool
    #: Matched by coordinates alone (no id, no shared name): always waits for review.
    coords_only: bool = False


@dataclass
class Candidate:
    place_id: str
    photo: NormalizedPhoto
    score: float
    approved: bool


# ── match ────────────────────────────────────────────────────────────────────


def _metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    rad = math.radians
    h = math.sin(rad(lat2 - lat1) / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(rad(lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def match_subjects(conn: psycopg.Connection, settings: Settings, box: BBox, subjects: list[Subject]) -> list[Match]:
    """One place per subject: an external id wins; otherwise the nearest place sharing a name; otherwise (a source
    that only knows coordinates) the nearest place, for review."""
    if not subjects:
        return []
    pad = settings.photo_review_meters / 111_320
    rows = conn.execute(
        """
        SELECT p.id::text AS id, p.lat, p.lng, p.name,
               coalesce(array_agg(DISTINCT n.name) FILTER (WHERE n.name IS NOT NULL), '{}') AS names,
               coalesce(array_agg(DISTINCT 'wikidata:' || (s.raw->'tags'->>'wikidata'))
                        FILTER (WHERE s.provider = 'osm' AND s.raw->'tags'->>'wikidata' IS NOT NULL), '{}')
               || coalesce(array_agg(DISTINCT s.provider || ':' || s.external_id) FILTER (WHERE s.id IS NOT NULL), '{}') AS ids
        FROM places p
        LEFT JOIN place_names n ON n.place_id = p.id
        LEFT JOIN place_sources s ON s.place_id = p.id
        WHERE p.status = 'ACTIVE' AND p.merged_into_id IS NULL
          AND p.lng BETWEEN %s AND %s AND p.lat BETWEEN %s AND %s
        GROUP BY p.id
        """,
        [box.min_lng - pad, box.max_lng + pad, box.min_lat - pad, box.max_lat + pad],
    ).fetchall()
    by_id = {i: r for r in rows for i in r["ids"]}
    by_name: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        for name in {r["name"], *r["names"]}:
            key = normalize_search(name)
            if key:
                by_name.setdefault(key, []).append(r)

    out: list[Match] = []
    for s in subjects:
        ref = s.ref
        exact = next((by_id[f"{k}:{v}"] for k, v in ref.ids.items() if f"{k}:{v}" in by_id), None)
        if exact:
            d = _metres(ref.lat, ref.lng, exact["lat"], exact["lng"]) if ref.lat is not None and ref.lng is not None else 0.0
            out.append(Match(s, exact["id"], d, exact=True))
            continue
        if ref.lat is None or ref.lng is None:
            continue
        lat, lng = ref.lat, ref.lng
        if ref.names:
            pool = list({r["id"]: r for key in {normalize_search(n) for n in ref.names} for r in by_name.get(key, [])}.values())
        else:
            pool = rows
        best = min(pool, key=lambda r: _metres(lat, lng, r["lat"], r["lng"]), default=None)
        if best:
            d = _metres(lat, lng, best["lat"], best["lng"])
            if d <= settings.photo_review_meters:
                out.append(Match(s, best["id"], d, exact=False, coords_only=not ref.names))
    return out


# ── choose ───────────────────────────────────────────────────────────────────


def choose(matches: list[Match], batch: PhotoBatch, settings: Settings) -> tuple[list[Candidate], set[str]]:
    """Per place: the best-scored usable photos of its matched subjects, up to `photos_per_place`.
    Returns the candidates and the source ids that must not be shown (gone, or licence not usable)."""
    unusable = set(batch.gone) | {p.source_id for p in batch.photos if not usable_license(p.license, p.restrictions)}
    by_subject: dict[str, list[NormalizedPhoto]] = {}
    for p in batch.photos:
        by_subject.setdefault(p.subject, []).append(p)
    picked: dict[str, list[Candidate]] = {}
    for m in sorted(matches, key=lambda m: (not m.exact, m.distance_m)):
        approved = m.exact or (not m.coords_only and m.distance_m <= settings.photo_match_meters)
        slot = picked.setdefault(m.place_id, [])
        for p in by_subject.get(m.subject.key, []):
            if p.source_id not in unusable and p.score > 0:
                slot.append(Candidate(m.place_id, p, p.score, approved))
    out: list[Candidate] = []
    for slot in picked.values():
        seen: set[str] = set()
        for c in sorted(slot, key=lambda c: -c.score):
            if c.photo.source_id not in seen and len(seen) < settings.photos_per_place:
                seen.add(c.photo.source_id)
                out.append(c)
    return out, unusable


# ── save ─────────────────────────────────────────────────────────────────────

#: Columns each storage mode may fill (besides ids, status and score).
_CONTENT = {
    "store": {"remote_url", "page_url", "title", "author", "author_url", "license", "license_url", "caption"},
    # Credits and a link only: the app shows the source's own image, nothing is downloaded.
    "reference": {"page_url", "title", "author", "author_url", "license", "license_url"},
    "id_only": set(),
}


def row_values(manifest: Manifest, c: Candidate) -> dict[str, Any]:
    p = c.photo
    full = {
        "remote_url": p.remote_url,
        "page_url": p.page_url,
        "title": p.title,
        "author": p.author,
        "author_url": p.author_url,
        "license": p.license,
        "license_url": p.license_url,
        "caption": (p.caption or "")[:200] or None,
    }
    if manifest.storage not in _CONTENT:
        raise SourceConfigError(f"{manifest.key}: unknown storage mode {manifest.storage!r}")
    allowed = _CONTENT[manifest.storage]
    return {
        **{k: (v if k in allowed else None) for k, v in full.items()},
        "place": c.place_id,
        "source": manifest.key,
        "source_id": p.source_id,
        "status": "APPROVED" if c.approved else "PENDING",
        "score": c.score,
    }


def save(conn: psycopg.Connection, manifest: Manifest, candidates: list[Candidate], unusable: set[str]) -> dict[str, int]:
    """New photos are queued; existing rows get fresh credits but keep their status (a moderator's call)."""
    added = updated = 0
    for c in candidates:
        row = conn.execute(
            """
            INSERT INTO place_photos (id, place_id, source, source_id, remote_url, page_url, title, author, author_url,
                                      license, license_url, caption, status, score, updated_at)
            VALUES (gen_random_uuid(), %(place)s::uuid, %(source)s, %(source_id)s, %(remote_url)s, %(page_url)s, %(title)s, %(author)s,
                    %(author_url)s, %(license)s, %(license_url)s, %(caption)s, %(status)s::"PhotoStatus", %(score)s, now())
            ON CONFLICT (place_id, source, source_id) DO UPDATE SET
              remote_url = EXCLUDED.remote_url, page_url = EXCLUDED.page_url, title = EXCLUDED.title, author = EXCLUDED.author,
              author_url = EXCLUDED.author_url, license = EXCLUDED.license, license_url = EXCLUDED.license_url,
              caption = EXCLUDED.caption, score = EXCLUDED.score, updated_at = now()
            WHERE (place_photos.author, place_photos.license, place_photos.remote_url, place_photos.score)
                  IS DISTINCT FROM (EXCLUDED.author, EXCLUDED.license, EXCLUDED.remote_url, EXCLUDED.score)
            RETURNING (xmax = 0) AS inserted
            """,
            row_values(manifest, c),
        ).fetchone()
        if row:
            added += int(row["inserted"])
            updated += int(not row["inserted"])
    hidden = 0
    if unusable:
        # A file whose licence changed (or that was deleted) must stop being shown.
        hidden = conn.execute(
            "UPDATE place_photos SET status = 'HIDDEN', updated_at = now() WHERE source = %s AND source_id = ANY(%s) AND status <> 'HIDDEN'",
            [manifest.key, sorted(unusable)],
        ).rowcount
    return {"added": added, "updated": updated, "hidden": hidden}


# Kept for callers of the pre-`sources` API.
def upsert(conn: psycopg.Connection, candidates: list[Candidate], unusable: set[str]) -> dict[str, int]:
    from .sources.wikimedia import MANIFEST

    return save(conn, MANIFEST, candidates, unusable)


# ── which places ─────────────────────────────────────────────────────────────


def places_in(conn: psycopg.Connection, settings: Settings, box: BBox, only_due: bool) -> list[dict[str, Any]]:
    """Active places in the box — with `only_due`, those whose photos need (re)checking."""
    return conn.execute(
        """
        SELECT id::text AS id, lat, lng FROM places
        WHERE status = 'ACTIVE' AND merged_into_id IS NULL
          AND lng BETWEEN %s AND %s AND lat BETWEEN %s AND %s
          AND (NOT %s OR photos_checked_at IS NULL OR photos_checked_at < now() - make_interval(days => %s))
        """,
        [box.min_lng, box.max_lng, box.min_lat, box.max_lat, only_due, settings.photo_recheck_days],
    ).fetchall()


def mark_checked(conn: psycopg.Connection, places: list[dict[str, Any]], skipped: list[BBox]) -> int:
    """Places whose surroundings the source fully answered count as checked (not those in skipped tiles)."""
    ids = [p["id"] for p in places if not any(b.contains(p["lng"], p["lat"]) for b in skipped)]
    if not ids:
        return 0
    return conn.execute("UPDATE places SET photos_checked_at = now() WHERE id = ANY(%s::uuid[])", [ids]).rowcount


def sync_partition(conn: psycopg.Connection, source: Any, settings: Settings, part: Partition | BBox, only_due: bool = False) -> dict[str, int]:
    if isinstance(part, BBox):
        part = Partition(source.manifest.key, "bbox", part)
    box = part.bbox
    places = places_in(conn, settings, box, only_due)
    if only_due and not places:
        return {"due": 0, "items": 0, "matched": 0, "places": 0, "added": 0, "updated": 0, "hidden": 0, "skipped_tiles": 0, "checked": 0}
    found = source.find_subjects(part, focus=[(p["lat"], p["lng"]) for p in places] if only_due else None)
    matches = match_subjects(conn, settings, box, found.subjects)
    if only_due:
        due = {p["id"] for p in places}
        matches = [m for m in matches if m.place_id in due]
    subjects = list({m.subject.key: m.subject for m in matches}.values())
    batch = source.fetch_photos(subjects) if subjects else PhotoBatch([])
    candidates, unusable = choose(matches, batch, settings)
    stats = save(conn, source.manifest, candidates, unusable)
    checked = mark_checked(conn, places, found.skipped)
    out = {"items": len(found.subjects), "matched": len(matches), "places": len({c.place_id for c in candidates}), **stats}
    out.update({"skipped_tiles": len(found.skipped), "checked": checked})
    if only_due:
        out["due"] = len(places)
    return out


# ── runs ─────────────────────────────────────────────────────────────────────


def _config_error(problems: list[str]) -> SourceConfigError:
    msg = "; ".join(problems)
    return ContactMissing(msg) if "CATALOG_CONTACT" in msg else SourceConfigError(msg)


def resolve_partitions(conn: psycopg.Connection, settings: Settings, areas: list[str], bbox: str | None) -> list[Partition]:
    from .pipeline import resolve_scope  # late import: pipeline imports the place sources

    parts: dict[str, Partition] = {}
    for a in areas or [None]:  # type: ignore[list-item]
        for p in resolve_scope(conn, settings, a, bbox if a is None else None)[0]:
            parts.setdefault(p.key, p)
    return list(parts.values())


def count_due(settings: Settings, areas: list[str], bbox: str | None) -> int:
    """How many places in the areas need their photos checked (decides whether a sync announces new places)."""
    with db.connect(settings.database_url) as conn:
        parts = resolve_partitions(conn, settings, areas, bbox)
        return len({p["id"] for part in parts for p in places_in(conn, settings, part.bbox, True)})


def sync_photos(
    settings: Settings,
    area: str | None = None,
    bbox: str | None = None,
    dry_run: bool = False,
    client: httpx.Client | None = None,
    *,
    areas: list[str] | None = None,
    only_due: bool = False,
    source: str = "wikimedia",
    after_sync: str | None = None,
) -> dict[str, Any]:
    """Queue photos for the places in `area` (or several `areas`, or `bbox`). `only_due` = incremental run."""
    check_keys([source], "photos")
    src = get_source(source, settings, client=client)
    problems = src.check()
    if problems:  # before anything is sent
        raise _config_error(problems)
    areas = list(dict.fromkeys([*(areas or []), *([area] if area else [])]))
    with db.connect(settings.database_url) as conn:
        parts = resolve_partitions(conn, settings, areas, bbox)
        params = {"kind": "photos", "source": source, "area": area, "areas": areas, "bbox": bbox, "only_due": only_due, "after_sync": after_sync}
        run_id = None if dry_run else db.start_run(conn, "photos", params)
        totals: dict[str, Any] = {"partitions": {}}
        errors: dict[str, str] = {}
        try:
            for i, p in enumerate(parts, 1):
                log.info("photos %d/%d: %s%s", i, len(parts), p.key, " (due only)" if only_due else "")
                try:
                    s = sync_partition(conn, src, settings, Partition(source, p.key, p.bbox, p.area_id), only_due)
                except (httpx.HTTPError, SourceUnavailable, RuntimeError) as e:
                    # One region failing (network, a source hiccup) shouldn't throw away the others; re-runs are safe.
                    conn.rollback()
                    errors[p.key] = f"{type(e).__name__}: {e}"[:300]
                    log.warning("photos %s failed: %s", p.key, errors[p.key])
                    continue
                totals["partitions"][p.key] = s
                for k, v in s.items():
                    totals[k] = totals.get(k, 0) + v
                if not dry_run:
                    conn.commit()
            if errors:
                totals["failed_partitions"] = errors
                if len(errors) == len(parts):
                    raise RuntimeError(f"every partition failed, e.g. {next(iter(errors.items()))}")
            status = "partial" if errors or totals.get("skipped_tiles") else "succeeded"
            totals["status"] = status
            if dry_run:
                conn.rollback()
            else:
                db.finish_run(conn, run_id, status, totals)  # type: ignore[arg-type]
        except Exception as e:
            conn.rollback()
            if run_id:
                db.finish_run(conn, run_id, "failed", totals, f"{type(e).__name__}: {e}"[:2000])
            raise
    return {"run_id": run_id, "dry_run": dry_run, **totals}


__all__ = [
    "MAX_SPLITS",
    "TILE_DEGREES",
    "Candidate",
    "ContactMissing",
    "Match",
    "QueryTooBig",
    "WikiItem",
    "Wikimedia",
    "category_files",
    "check_contact",
    "choose",
    "count_due",
    "file_infos",
    "file_title_from_url",
    "match_subjects",
    "quarter",
    "save",
    "sync_partition",
    "sync_photos",
    "tiles",
    "usable_license",
    "wikidata_items",
]
