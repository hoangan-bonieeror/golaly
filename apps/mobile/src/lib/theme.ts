import { useColorScheme } from "react-native";
import { dark, light, radius } from "@golaly/tokens";

/** Atlas colours for the current system appearance (the same tokens as the web's light / Atlas Night). */
export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? dark : light;
  return { colors, radius, dark: scheme === "dark" };
}

export type Theme = ReturnType<typeof useTheme>;
