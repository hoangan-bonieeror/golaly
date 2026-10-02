# Airflow + the triply-catalog package. Build context: the repo root (see docker-compose.yml, profile "pipelines").
FROM apache/airflow:3.1.8-python3.12

USER root
RUN mkdir -p /data/catalog && chown airflow:root /data/catalog
USER airflow

COPY --chown=airflow:root pipelines/pyproject.toml pipelines/README.md /opt/triply/pipelines/
COPY --chown=airflow:root pipelines/triply_catalog /opt/triply/pipelines/triply_catalog
# Pin against Airflow's constraints so pip can't upgrade anything Airflow depends on.
RUN pip install --no-cache-dir /opt/triply/pipelines \
      --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-3.1.8/constraints-3.12.txt" \
 && python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"

COPY --chown=airflow:root pipelines/dags /opt/airflow/dags
ENV CATALOG_DATA_DIR=/data/catalog
