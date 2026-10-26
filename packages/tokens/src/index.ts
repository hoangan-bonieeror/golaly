/**
 * @golaly/tokens — the "Atlas" design tokens, shared by the web (Tailwind theme in apps/web/src/app/globals.css)
 * and the app (React Native styles). Spec and contrast table: design-system/golaly/MASTER.md.
 *
 * globals.css stays the web's source for Tailwind; `npm run check -w @golaly/tokens` (CI) fails when the two drift.
 * Names follow the CSS (`--color-primary-600` → `primary600`).
 */

/** Atlas (day). */
export const light = {
  sand: "#f3efe6",
  sand2: "#e8e1d3",
  surface: "#fffdf8",
  ink: "#1f1a16",
  ink2: "#4a423a",
  muted: "#675d53",
  line: "#ddd4c4",
  primary: "#1f5e52",
  primary600: "#16463d",
  primary50: "#e1ede8",
  accent: "#d9481c",
  accent50: "#fbe6dc",
  accent600: "#b23a14",
  accent700: "#a33412",
  gold: "#d39a2e",
  gold50: "#f8ecd2",
  gold700: "#7c520f",
  success: "#8fcab7",
  danger: "#b3261e",
  onPrimary: "#ffffff",
  onInk: "#fffdf8",
  lineStrong: "#b9ad99",
  map: "#ece5d6",
  contour: "#ddd3c0",
  water: "#b9d3ca",
  pinRing: "#fffdf8",
} as const;

export type ColorName = keyof typeof light;

/** Atlas Night — same names, re-tuned for a dark canvas (not inverted). Colours it doesn't override stay as in `light`. */
export const dark: Record<ColorName, string> = {
  ...light,
  sand: "#15130f",
  sand2: "#2a251f",
  surface: "#1e1b16",
  ink: "#e9e2d4",
  ink2: "#cbc2b2",
  muted: "#a89e8f",
  line: "#3a342c",
  primary: "#7cc4b0",
  primary600: "#9ad3c3",
  primary50: "#1b3430",
  accent: "#ff7a45",
  accent50: "#3b211a",
  accent600: "#c2461b",
  accent700: "#ff8a5c",
  gold: "#e0a83e",
  gold50: "#352a14",
  gold700: "#e8bb63",
  danger: "#ff8a80",
  onPrimary: "#15130f",
  onInk: "#15130f",
  lineStrong: "#5a5147",
  map: "#1b1915",
  contour: "#2e2922",
  water: "#24413a",
  pinRing: "#e9e2d4",
};

/** The CSS custom property behind a colour token: `primary600` → `--color-primary-600`. */
export const cssVar = (name: ColorName) => `--color-${name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").replace(/([0-9])([a-z])/gi, "$1-$2").toLowerCase()}`;

/** One colour per trip day (route lines, pins, day chips), cycling after the seventh day. */
export const DAY_COLORS = ["#c23e14", "#1f5e52", "#3d4fa1", "#93601a", "#8a3b6e", "#26699a", "#5e6f26"] as const;
export const dayColor = (dayNumber: number) => DAY_COLORS[(((dayNumber - 1) % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];

export const radius = { card: 16 } as const;

/** Font families (Google Fonts). The web loads them with next/font, the app with expo-font. */
export const fonts = {
  display: "Bricolage Grotesque",
  sans: "Be Vietnam Pro",
  mono: "JetBrains Mono",
} as const;
