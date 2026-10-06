"""`triply-catalog` command line.

triply-catalog bootstrap                        # taxonomy + adopt existing (seed/manual) places
triply-catalog boundaries --country VN          # country + provinces from Overture divisions
triply-catalog sync --area hoi-an               # Overture + OSM for a destination / geo area
triply-catalog sync --area vn --providers overture,osm
triply-catalog sync --area hoi-an --dry-run     # full run, rolled back: shows what would change
triply-catalog sync --area hoi-an --photos      # then look for photos of new/changed places (as Airflow does)
triply-catalog photos --area hoi-an             # photos for every place in the area (--only-due: incremental)
triply-catalog sources                          # registered sources, their licences and configuration state
triply-catalog dedupe --area hoi-an [--dry-run]  # find duplicates among an area's places (sync does this for what it touched)
triply-catalog merges list --area hoi-an        # pairs waiting for review
triply-catalog merges decide <candidate-id> merge|reject
triply-catalog merges undo <merge-id>           # put a merge back exactly as it was
triply-catalog merges sample --area hoi-an --n 200 --out pairs.csv   # pairs to label by hand (same / different)
triply-catalog merges evaluate pairs.csv        # precision / recall per threshold on the labelled pairs
triply-catalog stats
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from typing import Any

from . import db
from .boundaries import import_boundaries
from .config import settings as load_settings
from .photos import sync_photos
from .pipeline import ScopeError, adopt_manual_places, run_sync
from .publish import publish
from .sources import SourceConfigError, SourceRefused, check_keys, check_ready, keys
from .sources import status as source_status
from .taxonomy import sync_taxonomy


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="triply-catalog", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("bootstrap", help="taxonomy + adopt existing places")
    b = sub.add_parser("boundaries", help="import country/province boundaries from Overture divisions")
    b.add_argument("--country", default="VN")
    s = sub.add_parser("sync", help="import places for an area")
    s.add_argument("--area", help="geo area slug (vn, vn-da-nang) or destination slug (hoi-an)")
    s.add_argument("--bbox", help="minLng,minLat,maxLng,maxLat")
    s.add_argument("--providers", default=",".join(keys("places")), help="place sources (see `triply-catalog sources`)")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--photos", action="store_true", help="afterwards, look for photos of places that are new, renamed, moved or due")
    ph = sub.add_parser("photos", help="queue openly licensed photos (Wikimedia Commons) for places in an area")
    ph.add_argument("--area", help="geo area slug (vn, vn-da-nang) or destination slug (hoi-an)")
    ph.add_argument("--bbox", help="minLng,minLat,maxLng,maxLat")
    ph.add_argument("--source", default="wikimedia", help="photo source (see `triply-catalog sources`)")
    ph.add_argument("--only-due", action="store_true", help="only places never checked, renamed, moved, or checked long ago")
    ph.add_argument("--dry-run", action="store_true")
    sub.add_parser("sources", help="registered sources: what they provide, licence, storage, configuration problems")
    dd = sub.add_parser("dedupe", help="score possible duplicates among an area's places; merge sure ones, queue the rest")
    dd.add_argument("--area")
    dd.add_argument("--bbox")
    dd.add_argument("--dry-run", action="store_true")
    mg = sub.add_parser("merges", help="review duplicate candidates, undo merges, measure the matching")
    msub = mg.add_subparsers(dest="action", required=True)
    ml = msub.add_parser("list")
    ml.add_argument("--area")
    ml.add_argument("--bbox")
    ml.add_argument("--status", default="PENDING", choices=["PENDING", "MERGED", "REJECTED"])
    ml.add_argument("--limit", type=int, default=50)
    md = msub.add_parser("decide")
    md.add_argument("candidate")
    md.add_argument("decision", choices=["merge", "reject"])
    mu = msub.add_parser("undo")
    mu.add_argument("merge")
    ms = msub.add_parser("sample")
    ms.add_argument("--area")
    ms.add_argument("--bbox")
    ms.add_argument("--n", type=int, default=200)
    ms.add_argument("--out", default="merge_pairs.csv")
    me = msub.add_parser("evaluate")
    me.add_argument("labels")
    sub.add_parser("stats", help="catalog counts")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_settings()

    try:
        if args.cmd == "bootstrap":
            with db.connect(cfg.database_url) as conn:
                out = sync_taxonomy(conn)
                run_id = str(uuid.uuid4())
                out["adopted"] = adopt_manual_places(conn, run_id)
                out["publish"] = publish(conn, cfg, run_id, ["manual"], require_area=False)
                conn.commit()
        elif args.cmd == "boundaries":
            with db.connect(cfg.database_url) as conn:
                out = import_boundaries(conn, cfg, args.country.upper())
        elif args.cmd == "sync":
            providers = [p.strip() for p in args.providers.split(",") if p.strip()]
            if args.photos:  # fail before the sync rather than after it
                check_ready(check_keys(["wikimedia"], "photos"), cfg)
            out = run_sync(cfg, args.area, args.bbox, providers, dry_run=args.dry_run)
            scope = out.pop("photo_scope", None)
            if args.photos and not args.dry_run:
                out["photos"] = sync_photos(cfg, bbox=scope["bbox"], areas=scope["areas"], only_due=True, after_sync=out["run_id"]) if scope else None
        elif args.cmd == "photos":
            out = sync_photos(cfg, args.area, args.bbox, dry_run=args.dry_run, source=args.source, only_due=args.only_due)
        elif args.cmd == "sources":
            out = source_status(cfg)
        elif args.cmd == "dedupe":
            out = run_dedupe(cfg, args.area, args.bbox, args.dry_run)
        elif args.cmd == "merges":
            out = run_merges(cfg, args)
        else:
            with db.connect(cfg.database_url) as conn:
                out = conn.execute(
                    """SELECT (SELECT count(*) FROM places) AS places,
                              (SELECT count(*) FROM places WHERE status = 'ACTIVE' AND merged_into_id IS NULL) AS active,
                              (SELECT count(*) FROM place_sources) AS sources,
                              (SELECT json_object_agg(provider, n) FROM (SELECT provider, count(*) n FROM place_sources GROUP BY 1) x) AS by_provider,
                              (SELECT count(*) FROM place_sources WHERE category_id IS NULL) AS unmapped,
                              (SELECT count(*) FROM geo_areas) AS areas,
                              (SELECT json_object_agg(st, n) FROM (SELECT status::text AS st, count(*) n FROM place_photos GROUP BY 1) x) AS photos,
                              (SELECT count(*) FROM place_photos
                               WHERE media_id IS NULL AND remote_url IS NOT NULL AND status <> 'HIDDEN') AS photos_to_download"""
                ).fetchone()
    except (ScopeError, SourceConfigError, SourceRefused, PermissionError, LookupError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


def _scope_ids(conn: Any, cfg: Any, area: str | None, bbox: str | None) -> list[str]:
    from .dedupe import place_ids_in
    from .pipeline import resolve_scope

    parts, _ = resolve_scope(conn, cfg, area, bbox)
    return place_ids_in(conn, [(p.bbox.min_lng, p.bbox.min_lat, p.bbox.max_lng, p.bbox.max_lat) for p in parts])


def run_dedupe(cfg: Any, area: str | None, bbox: str | None, dry_run: bool) -> dict[str, Any]:
    from .dedupe import dedupe

    with db.connect(cfg.database_url) as conn:
        ids = _scope_ids(conn, cfg, area, bbox)
        totals: dict[str, Any] = {"places": len(ids), "dry_run": dry_run}
        for i in range(0, len(ids), 2000):  # one transaction per chunk, so a country-wide pass can be interrupted
            for k, v in dedupe(conn, cfg, ids[i : i + 2000], actor="cli").items():
                totals[k] = totals.get(k, 0) + v
            conn.rollback() if dry_run else conn.commit()
    return totals


def run_merges(cfg: Any, args: Any) -> Any:
    from . import dedupe

    if args.action == "evaluate":
        return dedupe.evaluate(args.labels)
    with db.connect(cfg.database_url) as conn:
        if args.action == "list":
            ids = _scope_ids(conn, cfg, args.area, args.bbox) if (args.area or args.bbox) else None
            return conn.execute(
                """SELECT m.id::text AS id, m.score, m.signals, a.name AS name_a, b.name AS name_b, m.place_a::text AS place_a, m.place_b::text AS place_b
                   FROM merge_candidates m JOIN places a ON a.id = m.place_a JOIN places b ON b.id = m.place_b
                   WHERE m.status = %(status)s::"MergeStatus" AND a.merged_into_id IS NULL AND b.merged_into_id IS NULL
                     AND (%(ids)s::uuid[] IS NULL OR m.place_a = ANY(%(ids)s::uuid[]) OR m.place_b = ANY(%(ids)s::uuid[]))
                   ORDER BY m.score DESC LIMIT %(limit)s""",
                {"status": args.status, "ids": ids, "limit": args.limit},
            ).fetchall()
        if args.action == "decide":
            c = conn.execute(
                "SELECT place_a::text AS a, place_b::text AS b, score, signals, status::text AS status FROM merge_candidates WHERE id = %s::uuid",
                [args.candidate],
            ).fetchone()
            if not c:
                raise LookupError(f"no candidate {args.candidate}")
            if c["status"] != "PENDING":
                raise LookupError(f"candidate {args.candidate} is already {c['status']}")
            if args.decision == "reject":
                conn.execute(
                    "UPDATE merge_candidates SET status = 'REJECTED', decided_by = 'cli', decided_at = now(), updated_at = now() WHERE id = %s::uuid",
                    [args.candidate],
                )
                conn.commit()
                return {"candidate": args.candidate, "status": "REJECTED"}
            places = dedupe.load_places(conn, [c["a"], c["b"]])
            if len(places) < 2:
                raise LookupError("one of the two places no longer exists")
            w, lose = dedupe.pick_winner(places[c["a"]], places[c["b"]])
            merge_id = dedupe.merge(conn, w.id, lose.id, "cli", c["score"], c["signals"])
            dedupe.republish(conn, cfg, [w.id])
            conn.commit()
            return {"candidate": args.candidate, "status": "MERGED", "merge": merge_id, "winner": w.id, "loser": lose.id}
        if args.action == "undo":
            try:
                out = dedupe.unmerge(conn, cfg, args.merge, "cli")
            except ValueError as e:
                raise LookupError(str(e)) from e
            conn.commit()
            return out
        ids = _scope_ids(conn, cfg, args.area, args.bbox)
        return {"written": args.out, **dedupe.sample(conn, cfg, ids, args.n, args.out)}


if __name__ == "__main__":
    sys.exit(main())
