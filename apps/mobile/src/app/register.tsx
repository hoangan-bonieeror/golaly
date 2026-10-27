import { useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { ApiError, GENERIC_ERROR } from "@golaly/client";
import { localizeMessage } from "@golaly/shared";
import { register } from "@/lib/auth";
import { currentLocale, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button, ErrorText, Field } from "@/components/ui";

export default function Register() {
  const t = useT();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await register(qc, form);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : localizeMessage(GENERIC_ERROR, currentLocale()));
      if (e instanceof ApiError && e.fields) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.sand }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "800", color: colors.ink }}>
          {t.signUp}
        </Text>
        <Field label={t.email} value={form.email} onChangeText={set("email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" error={fields.email} />
        <Field label={t.username} value={form.username} onChangeText={set("username")} autoCapitalize="none" autoComplete="username-new" textContentType="username" error={fields.username} />
        <Field label={t.password} value={form.password} onChangeText={set("password")} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={fields.password} />
        <ErrorText>{error}</ErrorText>
        <Button title={t.signUp} busy={busy} disabled={busy || !form.email || !form.username || !form.password} onPress={submit} />
        <Link href="/login" replace style={{ color: colors.primary, fontSize: 15, textAlign: "center", paddingVertical: 12 }}>
          {t.haveAccount}
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
