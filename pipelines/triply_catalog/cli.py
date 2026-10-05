"""`triply-catalog` command line.

triply-catalog bootstrap                        # taxonomy + adopt existing (seed/manual) places
triply-catalog boundaries --country VN          # country + provinces from Overture divisions
triply-catalog sync --area hoi-an               # Overture + OSM for a destination / geo area
triply-catalog sync --area vn --providers overture,osm
triply-catalog sync --area hoi-an --dry-run     # full run, rolled back: shows what would change
triply-catalog sync --area hoi-an --photos      # then look for photos of new/changed places (as Airflow does)
triply-catalog photos --area hoi-an             # photos for every place in the area (--only-due: incremental)
triply-catalog sources                          # registered sources, their licences and configuration state
triply-catalog stats
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid

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
    except (ScopeError, SourceConfigError, SourceRefused, PermissionError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
