"""DAG structure check. Runs only where Airflow is installed (e.g. `pip install "apache-airflow==3.1.*"` with the
official constraints, or inside the pipelines Docker image)."""

from pathlib import Path

import pytest

pytest.importorskip("airflow")


def test_dags_parse():
    from airflow.models.dagbag import DagBag

    bag = DagBag(str(Path(__file__).parents[1] / "dags"), include_examples=False)
    assert bag.import_errors == {}
    sync = bag.get_dag("catalog_sync")
    assert {t.task_id for t in sync.tasks} == {"start", "plan", "extract_load", "finalize", "finish", "announce"}
    assert set(sync.params.keys()) == {"area", "bbox", "providers", "sync_run_id", "photos"}
    assert sync.max_active_runs == 1
    assert bag.get_dag("catalog_bootstrap") is not None
    photos = bag.get_dag("catalog_photos")
    assert {t.task_id for t in photos.tasks} == {"queue_photos"} and set(photos.params.keys()) == {"area", "bbox", "only_due"}
    assert photos.max_active_runs == 1


def test_sync_announces_places_and_photos_follow():
    """Only the single `announce` task (not the mapped extract_load) emits the Asset; catalog_photos is scheduled on it."""
    from airflow.models.dagbag import DagBag

    bag = DagBag(str(Path(__file__).parents[1] / "dags"), include_examples=False)
    sync, photos = bag.get_dag("catalog_sync"), bag.get_dag("catalog_photos")
    emitting = {t.task_id for t in sync.tasks if getattr(t, "outlets", None)}
    assert emitting == {"announce"}
    (asset,) = sync.get_task("announce").outlets
    assert asset.uri == "triply://catalog/places"
    assert "triply://catalog/places" in repr(photos.timetable.asset_condition)
    assert sync.params["providers"] == ["overture", "osm"]  # from the source registry


def test_photos_after_sync_merges_events():
    import importlib.util

    spec = importlib.util.spec_from_file_location("catalog_sync_dag", Path(__file__).parents[1] / "dags" / "catalog_sync.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    calls = []

    def fake(settings, area=None, bbox=None, **kw):
        calls.append({"area": area, "bbox": bbox, **kw})
        return {"status": "succeeded"}

    extras = [
        {"areas": ["hoi-an"], "bbox": None, "sync_run_id": "r1"},
        {"areas": ["vn-da-nang", "hoi-an"], "bbox": None, "sync_run_id": "r2"},
        {"areas": [], "bbox": "108,15,108.1,15.1", "sync_run_id": "r3"},
    ]
    out = mod.photos_after_sync(extras, fake)
    assert out["areas"] == ["hoi-an", "vn-da-nang"]
    assert calls[0]["areas"] == ["hoi-an", "vn-da-nang"] and calls[0]["only_due"] and calls[0]["after_sync"] == "r1,r2,r3"
    assert calls[1]["bbox"] == "108,15,108.1,15.1" and calls[1]["only_due"]

    from airflow.exceptions import AirflowSkipException

    from triply_catalog.photos import ContactMissing

    def no_contact(*a, **kw):
        raise ContactMissing("Set CATALOG_CONTACT")

    import pytest as _pytest

    with _pytest.raises(AirflowSkipException):  # automatic runs skip (with a warning) instead of failing
        mod.photos_after_sync(extras[:1], no_contact)
