import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as AppleAuthentication from "expo-apple-authentication";
import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, GENERIC_ERROR } from "@golaly/client";
import { localizeMessage } from "@golaly/shared";
import { availableProviders, logIn, logInWithApple, logInWithGoogle } from "@/lib/auth";
import { currentLocale, useT } from "@/lib/i18n";
import { useSessionStatus } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { Button, ErrorText, Field, Loading } from "@/components/ui";

/** The API's message (already in the right language), or a generic one for a native sign-in failure. */
const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : localizeMessage(GENERIC_ERROR, currentLocale()));

export default function Login() {
  const t = useT();
  const { colors, dark, radius } = useTheme();
  const qc = useQueryClient();
  const status = useSessionStatus();
  const providers = useQuery({ queryKey: ["auth", "app-providers"], queryFn: availableProviders, staleTime: 10 * 60_000 });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Signing in switches the navigator to the signed-in screens on its own (Stack.Protected in _layout).
  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiError && e.fields) setFields(e.fields);
    } finally {
      setBusy(null);
    }
  }

  if (status === "loading") return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.sand }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6, marginBottom: 8 }}>
            <Text accessibilityRole="header" style={{ fontSize: 40, fontWeight: "800", color: colors.primary, letterSpacing: -1 }}>
              Golaly
            </Text>
            <Text style={{ fontSize: 16, color: colors.ink2 }}>{t.appTagline}</Text>
          </View>

          <Field label={t.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" error={fields.email} />
          <Field label={t.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" error={fields.password} onSubmitEditing={() => run("password", () => logIn(qc, { email, password }))} />
          <ErrorText>{error}</ErrorText>
          <Button title={t.logIn} busy={busy === "password"} disabled={!!busy || !email || !password} onPress={() => run("password", () => logIn(qc, { email, password }))} />

          {(providers.data?.google || providers.data?.apple) && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
              <Text style={{ color: colors.muted }}>{t.or}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
            </View>
          )}
          {providers.data?.apple && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.card}
              style={{ height: 48 }}
              onPress={() => run("apple", () => logInWithApple(qc))}
            />
          )}
          {providers.data?.google && <Button kind="secondary" title={t.continueWithGoogle} busy={busy === "google"} disabled={!!busy} onPress={() => run("google", () => logInWithGoogle(qc))} />}

          <Link href="/register" style={{ color: colors.primary, fontSize: 15, textAlign: "center", paddingVertical: 12 }}>
            {t.noAccount}
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
