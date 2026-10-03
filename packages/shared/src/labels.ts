import type { Interest, ItineraryItemType, TravelerType, TripRole, TripVisibility } from "./types";

export const ITEM_TYPE_LABEL: Record<ItineraryItemType, string> = {
  PLACE: "Place",
  RESTAURANT: "Restaurant",
  HOTEL: "Hotel",
  FLIGHT: "Flight",
  TRANSPORTATION: "Transport",
  ACTIVITY: "Activity",
  NOTE: "Note",
};

export const ROLE_LABEL: Record<TripRole, string> = {
  OWNER: "Owner",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

export const VISIBILITY_LABEL: Record<TripVisibility, { label: string; hint: string }> = {
  PRIVATE: { label: "Private", hint: "Only members can see this trip." },
  LINK_ONLY: { label: "Link only", hint: "Anyone with the link can view. Not listed in Explore." },
  PUBLIC: { label: "Public", hint: "Discoverable in Explore, search and your profile." },
};

export const TRAVELER_TYPES: { value: TravelerType; label: string }[] = [
  { value: "SOLO", label: "Solo" },
  { value: "COUPLE", label: "Couple" },
  { value: "FRIENDS", label: "Friends" },
  { value: "FAMILY", label: "Family" },
  { value: "ALL", label: "A bit of everything" },
];

export const INTERESTS: { value: Interest; label: string }[] = [
  { value: "FOOD", label: "Food" },
  { value: "NATURE", label: "Nature" },
  { value: "BEACH", label: "Beach" },
  { value: "CITY", label: "City" },
  { value: "CULTURE", label: "Culture" },
  { value: "ADVENTURE", label: "Adventure" },
  { value: "SHOPPING", label: "Shopping" },
  { value: "PHOTOGRAPHY", label: "Photography" },
];

/**
 * Search normalisation shared by the API (indexing + queries): lower-case, strip
 * accents/diacritics (incl. Vietnamese đ), collapse whitespace.
 * "Hội An" → "hoi an", "Sensō-ji" → "senso-ji".
 */
export function normalizeSearch(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lower-cased text that keeps its accents (NFC), for accent-aware search: "Phở" → "phở", so a query
 * typed with diacritics can tell "phở" from "phố". Mirrors `accent_search` in the catalog pipeline.
 */
export function accentSearch(input: string | null | undefined): string {
  return (input ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Administrative prefixes of Vietnamese provincial-level names ("Thành phố Đà Nẵng", "Tỉnh Lâm Đồng"). */
const AREA_PREFIXES: [RegExp, "city" | "province"][] = [
  [/^(thành phố|tp\.?)\s+/i, "city"],
  [/^tỉnh\s+/i, "province"],
];

/**
 * An administrative area's name without its type prefix ("Thành phố Đà Nẵng" → "Đà Nẵng") and that type
 * ("city", "province", or null when the name has none). Mirrors `short_area_name` in the catalog pipeline.
 */
export function splitAreaName(name: string): { short: string; kind: "city" | "province" | null } {
  const s = name.normalize("NFC").trim();
  for (const [re, kind] of AREA_PREFIXES) if (re.test(s)) return { short: s.replace(re, ""), kind };
  return { short: s, kind: null };
}
