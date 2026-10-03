import type { ItineraryItemType } from "@triply/shared";
import { BedDouble, Bus, Flag, MapPin, Plane, StickyNote, UtensilsCrossed } from "lucide-react";
import { cx } from "../ui";

export const TYPE_META: Record<ItineraryItemType, { icon: React.ElementType; bg: string; fg: string; dot: string }> = {
  PLACE: { icon: MapPin, bg: "bg-primary-50", fg: "text-primary", dot: "#6b3a1f" },
  RESTAURANT: { icon: UtensilsCrossed, bg: "bg-accent-50", fg: "text-accent-700", dot: "#e0662d" },
  HOTEL: { icon: BedDouble, bg: "bg-[#ece8f7]", fg: "text-[#5b4a9e]", dot: "#5b4a9e" },
  FLIGHT: { icon: Plane, bg: "bg-[#e3eef9]", fg: "text-[#2f6db5]", dot: "#2f6db5" },
  TRANSPORTATION: { icon: Bus, bg: "bg-[#e3eef9]", fg: "text-[#2f6db5]", dot: "#2f6db5" },
  ACTIVITY: { icon: Flag, bg: "bg-gold-50", fg: "text-gold-700", dot: "#c28512" },
  NOTE: { icon: StickyNote, bg: "bg-sand-2", fg: "text-ink-2", dot: "#8a7262" },
};

export function ItemTypeIcon({ type, size = "md" }: { type: ItineraryItemType; size?: "sm" | "md" }) {
  const m = TYPE_META[type];
  const Icon = m.icon;
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-xl", m.bg, m.fg, size === "sm" ? "size-8" : "size-10")}>
      <Icon className={size === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}
