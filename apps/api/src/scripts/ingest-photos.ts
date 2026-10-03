/**
 * Drains the imported-photo queue now instead of waiting for the background worker:
 *
 *   npm run build -w @triply/api && npm run photos:ingest -w @triply/api
 *
 * Useful right after `triply-catalog photos --area …`. Safe to run while the API is up.
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PhotoIngestService } from "../modules/places/photos";

async function main() {
  PhotoIngestService.autoStart = false; // this process drains the queue itself; no interval timer
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  const ingest = app.get(PhotoIngestService);
  if (!ingest.userAgent) {
    console.error("Set CATALOG_CONTACT (a URL or email) first: Wikimedia refuses downloads from clients without one (HTTP 403).");
    await app.close();
    process.exit(2);
  }
  const log = new Logger("photos:ingest");
  const total = { claimed: 0, stored: 0, failed: 0 };
  for (;;) {
    const r = await ingest.ingestBatch(10);
    total.claimed += r.claimed;
    total.stored += r.stored;
    total.failed += r.failed;
    if (r.claimed === 0) break;
    log.log(`stored ${total.stored}, failed ${total.failed}`);
  }
  log.log(`done: ${JSON.stringify(total)} (failed photos are retried later with back-off)`);
  await app.close();
}

void main();
