"""Pure normalisation helpers (no I/O) — unit tested, and kept identical to the app where they overlap."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import phonenumbers

_COMBINING = re.compile(r"[̀-ͯ]")
_SPACES = re.compile(r"\s+")


def normalize_search(text: str | None) -> str:
    """Accent-free, lower-case, single-spaced text.

    Mirrors `normalizeSearch` in packages/shared/src/labels.ts exactly; both sides are tested against
    packages/shared/fixtures/normalize-cases.json so search and matching agree across languages.
    """
    s = unicodedata.normalize("NFD", text or "")
    s = _COMBINING.sub("", s)
    s = s.replace("đ", "d").replace("Đ", "d")
    s = s.lower()
    return _SPACES.sub(" ", s).strip()


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize_search(text)).strip("-")


def clean_text(value: Any, max_len: int = 300) -> str | None:
    if not isinstance(value, str):
        return None
    s = _SPACES.sub(" ", value).strip()
    return s[:max_len] or None


def normalize_phone(raw: Any, region: str = "VN") -> str | None:
    """E.164 (`+84…`), or None when the number isn't valid. Multiple numbers ("a; b") → the first valid one."""
    if not isinstance(raw, str):
        return None
    for part in re.split(r"[;,/]", raw):
        part = part.strip()
        if not part:
            continue
        try:
            num = phonenumbers.parse(part, region)
        except phonenumbers.NumberParseException:
            continue
        if phonenumbers.is_valid_number(num):
            return phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)
    return None


_TRACKING = re.compile(r"^(utm_[a-z]+|fbclid|gclid|ref)$", re.IGNORECASE)


def normalize_website(raw: Any) -> str | None:
    """https URL without tracking parameters or fragments; None for anything that isn't a web URL."""
    if not isinstance(raw, str):
        return None
    url = raw.strip()
    if not url:
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*:(?!//)", url, re.IGNORECASE) and not re.match(r"^[^:/]+:\d", url):
        return None  # mailto:, tel:, javascript: …
    if "://" not in url:
        url = "https://" + url
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or "." not in parts.netloc or "@" in parts.netloc:
        return None
    query = "&".join(q for q in parts.query.split("&") if q and not _TRACKING.match(q.split("=", 1)[0]))
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path or "/", query, ""))[:500]


def lang_tag(tag: str) -> str:
    """BCP 47 tag in canonical case: 'vi', 'en', 'zh-Hans', 'pt-BR'."""
    parts = tag.replace("_", "-").split("-")
    out = [parts[0].lower()]
    for p in parts[1:]:
        out.append(p.upper() if len(p) == 2 else p.title() if len(p) == 4 else p.lower())
    return "-".join(out)


def content_hash(normalized: dict[str, Any]) -> str:
    """Stable hash of a normalised record: identical content → identical hash → no update on re-import."""
    payload = json.dumps(normalized, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
