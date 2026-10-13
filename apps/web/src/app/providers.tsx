"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Locale } from "@triply/shared";
import { useEffect, useState } from "react";
import { I18nProvider, useI18n } from "@/i18n/client";
import { ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/api/queries";
import { ToastProvider } from "@/lib/toast";

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

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Don't hammer the API on permission/not-found errors.
            retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initial={locale}>
        <AccountLocale />
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
