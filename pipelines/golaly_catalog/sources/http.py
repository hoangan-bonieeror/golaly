"""Shared plumbing for API sources: a polite HTTP client and adaptive tiling.

No adapter writes its own retry loop, rate limiting or User-Agent handling.
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections.abc import Callable
from typing import Any, TypeVar

import httpx

from ..models import BBox
from .base import QueryTooBig, RateLimited, SourceConfigError, SourceRefused, SourceUnavailable

log = logging.getLogger(__name__)
T = TypeVar("T")


# ── contact ──────────────────────────────────────────────────────────────────


class ContactMissing(SourceConfigError):
    """Sources such as Wikimedia refuse anonymous clients; stop before sending anything."""


_CONTACT = re.compile(r"^(https?://\S+\.\S+|[^@\s]+@[^@\s]+\.[^@\s]+)$")
CONTACT_HELP = (
    "Set CATALOG_CONTACT to a URL (e.g. your repository) or an email address. Wikimedia requires every client "
    "to say how to reach its operator and answers 403 otherwise. With Docker Compose, put CATALOG_CONTACT=… "
    "in the .env next to docker-compose.yml and recreate the containers (docker compose --profile pipelines up -d)."
)


def contact_problem(contact: str | None) -> str | None:
    return None if _CONTACT.match((contact or "").strip()) else CONTACT_HELP


def check_contact(contact: str | None) -> str:
    problem = contact_problem(contact)
    if problem:
        raise ContactMissing(problem)
    return (contact or "").strip()


# ── client ───────────────────────────────────────────────────────────────────


class PoliteClient:
    """Identifies itself, spaces requests out (`delay` seconds apart), retries 429/5xx honouring Retry-After,
    and turns failures into the standard errors:

    - 403 → SourceRefused (with `refused_hint`); still 429 after retries → RateLimited; other 5xx / network
      after retries → SourceUnavailable.
    - For `query=True` requests a timeout (ours or the server's, see `too_big`) → QueryTooBig, never retried:
      the same query would just time out again — ask for a smaller box instead.

    Subclasses adjust `too_big` and `retry_after_body` to the source's conventions.
    """

    name = "source"
    attempts = 5

    def __init__(
        self,
        user_agent: str,
        delay: float = 1.0,
        client: httpx.Client | None = None,
        timeout: httpx.Timeout | None = None,
        refused_hint: str = "",
    ) -> None:
        self.client = client or httpx.Client(timeout=timeout or httpx.Timeout(30, connect=15), follow_redirects=True)
        self.client.headers["User-Agent"] = user_agent
        self.delay = delay
        self.refused_hint = refused_hint
        self._last = 0.0

    def too_big(self, response: httpx.Response) -> bool:
        return response.status_code == 504

    def retry_after_body(self, data: Any, response: httpx.Response) -> float | None:
        """Seconds to wait when a 200 response says "come back later" in its body (e.g. MediaWiki maxlag)."""
        return None

    def _pace(self) -> None:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get(self, url: str, params: dict[str, Any], *, query: bool = False) -> Any:
        last = ""
        for attempt in range(self.attempts):
            self._pace()
            try:
                r = self.client.get(url, params=params)
            except httpx.TimeoutException as e:
                if query:
                    raise QueryTooBig(str(e) or "timed out") from e
                last = f"timed out ({e})"
                log.warning("%s timed out, retrying", url)
                time.sleep(2**attempt)
                continue
            if query and self.too_big(r):
                raise QueryTooBig(f"HTTP {r.status_code}")
            if r.status_code in (429, 502, 503, 504):
                retry = float(r.headers.get("retry-after", 2**attempt))
                last = f"HTTP {r.status_code}"
                log.warning("%s → %s, retrying in %.0fs", url, r.status_code, retry)
                time.sleep(min(retry, 60))
                continue
            if r.status_code in (401, 403):
                raise SourceRefused(
                    f"{self.name} refused the request ({r.status_code}) with User-Agent {self.client.headers['User-Agent']!r}. {self.refused_hint}".strip()
                )
            r.raise_for_status()
            data = r.json()
            wait = self.retry_after_body(data, r)
            if wait is not None:
                last = "asked to retry later"
                time.sleep(min(wait, 60))
                continue
            return data
        if last.startswith("HTTP 429"):
            raise RateLimited(f"{url}: still rate limited after {self.attempts} attempts")
        raise SourceUnavailable(f"{url}: gave up after retries ({last})")


# ── tiling ───────────────────────────────────────────────────────────────────

#: Boxes are queried in tiles at most this many degrees wide/high (a French region is several degrees across).
TILE_DEGREES = 0.5
#: A tile that still times out is split in four, down to this many levels (0.5° → ~3 km).
MAX_SPLITS = 4


def tiles(box: BBox, size: float = TILE_DEGREES) -> list[BBox]:
    nx = max(1, math.ceil((box.max_lng - box.min_lng) / size - 1e-9))
    ny = max(1, math.ceil((box.max_lat - box.min_lat) / size - 1e-9))
    dx = (box.max_lng - box.min_lng) / nx
    dy = (box.max_lat - box.min_lat) / ny
    return [BBox(box.min_lng + i * dx, box.min_lat + j * dy, box.min_lng + (i + 1) * dx, box.min_lat + (j + 1) * dy) for j in range(ny) for i in range(nx)]


def quarter(box: BBox) -> list[BBox]:
    mx, my = (box.min_lng + box.max_lng) / 2, (box.min_lat + box.max_lat) / 2
    return [
        BBox(box.min_lng, box.min_lat, mx, my),
        BBox(mx, box.min_lat, box.max_lng, my),
        BBox(box.min_lng, my, mx, box.max_lat),
        BBox(mx, my, box.max_lng, box.max_lat),
    ]


def near(points: list[tuple[float, float]], pad_degrees: float) -> Callable[[BBox], bool]:
    """A tile filter: keep tiles with one of the (lat, lng) points inside (or within `pad_degrees` of) them."""

    def keep(t: BBox) -> bool:
        return any(
            t.min_lat - pad_degrees <= lat <= t.max_lat + pad_degrees and t.min_lng - pad_degrees <= lng <= t.max_lng + pad_degrees for lat, lng in points
        )

    return keep


def tiled(
    box: BBox,
    query: Callable[[BBox], T],
    *,
    failed: list[BBox] | None = None,
    keep: Callable[[BBox], bool] | None = None,
    size: float = TILE_DEGREES,
    max_splits: int = MAX_SPLITS,
) -> list[T]:
    """Run `query` on each tile of `box` (only the tiles `keep` accepts). A tile whose query raises QueryTooBig is
    split in four and retried, down to `max_splits` levels; tiles that still fail are appended to `failed` and
    skipped, so the rest of the box is still answered."""
    out: list[T] = []
    queue = [(t, 0) for t in tiles(box, size) if keep is None or keep(t)]
    while queue:
        t, depth = queue.pop(0)
        try:
            out.append(query(t))
        except QueryTooBig:
            if depth >= max_splits:
                log.warning("query still too big at %s; skipped", t)
                if failed is not None:
                    failed.append(t)
                continue
            queue[:0] = [(q, depth + 1) for q in quarter(t) if keep is None or keep(q)]
    return out
