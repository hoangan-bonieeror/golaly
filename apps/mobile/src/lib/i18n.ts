import { getLocales } from "expo-localization";
import { useSyncExternalStore } from "react";
import { isLocale, type Locale } from "@golaly/shared";

/**
 * The app's own strings (the API already answers its messages in the chosen language).
 * Starts from the phone's language; the account's saved language wins once signed in.
 */
const en = {
  appTagline: "Plan together. Discover together. Travel together.",
  email: "Email",
  password: "Password",
  username: "Username",
  logIn: "Log in",
  signUp: "Create account",
  noAccount: "New to Golaly? Create an account",
  haveAccount: "Already have an account? Log in",
  or: "or",
  continueWithGoogle: "Continue with Google",
  myTrips: "My trips",
  noTrips: "No trips yet",
  noTripsBody: "Trips you plan or join on golaly.com show up here.",
  logOut: "Log out",
  retry: "Try again",
  loadFailed: "Couldn't load this. Check your connection and try again.",
  day: (n: number) => `Day ${n}`,
  noStops: "Nothing planned for this day yet.",
  ideas: "Ideas, not on a day yet",
  dates: (start: string | null, end: string | null) => (start ? `${start}${end && end !== start ? ` → ${end}` : ""}` : "No dates yet"),
  members: (n: number) => (n === 1 ? "1 person" : `${n} people`),
  stops: (n: number) => (n === 1 ? "1 stop" : `${n} stops`),
  roles: { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" } as Record<string, string>,
};
type Strings = typeof en;

const vi: Strings = {
  appTagline: "Cùng lên kế hoạch. Cùng khám phá. Cùng đi.",
  email: "Email",
  password: "Mật khẩu",
  username: "Tên người dùng",
  logIn: "Đăng nhập",
  signUp: "Tạo tài khoản",
  noAccount: "Mới dùng Golaly? Tạo tài khoản",
  haveAccount: "Đã có tài khoản? Đăng nhập",
  or: "hoặc",
  continueWithGoogle: "Tiếp tục với Google",
  myTrips: "Chuyến đi của tôi",
  noTrips: "Chưa có chuyến đi nào",
  noTripsBody: "Các chuyến đi bạn lên kế hoạch hoặc tham gia trên golaly.com sẽ hiện ở đây.",
  logOut: "Đăng xuất",
  retry: "Thử lại",
  loadFailed: "Không tải được. Kiểm tra kết nối rồi thử lại.",
  day: (n) => `Ngày ${n}`,
  noStops: "Ngày này chưa có kế hoạch.",
  ideas: "Ý tưởng, chưa xếp vào ngày",
  dates: (start, end) => (start ? `${start}${end && end !== start ? ` → ${end}` : ""}` : "Chưa có ngày"),
  members: (n) => `${n} người`,
  stops: (n) => `${n} điểm dừng`,
  roles: { OWNER: "Chủ chuyến đi", EDITOR: "Người chỉnh sửa", VIEWER: "Người xem" },
};

const deviceLocale = (): Locale => (getLocales()[0]?.languageCode === "vi" ? "vi" : "en");

let locale: Locale = deviceLocale();
const listeners = new Set<() => void>();

export const currentLocale = () => locale;
export function setLocale(next: string | null | undefined) {
  const l = isLocale(next) ? next : deviceLocale();
  if (l === locale) return;
  locale = l;
  listeners.forEach((f) => f());
}

export function useT(): Strings {
  const l = useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), currentLocale);
  return l === "vi" ? vi : en;
}
