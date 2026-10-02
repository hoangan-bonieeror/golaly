import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque, URL-safe random token (≥ 256 bits). Used for refresh, invite and reset tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes — a DB leak doesn't leak usable tokens. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string) {
  return hash(password, ARGON);
}

export async function verifyPassword(stored: string, password: string) {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
