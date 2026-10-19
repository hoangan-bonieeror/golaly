"""Duplicate detection and merging (catalog phase 2).

Phase 1 only attaches a source record to a place with the *same* normalised name within 50 m. This step looks at
places that were just created or changed and their neighbours, and decides whether two places are the same:

1. **Sure** — an external id of one points at the other (Overture lists the OSM / Foursquare record it came
   from), or the same phone or website within `merge_sure_m`.
2. **Candidates** — the 10 nearest active places within `merge_radius_m` (`merge_radius_landmark_m` for sights,
   culture and nature), whose names look alike.
3. **Score** — name 0.45 (trigram similarity of the accent-free names, any language, generic words like "quán",
   "nhà hàng", "hotel" ignored), distance 0.25 (1 at the same point → 0 at the radius), category 0.15 (same 1,
   same group 0.5), address 0.15 (house number + street). Weights are renormalised over the signals both places
   have, so a missing address doesn't count against a pair.
4. **Decide** — score ≥ `merge_auto` → merged now; ≥ `merge_review` → `merge_candidates` (pending). Never merged
   automatically: places of different kinds (a hotel and its restaurant), two records of the same provider (the
   provider already says they're two places), and pairs someone rejected.

A merge moves the loser's source records, itinerary items, saves and photos to the winner (the place with more
links), points the loser at the winner (`merged_into_id`, so old links still resolve) and records what moved in
`place_merges` — `unmerge` puts everything back.
"""

from __future__ import annotations

import csv
import logging
import math
import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import psycopg

from . import db
from .config import GROUP_FAMILIES, LANDMARK_GROUPS, MERGE_WEIGHTS, Settings
from .normalize import normalize_search

log = logging.getLogger(__name__)

GENERIC = re.compile(r"^(nha hang|quan an|quan|tiem|cua hang|ca phe|cafe|coffee|khach san|nha nghi|homestay|hotel|hostel|resort|restaurant|the) ")
_WORD = re.compile(r"[a-z0-9]+")
_HOUSE = re.compile(r"^\d+[a-z]?(/\d+[a-z]?)?$")


# ── text similarity ──────────────────────────────────────────────────────────


def core_name(name_norm: str) -> str:
    """'quan banh mi phuong' → 'banh mi phuong' (on an already normalised name)."""
    stripped = GENERIC.sub("", name_norm or "", count=1)
    return stripped or (name_norm or "")


def trigrams(text: str) -> set[str]:
    """pg_trgm's trigrams: each word padded with two spaces in front and one behind."""
    out: set[str] = set()
    for w in _WORD.findall(text.lower()):
        padded = f"  {w} "
        out.update(padded[i : i + 3] for i in range(len(padded) - 2))
    return out


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = trigrams(a), trigrams(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def name_score(a: Iterable[str], b: Iterable[str]) -> float:
    return max((similarity(core_name(x), core_name(y)) for x in a for y in b if x and y), default=0.0)


def _address_parts(address: str | None) -> tuple[str | None, str]:
    first = normalize_search((address or "").split(",")[0])
    words = first.split()
    if words and _HOUSE.match(words[0]):
        return words[0], " ".join(words[1:])
    return None, first


def address_score(a: str | None, b: str | None) -> float | None:
    """1 = same house number and street, 0 = different; None when either is missing (not counted)."""
    if not a or not b:
        return None
    na, sa = _address_parts(a)
    nb, sb = _address_parts(b)
    street = similarity(sa, sb)
    if na and nb:
        return 1.0 if na == nb and street >= 0.5 else 0.0
    return 0.5 if street >= 0.8 else 0.0


def _site(url: str | None) -> str | None:
    if not url:
        return None
    u = re.sub(r"^https?://(www\.)?", "", url.lower()).rstrip("/")
    return u or None


# ── places ───────────────────────────────────────────────────────────────────


@dataclass
class P:
    id: str
    name: str
    names: set[str]
    lat: float
    lng: float
    category_id: str | None
    group: str | None
    address: str | None
    phone: str | None
    website: str | None
    #: {"osm": {"n123"}, "overture": {"…"}} — this place's own source records.
    ids: dict[str, set[str]] = field(default_factory=dict)
    #: Records of other providers that this place's sources say they came from: {"osm:n123", "fsq:…"}.
    refs: set[str] = field(default_factory=set)
    links: int = 0
    sources: int = 0
    manual: bool = False
    created_at: Any = None

    def family(self) -> int | None:
        return next((i for i, f in enumerate(GROUP_FAMILIES) if self.group in f), None)


_OSM_REF = re.compile(r"^(?:(node|way|relation)/|([nwr]))(\d+)")
_DATASETS = {"openstreetmap": "osm", "foursquare": "fsq", "fsq": "fsq"}


def _refs(raw_sources: Any) -> set[str]:
    """Overture's `sources` → provider-qualified ids ("osm:w123", "fsq:4b…") of the records it was built from."""
    out: set[str] = set()
    for s in raw_sources or []:
        if not isinstance(s, dict):
            continue
        provider = _DATASETS.get(str(s.get("dataset") or "").lower())
        rid = str(s.get("record_id") or "")
        if not provider or not rid:
            continue
        if provider == "osm":
            m = _OSM_REF.match(rid)
            if m:
                out.add(f"osm:{(m.group(1) or m.group(2))[0]}{m.group(3)}")
        else:
            out.add(f"{provider}:{rid.split('@')[0]}")
    return out


def load_places(conn: psycopg.Connection, ids: list[str]) -> dict[str, P]:
    rows = conn.execute(
        """
        SELECT p.id::text AS id, p.name, p.name_norm, p.lat, p.lng, p.category_id::text AS category_id,
               coalesce(g.key, c.key) AS grp, nullif(p.address, '') AS address, p.phone, p.website, p.created_at,
               (SELECT count(*) FROM itinerary_items i WHERE i.place_id = p.id)
                 + (SELECT count(*) FROM saved_places sp WHERE sp.place_id = p.id)
                 + (SELECT count(*) FROM place_photos ph WHERE ph.place_id = p.id AND ph.status = 'APPROVED') AS links,
               coalesce(jsonb_agg(jsonb_build_object('provider', s.provider, 'id', s.external_id, 'names', s.normalized->'names_norm',
                                                     'sources', CASE WHEN s.provider = 'overture' THEN s.raw->'sources' END))
                        FILTER (WHERE s.id IS NOT NULL), '[]') AS recs
        FROM places p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories g ON g.id = c.parent_id
        LEFT JOIN place_sources s ON s.place_id = p.id
        WHERE p.id = ANY(%s::uuid[])
        GROUP BY p.id, g.key, c.key
        """,
        [ids],
    ).fetchall()
    out: dict[str, P] = {}
    for r in rows:
        p = P(
            id=r["id"],
            name=r["name"],
            names={n for n in [r["name_norm"] or normalize_search(r["name"])] if n},
            lat=r["lat"],
            lng=r["lng"],
            category_id=r["category_id"],
            group=r["grp"],
            address=r["address"],
            phone=r["phone"],
            website=r["website"],
            links=int(r["links"]),
            created_at=r["created_at"],
        )
        for rec in r["recs"]:
            p.sources += 1
            p.manual = p.manual or rec["provider"] == "manual"
            p.ids.setdefault(rec["provider"], set()).add(rec["id"])
            p.names.update(n for n in rec.get("names") or [] if n)
            p.refs |= _refs(rec.get("sources"))
        out[p.id] = p
    return out


# ── scoring ──────────────────────────────────────────────────────────────────


@dataclass
class Pair:
    a: str
    b: str
    distance_m: float
    score: float
    signals: dict[str, Any]
    blocked: str | None = None

    @property
    def key(self) -> tuple[str, str]:
        return (self.a, self.b) if self.a < self.b else (self.b, self.a)


def _metres(a: P, b: P) -> float:
    rad = math.radians
    h = math.sin(rad(b.lat - a.lat) / 2) ** 2 + math.cos(rad(a.lat)) * math.cos(rad(b.lat)) * math.sin(rad(b.lng - a.lng) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _qualified(p: P) -> set[str]:
    return {f"{prov}:{i}" for prov, ids in p.ids.items() for i in ids}


def score_pair(a: P, b: P, settings: Settings, distance_m: float | None = None) -> Pair | None:
    """None when the two aren't candidates at all (too far, and nothing ties them together)."""
    d = _metres(a, b) if distance_m is None else distance_m
    sure = None
    if d <= settings.merge_sure_m:
        if (a.refs & _qualified(b)) or (b.refs & _qualified(a)):
            sure = "external_id"
        elif a.phone and a.phone == b.phone:
            sure = "phone"
        elif _site(a.website) and _site(a.website) == _site(b.website):
            sure = "website"
    landmark = a.group in LANDMARK_GROUPS or b.group in LANDMARK_GROUPS
    radius = settings.merge_radius_landmark_m if landmark else settings.merge_radius_m
    if d > radius and not sure:
        return None
    signals: dict[str, Any] = {"name": round(name_score(a.names, b.names), 3), "distance": round(max(0.0, 1 - d / radius), 3), "distance_m": round(d, 1)}
    if a.category_id and b.category_id:
        signals["category"] = 1.0 if a.category_id == b.category_id else 0.5 if a.group and a.group == b.group else 0.0
    addr = address_score(a.address, b.address)
    if addr is not None:
        signals["address"] = addr
    used = {k: w for k, w in MERGE_WEIGHTS.items() if k in signals}
    score = sum(signals[k] * w for k, w in used.items()) / sum(used.values())
    if sure:
        signals["sure"] = sure
        score = 1.0
    blocked = None
    fa, fb = a.family(), b.family()
    if fa is not None and fb is not None and fa != fb:
        blocked = "different_kind"
    elif any(prov != "manual" and prov in b.ids and a.ids[prov] != b.ids[prov] for prov in a.ids):
        blocked = "same_provider"
    if blocked:
        signals["blocked"] = blocked
    return Pair(a.id, b.id, d, round(score, 4), signals, blocked)


# ── candidates ───────────────────────────────────────────────────────────────


def candidate_pairs(conn: psycopg.Connection, settings: Settings, ids: list[str]) -> list[tuple[str, str, float]]:
    """(a, b, metres) for the given places and their nearest active neighbours whose names or contacts look alike."""
    if not ids:
        return []
    r = max(settings.merge_radius_m, settings.merge_radius_landmark_m, settings.merge_sure_m)
    rows = conn.execute(
        """
        SELECT DISTINCT least(b.id, o.id)::text AS a, greatest(b.id, o.id)::text AS b, o.d
        FROM places b
        CROSS JOIN LATERAL (
          SELECT o.id, ST_Distance(o.location, b.location) AS d, o.name_norm, o.search_text, o.phone, o.website
          FROM places o
          WHERE o.id <> b.id AND o.status = 'ACTIVE' AND o.merged_into_id IS NULL AND ST_DWithin(o.location, b.location, %(r)s)
          ORDER BY o.location <-> b.location LIMIT 10
        ) o
        WHERE b.id = ANY(%(ids)s::uuid[]) AND b.status = 'ACTIVE' AND b.merged_into_id IS NULL AND b.location IS NOT NULL
          AND (similarity(o.name_norm, b.name_norm) > 0.25
               OR strpos(b.search_text, o.name_norm) > 0 OR strpos(o.search_text, b.name_norm) > 0
               OR (b.phone IS NOT NULL AND b.phone = o.phone) OR (b.website IS NOT NULL AND b.website = o.website)
               OR EXISTS (SELECT 1 FROM place_sources s1 JOIN place_sources s2 ON s2.place_id = CASE WHEN s1.place_id = b.id THEN o.id ELSE b.id END
                          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s1.raw->'sources') = 'array' THEN s1.raw->'sources' ELSE '[]' END) x
                          WHERE s1.place_id IN (b.id, o.id) AND s1.provider = 'overture'
                            AND split_part(x->>'record_id', '@', 1) = s2.external_id))
        """,
        {"ids": ids, "r": r},
    ).fetchall()
    return [(x["a"], x["b"], float(x["d"])) for x in rows]


def score_places(conn: psycopg.Connection, settings: Settings, ids: list[str]) -> list[Pair]:
    pairs = candidate_pairs(conn, settings, ids)
    places = load_places(conn, sorted({i for a, b, _ in pairs for i in (a, b)}))
    out = []
    for a, b, d in pairs:
        if a in places and b in places:
            p = score_pair(places[a], places[b], settings, d)
            if p:
                out.append(p)
    return sorted(out, key=lambda p: -p.score)


# ── merge / unmerge ──────────────────────────────────────────────────────────


def pick_winner(a: P, b: P) -> tuple[P, P]:
    """The place more of Golaly points at survives (itinerary items, saves, approved photos), then the one with more
    sources, a curated (manual) one, the older one. Same order as the database's catalog_pick_winner()."""
    ka = (-a.links, -a.sources, not a.manual, a.created_at, a.id)
    kb = (-b.links, -b.sources, not b.manual, b.created_at, b.id)
    return (a, b) if ka <= kb else (b, a)


def winner_of(conn: psycopg.Connection, a: str, b: str) -> tuple[str, str]:
    w = conn.execute("SELECT catalog_pick_winner(%s::uuid, %s::uuid)::text AS w", [a, b]).fetchone()["w"]  # type: ignore[index]
    return (w, b if w == a else a)


def merge(conn: psycopg.Connection, winner: str, loser: str, actor: str, score: float | None = None, signals: dict[str, Any] | None = None) -> str:
    """Move everything from `loser` to `winner` (the database function catalog_merge_places, shared with the admin
    API) in the caller's transaction. Returns the place_merges id; the winner is flagged needs_publish."""
    row = conn.execute(
        "SELECT catalog_merge_places(%s::uuid, %s::uuid, %s, %s, %s)::text AS id", [winner, loser, actor, score, db.jsonb(signals or {})]
    ).fetchone()
    assert row
    return row["id"]


def unmerge(conn: psycopg.Connection, settings: Settings, merge_id: str, actor: str) -> dict[str, Any]:
    """Undo a merge (catalog_unmerge): everything it moved goes back when it's still on the winner, the loser is a
    place again, and the pair is marked rejected so it isn't merged again automatically."""
    try:
        out = conn.execute("SELECT catalog_unmerge(%s::uuid, %s) AS r", [merge_id, actor]).fetchone()["r"]  # type: ignore[index]
    except psycopg.errors.RaiseException as e:
        conn.rollback()
        raise ValueError(str(e).split("\n")[0]) from e
    republish(conn, settings, [out["winner"], out["loser"]])
    return out


def republish(conn: psycopg.Connection, settings: Settings, place_ids: list[str]) -> None:
    """Recompute published fields, names and search text of places whose sources changed hands."""
    from .publish import refresh_names_and_search, refresh_places

    if not place_ids:
        return
    run = str(uuid.uuid4())
    conn.execute("UPDATE place_sources SET changed_run_id = %s::uuid WHERE place_id = ANY(%s::uuid[])", [run, place_ids])
    refresh_places(conn, settings, run)
    refresh_names_and_search(conn, settings, run)
    conn.execute("UPDATE places SET needs_publish = false WHERE id = ANY(%s::uuid[]) AND needs_publish", [place_ids])


def republish_dirty(conn: psycopg.Connection, settings: Settings, limit: int = 2000) -> int:
    """Places an admin merged or unmerged (needs_publish): recompute their fields. Run by catalog_scheduler."""
    ids = [r["id"] for r in conn.execute("SELECT id::text AS id FROM places WHERE needs_publish LIMIT %s", [limit]).fetchall()]
    republish(conn, settings, ids)
    return len(ids)


# ── a dedupe pass ────────────────────────────────────────────────────────────


def _decided(conn: psycopg.Connection, pairs: list[Pair]) -> dict[tuple[str, str], str]:
    if not pairs:
        return {}
    rows = conn.execute(
        """SELECT place_a::text AS a, place_b::text AS b, status::text AS status FROM merge_candidates
           WHERE (place_a, place_b) IN (SELECT * FROM unnest(%s::uuid[], %s::uuid[])) AND status <> 'PENDING'""",
        [[p.key[0] for p in pairs], [p.key[1] for p in pairs]],
    ).fetchall()
    return {(r["a"], r["b"]): r["status"] for r in rows}


def dedupe(conn: psycopg.Connection, settings: Settings, place_ids: list[str], actor: str = "auto") -> dict[str, Any]:
    """Score the places and their neighbours; merge sure/high pairs, queue the uncertain ones. Idempotent."""
    stats = {"pairs": 0, "merged": 0, "queued": 0, "blocked": 0}
    pairs = score_places(conn, settings, place_ids)
    stats["pairs"] = len(pairs)
    decided = _decided(conn, pairs)
    gone: set[str] = set()
    winners: set[str] = set()
    for p in pairs:
        if p.key in decided or p.a in gone or p.b in gone or p.score < settings.merge_review:
            continue
        if p.score >= settings.merge_auto and not p.blocked:
            w, lose = winner_of(conn, p.a, p.b)
            merge(conn, w, lose, actor, p.score, p.signals)
            gone.add(lose)
            winners.add(w)
            stats["merged"] += 1
            continue
        stats["blocked"] += int(bool(p.blocked))
        a, b = p.key
        conn.execute(
            """INSERT INTO merge_candidates (id, place_a, place_b, score, signals) VALUES (gen_random_uuid(), %s::uuid, %s::uuid, %s, %s)
               ON CONFLICT (place_a, place_b) DO UPDATE SET score = EXCLUDED.score, signals = EXCLUDED.signals, updated_at = now()
               WHERE merge_candidates.status = 'PENDING'
                 AND (merge_candidates.score, merge_candidates.signals) IS DISTINCT FROM (EXCLUDED.score, EXCLUDED.signals)""",
            [a, b, p.score, db.jsonb(p.signals)],
        )
        stats["queued"] += 1
    republish(conn, settings, sorted(winners - gone))
    return stats


def place_ids_in(conn: psycopg.Connection, boxes: list[tuple[float, float, float, float]]) -> list[str]:
    ids: list[str] = []
    for x0, y0, x1, y1 in boxes:
        ids += [
            r["id"]
            for r in conn.execute(
                """SELECT id::text AS id FROM places WHERE status = 'ACTIVE' AND merged_into_id IS NULL
                   AND lng BETWEEN %s AND %s AND lat BETWEEN %s AND %s ORDER BY id""",
                [x0, x1, y0, y1],
            ).fetchall()
        ]
    return list(dict.fromkeys(ids))


# ── review & evaluation tools ────────────────────────────────────────────────

SAMPLE_FIELDS = [
    "pair",
    "score",
    "decision",
    "label",
    "distance_m",
    "name_a",
    "name_b",
    "category_a",
    "category_b",
    "address_a",
    "address_b",
    "signals",
    "place_a",
    "place_b",
]


def sample(conn: psycopg.Connection, settings: Settings, place_ids: list[str], n: int, path: str) -> dict[str, int]:
    """Write `n` scored pairs to a CSV for hand labelling (fill `label` with same / different), spread over the
    score bands so precision and recall can both be measured: auto-merge, review, and below review."""
    pairs = [p for p in score_places(conn, settings, place_ids) if p.score >= 0.3]
    merged = conn.execute(
        """SELECT winner_id::text AS a, loser_id::text AS b, score, signals FROM place_merges
           WHERE undone_at IS NULL AND (winner_id = ANY(%(ids)s::uuid[]) OR loser_id = ANY(%(ids)s::uuid[]))""",
        {"ids": place_ids},
    ).fetchall()
    for m in merged:  # already merged pairs count as "auto" decisions
        pairs.append(Pair(m["a"], m["b"], float(m["signals"].get("distance_m", 0)), float(m["score"] or 1), m["signals"]))
    bands: dict[str, list[Pair]] = {"auto": [], "review": [], "below": []}
    for p in pairs:
        bands["auto" if p.score >= settings.merge_auto and not p.blocked else "review" if p.score >= settings.merge_review else "below"].append(p)
    per = max(1, n // 3)
    chosen: list[tuple[str, Pair]] = []
    for band in ("auto", "review", "below"):
        group = sorted(bands[band], key=lambda p: p.key)
        step = max(1, len(group) // per) if group else 1
        chosen += [(band, p) for p in group[::step][:per]]
    names = {
        r["id"]: r
        for r in conn.execute(
            """SELECT p.id::text AS id, p.name, p.address, c.key AS category FROM places p LEFT JOIN categories c ON c.id = p.category_id
               WHERE p.id = ANY(%s::uuid[])""",
            [sorted({i for _, p in chosen for i in (p.a, p.b)})],
        ).fetchall()
    }
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, SAMPLE_FIELDS)
        w.writeheader()
        for band, p in chosen:
            a, b = names.get(p.a, {}), names.get(p.b, {})
            w.writerow(
                {
                    "pair": f"{p.key[0]}:{p.key[1]}",
                    "score": p.score,
                    "decision": band,
                    "label": "",
                    "distance_m": round(p.distance_m, 1),
                    "name_a": a.get("name"),
                    "name_b": b.get("name"),
                    "category_a": a.get("category"),
                    "category_b": b.get("category"),
                    "address_a": a.get("address"),
                    "address_b": b.get("address"),
                    "signals": {k: v for k, v in p.signals.items()},
                    "place_a": p.a,
                    "place_b": p.b,
                }
            )
    return {band: sum(1 for b, _ in chosen if b == band) for band in bands}


def evaluate(path: str, thresholds: Iterable[float] = (0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95)) -> dict[str, Any]:
    """Precision / recall of "merge when score ≥ t" on a labelled sample (label: same / different; blank rows skipped)."""
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            label = (r.get("label") or "").strip().lower()
            if label in ("same", "s", "1", "yes", "y", "different", "d", "0", "no", "n"):
                blocked = "blocked" in (r.get("signals") or "")
                rows.append((float(r["score"]), label in ("same", "s", "1", "yes", "y"), blocked))
    same = sum(1 for _, s, _ in rows if s)
    out: dict[str, Any] = {"labelled": len(rows), "same": same, "thresholds": []}
    for t in thresholds:
        pred = [(s, b) for score, s, b in rows if score >= t and not b]
        tp = sum(1 for s, _ in pred if s)
        out["thresholds"].append(
            {"threshold": t, "merged": len(pred), "precision": round(tp / len(pred), 3) if pred else None, "recall": round(tp / same, 3) if same else None}
        )
    return out
