import { Injectable, Logger } from "@nestjs/common";
import { env } from "../../config/env";

export class AirflowError extends Error {}

/**
 * Starts DAG runs through Airflow's REST API (v2, Airflow 3). Authenticates with a JWT from the auth manager:
 * POST /auth/token with AIRFLOW_USERNAME/PASSWORD, or GET /auth/token when the simple auth manager makes
 * everyone admin (local docker compose). The token is reused until Airflow answers 401.
 */
@Injectable()
export class AirflowClient {
  private readonly log = new Logger("Airflow");
  private token: string | null = null;
  /** Replaced in tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  private url(path: string) {
    return `${env.AIRFLOW_API_URL.replace(/\/$/, "")}${path}`;
  }

  private async login(): Promise<string> {
    const creds = env.AIRFLOW_USERNAME && env.AIRFLOW_PASSWORD;
    const res = await this.fetchImpl(this.url("/auth/token"), {
      method: creds ? "POST" : "GET",
      headers: creds ? { "Content-Type": "application/json" } : undefined,
      body: creds ? JSON.stringify({ username: env.AIRFLOW_USERNAME, password: env.AIRFLOW_PASSWORD }) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new AirflowError(`Airflow refused to log in (HTTP ${res.status}). Set AIRFLOW_USERNAME / AIRFLOW_PASSWORD.`);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new AirflowError("Airflow's login answer had no token.");
    return body.access_token;
  }

  /** Triggers a DAG run; returns Airflow's dag_run_id. */
  async trigger(dagId: string, conf: Record<string, unknown>): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        this.token ??= await this.login();
        res = await this.fetchImpl(this.url(`/api/v2/dags/${encodeURIComponent(dagId)}/dagRuns`), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
          body: JSON.stringify({ logical_date: null, conf }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        if (e instanceof AirflowError) throw e;
        throw new AirflowError(`Can't reach Airflow at ${env.AIRFLOW_API_URL} — is it running (docker compose --profile pipelines up -d)?`);
      }
      if (res.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        this.log.warn(`trigger ${dagId} → ${res.status} ${text}`);
        throw new AirflowError(
          res.status === 404 ? `Airflow doesn't know the DAG ${dagId} (is the pipelines folder mounted?).` : `Airflow refused the run (HTTP ${res.status}).`,
        );
      }
      const body = (await res.json()) as { dag_run_id?: string };
      return body.dag_run_id ?? "";
    }
    throw new AirflowError("Airflow refused the credentials.");
  }
}
