/**
 * Tests always run against TEST_DATABASE_URL — never your dev database.
 * Rate limits are raised so the suite can log in many times.
 */
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://golaly:golaly@localhost:5432/golaly_test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret";
process.env.AUTH_RATE_LIMIT_PER_MIN = "10000";
process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.MAIL_DRIVER = "disabled";
process.env.MEDIA_DIR = "./storage/test-media";
