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
  /**
   * Imported place photos (Wikimedia Commons) are downloaded by a background worker in the API.
   * "off" disables it (e.g. on extra replicas; the queue is safe to share either way).
   */
  PHOTO_INGEST: z.enum(["on", "off"]).default("on"),
  /** Only these hosts are ever fetched (SSRF guard). Comma-separated. */
  PHOTO_HOSTS: z
    .string()
    .default("upload.wikimedia.org")
    .transform((v) => v.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)),
  /**
   * Wikimedia refuses clients that don't say how to reach their operator (403). Set CATALOG_CONTACT to a URL or
   * email (same variable as the catalog pipeline); PHOTO_USER_AGENT overrides the whole header if needed.
   * Without either, imported photos simply stay queued.
   */
  CATALOG_CONTACT: z.string().optional().transform((v) => v?.trim() || undefined),
  PHOTO_USER_AGENT: z.string().optional().transform((v) => v?.trim() || undefined),
  MAIL_DRIVER: z.enum(["dev-outbox", "disabled"]).default("dev-outbox"),
  MAIL_OUTBOX_DIR: z.string().default("./storage/outbox"),
  /** Google sign-in (optional). Leave empty to hide the Google button. */
  GOOGLE_CLIENT_ID: z.string().optional().transform((v) => v || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => v || undefined),
  /** Defaults to `${WEB_ORIGIN}/api/v1/auth/google/callback` — register exactly this URL in Google Cloud Console. */
  GOOGLE_REDIRECT_URI: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  /** Requests per minute per IP for the general limiter. Auth routes use a stricter limit. */
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(300),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(10),
  /**
   * Which hops in front of the API may set X-Forwarded-For (Express "trust proxy").
   * Default: only loopback — i.e. the Next.js web server on the same machine, which overwrites
   * X-Forwarded-For with the real client address. Behind other proxies use their subnet
   * (e.g. "loopback, uniquelocal" in Docker) or a hop count. Never "true": then any client
   * could spoof its IP and dodge rate limits.
   */
  TRUST_PROXY: z
    .string()
    .default("loopback")
    .transform((v) => (/^\d+$/.test(v) ? Number(v) : v === "false" ? false : v)),
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
  if (parsed.data.NODE_ENV === "production" && !parsed.data.COOKIE_SECURE && !process.env.ALLOW_INSECURE_COOKIES) {
    throw new Error("Set COOKIE_SECURE=true in production (serve over HTTPS). For a local HTTP-only demo set ALLOW_INSECURE_COOKIES=1.");
  }
  if (parsed.data.TRUST_PROXY === "true") throw new Error('TRUST_PROXY=true lets clients spoof their IP. Use a subnet like "loopback" or a hop count.');
  return parsed.data;
}

export const env = load();
