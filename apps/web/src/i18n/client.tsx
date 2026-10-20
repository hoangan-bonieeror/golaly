"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LOCALE_COOKIE, type Locale } from "@golaly/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setRequestLocale } from "@/lib/api/client";
import { formatCount, formatDateRange, formatDay, setFormatLocale, timeAgo } from "@/lib/utils";
import { CATALOGS } from "./catalog";
import type { Messages } from "./types";
import { useClock } from "@/lib/clock";

interface I18n {
  locale: Locale;
  m: Messages;
  /** Switches the interface instantly and remembers it on this device (cookie). Saving it to the account is the caller's job. */
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<I18n | null>(null);
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Module state the non-React helpers read (API client header, date/number formatting). */
function applyGlobals(l: Locale) {
  if (typeof window === "undefined") return; // module state is per browser tab, never shared between server requests
  setRequestLocale(l);
  setFormatLocale(l);
}

export function I18nProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const current = useRef(initial);
  // Set synchronously so the first render's API calls and formatted dates already use it.
  applyGlobals(locale);
  const qc = useQueryClient();

  const setLocale = useCallback(
    (l: Locale) => {
      if (l === current.current) return;
      current.current = l;
      applyGlobals(l);
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
      document.documentElement.lang = l;
      setLocaleState(l);
      // Server-built text (notifications, place names, categories, errors) comes back in the new language.
      void qc.invalidateQueries();
    },
    [qc],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, m: CATALOGS[locale], setLocale }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

/** The message catalog for the current language: `const t = useT(); t.common.save`. */
export function useT(): Messages {
  return useI18n().m;
}

/** Date and number formatters bound to the current language. */
export function useFormat() {
  const { locale } = useI18n();
  const { now, timeZone } = useClock();
  const at = Math.floor(now.getTime() / 60_000) * 60_000;
  return useMemo(
    () => ({
      count: (n: number) => formatCount(n, locale),
      timeAgo: (iso: string) => timeAgo(iso, locale, at, timeZone),
      dateRange: (start?: string | null, end?: string | null) => formatDateRange(start ?? undefined, end ?? undefined, locale),
      day: (iso: string, opts?: Intl.DateTimeFormatOptions) => formatDay(iso, opts, locale),
      number: (n: number, opts?: Intl.NumberFormatOptions) => n.toLocaleString(locale === "vi" ? "vi-VN" : "en-US", opts),
    }),
    // `at` is rounded to the minute, so the formatters only change when what they'd show can.
    [locale, at, timeZone],
  );
}
