# Airflow + the golaly-catalog package. Build context: the repo root (see docker-compose.yml, profile "pipelines").
FROM apache/airflow:3.1.8-python3.12

USER root
RUN mkdir -p /data/catalog && chown airflow:root /data/catalog
USER airflow

COPY --chown=airflow:root pipelines/pyproject.toml pipelines/README.md /opt/golaly/pipelines/
COPY --chown=airflow:root pipelines/golaly_catalog /opt/golaly/pipelines/golaly_catalog
# Pin against Airflow's constraints so pip can't upgrade anything Airflow depends on.
RUN pip install --no-cache-dir /opt/golaly/pipelines \
      --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-3.1.8/constraints-3.12.txt" \
 && python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"

# Analytics (dbt) in its own virtualenv so its dependencies never touch Airflow's. The DAG analytics_daily runs it.
USER root
RUN python -m venv /opt/dbt && /opt/dbt/bin/pip install --no-cache-dir "dbt-core>=1.12,<1.13" "dbt-postgres>=1.11,<1.12" && chown -R airflow:root /opt/dbt
USER airflow
COPY --chown=airflow:root analytics /opt/golaly/analytics

COPY --chown=airflow:root pipelines/dags /opt/airflow/dags
ENV CATALOG_DATA_DIR=/data/catalog
