"""One licence filter for every source.

Accepted: free for commercial use and changes — CC0, public domain, CC BY, CC BY-SA, and the dataset licences
TRIPLY's place sources use (ODbL, CDLA-Permissive, Apache-2.0). Rejected: NC/ND variants, fair use, "all rights
reserved", and anything with extra restrictions (trademark, personality rights…).
"""

from __future__ import annotations

import re

_NOT_FREE = re.compile(r"\b(NC|ND)\b|non-?commercial|no.?deriv|fair use|all rights reserved", re.I)
_FREE = re.compile(r"^(CC0|CC[ -]?zero|public domain|PD\b|PD-|CC BY(-SA)? \d(\.\d)?|ODbL|CDLA-Permissive|Apache-2\.0)", re.I)


def usable_license(short_name: str | None, restrictions: str | None = None) -> bool:
    s = (short_name or "").strip()
    if not s or _NOT_FREE.search(s) or (restrictions or "").strip():
        return False
    return bool(_FREE.match(s))
