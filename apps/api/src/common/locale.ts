import { AsyncLocalStorage } from "node:async_hooks";
import { isLocale, LOCALE_HEADER, localeFromAcceptLanguage, type Locale } from "@golaly/shared";
import type { NextFunction, Request, Response } from "express";

/**
 * Which language place names are shown in, per request. The web sends the device's languages (the browser's
 * Accept-Language) or the viewer's choice from Settings; presenters read it without every service passing it on.
 */
const store = new AsyncLocalStorage<{ langs: string[]; ui: Locale }>();

/** "en-GB,en;q=0.9,vi;q=0.8" → ["en-gb", "en", "vi"]: by preference, each tag followed by its base language. */
export function parseAcceptLanguage(header: string | undefined | null): string[] {
  if (!header) return [];
  const tags = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((t) => /^[a-z]{1,8}(-[a-z0-9]{1,8})*$/.test(t.tag) && t.q > 0 && Number.isFinite(t.q))
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .slice(0, 8);
  const out: string[] = [];
  for (const { tag } of tags) {
    for (const t of [tag, tag.split("-")[0]!]) if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function localeMiddleware(req: Request, res: Response, next: NextFunction) {
  res.vary("Accept-Language");
  res.vary(LOCALE_HEADER);
  // Interface language: the web sends the app's choice; other clients fall back to Accept-Language.
  const header = req.headers[LOCALE_HEADER];
  const ui = isLocale(header) ? header : localeFromAcceptLanguage(req.headers["accept-language"]);
  store.run({ langs: parseAcceptLanguage(req.headers["accept-language"]), ui }, next);
}

/** The interface language of the current request (messages, notification text). */
export function requestLocale(): Locale {
  return store.getStore()?.ui ?? "en";
}

export function preferredLanguages(): string[] {
  return store.getStore()?.langs ?? [];
}

/**
 * The name to show: the first preferred language the place has a name in (exact tag, then same base language),
 * else its local name. `localName` is set when that differs, so the UI can show the on-the-ground name as well
 * (handy for asking the way). Names are never machine-translated.
 */
export function pickPlaceName(local: string, names: { lang: string; name: string }[], langs: string[] = preferredLanguages()) {
  if (names.length && langs.length) {
    const byLang = new Map(names.map((n) => [n.lang.toLowerCase(), n.name]));
    for (const lang of langs) {
      const exact = byLang.get(lang);
      const sameBase = exact ?? names.find((n) => n.lang.toLowerCase().split("-")[0] === lang)?.name;
      if (sameBase) return { name: sameBase, localName: sameBase === local ? null : local };
    }
  }
  return { name: local, localName: null };
}
