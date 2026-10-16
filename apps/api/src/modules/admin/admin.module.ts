import { Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Client } from "pg";
import { env } from "../../config/env";
import { RealtimeService } from "../realtime/realtime";
import { AirflowClient } from "./airflow";
import { AnalyticsController, AnalyticsService } from "./analytics";
import { DiagnosticsController } from "./diagnostics";
import { AdminGuard, CatalogAdminController, CatalogAdminService } from "./catalog";

/**
 * Forwards `NOTIFY sync_run` (fired by a trigger on every sync_runs change — the pipeline writes progress there)
 * to the admin screens over Socket.IO (room `admin`, event `sync_run`). Reconnects with backoff if Postgres drops.
 */
@Injectable()
export class SyncRunListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("SyncRunListener");
  private client: Client | null = null;
  private stopped = false;
  private retry: NodeJS.Timeout | null = null;
  private delay = 1000;

  constructor(private readonly realtime: RealtimeService) {}

  onModuleInit() {
    if (env.CATALOG_REALTIME === "off" || env.NODE_ENV === "test") return;
    void this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    await this.client?.end().catch(() => undefined);
  }

  /** Exposed for tests: forward one notification payload. */
  forward(payload: string | undefined) {
    if (!payload) return;
    try {
      const run = JSON.parse(payload) as { id: string; job_id: string | null; status: string; progress: unknown };
      this.realtime.admins("sync_run", { id: run.id, jobId: run.job_id, status: run.status, progress: run.progress ?? {} });
    } catch {
      /* malformed payloads are ignored */
    }
  }

  private async connect() {
    if (this.stopped) return;
    const client = new Client({ connectionString: env.DATABASE_URL });
    client.on("notification", (n) => n.channel === "sync_run" && this.forward(n.payload));
    client.on("error", (e) => {
      this.log.warn(`connection lost: ${e.message}`);
      this.schedule();
    });
    try {
      await client.connect();
      await client.query("LISTEN sync_run");
      this.client = client;
      this.delay = 1000;
    } catch (e) {
      this.log.warn(`couldn't listen for sync runs: ${(e as Error).message}`);
      await client.end().catch(() => undefined);
      this.schedule();
    }
  }

  private schedule() {
    if (this.stopped || this.retry) return;
    this.client = null;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 60_000);
  }
}

@Module({
  controllers: [CatalogAdminController, AnalyticsController, DiagnosticsController],
  providers: [CatalogAdminService, AnalyticsService, AdminGuard, SyncRunListener, { provide: AirflowClient, useFactory: () => new AirflowClient() }],
})
export class AdminModule {}
