/**
 * Rebuilds the test database from the committed migrations (no Prisma CLI needed),
 * then loads the demo seed. Runs once per `npm run test:int`.
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://triply:triply@localhost:5432/triply_test";
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL && !/test/i.test(url))
    throw new Error("TEST_DATABASE_URL must point at a separate test database.");
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const dir = path.join(__dirname, "..", "prisma", "migrations");
  for (const m of readdirSync(dir).filter((d) => /^\d+_/.test(d)).sort()) {
    await client.query(readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
  }
  await client.end();
  process.env.NODE_ENV = "test";
  const { seedDatabase } = await import("../prisma/seed");
  await seedDatabase(url, { quiet: true });
}
