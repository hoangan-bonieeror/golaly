"""`triply-catalog` command line.

triply-catalog bootstrap                        # taxonomy + adopt existing (seed/manual) places
triply-catalog boundaries --country VN          # country + provinces from Overture divisions
triply-catalog sync --area hoi-an               # Overture + OSM for a destination / geo area
triply-catalog sync --area vn --providers overture,osm
triply-catalog sync --area hoi-an --dry-run     # full run, rolled back: shows what would change
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
from .pipeline import ScopeError, adopt_manual_places, run_sync
from .publish import publish
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
    s.add_argument("--providers", default="overture,osm")
    s.add_argument("--dry-run", action="store_true")
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
            out = run_sync(cfg, args.area, args.bbox, providers, dry_run=args.dry_run)
        else:
            with db.connect(cfg.database_url) as conn:
                out = conn.execute(
                    """SELECT (SELECT count(*) FROM places) AS places,
                              (SELECT count(*) FROM places WHERE status = 'ACTIVE' AND merged_into_id IS NULL) AS active,
                              (SELECT count(*) FROM place_sources) AS sources,
                              (SELECT json_object_agg(provider, n) FROM (SELECT provider, count(*) n FROM place_sources GROUP BY 1) x) AS by_provider,
                              (SELECT count(*) FROM place_sources WHERE category_id IS NULL) AS unmapped,
                              (SELECT count(*) FROM geo_areas) AS areas"""
                ).fetchone()
    except ScopeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
