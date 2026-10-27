import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme";

/** Signed-in screens (the root layout only mounts this group with a live session). */
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.sand },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.sand },
      }}
    />
  );
}
