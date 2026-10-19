"""Golaly analytics DAG.

analytics_daily   every night at 02:17 UTC: rebuild the analytics marts (dbt models + tests in analytics/) on the
                  app database, so the admin dashboard's cohorts and stickiness are fresh. The marts read app
                  activity only (not the catalog), so they don't wait for catalog syncs.

dbt lives in its own virtualenv in the image (/opt/dbt, see pipelines/Dockerfile) so its dependencies never fight
Airflow's. The same build runs without Airflow: `cd analytics && uv run python run.py build`, and nightly on the
demo deployment as the "Analytics" GitHub Action.
"""

from __future__ import annotations

from datetime import datetime, timedelta

try:  # Airflow 3
    from airflow.sdk import dag
except ImportError:  # Airflow 2.x
    from airflow.decorators import dag

try:
    from airflow.providers.standard.operators.bash import BashOperator
except ImportError:  # Airflow 2.x
    from airflow.operators.bash import BashOperator

ANALYTICS_DIR = "/opt/triply/analytics"
DBT_PYTHON = "/opt/dbt/bin/python"


@dag(
    dag_id="analytics_daily",
    schedule="17 2 * * *",
    start_date=datetime(2026, 10, 1),
    catchup=False,
    max_active_runs=1,
    default_args={"retries": 2, "retry_delay": timedelta(minutes=5)},
    tags=["triply", "analytics"],
    doc_md=__doc__,
)
def analytics_daily():
    # build = run every model, then its tests; a failing test fails the task (and the marts it guards are not trusted).
    BashOperator(
        task_id="dbt_build",
        bash_command=f"cd {ANALYTICS_DIR} && {DBT_PYTHON} run.py build",
        # DATABASE_URL comes from the container environment (docker-compose.yml).
        append_env=True,
    )


analytics_daily()
