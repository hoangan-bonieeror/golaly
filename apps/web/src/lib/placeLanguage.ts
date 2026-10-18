/**
 * Which language place names are shown in. Default: the interface language (the API client falls back to it).
 * Settings can pin one, or ask for local names only (what's written on the signs).
 * Kept per device in localStorage — it's a display preference.
 */
const KEY = "triply.placeNames";
/**
 * Mirror of the choice for the server render (lib/api/server.ts), which can't read localStorage. Same values;
 * absent = same as the app language.
 */
export const PLACE_NAMES_COOKIE = "triply-place-names";

function writeCookie(v: PlaceNameChoice) {
  if (typeof document === "undefined") return;
  document.cookie = v ? `${PLACE_NAMES_COOKIE}=${v}; Path=/; Max-Age=31536000; SameSite=Lax` : `${PLACE_NAMES_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Brings the cookie in line with a choice saved before the cookie existed (run once on start). */
export function syncPlaceNamesCookie() {
  const v = getPlaceNameChoice();
  const has = document.cookie.split("; ").find((c) => c.startsWith(`${PLACE_NAMES_COOKIE}=`))?.split("=")[1] ?? "";
  if (has !== v) writeCookie(v);
}

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
  writeCookie(v);
}

let memory: PlaceNameChoice | null = null;

/** The Accept-Language to send instead of the browser's, or undefined to leave it alone. "und" = no language → local names. */
export function placeNameHeader(): string | undefined {
  const v = memory ?? getPlaceNameChoice();
  return v === "local" ? "und" : v || undefined;
}
