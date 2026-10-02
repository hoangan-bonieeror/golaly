import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Fallback lets `prisma generate` run during `npm install`, before .env exists.
    url: process.env.DATABASE_URL ?? "postgresql://triply:triply@localhost:5432/triply",
  },
});
