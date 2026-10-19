"""Golaly place catalog DAGs.

catalog_sync       start → plan → extract_load (one mapped task per provider × partition) → finalize → finish
catalog_bootstrap  taxonomy + adopt seed places → country/province boundaries
catalog_scheduler  every 10 minutes: start the sync_jobs whose cron schedule is due; republish places an admin merged;
                   recount unmapped source categories after syncs
catalog_dry_run    a sync in one rolled-back transaction: what a job would change (the admin's "Dry run" button)
catalog_photos     queue openly licensed photos (Wikimedia Commons) for an area's places; the API downloads them.
                   Runs by itself after a sync (Asset golaly://catalog/places) for the places that need it, or by hand.

Trigger catalog_sync from the Airflow UI ("Trigger DAG w/ config") or the REST API:

    POST /api/v2/dags/catalog_sync/dagRuns   {"logical_date": null, "conf": {"area": "hoi-an", "providers": ["overture", "osm"]}}

The work itself lives in the `golaly_catalog` package (also runnable without Airflow: `golaly-catalog sync --area hoi-an`).
Airflow only adds scheduling, retries per partition, parallelism and a UI. Every step is idempotent, so a retried
task or a re-run DAG never duplicates data.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

try:  # Airflow 3
    from airflow.sdk import Asset, Param, dag, get_current_context, task
except ImportError:  # Airflow 2.x
    from airflow.datasets import Dataset as Asset
    from airflow.decorators import dag, task
    from airflow.models.param import Param
    from airflow.operators.python import get_current_context

from airflow.exceptions import AirflowFailException, AirflowSkipException

try:
    from airflow.task.trigger_rule import TriggerRule
except ImportError:  # Airflow 2.x
    from airflow.utils.trigger_rule import TriggerRule

log = logging.getLogger(__name__)

#: Emitted by catalog_sync when places were published that need photos; catalog_photos is scheduled on it.
#: extra = {"areas": [...], "bbox": str | None, "sync_run_id": str}
PLACES = Asset("golaly://catalog/places")

try:  # the registry is cheap to read (no DuckDB/pyosmium import); fall back if the package isn't importable here
    from golaly_catalog.sources import keys as _source_keys

    PLACE_SOURCES = _source_keys("places")
    DEFAULT_SOURCES = _source_keys("places", default_only=True)
except Exception:  # pragma: no cover
    PLACE_SOURCES = DEFAULT_SOURCES = ["overture", "osm"]

DEFAULT_ARGS = {"owner": "golaly", "retries": 2, "retry_delay": timedelta(minutes=2)}


def _settings():
    from golaly_catalog.config import settings

    return settings()


def _ids(values: Any) -> list[Any]:
    """Mapped-task XComs arrive as a lazy sequence; failed map indexes are simply absent."""
    return [v for v in (values or []) if v is not None]


@dag(
    dag_id="catalog_sync",
    description="Import places for a country/province/destination from open data (Overture Maps, OpenStreetMap)",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,  # one writer at a time; the CLI uses an advisory lock for the same reason
    default_args=DEFAULT_ARGS,
    tags=["golaly", "catalog"],
    params={
        "area": Param("hoi-an", type=["null", "string"], description="geo area slug (vn, vn-da-nang) or destination slug (hoi-an)"),
        "bbox": Param(None, type=["null", "string"], description="minLng,minLat,maxLng,maxLat — instead of area"),
        "providers": Param(
            list(DEFAULT_SOURCES), type="array", items={"type": "string", "enum": PLACE_SOURCES}, description="place sources (registry: golaly_catalog/sources)"
        ),
        "sync_run_id": Param(None, type=["null", "string"], description="existing sync_runs.id (set by the admin API); created if empty"),
        "photos": Param(True, type="boolean", description="afterwards, look for photos of the places that need it (catalog_photos)"),
        "category_keys": Param([], type="array", items={"type": "string"}, description="only these Golaly groups/categories (empty = all)"),
    },
    render_template_as_native_obj=True,
)
def catalog_sync():
    @task
    def start() -> str:
        from golaly_catalog import db, pipeline

        p = get_current_context()["params"]
        if not p.get("area") and not p.get("bbox"):
            raise ValueError("set either 'area' or 'bbox'")
        if p.get("sync_run_id"):
            # A run queued by the admin API / scheduler, or one being resumed (its finished partitions are skipped).
            from golaly_catalog.taxonomy import sync_taxonomy

            with db.connect(_settings().database_url) as conn:
                sync_taxonomy(conn)
                pipeline.reopen_run(conn, p["sync_run_id"])
            return p["sync_run_id"]
        return pipeline.start(_settings(), {k: p.get(k) for k in ("area", "bbox", "providers", "category_keys")}, "airflow")

    @task
    def plan(sync_id: str) -> list[dict[str, Any]]:
        from golaly_catalog import pipeline

        p = get_current_context()["params"]
        return pipeline.plan(_settings(), sync_id, p.get("area"), p.get("bbox"), list(p["providers"]), list(p.get("category_keys") or []))

    @task(max_active_tis_per_dagrun=4, execution_timeout=timedelta(hours=2), map_index_template="{{ partition_label }}")
    def extract_load(sync_id: str, part: dict[str, Any]) -> dict[str, Any]:
        from golaly_catalog import db, pipeline

        key = f"{part['provider']}/{part['key']}"
        get_current_context()["partition_label"] = key  # shown instead of the map index in the UI
        try:
            return {"key": key, **pipeline.extract_load(_settings(), sync_id, part)}
        except db.Cancelled as e:
            raise AirflowFailException(str(e)) from e  # no retries

    @task(trigger_rule=TriggerRule.ALL_DONE, retries=0)
    def finalize(sync_id: str, parts: list[dict[str, Any]], loaded: Any) -> dict[str, Any]:
        from golaly_catalog import pipeline

        done = _ids(loaded)
        complete = len(done) == len(parts)
        # A failed partition means we didn't see everything: publish what we have, but don't count anything as missing.
        stats = pipeline.finalize(_settings(), sync_id, parts, list(get_current_context()["params"]["providers"]), complete=complete)
        stats["loaded"] = {d["key"]: {k: v for k, v in d.items() if k != "key"} for d in done}
        if not complete:
            stats["status"] = "partial"
            stats["failed_partitions"] = len(parts) - len(done)
        return stats

    @task(trigger_rule=TriggerRule.ALL_DONE, retries=1)
    def finish(sync_id: str, stats: dict[str, Any] | None) -> dict[str, Any]:
        from golaly_catalog import pipeline

        if not stats:
            pipeline.finish(_settings(), sync_id, "failed", {}, "finalize failed — see the Airflow task log")
            raise RuntimeError("catalog_sync failed")
        if pipeline.cancel_requested(_settings(), sync_id):
            stats["status"] = "cancelled"  # what was loaded before the stop is published; nothing counts as missing
        pipeline.finish(_settings(), sync_id, stats["status"], stats)
        return stats

    @task(outlets=[PLACES], retries=1)
    def announce(sync_id: str, parts: list[dict[str, Any]], stats: dict[str, Any]) -> dict[str, Any]:
        """One task (not the mapped ones) emits the Asset event that starts catalog_photos. Skipped — no event —
        when photos are turned off, no area finished, or no place in the finished areas needs checking."""
        from golaly_catalog import photos, pipeline

        ctx = get_current_context()
        p = ctx["params"]
        if not p.get("photos", True):
            raise AirflowSkipException("photos: false")
        if stats.get("status") == "cancelled":
            raise AirflowSkipException("the run was cancelled")
        scope = pipeline.photo_scope(p.get("area"), p.get("bbox"), parts, set(stats.get("loaded", {})))
        if not scope:
            raise AirflowSkipException("no area was fully synced")
        due = photos.count_due(_settings(), scope["areas"], scope["bbox"])
        if not due:
            raise AirflowSkipException("no place needs its photos checked")
        extra = {**scope, "sync_run_id": sync_id, "places_due": due}
        ctx["outlet_events"][PLACES].extra = extra
        return extra

    sync_id = start()
    parts = plan(sync_id)
    loaded = extract_load.partial(sync_id=sync_id).expand(part=parts)
    announce(sync_id, parts, finish(sync_id, finalize(sync_id, parts, loaded)))


@dag(
    dag_id="catalog_bootstrap",
    description="Category taxonomy, adopt the app's existing places, import country/province boundaries",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    tags=["golaly", "catalog"],
    params={"country": Param("VN", type="string", minLength=2, maxLength=2)},
)
def catalog_bootstrap():
    @task
    def taxonomy_and_seed() -> dict[str, Any]:
        import uuid

        from golaly_catalog import db, pipeline, publish, taxonomy

        s = _settings()
        with db.connect(s.database_url) as conn:
            out: dict[str, Any] = taxonomy.sync_taxonomy(conn)
            sync_id = str(uuid.uuid4())
            out["adopted"] = pipeline.adopt_manual_places(conn, sync_id)
            out["publish"] = publish.publish(conn, s, sync_id, ["manual"], require_area=False)
            conn.commit()
        return out

    @task
    def boundaries(_: dict[str, Any]) -> dict[str, int]:
        from golaly_catalog import boundaries as b
        from golaly_catalog import db

        s = _settings()
        with db.connect(s.database_url) as conn:
            return b.import_boundaries(conn, s, get_current_context()["params"]["country"].upper())

    boundaries(taxonomy_and_seed())


@dag(
    dag_id="catalog_scheduler",
    description="Start the sync jobs whose schedule is due; republish places an admin merged or unmerged",
    schedule="*/10 * * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args={**DEFAULT_ARGS, "retries": 0},
    tags=["golaly", "catalog"],
)
def catalog_scheduler():
    try:
        from airflow.providers.standard.operators.trigger_dagrun import TriggerDagRunOperator
    except ImportError:  # Airflow 2.x
        from airflow.operators.trigger_dagrun import TriggerDagRunOperator

    @task
    def due_jobs() -> list[dict[str, Any]]:
        from golaly_catalog import db, jobs

        with db.connect(_settings().database_url) as conn:
            return jobs.start_due_jobs(conn)

    @task
    def republish() -> int:
        from golaly_catalog import db, dedupe

        s = _settings()
        with db.connect(s.database_url) as conn:
            n = dedupe.republish_dirty(conn, s)
            conn.commit()
        return n

    @task(execution_timeout=timedelta(minutes=30))
    def recount_unmapped() -> int | None:
        """Admin → Categories reads a summary; recount it after syncs (minutes on a big catalog)."""
        from golaly_catalog import db, jobs

        with db.connect(_settings().database_url) as conn:
            return jobs.refresh_unmapped_if_stale(conn)

    TriggerDagRunOperator.partial(task_id="start_syncs", trigger_dag_id="catalog_sync", wait_for_completion=False).expand(conf=due_jobs())
    republish()
    recount_unmapped()


@dag(
    dag_id="catalog_dry_run",
    description="What a sync would change, without writing (one transaction, rolled back); results in sync_runs",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=2,
    default_args={**DEFAULT_ARGS, "retries": 0},
    tags=["golaly", "catalog"],
    params={
        "area": Param("hoi-an", type=["null", "string"]),
        "bbox": Param(None, type=["null", "string"]),
        "providers": Param(list(DEFAULT_SOURCES), type="array", items={"type": "string", "enum": PLACE_SOURCES}),
        "category_keys": Param([], type="array", items={"type": "string"}),
        "sync_run_id": Param(None, type=["null", "string"], description="sync_runs row to report into (set by the admin API)"),
    },
    render_template_as_native_obj=True,
)
def catalog_dry_run():
    @task(execution_timeout=timedelta(hours=2))
    def dry_run() -> dict[str, Any]:
        from golaly_catalog import pipeline

        p = get_current_context()["params"]
        out = pipeline.run_sync(
            _settings(),
            p.get("area"),
            p.get("bbox"),
            list(p["providers"]),
            dry_run=True,
            category_keys=list(p.get("category_keys") or []),
            sync_run_id=p.get("sync_run_id"),
        )
        return {k: v for k, v in out.items() if k in ("loaded", "publish", "status")}

    dry_run()


@dag(
    dag_id="catalog_photos",
    description="Queue openly licensed photos (Wikimedia Commons via Wikidata) for the places in an area",
    # After each catalog_sync that published places needing photos; events that arrive while a run is going are
    # handled together by the next run. Can still be triggered by hand (then the params below apply).
    schedule=[PLACES],
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,  # one polite client towards Wikimedia at a time
    default_args={**DEFAULT_ARGS, "retry_delay": timedelta(minutes=10)},
    tags=["golaly", "catalog", "photos"],
    params={
        "area": Param("hoi-an", type=["null", "string"], description="geo area slug (vn, vn-da-nang) or destination slug (hoi-an)"),
        "bbox": Param(None, type=["null", "string"], description="minLng,minLat,maxLng,maxLat — instead of area"),
        "only_due": Param(False, type="boolean", description="only places never checked, renamed, moved or checked long ago"),
    },
)
def catalog_photos():
    @task(execution_timeout=timedelta(hours=3))
    def queue_photos() -> dict[str, Any]:
        from golaly_catalog.photos import sync_photos

        ctx = get_current_context()
        events = [e for evs in (ctx.get("triggering_asset_events") or {}).values() for e in evs]
        if not events:  # triggered by hand
            p = ctx["params"]
            if not p.get("area") and not p.get("bbox"):
                raise ValueError("set either 'area' or 'bbox'")
            return sync_photos(_settings(), p.get("area"), p.get("bbox"), only_due=bool(p.get("only_due")))
        # After one or more syncs: the union of their areas, incremental. Params (defaults) don't apply here.
        return photos_after_sync([dict(e.extra or {}) for e in events])

    queue_photos()


def photos_after_sync(extras: list[dict[str, Any]], sync_photos: Any = None) -> dict[str, Any]:
    """Incremental photo runs for the areas of one or more finished syncs (the Asset events' extras)."""
    from golaly_catalog.photos import ContactMissing
    from golaly_catalog.photos import sync_photos as default_sync

    sync_photos = sync_photos or default_sync
    areas = list(dict.fromkeys(a for x in extras for a in x.get("areas") or []))
    boxes = list(dict.fromkeys(x["bbox"] for x in extras if x.get("bbox")))
    after = ",".join(dict.fromkeys(x["sync_run_id"] for x in extras if x.get("sync_run_id"))) or None
    s = _settings()
    try:
        out: dict[str, Any] = {"areas": areas, "bboxes": boxes, "runs": []}
        if areas:
            out["runs"].append(sync_photos(s, areas=areas, only_due=True, after_sync=after))
        for b in boxes:
            out["runs"].append(sync_photos(s, bbox=b, only_due=True, after_sync=after))
        return out
    except ContactMissing as e:
        # Automatic runs shouldn't turn every sync red while the operator hasn't set a contact yet.
        log.warning("photos skipped: %s", e)
        raise AirflowSkipException("CATALOG_CONTACT is not set") from e


catalog_sync()
catalog_bootstrap()
catalog_scheduler()
catalog_dry_run()
catalog_photos()
