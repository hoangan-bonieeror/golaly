"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Locale } from "@triply/shared";
import { Suspense, useEffect, useState } from "react";
import { I18nProvider, useI18n } from "@/i18n/client";
import { ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/api/queries";
import { registerServiceWorker } from "@/lib/offline";
import { ToastProvider } from "@/lib/toast";
import { syncPlaceNamesCookie } from "@/lib/placeLanguage";
import { ClockProvider } from "@/lib/clock";

/** After sign-in on a new device, the language saved on the account wins over the device's guess. */
function AccountLocale() {
  const me = useMe().data;
  const { locale, setLocale } = useI18n();
  useEffect(() => {
    if (me?.locale && me.locale !== locale) setLocale(me.locale);
    // Only when the account (or its saved language) changes — not when the user switches here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.locale]);
  return null;
}

export function Providers({ locale, renderedAt, timeZone, children }: { locale: Locale; renderedAt: number; timeZone: string | null; children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Offline, still try once: the service worker answers trip data from its last copy.
            networkMode: "offlineFirst",
            refetchOnWindowFocus: true,
            // Don't hammer the API on permission/not-found errors.
            retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
          },
        },
      }),
  );
  useEffect(() => registerServiceWorker(), []);
  useEffect(() => syncPlaceNamesCookie(), []);
  return (
    <QueryClientProvider client={client}>
      <ClockProvider renderedAt={renderedAt} timeZone={timeZone}>
        <I18nProvider initial={locale}>
          <AccountLocale />
          <ToastProvider>
            {/*
              A boundary around the page: the document shell (head, fonts, styles) streams at once while a page waits
              for its server prefetch, and if a page's server HTML ever doesn't match, React re-renders just the
              page, not <html> (which would drop the theme set before paint).
            */}
            <Suspense>
              {children}
              <HydratedMark />
            </Suspense>
          </ToastProvider>
        </I18nProvider>
      </ClockProvider>
    </QueryClientProvider>
  );
}

/**
 * Marks <html data-hydrated> once the page itself has hydrated. Pages can arrive with their content already
 * rendered (server prefetch) and their controls don't respond until then; tests wait for this marker.
 */
function HydratedMark() {
  useEffect(() => void (document.documentElement.dataset.hydrated = "1"), []);
  return null;
}
