import "dotenv/config";
import { z } from "zod";

/** Environment is validated once at boot — the API refuses to start with bad config. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MEDIA_DRIVER: z.enum(["local"]).default("local"),
  MEDIA_DIR: z.string().default("./storage/media"),
  MEDIA_MAX_BYTES: z.coerce.number().int().default(8 * 1024 * 1024),
  MAIL_DRIVER: z.enum(["dev-outbox", "disabled"]).default("dev-outbox"),
  MAIL_OUTBOX_DIR: z.string().default("./storage/outbox"),
  /** Requests per minute per IP for the general limiter. Auth routes use a stricter limit. */
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(300),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(10),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee apps/api/.env.example`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET.startsWith("change-me")) {
    throw new Error("Set a real JWT_SECRET in production.");
  }
  return parsed.data;
}

export const env = load();
