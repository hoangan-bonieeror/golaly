import { localNowAt, openStateAt, parseOpeningHours, timeZoneAt, weekdayOf } from "@triply/shared";

// 2026-10-12 is a Monday.
const MON = "2026-10-12";
const SAT = "2026-10-17";
const SUN = "2026-10-18";

describe("opening hours", () => {
  it("knows the weekday", () => {
    expect([MON, SAT, SUN].map(weekdayOf)).toEqual([0, 5, 6]);
  });

  it("24/7 is open with no closing time", () => {
    expect(openStateAt("24/7", MON, "03:10")).toEqual({ state: "open", until: null });
  });

  it("simple daily hours, before / during / after", () => {
    const spec = "Mo-Su 07:30-17:30";
    expect(openStateAt(spec, MON, "07:00")).toEqual({ state: "closed", opensAt: "07:30" });
    expect(openStateAt(spec, MON, "07:30")).toEqual({ state: "open", until: "17:30" });
    expect(openStateAt(spec, MON, "17:30")).toEqual({ state: "closed", opensAt: null });
  });

  it("a lunch break, and later rules replacing days", () => {
    const spec = "Mo-Sa 08:00-11:00,15:00-16:00; Su off";
    expect(openStateAt(spec, MON, "12:00")).toEqual({ state: "closed", opensAt: "15:00" });
    expect(openStateAt(spec, SAT, "15:30")).toEqual({ state: "open", until: "16:00" });
    expect(openStateAt(spec, SUN, "09:00")).toEqual({ state: "closed", opensAt: null });
    expect(openStateAt("Mo-Fr 07:00-19:00; Sa,Su 07:00-18:00", SUN, "18:30")).toEqual({ state: "closed", opensAt: null });
    expect(openStateAt("Tu-Su 07:00-17:00; Mo off", MON, "10:00").state).toBe("closed");
  });

  it("hours past midnight count on the next morning", () => {
    const bar = "Mo-Su 18:00-02:00";
    expect(openStateAt(bar, SAT, "23:00")).toEqual({ state: "open", until: "02:00" });
    expect(openStateAt(bar, SUN, "01:15")).toEqual({ state: "open", until: "02:00" });
    expect(openStateAt(bar, SUN, "03:00")).toEqual({ state: "closed", opensAt: "18:00" });
    // Only Friday night: Saturday 01:00 is still Friday's.
    expect(openStateAt("Fr 20:00-03:00", SAT, "01:00")).toEqual({ state: "open", until: "03:00" });
    expect(openStateAt("Fr 20:00-03:00", SUN, "01:00").state).toBe("closed");
  });

  it("wrapping weekday ranges, open ends, comments and holidays", () => {
    expect(openStateAt("Fr-Mo 10:00-14:00", MON, "11:00").state).toBe("open");
    expect(openStateAt("Fr-Mo 10:00-14:00", "2026-10-14", "11:00").state).toBe("closed"); // Wednesday
    expect(openStateAt("Mo-Su 18:00+", MON, "20:00")).toEqual({ state: "open", until: "00:00" });
    expect(openStateAt('Mo-Fr 09:00-17:00 "call ahead"', MON, "10:00").state).toBe("open");
    expect(openStateAt("Mo-Fr 09:00-17:00; PH off", MON, "10:00").state).toBe("open");
    expect(openStateAt("Mo-Su,PH 09:00-17:00", SUN, "10:00").state).toBe("open");
  });

  it("says unknown instead of guessing", () => {
    for (const spec of [null, "", "sunrise-sunset", "Jan-Mar 08:00-10:00", "Mo-Fr 08:00-12:00 open \"x\" || nonsense", "by appointment", "Mo 25:99-26:00"]) {
      expect(openStateAt(spec, MON, "10:00")).toEqual({ state: "unknown" });
    }
    expect(parseOpeningHours("PH off")).toBeNull();
  });
});

describe("local time at a place", () => {
  it("infers the zone from coordinates", () => {
    expect(timeZoneAt(21.03, 105.85)).toBe("Asia/Ho_Chi_Minh"); // Hanoi
    expect(timeZoneAt(35.01, 135.77)).toBe("Asia/Tokyo"); // Kyoto
    expect(timeZoneAt(38.72, -9.14)).toBe("Europe/Lisbon");
    expect(timeZoneAt(36.27, -121.81)).toBe("America/Los_Angeles"); // Big Sur
    expect(timeZoneAt(-33.87, 151.21)).toBe("Etc/GMT-10"); // elsewhere: solar time
  });
  it("gives that place's date and clock", () => {
    // 19:16 UTC on a Wednesday is 02:16 on Thursday in Hanoi.
    expect(localNowAt(21.03, 105.85, new Date("2026-10-14T19:16:00Z"))).toEqual({ date: "2026-10-15", time: "02:16", zone: "Asia/Ho_Chi_Minh" });
    expect(localNowAt(36.27, -121.81, new Date("2026-10-14T19:16:00Z")).time).toBe("12:16");
  });
});
