import type { ExpoConfig } from "expo/config";

/**
 * Build-time settings come from EXPO_PUBLIC_* variables (apps/mobile/.env locally, EAS environment variables for
 * store builds) — none of them are secrets: they end up inside the app.
 */
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
/** "123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc" (what Google sign-in on iOS opens). */
const googleIosScheme = googleIosClientId?.split(".").reverse().join(".");

const config: ExpoConfig = {
  name: "Golaly",
  slug: "golaly",
  scheme: "golaly",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: process.env.EXPO_PUBLIC_BUNDLE_ID ?? "com.golaly.app",
    supportsTablet: true,
    usesAppleSignIn: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: process.env.EXPO_PUBLIC_BUNDLE_ID ?? "com.golaly.app",
    adaptiveIcon: { backgroundColor: "#1f5e52" },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-apple-authentication",
    "expo-localization",
    ["expo-notifications", { color: "#1f5e52" }],
    ...(googleIosScheme ? [["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosScheme }] as [string, object]] : []),
  ],
  experiments: { typedRoutes: true },
  extra: {
    // `eas init` writes the project id here; push tokens need it.
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
  },
};

export default config;
