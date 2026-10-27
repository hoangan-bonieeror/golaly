import { Injectable } from "@nestjs/common";
import { createHash, createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { env } from "../../config/env";
import type { GoogleProfile } from "./google";

const ISSUER = "https://appleid.apple.com";
const KEYS_URL = `${ISSUER}/auth/keys`;
const KEYS_TTL_MS = 24 * 3_600_000;
/** Apple's clock and ours may differ a little. */
const SKEW_S = 60;

interface AppleClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  /** Apple sends these as booleans or as the strings "true"/"false". */
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
}

const truthy = (v: boolean | string | undefined) => v === true || v === "true";
const b64json = <T>(part: string): T => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;

/**
 * Verifies Sign in with Apple identity tokens (RS256 JWTs) with Apple's published keys — no SDK needed.
 * Checks signature, issuer, audience (our bundle ids), expiry and the nonce; returns the same profile shape as
 * Google so both link accounts by the same rules. Isolated like GoogleClient so tests can swap in a fake.
 */
@Injectable()
export class AppleClient {
  private keys: Map<string, KeyObject> | null = null;
  private keysAt = 0;

  get configured() {
    return env.APPLE_CLIENT_IDS.length > 0;
  }

  /** `nonce` is the raw value the app generated; the token must carry its SHA-256 (hex). */
  async verify(identityToken: string, nonce: string): Promise<GoogleProfile & { privateEmail: boolean }> {
    const parts = identityToken.split(".");
    if (parts.length !== 3) throw new Error("malformed Apple token");
    const [h, p, sig] = parts;
    const header = b64json<{ alg?: string; kid?: string }>(h);
    if (header.alg !== "RS256" || !header.kid) throw new Error("unexpected Apple token algorithm");
    const key = await this.key(header.kid);
    if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(sig, "base64url"))) throw new Error("bad Apple token signature");

    const c = b64json<AppleClaims>(p);
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.iss !== ISSUER) throw new Error("wrong Apple token issuer");
    if (!aud.some((a) => a && env.APPLE_CLIENT_IDS.includes(a))) throw new Error("Apple token is for another app");
    if (!c.exp || c.exp + SKEW_S < now) throw new Error("expired Apple token");
    if (c.nonce !== createHash("sha256").update(nonce).digest("hex")) throw new Error("Apple token nonce mismatch");
    if (!c.sub) throw new Error("Apple token has no subject");
    // Normally always there; without it only an already-linked account can sign in (see resolveUser).
    return { sub: c.sub, email: c.email?.toLowerCase() ?? "", emailVerified: !!c.email && truthy(c.email_verified), privateEmail: truthy(c.is_private_email) };
  }

  /** Apple rotates its keys: cached for a day, refetched at once when a token names a key we don't have. */
  private async key(kid: string): Promise<KeyObject> {
    const age = Date.now() - this.keysAt;
    // An unknown kid refetches at most once a minute: made-up kids can't make us hammer Apple.
    if (!this.keys || age > KEYS_TTL_MS || (!this.keys.has(kid) && age > 60_000)) await this.loadKeys();
    const key = this.keys!.get(kid);
    if (!key) throw new Error("unknown Apple signing key");
    return key;
  }

  private async loadKeys() {
    const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Apple keys answered ${res.status}`);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) if (jwk.kid && jwk.kty === "RSA") keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    this.keys = keys;
    this.keysAt = Date.now();
  }
}
