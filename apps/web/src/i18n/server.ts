import { isLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from "@triply/shared";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { CATALOGS } from "./catalog";
import type { Messages } from "./types";

/**
 * The request's interface language: the `triply-locale` cookie (the user's choice, also synced from
 * their account after sign-in), else the browser's Accept-Language, else English.
 */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

export async function getMessages(): Promise<Messages> {
  return CATALOGS[await getLocale()];
}

/** For route layouts: `export const generateMetadata = titleFor("explore")`. */
export function titleFor(key: Exclude<keyof Messages["titles"], "default" | "description">) {
  return async (): Promise<Metadata> => ({ title: (await getMessages()).titles[key] });
}
