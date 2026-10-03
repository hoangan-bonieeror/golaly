# triply-catalog — place catalog pipeline

Imports places (sights, restaurants, cafés, hotels…) from **open data** into the TRIPLY database, for whichever
country, province or destination an admin chooses. Python + DuckDB + PostGIS, orchestrated by Airflow, and also
runnable as a plain CLI.

| Source | What we use | License | Stored |
|---|---|---|---|
| [Overture Maps](https://docs.overturemaps.org/) `places`, `divisions` | names (many languages), category, phone, website, address; province/country boundaries | CDLA-Permissive 2.0 (places), ODbL (divisions) | yes |
| [OpenStreetMap](https://www.openstreetmap.org/) via [Geofabrik](https://download.geofabrik.de/asia/vietnam.html) | names (`name:xx`), tags → category, opening hours, precise coordinates | ODbL — attribution “© OpenStreetMap contributors” | yes |
| App seed / admin edits | provider `manual` | — | yes |

The design (data model, matching rules, survivorship, Airflow layout, later phases) is in the TRIPLY design doc
“Thiết kế: Catalog địa điểm & công cụ đồng bộ dữ liệu”.

## How it works

```
             ┌─────────── extract_load (one task per provider × province) ───────────┐
start → plan ┤ Overture: DuckDB reads GeoParquet straight from S3, bbox + confidence  ├→ finalize → finish
             │ OSM: pyosmium streams the Geofabrik .pbf (downloaded once, cached)     │
             └──── normalize → COPY into place_sources (upsert by provider+id) ───────┘
```

1. **Raw layer – `place_sources`**: one row per record per provider, with the raw payload, a normalised form and a
   content hash. Re-importing unchanged data writes nothing.
2. **Publish – `places`**: a source record is attached to an existing place when one of its names matches (accents
   and case ignored, all languages) within 50 m and that place has no record from the same provider; otherwise it
   creates a place. Existing place ids never change, so itineraries keep working.
3. **Survivorship**: each field comes from the best source that has it (`FIELD_PRIORITY` in `config.py`) — e.g. name
   from manual → Overture → OSM, opening hours from OSM. Admins can lock fields (`places.locked_fields`).
   `places.field_sources` records where each value came from.
4. **Names by locale**: every name variant goes to `place_names (lang)`; the app shows the one matching the device
   locale and searches across all of them.
5. **Closures**: a record missing from 3 complete runs (or marked closed upstream) closes the place
   (`status = CLOSED`, never deleted). If a run would close more than 10 % of a scope at once, nothing is closed and
   the run ends as `needs_review` — usually a truncated file or a wrong bbox.

## Run it on your machine

Needs Docker (PostGIS), Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/), internet access to
`overturemaps-us-west-2.s3.amazonaws.com` and `download.geofabrik.de`.

```bash
# from the repo root: PostGIS + migrations (once)
docker compose up -d db
npm run db:deploy

cd pipelines
uv sync --extra dev
export DATABASE_URL=postgresql://triply:triply@localhost:5432/triply   # same as apps/api/.env

uv run triply-catalog bootstrap              # taxonomy + adopt the app's existing places (source "manual")
uv run triply-catalog boundaries --country VN   # country + 34 provinces from Overture divisions
uv run triply-catalog sync --area hoi-an --dry-run   # counts only, writes nothing
uv run triply-catalog sync --area hoi-an     # one destination (≈ minutes; downloads the Vietnam .pbf once, ~300 MB)
uv run triply-catalog sync --area vn         # all of Vietnam, one partition per province
uv run triply-catalog stats
```

### Photos (Wikimedia Commons)

```bash
export CATALOG_CONTACT="https://github.com/<you>/triply"   # required: a URL or email (Wikimedia answers 403 without one)
uv run triply-catalog photos --area hoi-an --dry-run   # what would be queued
uv run triply-catalog photos --area hoi-an             # queue them (then the API downloads them)
npm run build -w @triply/api && npm run photos:ingest -w @triply/api   # optional: download now instead of waiting
```

`CATALOG_CONTACT` is required by [Wikimedia's User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy):
requests that don't say how to reach the operator get **403 "Please respect our robot policy"**. The command refuses to
start without it; the API needs the same variable (in `apps/api/.env`, or the root `.env` for Docker) to download
the queued photos. In PowerShell: `$env:CATALOG_CONTACT = "https://github.com/<you>/triply"`.

How it works: one Wikidata query per province/box finds items with coordinates, a main image (P18) or a Commons
category (P373), and their names in vi/en/fr/de/ja/ko/zh. Each item is matched to **one** place, exactly through an
OpenStreetMap `wikidata=Q…` tag, or by name (accents ignored, any language) to the nearest place: within 100 m it is
published, up to 300 m it waits in the moderation queue (`/admin/photos`). From Commons it keeps the main image plus up
to 3 large landscape *Quality / Featured / Valued* images from the category, and only free licences that allow
commercial use and changes (CC0, public domain, CC BY, CC BY-SA). Author, licence and source are stored and shown
next to every photo. The pipeline writes rows to `place_photos` with a `remote_url`; the API's ingester downloads
them (only from `upload.wikimedia.org`, https, no redirects, size-capped) into TRIPLY's own media in three WebP sizes.
Re-runs refresh credits, keep moderators' decisions and hide files whose licence changed. Airflow: DAG
`catalog_photos` with `{"area": "vn"}`.

Expect landmarks, temples, museums, beaches and markets to get photos; small cafés and restaurants mostly won't —
traveler uploads (place page → *Add photo*, or *Also show on place pages* when posting) fill that gap.

`--area` accepts a geo area slug (`vn`, `vn-da-nang`, `vn-ha-noi`), a destination slug (`hoi-an` → its point ± 15 km)
or use `--bbox minLng,minLat,maxLng,maxLat`. `--providers overture` limits the sources.

### With Airflow (docker compose)

```bash
docker compose --profile pipelines up -d --build      # Airflow UI → http://localhost:8080 (local dev: no login)
docker compose --profile pipelines run --rm catalog bootstrap
docker compose --profile pipelines run --rm catalog boundaries --country VN
```

`pipelines/dags/` and `pipelines/triply_catalog/` are mounted into the containers, so code changes apply without a
rebuild (restart the `airflow` service to reload the package). Rebuild (`docker compose --profile pipelines up -d --build`)
only when dependencies in `pyproject.toml` change. Set `CATALOG_CONTACT` in the root `.env` for the photos step.

In the UI trigger **catalog_sync** with config `{"area": "vn", "providers": ["overture", "osm"]}`, or from the API:

```bash
curl -X POST http://localhost:8080/api/v2/dags/catalog_sync/dagRuns \
  -H 'Content-Type: application/json' -d '{"logical_date": null, "conf": {"area": "hoi-an"}}'
```

Each province is a separate mapped task (retried on its own); progress and results are also written to the
`sync_runs` table, which the admin screen reads.

## Configuration

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | — | the app database |
| `OVERTURE_RELEASE` | `2026-09-23.1` | pin a release; see [releases](https://docs.overturemaps.org/release/latest/) |
| `OVERTURE_BASE` | `s3://overturemaps-us-west-2/release` | or a local folder with the same layout |
| `OVERTURE_MIN_CONFIDENCE` | `0.6` | Overture's own existence confidence |
| `OSM_SOURCE` | Geofabrik Vietnam `.pbf` URL | or a local `.pbf`/`.osm` file |
| `CATALOG_DATA_DIR` | `./data` | download cache |
| `CATALOG_CONTACT` | — | URL or email put in the User-Agent sent to Wikidata/Commons (please set it) |
| `CATALOG_PHOTO_MATCH_METERS` / `CATALOG_PHOTO_REVIEW_METERS` | `100` / `300` | name matches publish / go to review |
| `CATALOG_PHOTOS_PER_PLACE` | `4` | main image + quality images per place |

Category mapping lives in `triply_catalog/data/taxonomy.json` (TRIPLY's categories, vi/en labels) and
`category_maps.json` (Overture category / OSM tag → TRIPLY category). Unmapped records are stored but not published;
`triply-catalog stats` shows how many.

## Tests

```bash
uv run pytest            # unit + end-to-end (needs PostgreSQL with PostGIS and Node.js for the app seed)
TEST_DATABASE_URL=postgresql://triply:triply@localhost:5432/triply_catalog_test uv run pytest
uv run ruff check . && uv run ruff format --check .
```

The end-to-end tests run against **synthetic fixtures** (`tests/fixtures/make_fixtures.py` — invented records shaped
like Overture GeoParquet and OSM XML around Hội An), so they need no network. They check: seed places adopted with
their ids, cross-source matching (incl. a name only in another language), survivorship, a second run writing nothing,
itineraries untouched, dry runs, locked fields, closing after 3 missed runs, the safety brake and re-opening.
`test_pipeline_photos.py` runs the photo step against a fake Wikidata/Commons (httpx MockTransport): exact and name
matches, the review distance, licence filtering, category quality images, idempotent re-runs, kept moderation decisions
and licence changes. `normalize_search` is checked against the same cases as the app's TypeScript (`packages/shared/fixtures/normalize-cases.json`).
