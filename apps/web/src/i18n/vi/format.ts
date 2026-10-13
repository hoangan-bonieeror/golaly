import type { Messages } from "../types";

export const format: Messages["format"] = {
  justNow: "vừa xong",
  minutesShort: (n) => `${n} phút`,
  hoursShort: (n) => `${n} giờ`,
  daysShort: (n) => `${n} ngày`,
  minutes: (n) => `${n} phút`,
  hoursMinutes: (h, m) => (m ? `${h} giờ ${m} phút` : `${h} giờ`),
  days: (n) => `${n} ngày`,
  places: (n) => `${n} địa điểm`,
  stops: (n) => `${n} điểm dừng`,
  travelers: (n) => `${n} người đi`,
  datesNotSet: "Chưa chọn ngày",
  thousandSuffix: "N",
};
