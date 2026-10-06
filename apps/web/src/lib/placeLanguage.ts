/**
 * Which language place names are shown in. Default: the device's languages (the browser sends them as
 * Accept-Language). Settings can pin one, or ask for local names only (what's written on the signs).
 * Kept per device in localStorage — it's a display preference, like the device language it overrides.
 */
const KEY = "triply.placeNames";

export const PLACE_NAME_OPTIONS = [
  { value: "", label: "Match my device" },
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "local", label: "Local names (as on the signs)" },
] as const;

export type PlaceNameChoice = (typeof PLACE_NAME_OPTIONS)[number]["value"];

export function getPlaceNameChoice(): PlaceNameChoice {
  try {
    const v = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    return PLACE_NAME_OPTIONS.some((o) => o.value === v) ? (v as PlaceNameChoice) : "";
  } catch {
    return "";
  }
}

export function setPlaceNameChoice(v: PlaceNameChoice) {
  try {
    if (v) window.localStorage.setItem(KEY, v);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page reloads.
  }
  memory = v;
}

let memory: PlaceNameChoice | null = null;

/** The Accept-Language to send instead of the browser's, or undefined to leave it alone. "und" = no language → local names. */
export function placeNameHeader(): string | undefined {
  const v = memory ?? getPlaceNameChoice();
  return v === "local" ? "und" : v || undefined;
}
