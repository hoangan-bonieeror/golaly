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
    assert {t.task_id for t in sync.tasks} == {"start", "plan", "extract_load", "finalize", "finish"}
    assert set(sync.params.keys()) == {"area", "bbox", "providers", "sync_run_id"}
    assert sync.max_active_runs == 1
    assert bag.get_dag("catalog_bootstrap") is not None
