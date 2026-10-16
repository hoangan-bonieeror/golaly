/**
 * Where to send someone after signing in: only a path on this site. Anything a browser could read as another
 * origin is refused — `//evil.com`, `/\evil.com` (WHATWG URLs treat `\` like `/`), a tab or newline inside
 * (`/\t/evil.com`), or an absolute URL. The result is re-built from the parsed path so nothing else survives.
 */
export function safeNext(next: unknown, fallback = "/home"): string {
  if (typeof next !== "string" || next.length > 512 || !next.startsWith("/")) return fallback;
  // Backslashes, control characters and whitespace have no business in our own paths.
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "https://triply.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
