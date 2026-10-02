// Cross-platform first-time setup (works on Windows, macOS, Linux):
// copies .env examples, generates a JWT secret, builds the shared package.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const pairs = [
  ["apps/api/.env.example", "apps/api/.env"],
  ["apps/web/.env.example", "apps/web/.env.local"],
];
for (const [from, to] of pairs) {
  if (existsSync(to)) {
    console.log(`✓ ${to} already exists — left unchanged`);
    continue;
  }
  copyFileSync(from, to);
  if (to.endsWith("api/.env")) {
    const secret = randomBytes(48).toString("base64url");
    writeFileSync(to, readFileSync(to, "utf8").replace("JWT_SECRET=change-me-to-a-long-random-string", `JWT_SECRET=${secret}`));
  }
  console.log(`✓ created ${to}`);
}
console.log("\nNext: start PostgreSQL (docker compose up -d db), then: npm run db:deploy && npm run db:seed && npm run dev");
