import { BedDouble, Bus, Coffee, Flag, Landmark, MapPin, Martini, Mountain, ShoppingBag, Sparkles, UtensilsCrossed } from "lucide-react";
import type { Locale } from "@triply/shared";
import { CATALOGS, INTL_LOCALE } from "@/i18n/catalog";
import { cx } from "../ui";

/**
 * Icon + tint per category group. Group colours are categorical data colours (allowed as raw hex by
 * the design system), each paired with a text colour that keeps ≥ 4.5:1 on its tint.
 */
export const GROUP_META: Record<string, { icon: React.ElementType; bg: string; fg: string; pin: string }> = {
  food: { icon: UtensilsCrossed, bg: "bg-accent-50", fg: "text-accent-700", pin: "#d9481c" },
  drink: { icon: Coffee, bg: "bg-[#f1e4d8]", fg: "text-[#6b3a1f]", pin: "#6b3a1f" },
  sights: { icon: Landmark, bg: "bg-primary-50", fg: "text-primary", pin: "#1f5e52" },
  culture: { icon: Sparkles, bg: "bg-[#efe6f5]", fg: "text-[#6a3d8f]", pin: "#6a3d8f" },
  nature: { icon: Mountain, bg: "bg-[#e3f0e1]", fg: "text-[#2f6b3a]", pin: "#3d8b5a" },
  activity: { icon: Flag, bg: "bg-gold-50", fg: "text-gold-700", pin: "#c28512" },
  nightlife: { icon: Martini, bg: "bg-[#f7e3ea]", fg: "text-[#9b2f55]", pin: "#b5446e" },
  lodging: { icon: BedDouble, bg: "bg-[#ece8f7]", fg: "text-[#5b4a9e]", pin: "#5b4a9e" },
  shopping: { icon: ShoppingBag, bg: "bg-[#fbeedc]", fg: "text-[#8a4b0f]", pin: "#a4471f" },
  transport: { icon: Bus, bg: "bg-[#e3eef9]", fg: "text-[#2f6db5]", pin: "#2f6db5" },
};
const FALLBACK = { icon: MapPin, bg: "bg-sand-2", fg: "text-ink-2", pin: "#4a423a" };

export const groupOf = (categoryKey: string | null | undefined) => (categoryKey ? categoryKey.split(".")[0] : "");
export const groupMeta = (group: string) => GROUP_META[group] ?? FALLBACK;

export function CategoryIcon({ categoryKey, size = "md", className }: { categoryKey: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const m = groupMeta(groupOf(categoryKey));
  const Icon = m.icon;
  const box = { sm: "size-8 rounded-lg", md: "size-10 rounded-xl", lg: "size-14 rounded-2xl" }[size];
  const icon = { sm: "size-4", md: "size-5", lg: "size-7" }[size];
  return (
    <span className={cx("cat-tint flex shrink-0 items-center justify-center", box, m.bg, m.fg, className)} style={{ "--cat": m.pin } as React.CSSProperties} aria-hidden>
      <Icon className={icon} />
    </span>
  );
}

/** "350 m", "1.2 km" ("1,2 km" in Vietnamese). Pure: pass the interface language. */
export function formatDistance(m: number | undefined, locale: Locale = "en") {
  if (m === undefined) return null;
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const digits = m < 9500 ? 1 : 0;
  return `${(m / 1000).toLocaleString(INTL_LOCALE[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

const DAY = "Mo|Tu|We|Th|Fr|Sa|Su|PH";
/**
 * Human-readable OpenStreetMap opening_hours, one line per rule ("Mo-Fr 08:00-17:00; Sa 09:00-12:00"
 * → ["Mon–Fri 08:00–17:00", "Sat 09:00–12:00"], or "Th 2–Th 6 08:00–17:00" in Vietnamese). Times stay
 * 24-hour. Unusual syntax is shown as-is rather than guessed at. Pure: pass the interface language.
 */
export function formatOpeningHours(raw: string, locale: Locale = "en"): string[] {
  const h = CATALOGS[locale].explore.hours;
  const day = (d: string) => h.days[d as keyof typeof h.days];
  if (raw.trim() === "24/7") return [h.always];
  return raw
    .split(";")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) =>
      r
        // One pass for day names and day ranges, so a translated name ("Th 2") is never matched again.
        .replace(new RegExp(`\\b(${DAY})(?:-(${DAY}))?\\b`, "g"), (_, a: string, b?: string) => (b ? `${day(a)}–${day(b)}` : day(a)))
        .replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, "$1–$2")
        .replace(/([A-Z][a-z]{2})-([A-Z][a-z]{2})/g, "$1–$2")
        .replace(/\boff\b/g, h.closed),
    );
}
