import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./session";

/** Notifications that arrive while the app is open still show (the in-app list refreshes over realtime later). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Asks once for permission, gets this phone's Expo push token and registers it for the signed-in session
 * (PUT /push/devices is idempotent, so calling this at every start is fine). Quietly does nothing on a simulator,
 * without permission, or before the project is linked to EAS (no project id).
 */
export async function registerPush(): Promise<void> {
  if (!Device.isDevice) return;
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Golaly", importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.put("/push/devices", { token, platform: Platform.OS === "ios" ? "ios" : "android" });
}

/** Where a tapped notification leads: the trip it is about, if any. */
export function tripIdOf(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as { tripId?: string | null } | undefined;
  return typeof data?.tripId === "string" ? data.tripId : null;
}
