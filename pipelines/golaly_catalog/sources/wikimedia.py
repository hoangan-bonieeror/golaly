"""Wikimedia Commons photos, found through Wikidata — a PhotoSource.

1. `find_subjects`: one SPARQL query per tile — Wikidata items with coordinates in the box that have a main
   image (P18) and/or a Commons category (P373), with labels and aliases in the languages we care about.
2. `fetch_photos` (matched items only): licence, author and a ≤2400 px rendition of the main image and of the
   category's *quality* images (Quality / Featured / Valued) from the Commons API.

Matching, licence filtering, choosing and saving are shared (`golaly_catalog.photos`).
"""

from __future__ import annotations

import html
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

import httpx

from ..config import Settings
from ..models import BBox, Partition
from .base import Manifest, NormalizedPhoto, PhotoBatch, PlaceRef, Subject, SubjectBatch
from .http import PoliteClient, check_contact, contact_problem, near, tiled

log = logging.getLogger(__name__)

MANIFEST = Manifest(
    key="wikimedia",
    name="Wikimedia Commons",
    provides=frozenset({"photos"}),
    license="per file (CC0, public domain, CC BY, CC BY-SA)",
    attribution="Wikimedia Commons contributors",
    storage="store",
    partitioning="tiles",
    rate=1.0,
    requires=("CATALOG_CONTACT",),
    coverage="global",
    cost="free",
    homepage="https://commons.wikimedia.org",
)

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
MIMES = ("image/jpeg", "image/png", "image/webp", "image/tiff")


@dataclass
class WikiItem:
    qid: str
    lat: float
    lng: float
    names: set[str] = field(default_factory=set)
    image: str | None = None  # "File:…"
    category: str | None = None  # "Category:…"


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
    restrictions: str | None = None


# ── HTTP ─────────────────────────────────────────────────────────────────────


class Wikimedia(PoliteClient):
    """The polite client, with Wikimedia's conventions: WDQS reports its 60 s timeout as 500/504, MediaWiki
    asks clients to back off with `maxlag` errors."""

    name = "Wikimedia"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        check_contact(settings.contact)
        self.s = settings
        # WDQS stops queries after 60 s; wait a little longer so we see its answer rather than our own timeout.
        super().__init__(
            settings.user_agent,
            delay=settings.wikimedia_delay,
            client=client,
            timeout=httpx.Timeout(75, connect=15),
            refused_hint="Check that CATALOG_CONTACT is a working URL or email; if it is, the address may be rate-limited — "
            "wait a few minutes and run again (re-runs are safe).",
        )

    def too_big(self, response: httpx.Response) -> bool:
        return response.status_code == 504 or (response.status_code == 500 and "timeout" in response.text[:2000].lower())

    def retry_after_body(self, data: Any, response: httpx.Response) -> float | None:
        if isinstance(data, dict) and data.get("error", {}).get("code") == "maxlag":
            return float(response.headers.get("retry-after", 5))
        return None

    def get(self, url: str, params: dict[str, Any], *, sparql: bool = False, query: bool = False) -> Any:  # type: ignore[override]
        return super().get(url, params, query=sparql or query)


# ── Wikidata ─────────────────────────────────────────────────────────────────

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


def _sparql(box: BBox) -> str:
    return SPARQL.format(x0=box.min_lng, y0=box.min_lat, x1=box.max_lng, y1=box.max_lat, langs=", ".join(f'"{lang}"' for lang in LANGS))


def _parse_items(data: dict[str, Any], items: dict[str, WikiItem]) -> None:
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


def wikidata_items(wm: Wikimedia, box: BBox, failed: list[BBox] | None = None, keep: Any = None) -> list[WikiItem]:
    """All items in `box`, queried tile by tile; tiles the service can't answer in time are split further.
    Tiles that still fail at the smallest size are listed in `failed` (the rest of the box is still returned)."""
    items: dict[str, WikiItem] = {}
    tiled(box, lambda t: _parse_items(wm.get(wm.s.wikidata_sparql, {"query": _sparql(t), "format": "json"}, sparql=True), items), failed=failed, keep=keep)
    return list(items.values())


# ── Commons ──────────────────────────────────────────────────────────────────


def _text(value: str | None) -> str | None:
    """Commons metadata is HTML: keep the words."""
    if not value:
        return None
    t = html.unescape(re.sub(r"<[^>]+>", " ", value))
    t = re.sub(r"\s+", " ", t).strip()
    return t[:300] or None


def _http(url: str | None) -> str | None:
    """Only http(s) links reach a place page (never javascript:, data: or anything else from the source)."""
    url = (url or "").strip()
    if url.startswith("//"):
        url = "https:" + url
    return url if re.match(r"^https?://", url, re.IGNORECASE) else None


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
    """Licence, author and a ≤2400 px rendition for each file; None when the file is gone or isn't an image.
    The licence is reported as is — the shared licence filter decides whether it can be used."""
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
            if not ii or page.get("missing") or ii.get("mime") not in MIMES:
                out[title] = None
                continue
            meta = {k: v.get("value") for k, v in (ii.get("extmetadata") or {}).items()}
            quality = max((QUALITY_CATEGORIES.get(c["title"], 0.0) for c in page.get("categories", [])), default=0.0)
            out[title] = FileInfo(
                title=title,
                remote_url=ii.get("thumburl") if ii.get("width", 0) > STORE_WIDTH and ii.get("thumburl") else ii["url"],
                page_url=_http(ii.get("descriptionurl")) or f"https://commons.wikimedia.org/wiki/{title.replace(' ', '_')}",
                width=int(ii.get("width", 0)),
                height=int(ii.get("height", 0)),
                author=_text(meta.get("Artist")),
                author_url=_first_link(meta.get("Artist")),
                license=_text(meta.get("LicenseShortName")) or "",
                license_url=_http(meta.get("LicenseUrl")),
                caption=_text(meta.get("ImageDescription")),
                quality=quality,
                restrictions=(meta.get("Restrictions") or "").strip() or None,
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


def _photo(info: FileInfo, subject: str, score: float) -> NormalizedPhoto:
    return NormalizedPhoto(
        source_id=info.title,
        subject=subject,
        remote_url=info.remote_url,
        page_url=info.page_url,
        width=info.width,
        height=info.height,
        license=info.license,
        title=re.sub(r"\.\w{3,4}$", "", info.title.removeprefix("File:")),
        author=info.author,
        author_url=info.author_url,
        license_url=info.license_url,
        restrictions=info.restrictions,
        caption=info.caption,
        score=score,
    )


# ── the source ───────────────────────────────────────────────────────────────


class WikimediaSource:
    manifest = MANIFEST

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._client = client
        self._wm: Wikimedia | None = None

    @property
    def wm(self) -> Wikimedia:
        if self._wm is None:  # created on first use, so check() never needs a contact
            self._wm = Wikimedia(self.settings, self._client)
        return self._wm

    def check(self) -> list[str]:
        problem = contact_problem(self.settings.contact)
        return [problem] if problem else []

    def partitions(self, scope: list[Partition]) -> list[Partition]:
        return [Partition(self.manifest.key, p.key, p.bbox, p.area_id) for p in scope]

    def find_subjects(self, partition: Partition, focus: list[tuple[float, float]] | None = None) -> SubjectBatch:
        failed: list[BBox] = []
        keep = near(focus, self.settings.photo_review_meters / 111_320) if focus is not None else None
        items = wikidata_items(self.wm, partition.bbox, failed, keep=keep)
        subjects = [
            Subject(
                key=it.qid,
                ref=PlaceRef(ids={"wikidata": it.qid}, names=frozenset(it.names), lat=it.lat, lng=it.lng),
                data={"image": it.image, "category": it.category},
            )
            for it in items
        ]
        return SubjectBatch(subjects, failed)

    def fetch_photos(self, subjects: list[Subject]) -> PhotoBatch:
        gallery: dict[str, list[str]] = {}
        for s in subjects:
            if s.data.get("category") and self.settings.photos_per_place > 1:
                gallery[s.key] = category_files(self.wm, s.data["category"])
        titles = [t for s in subjects for t in ([s.data["image"]] if s.data.get("image") else []) + gallery.get(s.key, [])]
        infos = file_infos(self.wm, titles) if titles else {}
        photos: list[NormalizedPhoto] = []
        gone: set[str] = set()
        for s in subjects:
            # The item's main image first, then large landscape quality images from its category. Others get
            # score 0: not shown, but still licence-checked.
            main = s.data.get("image")
            if main:
                info = infos.get(main)
                if info is None:
                    gone.add(main)
                else:
                    photos.append(_photo(info, s.key, SCORE_MAIN_IMAGE if info.width >= MIN_WIDTH_MAIN else 0.0))
            for title in gallery.get(s.key, []):
                info = infos.get(title)
                if info is None:
                    gone.add(title)
                else:
                    ok = info.quality and info.width >= MIN_WIDTH_GALLERY and info.width > info.height
                    photos.append(_photo(info, s.key, info.quality if ok else 0.0))
        return PhotoBatch(photos, gone)
