# Triply Design System — "Slow Roast"

> Source of truth for Triply's visual language. Page-specific deviations live in
> `design-system/triply/pages/<page>.md` and override this file for that page only.
> Tokens are implemented in [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css).

## Mood

Lazy-morning coffee, poured a little stronger. Warm, unhurried and cozy, but with confident
contrast: espresso-dark text, a solid roast-brown primary and a caramel-ember accent that pops.
It should feel like flipping through a travel journal in a café, not like a banking app.

- **Cozy:** cream canvases, warm-tinted shadows, soft serif headings, rounded shapes.
- **Bolder:** near-black espresso ink, semibold controls, heavy (600–800) display type,
  one saturated accent used deliberately.

## Color tokens

Use tokens through Tailwind (`bg-primary`, `text-ink-2`, `border-line`, …). No raw hex in components,
except categorical data colors (itinerary item types, map day colors) and cover-art palettes.

| Token | Hex | Role |
|---|---|---|
| `sand` | `#f6eee2` | Page background (latte foam) |
| `sand-2` | `#ece0cd` | Wells, hover fills, skeletons |
| `surface` | `#fffbf5` | Cards, sheets, inputs |
| `ink` | `#2b1a10` | Primary text, active chips, dark toasts (espresso) |
| `ink-2` | `#4d3628` | Secondary text, labels |
| `muted` | `#6e5646` | Hints, metadata |
| `line` | `#e2d3bd` | Borders, dividers |
| `primary` / `-600` / `-50` | `#6b3a1f` / `#552d17` / `#f4e7da` | Main actions, links, focus ring, selected states |
| `accent` | `#e0662d` | Caramel ember: fills, large display type, pins, decoration |
| `accent-600` | `#b4481a` | Filled accent buttons (white text) |
| `accent-700` | `#963b15` | Accent-colored **text** and meaningful icons |
| `accent-50` | `#fce8dc` | Accent tint backgrounds |
| `gold` / `gold-50` / `gold-700` | `#d9982a` / `#fbefd6` / `#83560c` | Honey: ratings, highlights, warning banners |
| `success` | `#a9cf9c` | Sage: success icons on dark (`ink`) surfaces only |
| `danger` | `#b3261e` | Errors, destructive actions |

### Verified contrast (WCAG 2.2)

| Pair | Ratio | |
|---|---|---|
| ink on sand / sand-2 / surface | 14.5 / 12.8 / 16.2 | AAA |
| ink-2 on sand / sand-2 | 9.7 / 8.6 | AAA |
| muted on sand / sand-2 / surface / primary-50 | 5.9 / 5.2 / 6.6 / 5.6 | AA |
| primary on sand / primary-50 | 8.1 / 7.7 | AAA |
| white on primary / primary-600 | 9.3 / 11.8 | AAA |
| white on accent-600 | 5.4 | AA |
| accent-700 on sand / accent-50 | 6.2 / 6.0 | AA |
| gold-700 on gold-50 | 5.6 | AA |
| danger on sand / surface | 5.7 / 6.3 | AA |
| accent / gold / success on ink | 4.9 / 6.7 / 9.6 | AA |
| **accent on sand / surface** | **3.0 / 3.3** | Non-text & large text only |

**Rule:** raw `accent` is never used for body-size text or a meaningful small icon on a light surface.
Use `accent-700` for text and `accent-600` for filled buttons.

## Typography

| Role | Font | Weights | Notes |
|---|---|---|---|
| Display (`font-display`) | **Fraunces** (variable; `SOFT 100`, `WONK 1`) | 600–800 | Headings, hero lines, section titles. Tracking −0.02em. |
| UI / body (`font-sans`) | **Inter** | 400 body · 500 labels · 600 controls | 16px base for body copy, line-height 1.5–1.6. |

Both are loaded through `next/font/google` (`display: swap`, Latin + Vietnamese subsets) and
exposed as `--font-fraunces` and `--font-inter`.

Scale: 12 (caption) · 14 (UI/meta) · 16 (body) · 18 (lead) · 22 (section, `SectionTitle`) ·
28–32 (page H1) · 40–56 (hero). Headings use 600 or heavier; don't use thin display weights.

## Shape, depth & spacing

- Radius: cards `--radius-card` (1.25rem), sheets `rounded-3xl`, inputs `rounded-xl`, buttons and chips `rounded-full`.
- Shadows are tinted espresso (`--shadow-card`, `--shadow-pop`), never neutral grey. Two levels only.
- Spacing on a 4/8px rhythm; section gaps 24/32/48.
- `.grain` paper texture is welcome on covers, adding to the café/journal feel.

## Components (current conventions)

- **Button:** `font-semibold`, pill. One `primary` per screen; `accent` for the single highest-emotion CTA
  (e.g. "Start a trip"), `secondary` for the rest. Disabled = 50% opacity + `disabled`.
- **Chip:** `font-semibold`; active = `bg-ink text-white` (bold espresso pill).
- **Badge tones:** `neutral`, `primary`, `accent` (uses accent-700 text), `gold`.
- **Focus:** 2px `primary` outline, 2px offset (7–8:1 against canvases).
- **Touch:** controls ≥ 44px hit area (`hit` helper in `components/ui`).
- **Icons:** lucide-react, one stroke style; icon-only buttons need `label`.

## Motion

Calm, not sleepy: 150–250ms color/opacity transitions, `rise` (350ms) for sheets and page entrances,
ease-out on enter. Every animation is disabled under `prefers-reduced-motion`.

## Avoid

- Cool greys, teal or blue as brand colors (the old lagoon palette is retired).
- Raw `accent` text on light backgrounds; grey-on-cream low-contrast text.
- Faux-bold or thin display type; more than one accent-colored element competing per view.
- Emoji as icons; neutral-grey shadows; hardcoded hex in components.

## Not yet covered

- **Dark mode:** not implemented. When added, use a roasted-dark canvas (e.g. `#1d130d`) with
  desaturated cream text, and re-verify every pair above rather than inverting.
