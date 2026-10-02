"""TRIPLY place catalog DAGs.

catalog_sync       start → plan → extract_load (one mapped task per provider × partition) → finalize → finish
catalog_bootstrap  taxonomy + adopt seed places → country/province boundaries

Trigger catalog_sync from the Airflow UI ("Trigger DAG w/ config") or the REST API:

    POST /api/v2/dags/catalog_sync/dagRuns   {"logical_date": null, "conf": {"area": "hoi-an", "providers": ["overture", "osm"]}}

The work itself lives in the `triply_catalog` package (also runnable without Airflow: `triply-catalog sync --area hoi-an`).
Airflow only adds scheduling, retries per partition, parallelism and a UI. Every step is idempotent, so a retried
task or a re-run DAG never duplicates data.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

try:  # Airflow 3
    from airflow.sdk import Param, dag, get_current_context, task
except ImportError:  # Airflow 2.x
    from airflow.decorators import dag, task
    from airflow.models.param import Param
    from airflow.operators.python import get_current_context

from airflow.utils.trigger_rule import TriggerRule

DEFAULT_ARGS = {"owner": "triply", "retries": 2, "retry_delay": timedelta(minutes=2)}


def _settings():
    from triply_catalog.config import settings

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
    tags=["triply", "catalog"],
    params={
        "area": Param("hoi-an", type=["null", "string"], description="geo area slug (vn, vn-da-nang) or destination slug (hoi-an)"),
        "bbox": Param(None, type=["null", "string"], description="minLng,minLat,maxLng,maxLat — instead of area"),
        "providers": Param(["overture", "osm"], type="array", items={"type": "string", "enum": ["overture", "osm"]}),
        "sync_run_id": Param(None, type=["null", "string"], description="existing sync_runs.id (set by the admin API); created if empty"),
    },
    render_template_as_native_obj=True,
)
def catalog_sync():
    @task
    def start() -> str:
        from triply_catalog import db, pipeline

        p = get_current_context()["params"]
        if not p.get("area") and not p.get("bbox"):
            raise ValueError("set either 'area' or 'bbox'")
        if p.get("sync_run_id"):
            with db.connect(_settings().database_url) as conn:
                conn.execute("UPDATE sync_runs SET status = 'running', started_at = now() WHERE id = %s", [p["sync_run_id"]])
                conn.commit()
            return p["sync_run_id"]
        return pipeline.start(_settings(), {k: p.get(k) for k in ("area", "bbox", "providers")}, "airflow")

    @task
    def plan(sync_id: str) -> list[dict[str, Any]]:
        from triply_catalog import pipeline

        p = get_current_context()["params"]
        return pipeline.plan(_settings(), sync_id, p.get("area"), p.get("bbox"), list(p["providers"]))

    @task(max_active_tis_per_dagrun=4, execution_timeout=timedelta(hours=2), map_index_template="{{ partition_label }}")
    def extract_load(sync_id: str, part: dict[str, Any]) -> dict[str, Any]:
        from triply_catalog import pipeline

        key = f"{part['provider']}/{part['key']}"
        get_current_context()["partition_label"] = key  # shown instead of the map index in the UI
        return {"key": key, **pipeline.extract_load(_settings(), sync_id, part)}

    @task(trigger_rule=TriggerRule.ALL_DONE, retries=0)
    def finalize(sync_id: str, parts: list[dict[str, Any]], loaded: Any) -> dict[str, Any]:
        from triply_catalog import pipeline

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
    def finish(sync_id: str, stats: dict[str, Any] | None) -> None:
        from triply_catalog import pipeline

        if not stats:
            pipeline.finish(_settings(), sync_id, "failed", {}, "finalize failed — see the Airflow task log")
            raise RuntimeError("catalog_sync failed")
        pipeline.finish(_settings(), sync_id, stats["status"], stats)

    sync_id = start()
    parts = plan(sync_id)
    loaded = extract_load.partial(sync_id=sync_id).expand(part=parts)
    finish(sync_id, finalize(sync_id, parts, loaded))


@dag(
    dag_id="catalog_bootstrap",
    description="Category taxonomy, adopt the app's existing places, import country/province boundaries",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    tags=["triply", "catalog"],
    params={"country": Param("VN", type="string", minLength=2, maxLength=2)},
)
def catalog_bootstrap():
    @task
    def taxonomy_and_seed() -> dict[str, Any]:
        import uuid

        from triply_catalog import db, pipeline, publish, taxonomy

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
        from triply_catalog import boundaries as b
        from triply_catalog import db

        s = _settings()
        with db.connect(s.database_url) as conn:
            return b.import_boundaries(conn, s, get_current_context()["params"]["country"].upper())

    boundaries(taxonomy_and_seed())


catalog_sync()
catalog_bootstrap()
