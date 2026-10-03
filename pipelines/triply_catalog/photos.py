"""Photos for places from Wikimedia Commons, found through Wikidata.

For each partition (a province or a destination box):

1. **Wikidata** (one SPARQL query per box): items with coordinates inside the box that have a main image
   (P18) and/or a Commons category (P373), with their labels and aliases in the languages we care about.
2. **Match** each item to one place: exactly, when an OpenStreetMap record of the place carries the
   item's id (`wikidata=Q…` tag); otherwise by name (any language, accents ignored) to the nearest
   place within `photo_review_meters`. Close name matches publish at once; looser ones wait for review.
3. **Commons**: licence and author for the main image and for the category's *quality* images
   (Quality / Featured / Valued). Only free licences that allow commercial use and changes are kept
   (CC0, public domain, CC BY, CC BY-SA); NC/ND, fair use and restricted files are skipped.
4. **Queue**: rows in `place_photos` with `remote_url` and the credits. The API's ingester downloads them
   into TRIPLY's own media (3 WebP sizes) — the pipeline never writes image files itself.

Re-runs refresh credits, keep moderators' decisions, and hide files whose licence is no longer usable.
"""

from __future__ import annotations

import html
import logging
import math
import re
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

import httpx
import psycopg

from . import db
from .config import Settings
from .models import BBox
from .normalize import normalize_search

log = logging.getLogger(__name__)

LANGS = ("vi", "en", "fr", "de", "ja", "ko", "zh")
QUALITY_CATEGORIES = {
    "Category:Quality images": 1.0,
    "Category:Valued images sorted by promotion date": 1.0,
    "Category:Featured pictures on Wikimedia Commons": 1.1,
}
SCORE_MAIN_IMAGE = 1.5
MIN_WIDTH_MAIN = 800
MIN_WIDTH_GALLERY = 1600
STORE_WIDTH = 2400


@dataclass
class WikiItem:
    qid: str
    lat: float
    lng: float
    names: set[str] = field(default_factory=set)
    image: str | None = None  # "File:…"
    category: str | None = None  # "Category:…"


@dataclass
class Match:
    item: WikiItem
    place_id: str
    distance_m: float
    exact: bool


@dataclass
class FileInfo:
    title: str
    remote_url: str
    page_url: str
    width: int
    height: int
    author: str | None
    author_url: str | None
    license: str
    license_url: str | None
    caption: str | None
    quality: float  # 0 = not in a quality category


# ── HTTP ─────────────────────────────────────────────────────────────────────


class Wikimedia:
    """A polite client: identifies itself, spaces requests out, honours Retry-After and maxlag."""

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.s = settings
        self.client = client or httpx.Client(timeout=60, follow_redirects=True)
        self.client.headers["User-Agent"] = settings.user_agent
        self._last = 0.0

    def get(self, url: str, params: dict[str, Any]) -> Any:
        for attempt in range(5):
            wait = self.s.wikimedia_delay - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            r = self.client.get(url, params=params)
            if r.status_code in (429, 502, 503, 504):
                retry = float(r.headers.get("retry-after", 2**attempt))
                log.warning("%s → %s, retrying in %.0fs", url, r.status_code, retry)
                time.sleep(min(retry, 60))
                continue
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and data.get("error", {}).get("code") == "maxlag":
                time.sleep(min(float(r.headers.get("retry-after", 5)), 60))
                continue
            return data
        raise RuntimeError(f"{url}: gave up after retries")


# ── 1. Wikidata ──────────────────────────────────────────────────────────────

SPARQL = """
SELECT ?item ?coord ?image ?category (GROUP_CONCAT(DISTINCT ?name; separator="\\u001f") AS ?names) WHERE {{
  SERVICE wikibase:box {{
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point({x0} {y0})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point({x1} {y1})"^^geo:wktLiteral .
  }}
  OPTIONAL {{ ?item wdt:P18 ?image . }}
  OPTIONAL {{ ?item wdt:P373 ?category . }}
  FILTER(BOUND(?image) || BOUND(?category))
  OPTIONAL {{ ?item rdfs:label|skos:altLabel ?name . FILTER(LANG(?name) IN ({langs})) }}
}}
GROUP BY ?item ?coord ?image ?category
"""

_POINT = re.compile(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)")


def file_title_from_url(url: str) -> str:
    """ "http://commons.wikimedia.org/wiki/Special:FilePath/Ch%C3%B9a%20C%E1%BA%A7u.jpg" → "File:Chùa Cầu.jpg"."""
    return "File:" + unquote(url.rsplit("/", 1)[-1]).replace("_", " ")


def wikidata_items(wm: Wikimedia, box: BBox) -> list[WikiItem]:
    q = SPARQL.format(x0=box.min_lng, y0=box.min_lat, x1=box.max_lng, y1=box.max_lat, langs=", ".join(f'"{lang}"' for lang in LANGS))
    data = wm.get(wm.s.wikidata_sparql, {"query": q, "format": "json"})
    items: dict[str, WikiItem] = {}
    for b in data["results"]["bindings"]:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        m = _POINT.search(b["coord"]["value"])
        if not m:
            continue
        it = items.setdefault(qid, WikiItem(qid, lat=float(m.group(2)), lng=float(m.group(1))))
        if "image" in b and not it.image:
            it.image = file_title_from_url(b["image"]["value"])
        if "category" in b and not it.category:
            it.category = "Category:" + b["category"]["value"]
        it.names |= {n for n in b.get("names", {}).get("value", "").split("\u001f") if n}
    return list(items.values())


# ── 2. Matching ──────────────────────────────────────────────────────────────


def _metres(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    rad = math.radians
    h = math.sin(rad(lat2 - lat1) / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(rad(lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def match_items(conn: psycopg.Connection, settings: Settings, box: BBox, items: list[WikiItem]) -> list[Match]:
    """One place per item: the OSM `wikidata` tag wins; otherwise the nearest place sharing a name."""
    if not items:
        return []
    pad = settings.photo_review_meters / 111_320
    rows = conn.execute(
        """
        SELECT p.id::text AS id, p.lat, p.lng, p.name,
               coalesce(array_agg(DISTINCT n.name) FILTER (WHERE n.name IS NOT NULL), '{}') AS names,
               coalesce(array_agg(DISTINCT s.raw->'tags'->>'wikidata') FILTER (WHERE s.raw->'tags'->>'wikidata' IS NOT NULL), '{}') AS qids
        FROM places p
        LEFT JOIN place_names n ON n.place_id = p.id
        LEFT JOIN place_sources s ON s.place_id = p.id AND s.provider = 'osm'
        WHERE p.status = 'ACTIVE' AND p.merged_into_id IS NULL
          AND p.lng BETWEEN %s AND %s AND p.lat BETWEEN %s AND %s
        GROUP BY p.id
        """,
        [box.min_lng - pad, box.max_lng + pad, box.min_lat - pad, box.max_lat + pad],
    ).fetchall()
    by_qid = {q: r for r in rows for q in r["qids"]}
    by_name: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        for name in {r["name"], *r["names"]}:
            key = normalize_search(name)
            if key:
                by_name.setdefault(key, []).append(r)

    out: list[Match] = []
    for it in items:
        exact = by_qid.get(it.qid)
        if exact:
            out.append(Match(it, exact["id"], _metres(it.lat, it.lng, exact["lat"], exact["lng"]), exact=True))
            continue
        candidates = {r["id"]: r for key in {normalize_search(n) for n in it.names} for r in by_name.get(key, [])}
        best = min(candidates.values(), key=lambda r: _metres(it.lat, it.lng, r["lat"], r["lng"]), default=None)
        if best:
            d = _metres(it.lat, it.lng, best["lat"], best["lng"])
            if d <= settings.photo_review_meters:
                out.append(Match(it, best["id"], d, exact=False))
    return out


# ── 3. Commons ───────────────────────────────────────────────────────────────

_NOT_FREE = re.compile(r"\b(NC|ND)\b|non-?commercial|no.?deriv|fair use|all rights reserved", re.I)
_FREE = re.compile(r"^(CC0|CC[ -]?zero|public domain|PD\b|PD-|CC BY(-SA)? \d(\.\d)?)", re.I)


def usable_license(short_name: str | None, restrictions: str | None = None) -> bool:
    """Free for commercial use and changes: CC0 / public domain / CC BY / CC BY-SA, without extra restrictions."""
    s = (short_name or "").strip()
    if not s or _NOT_FREE.search(s) or (restrictions or "").strip():
        return False
    return bool(_FREE.match(s))


def _text(value: str | None) -> str | None:
    """Commons metadata is HTML: keep the words."""
    if not value:
        return None
    t = html.unescape(re.sub(r"<[^>]+>", " ", value))
    t = re.sub(r"\s+", " ", t).strip()
    return t[:300] or None


def _first_link(value: str | None) -> str | None:
    m = re.search(r'href="([^"]+)"', value or "")
    if not m:
        return None
    url = html.unescape(m.group(1))
    return "https:" + url if url.startswith("//") else url if url.startswith("http") else None


def _chunks(seq: list[str], n: int) -> Iterable[list[str]]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def file_infos(wm: Wikimedia, titles: list[str]) -> dict[str, FileInfo | None]:
    """Licence, author and a ≤2400 px rendition for each file; None when the file can't be used."""
    out: dict[str, FileInfo | None] = {}
    for batch in _chunks(sorted(set(titles)), 50):
        data = wm.get(
            wm.s.commons_api,
            {
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "maxlag": "5",
                "titles": "|".join(batch),
                "prop": "imageinfo|categories",
                "clcategories": "|".join(QUALITY_CATEGORIES),
                "iiprop": "url|size|mime|extmetadata",
                "iiurlwidth": str(STORE_WIDTH),
                "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|Restrictions|ObjectName|ImageDescription",
            },
        )
        normalized = {n["to"]: n["from"] for n in data.get("query", {}).get("normalized", [])}
        for page in data.get("query", {}).get("pages", []):
            title = normalized.get(page["title"], page["title"])
            ii = (page.get("imageinfo") or [None])[0]
            if not ii or page.get("missing"):
                out[title] = None
                continue
            meta = {k: v.get("value") for k, v in (ii.get("extmetadata") or {}).items()}
            if not usable_license(meta.get("LicenseShortName"), meta.get("Restrictions")) or ii.get("mime") not in (
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/tiff",
            ):
                out[title] = None
                continue
            quality = max((QUALITY_CATEGORIES.get(c["title"], 0.0) for c in page.get("categories", [])), default=0.0)
            out[title] = FileInfo(
                title=title,
                remote_url=ii.get("thumburl") if ii.get("width", 0) > STORE_WIDTH and ii.get("thumburl") else ii["url"],
                page_url=ii.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{title.replace(' ', '_')}",
                width=int(ii.get("width", 0)),
                height=int(ii.get("height", 0)),
                author=_text(meta.get("Artist")),
                author_url=_first_link(meta.get("Artist")),
                license=_text(meta.get("LicenseShortName")) or "",
                license_url=meta.get("LicenseUrl"),
                caption=_text(meta.get("ImageDescription")),
                quality=quality,
            )
    return out


def category_files(wm: Wikimedia, category: str, limit: int = 50) -> list[str]:
    data = wm.get(
        wm.s.commons_api,
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "maxlag": "5",
            "list": "categorymembers",
            "cmtitle": category,
            "cmtype": "file",
            "cmlimit": str(limit),
        },
    )
    return [m["title"] for m in data.get("query", {}).get("categorymembers", [])]


# ── 4. Queue ─────────────────────────────────────────────────────────────────


@dataclass
class Candidate:
    place_id: str
    info: FileInfo
    score: float
    approved: bool


def choose(matches: list[Match], infos: dict[str, FileInfo | None], gallery: dict[str, list[str]], settings: Settings) -> tuple[list[Candidate], set[str]]:
    """Per place: the item's main image, then landscape quality images from its category, up to the limit."""
    picked: dict[str, list[Candidate]] = {}
    unusable: set[str] = set()
    for m in sorted(matches, key=lambda m: (not m.exact, m.distance_m)):
        approved = m.exact or m.distance_m <= settings.photo_match_meters
        slot = picked.setdefault(m.place_id, [])
        if m.item.image:
            info = infos.get(m.item.image)
            if info is None:
                unusable.add(m.item.image)
            elif info.width >= MIN_WIDTH_MAIN:
                slot.append(Candidate(m.place_id, info, SCORE_MAIN_IMAGE, approved))
        for title in gallery.get(m.item.qid, []):
            info = infos.get(title)
            if info is None:
                unusable.add(title)
            elif info.quality and info.width >= MIN_WIDTH_GALLERY and info.width > info.height:
                slot.append(Candidate(m.place_id, info, info.quality, approved))
    out: list[Candidate] = []
    for slot in picked.values():
        seen: set[str] = set()
        for c in sorted(slot, key=lambda c: -c.score):
            if c.info.title not in seen and len(seen) < settings.photos_per_place:
                seen.add(c.info.title)
                out.append(c)
    return out, unusable


def upsert(conn: psycopg.Connection, candidates: list[Candidate], unusable: set[str]) -> dict[str, int]:
    """New files are queued; existing rows get fresh credits but keep their status (a moderator's call)."""
    added = updated = 0
    for c in candidates:
        i = c.info
        row = conn.execute(
            """
            INSERT INTO place_photos (id, place_id, source, source_id, remote_url, page_url, title, author, author_url,
                                      license, license_url, caption, status, score, updated_at)
            VALUES (gen_random_uuid(), %(place)s::uuid, 'wikimedia', %(title)s, %(url)s, %(page)s, %(name)s, %(author)s, %(author_url)s,
                    %(license)s, %(license_url)s, %(caption)s, %(status)s::"PhotoStatus", %(score)s, now())
            ON CONFLICT (place_id, source, source_id) DO UPDATE SET
              remote_url = EXCLUDED.remote_url, page_url = EXCLUDED.page_url, title = EXCLUDED.title, author = EXCLUDED.author,
              author_url = EXCLUDED.author_url, license = EXCLUDED.license, license_url = EXCLUDED.license_url,
              caption = EXCLUDED.caption, score = EXCLUDED.score, updated_at = now()
            WHERE (place_photos.author, place_photos.license, place_photos.remote_url, place_photos.score)
                  IS DISTINCT FROM (EXCLUDED.author, EXCLUDED.license, EXCLUDED.remote_url, EXCLUDED.score)
            RETURNING (xmax = 0) AS inserted
            """,
            {
                "place": c.place_id,
                "title": i.title,
                "url": i.remote_url,
                "page": i.page_url,
                "name": re.sub(r"\.\w{3,4}$", "", i.title.removeprefix("File:")),
                "author": i.author,
                "author_url": i.author_url,
                "license": i.license,
                "license_url": i.license_url,
                "caption": (i.caption or "")[:200] or None,
                "status": "APPROVED" if c.approved else "PENDING",
                "score": c.score,
            },
        ).fetchone()
        if row:
            added += int(row["inserted"])
            updated += int(not row["inserted"])
    hidden = 0
    if unusable:
        # A file whose licence changed (or that was deleted) must stop being shown.
        hidden = conn.execute(
            "UPDATE place_photos SET status = 'HIDDEN', updated_at = now() WHERE source = 'wikimedia' AND source_id = ANY(%s) AND status <> 'HIDDEN'",
            [sorted(unusable)],
        ).rowcount
    return {"added": added, "updated": updated, "hidden": hidden}


def sync_partition(conn: psycopg.Connection, wm: Wikimedia, settings: Settings, box: BBox) -> dict[str, int]:
    items = wikidata_items(wm, box)
    matches = match_items(conn, settings, box, items)
    gallery: dict[str, list[str]] = {}
    for m in matches:
        if m.item.category and settings.photos_per_place > 1:
            gallery[m.item.qid] = category_files(wm, m.item.category)
    titles = [t for m in matches for t in ([m.item.image] if m.item.image else []) + gallery.get(m.item.qid, [])]
    infos = file_infos(wm, titles) if titles else {}
    candidates, unusable = choose(matches, infos, gallery, settings)
    stats = upsert(conn, candidates, unusable)
    return {"items": len(items), "matched": len(matches), "places": len({c.place_id for c in candidates}), **stats}


def sync_photos(settings: Settings, area: str | None, bbox: str | None, dry_run: bool = False, client: httpx.Client | None = None) -> dict[str, Any]:
    from .pipeline import resolve_scope  # late import: pipeline imports the providers

    wm = Wikimedia(settings, client)
    with db.connect(settings.database_url) as conn:
        parts, _ = resolve_scope(conn, settings, area, bbox)
        run_id = None if dry_run else db.start_run(conn, "photos", {"kind": "photos", "area": area, "bbox": bbox})
        totals: dict[str, Any] = {"partitions": {}}
        try:
            for p in parts:
                s = sync_partition(conn, wm, settings, p.bbox)
                totals["partitions"][p.key] = s
                for k, v in s.items():
                    totals[k] = totals.get(k, 0) + v
                if not dry_run:
                    conn.commit()
            if dry_run:
                conn.rollback()
            else:
                db.finish_run(conn, run_id, "succeeded", totals)  # type: ignore[arg-type]
        except Exception as e:
            conn.rollback()
            if run_id:
                db.finish_run(conn, run_id, "failed", totals, f"{type(e).__name__}: {e}"[:2000])
            raise
    return {"run_id": run_id, "dry_run": dry_run, **totals}
