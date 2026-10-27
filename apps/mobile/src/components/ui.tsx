import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "@/lib/theme";

export function Button({ title, onPress, kind = "primary", busy, disabled }: { title: string; onPress: () => void; kind?: "primary" | "secondary"; busy?: boolean; disabled?: boolean }) {
  const { colors, radius } = useTheme();
  const primary = kind === "primary";
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.card,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
        backgroundColor: primary ? (pressed ? colors.primary600 : colors.primary) : pressed ? colors.sand2 : colors.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.line,
        opacity: off && !busy ? 0.5 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={primary ? colors.onPrimary : colors.ink} /> : <Text style={{ color: primary ? colors.onPrimary : colors.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...input }: TextInputProps & { label: string; error?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.ink2, fontSize: 14, fontWeight: "500" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: error ? colors.danger : colors.line, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: 14, fontSize: 16 }}
        {...input}
      />
      {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: string | null | undefined }) {
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
      {children}
    </Text>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: colors.sand }}>{children}</View>;
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <Centered>
      <ActivityIndicator color={colors.primary} />
    </Centered>
  );
}
