/**
 * Copies files from the local media folder (MEDIA_DIR) to the S3/R2 bucket, keeping their keys, so rows
 * moved to another database (e.g. `npm run data:import` to Neon) find their images in the bucket.
 *
 *   npm run build -w @golaly/api
 *   npm run media:push -w @golaly/api -- [--dir ./storage/media] [--dry-run]
 *
 * Needs the S3_* variables and MEDIA_PUBLIC_URL in the environment (MEDIA_DRIVER may stay "local").
 * Objects that already exist are skipped, so it is safe to re-run.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { S3StorageDriver } from "../modules/media/s3";

const IMAGE = /\.(webp|jpe?g|png)$/i;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && IMAGE.test(entry.name)) yield full;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dirArg = args.indexOf("--dir");
  const root = path.resolve(dirArg >= 0 ? args[dirArg + 1] : env.MEDIA_DIR);
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    console.error("Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY first (see apps/api/.env.example).");
    process.exit(2);
  }
  const s3 = new S3StorageDriver({ endpoint: S3_ENDPOINT, bucket: S3_BUCKET, accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, region: S3_REGION });

  const files: string[] = [];
  for await (const f of walk(root)) files.push(f);
  console.log(`${files.length} image files under ${root}${dryRun ? " (dry run)" : ""}`);

  const total = { uploaded: 0, skipped: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      const key = path.relative(root, file).split(path.sep).join("/");
      try {
        if (await s3.exists(key)) total.skipped++;
        else if (dryRun) total.uploaded++;
        else {
          await s3.put(key, await readFile(file));
          total.uploaded++;
        }
      } catch (e) {
        total.failed++;
        console.error(`  ${key}: ${(e as Error).message}`);
      }
      const done = total.uploaded + total.skipped + total.failed;
      if (done % 50 === 0) console.log(`  ${done}/${files.length}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`${dryRun ? "would upload" : "uploaded"} ${total.uploaded}, already there ${total.skipped}, failed ${total.failed}`);
  process.exit(total.failed ? 1 : 0);
}

void main();
