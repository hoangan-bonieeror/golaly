import type { Locale } from "@golaly/shared";
import { en } from "./en";
import type { Messages } from "./types";
import { vi } from "./vi";

/** Both catalogs ship in the bundle (they're small text); switching language is instant, no reload. */
export const CATALOGS: Record<Locale, Messages> = { en, vi };
/** BCP 47 tags for Intl formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", vi: "vi-VN" };
export type { Messages };
