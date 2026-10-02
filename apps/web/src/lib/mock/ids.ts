/**
 * Deterministic UUID-shaped ids for seed data (so URLs are stable across
 * reloads) and random UUIDs for anything created at runtime.
 * Mirrors the "UUIDs for public identifiers" rule — no sequential ids in URLs.
 */
function hash32(str: string, seed: number): number {
  let h = seed ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function seedId(key: string): string {
  const parts = [1, 2, 3, 4].map((s) => hash32(key, s * 2654435761).toString(16).padStart(8, "0"));
  const hex = parts.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return seedId(String(Math.random()) + Date.now());
}

/** Opaque invite token — 32 url-safe chars, unrelated to any internal id. */
export function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
