import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, ToastAndroid } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "@golaly/client";
import { ClientProvider, useMe, type ClientContextValue } from "@golaly/client/react";
import { currentLocale, setLocale } from "@/lib/i18n";
import { registerPush, tripIdOf } from "@/lib/push";
import { api, isSignedIn, loadSession, useSessionStatus } from "@/lib/session";
import { useTheme } from "@/lib/theme";

/** Errors as an alert; other messages as a toast on Android (iOS has none built in, and they're only confirmations). */
function notify(message: string, kind?: "error") {
  if (kind === "error") Alert.alert(message);
  else if (Platform.OS === "android") ToastAndroid.show(message, ToastAndroid.SHORT);
}

/** Once signed in: the account's language, push registration, and opening the trip a tapped notification is about. */
function SignedInEffects() {
  const me = useMe().data;
  const router = useRouter();
  useEffect(() => setLocale(me?.locale), [me?.locale]);
  useEffect(() => {
    registerPush().catch(() => undefined);
    const open = (r: Notifications.NotificationResponse) => {
      const tripId = tripIdOf(r);
      if (tripId) router.push({ pathname: "/trips/[id]", params: { id: tripId } });
    };
    // The notification that launched the app, then any tapped while it runs.
    const launched = Notifications.getLastNotificationResponse();
    if (launched) open(launched);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
  return null;
}

export default function RootLayout() {
  const status = useSessionStatus();
  const { colors, dark } = useTheme();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Permission / not-found answers won't change by asking again.
            retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
          },
        },
      }),
  );
  const client = useMemo<ClientContextValue>(() => ({ api, getLocale: currentLocale, notify, mightBeSignedIn: isSignedIn }), []);

  useEffect(() => void loadSession(), []);
  // Signed out (here, or because the session ended on the server): nothing of the last account stays cached.
  useEffect(() => {
    if (status === "signedOut") queryClient.clear();
  }, [status, queryClient]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ClientProvider value={client}>
          <StatusBar style={dark ? "light" : "dark"} />
          {status === "signedIn" && <SignedInEffects />}
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.sand },
              headerTintColor: colors.ink,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.sand },
            }}
          >
            <Stack.Protected guard={status === "signedIn"}>
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Protected guard={status !== "signedIn"}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="register" options={{ title: "" }} />
            </Stack.Protected>
          </Stack>
        </ClientProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
