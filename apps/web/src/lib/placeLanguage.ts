/**
 * Which language place names are shown in. Default: the interface language (the API client falls back to it).
 * Settings can pin one, or ask for local names only (what's written on the signs).
 * Kept per device in localStorage — it's a display preference.
 */
const KEY = "triply.placeNames";

/**
 * The choices, in display order. "" = same as the app language. Labels live in the catalog
 * (`t.settings.placeNames.options[labelKey]`).
 */
export const PLACE_NAME_OPTIONS = [
  { value: "", labelKey: "app" },
  { value: "en", labelKey: "en" },
  { value: "vi", labelKey: "vi" },
  { value: "local", labelKey: "local" },
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
