# Golaly Design System — "Atlas"

> Source of truth for Golaly's visual language. Page-specific deviations live in
> `design-system/triply/pages/<page>.md` and override this file for that page only.
> Tokens are implemented in [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css);
> the day palette and travel-leg estimates live in [`apps/web/src/lib/trip-geo.ts`](../../apps/web/src/lib/trip-geo.ts).

## Mood

A good paper map on a café table. The **map is the hero**: Golaly is where a group plans *where*
and *in what order*, so routes, numbered stops and the distances between them carry the screen.
Warm paper keeps the coziness of the earlier "Slow Roast" theme; deep jade and a vermilion route
line make it feel precise and confident rather than decorative.

- **Map-first:** itinerary and map side by side on wide screens; one selection drives both.
- **Legible days:** every day of a trip has its own colour, used for its chip, pins and route.
- **Precise:** times, distances and coordinates are set in a mono face so they line up and read as data.
- **Quiet chrome:** hairline borders instead of heavy shadows; colour is saved for the route and actions.

## Color tokens

Use tokens through Tailwind (`bg-primary`, `text-ink-2`, `border-line`, …). Token names are kept
from the previous theme so components follow automatically (`sand` is the paper canvas).
No raw hex in components, except categorical data colours (day palette, item types, place
categories) and cover-art palettes.

| Token | Hex | Role |
|---|---|---|
| `sand` | `#f3efe6` | Paper — page background |
| `sand-2` | `#e8e1d3` | Wells, segmented controls, hover fills, skeletons |
| `surface` | `#fffdf8` | Cards, sheets, inputs, map overlays |
| `ink` | `#1f1a16` | Primary text, "All days" chip, dark toasts |
| `ink-2` | `#4a423a` | Secondary text, labels |
| `muted` | `#675d53` | Hints, metadata, leg estimates |
| `line` | `#ddd4c4` | Hairline borders, dividers, dashed leg lines |
| `primary` / `-600` / `-50` | `#1f5e52` / `#16463d` / `#e1ede8` | Jade: main actions, links, focus ring, selected stop, presence |
| `accent` | `#d9481c` | Vermilion: route lines, pins, large display only |
| `accent-600` | `#b23a14` | Filled accent buttons ("Use this trip") |
| `accent-700` | `#a33412` | Vermilion **text** and meaningful icons |
| `accent-50` | `#fbe6dc` | Accent tint backgrounds |
| `gold` / `gold-50` / `gold-700` | `#d39a2e` / `#f8ecd2` / `#7c520f` | Ratings, highlights, warning banners |
| `success` | `#8fcab7` | Success icons on dark (`ink`) surfaces only |
| `danger` | `#b3261e` | Errors, destructive actions |
| `map` / `contour` / `water` | `#ece5d6` / `#ddd3c0` / `#b9d3ca` | Offline SVG map, route thumbnails |

### Day palette

`DAY_COLORS` in `lib/trip-geo.ts`; trips longer than seven days cycle. White numbers on every
colour pass AA; every colour is ≥ 4.2:1 against the `map` surface (non-text needs 3:1).

| Day | Hex | White text | On `map` |
|---|---|---|---|
| 1 | `#c23e14` | 5.3 | 4.2 |
| 2 | `#1f5e52` | 7.6 | 6.0 |
| 3 | `#3d4fa1` | 7.4 | 5.9 |
| 4 | `#93601a` | 5.3 | 4.3 |
| 5 | `#8a3b6e` | 7.2 | 5.7 |
| 6 | `#26699a` | 5.9 | 4.7 |
| 7 | `#5e6f26` | 5.6 | 4.4 |

### Verified contrast (WCAG 2.2)

| Pair | Ratio | |
|---|---|---|
| ink on sand / sand-2 / surface | 15.0 / 13.3 / 17.0 | AAA |
| ink-2 on sand / sand-2 / primary-50 | 8.6 / 7.6 / 8.2 | AAA |
| muted on sand / sand-2 / surface / primary-50 / map | 5.6 / 4.9 / 6.3 / 5.4 / 5.1 | AA |
| primary on sand / surface / primary-50 | 6.6 / 7.4 / 6.3 | AA |
| white on primary / primary-600 | 7.6 / 10.6 | AAA |
| white on accent-600 | 6.0 | AA |
| accent-700 on sand / accent-50 | 6.0 / 5.7 | AA |
| gold-700 on gold-50 | 5.8 | AA |
| danger on sand / surface | 5.7 / 6.4 | AA |
| gold / success on ink | 6.9 / 9.3 | AA |
| **accent on sand / surface / map / ink** | **3.7 / 4.2 / 3.4 / 4.0** | Non-text & large text only |

**Rule:** raw `accent` is never used for body-size text or a meaningful small icon. Use
`accent-700` for text and `accent-600` for filled buttons.

## Typography

| Role | Font | Weights | Notes |
|---|---|---|---|
| Display (`font-display`) | **Bricolage Grotesque** (variable, optical size) | 600–800 | Page titles, day headings. Tracking −0.025em. |
| UI / body (`font-sans`) | **Be Vietnam Pro** (static) | 400 body · 500 labels · 600 controls · 700 | Designed by Vietnamese type designers; full Vietnamese diacritics. |
| Data (`font-mono`) | **JetBrains Mono** (variable) | 400–600 | Times, dates, distances, durations, coordinates, counts. Tabular figures. |

All three load through `next/font/google` (`display: swap`, Latin + Latin-ext + Vietnamese) and are
exposed as `--font-bricolage`, `--font-be-vietnam` and `--font-jetbrains`. Be Vietnam Pro is a static
family, so `layout.tsx` lists its weights explicitly.

Scale: 11–12 (mono meta) · 13 (meta) · 14 (UI) · 15–16 (body) · 20–22 (day / section) ·
24–32 (page H1) · 40–56 (hero). Don't put body copy in mono; don't use display below 18px.

## Shape, depth & spacing

- Radius: 12–20px. Cards `--radius-card` (16px), itinerary stops 14px, buttons and inputs
  `rounded-xl` (12px), day chips 10px, sheets 20px. Filter chips and badges may stay pills.
- Depth comes from **hairline borders** (`border-line`). `--shadow-card` is barely there;
  `--shadow-pop` is only for floating layers (menus, sheets, the selected-stop card on the map).
- Spacing on a 4/8px rhythm; section gaps 24/32/48.

## App shell

- Interface in **English and Vietnamese** (`apps/web/src/i18n/README.md`); every text has room for the
  longer Vietnamese strings (no fixed-width labels).

- **Desktop (≥768px): a 64px top navbar**, not a sidebar — the map needs the width. Logo ·
  Home / Explore / Trips (active = `sand-2` fill) · global search (≥1024px; an icon below) ·
  Create · notifications (count badge) · avatar menu (Profile, Saved, Settings, Admin, Log out).
- **Phones:** 56px top bar + bottom tab bar (Home, Explore, Trips, Create, Alerts, Profile).
- Content pages sit in a centred `max-w-6xl` column. The trip planner runs **edge to edge**
  (`fullBleed` in `AppShell`). Admin keeps its own horizontal section nav.

## Trip planner (reference screen)

- **Header:** back · route thumbnail (`RouteThumb`) · title · route, mono dates and
  "N places · N km" · visibility · presence ("Minh is editing Day 2") · avatars (jade ring = here now) · actions.
- **≥1024px:** the planner fills the window under the navbar: an itinerary column
  (460px, 560px from 1280px) that scrolls on its own, and a full-height, borderless map.
  One `DayBar` and one selection drive both. Description, "based on" and remix count sit at
  the top of the itinerary column; members open in a "Travelers" panel from the avatars (`?tab=members`).
- **Narrower:** a List / Map segmented control and the `DayBar` stick under the top bar.
- **Stops:** numbered circle in the day colour (mono), title, meta; the selected stop is
  `primary-50` with a jade border, and the map shows a card for it.
- **Legs:** between consecutive places, a dashed line with "Walk ≈ 8 min · 650 m" in mono.
  Estimates come from coordinates (great-circle × 1.3, typical city speeds); always shown with ≈.
- **Phones:** a bottom action bar ("Add a place", then icon-only Expenses and Share for members)
  above the tab bar — never a floating button over the content.
- **Flexible plans:** no clock times unless something really happens at one. Each day is split
  into parts — morning (Sunrise), afternoon (Sun), evening (Moon), any time (Shuffle) — with a
  quiet mono uppercase label and a hairline; editors see every part (each with its own "+") so
  there's always somewhere to drop, viewers only the parts with plans. Anchors keep their time
  in the left column and the ticket style.
- **Ideas pool:** the first thing in the itinerary column — a dashed `sand` panel with a gold
  lightbulb, the group's top 3 ideas (the rest on request), "close together" area chips, and
  vote buttons: *really want* (accent-600, filled heart), *fine* (primary), *skip* (ink-2);
  counts in mono, voters as a small avatar stack. On the map an idea is a hollow dashed pin with a
  gold dot, under the planned stops and never on a route.
- **Who's there:** the day chip shows "3/4" with a people icon when someone is away; the day
  header says "Not here: Nam"; a gold note on a stop says when someone who loves it isn't there.
- **During the trip:** the day chip reads "Day 2 · Today" and the planner opens on it; the part of the
  day it is now has a jade label with a pulsing "Now" pill; a thin progress bar under each day header
  (went = jade, skipped = `ink-2` at 40%). On phones the went / skipped buttons get their own labelled row
  under the title, and a swipe shows what it will do underneath (jade "Went" from the left, ink "Skip"
  from the right). "Where to now?" is the primary button in the jade "You're on this trip" panel and opens a
  sheet: open state in jade ("Open until 17:30"), closed in `accent-700` with the card at 70% opacity, walk
  time in mono, a jade "Go" hand-off. Split groups use lane colours (jade, `accent-700`, `gold-700`, `ink-2`):
  a 3px left rail on their stops, a chip per group under the part-of-day label, and a small avatar stack with
  names; the meet-up point is a `gold-50` pill with a flag. Offline shows a `gold-50` notice with WifiOff.
- **After the trip:** from the first day, each stop has two round toggles — ✓ went (fills `primary`)
  and ✕ skipped (fills `ink-2`); a skipped title is struck through in `ink-2`. When the trip is over,
  a `sand-2` banner with an accent flag offers "Mark what you did" (a went/skipped checklist) and the recap.
  Remixed stops carry a small `accent-50` evidence pill with a fork icon ("The original group went · ♥ 3").
- **Recap:** cover band, mono eyebrow, `sand-2` stat tiles (mono numbers in the display face), the
  visited-only map, favourites (top 3 by hearts), a day-coloured timeline with photo grids (a small
  dashed "Add photo" button when a stop has none), the trip's stamps and a `primary-50` "Share as a post" band.
- **Expenses:** a wide sheet. A `sand-2` summary (total in the display face, per-traveller line,
  budget bar `primary` → `danger` when over, category totals), then balances (gets back = `primary`,
  owes = `accent-700`), the settle-up transfers with "Mark paid", and the expense list. Money is
  always `Intl` currency format in the interface language with `tabular-nums`.

## Home, Explore and places

- **Home:** greeting, then a "now" card for the trip that matters today — under way, else just back with stops
  to mark (≤ 7 days), else the next one, else a draft. It pairs a 112px `RouteThumb` (sky-tinted before and
  during) with a mono eyebrow ("DAY 3 OF 3 · MORNING" in jade with a pulsing dot; "NEXT TRIP · IN 12 DAYS" or
  "JUST BACK" in `accent-700`). During a trip a `sand-2` band shows the next stop, "Then: …", the day's
  progress bar and "Where to now?" (primary). Below: "Your trips" as a scrolling row of swatch cards with the
  phase ("On now" in jade). The right rail is one featured `TripCard` and compact rows (swatch, title, route,
  fork count).
- **Explore:** before anything is typed, an atlas map leads — one pin per destination with shared trips,
  diameter ∝ √trips (22–56px), the count in mono, the name underneath; names that would collide are hidden
  (biggest destinations win) and show on hover/focus. Pins are links.
- **Destination page:** mono country eyebrow, the name in the display face (extrabold), the blurb, then a
  map of its places as the hero. No places yet → the illustrated cover as before.
- **Place page:** mono eyebrow (category · destination), name, local name, then a row of facts: open-now pill
  (jade "Open now · until 22:30"; closed in `accent-50`/`accent-700` "Closed · opens 07:00", always in the
  place's local time, title says so), rating chip, "N groups went" chip (public trips that marked it). Photos
  lead when there are some; otherwise the map, with a one-line dashed "be the first" strip. Details card and
  a weekly hours table (mono times, today marked) side by side.
- **Place rows:** a small jade "Open" / `accent-700` "Closed" dot-label before the rating; within 2 km the
  distance adds "N min walk". Explore → Places has an "Open now" chip that filters the loaded results.

## Components (current conventions)

- **Button:** `font-semibold`, `rounded-xl`, no shadow. One `primary` per screen; `accent` only for
  the single highest-emotion CTA ("Use this trip"); `secondary` for the rest. Icon-only on phones
  keeps its text as `sr-only` so the accessible name doesn't change.
- **Chip:** active = `bg-ink text-white`. **Day chip:** active fills with the day colour.
- **Badge tones:** `neutral`, `primary`, `accent` (accent-700 text), `gold`.
- **Map pins:** round, numbered (mono), day colour with a `surface` ring; selected = jade halo. Ideas: hollow,
  dashed `ink-2` ring, gold dot, no number.
- **Focus:** 2px `primary` outline, 2px offset.
- **Touch:** controls ≥ 44px hit area (`hit` helper in `components/ui`).
- **Icons:** lucide-react, one stroke style; icon-only buttons need `label`.

## Motion

Motion explains what changed and where it went — it tells the story of the route, never decorates.
UI 150–300ms; map moves 600–900ms; only `transform` / `opacity` are animated. Helpers: `lib/motion.ts`.

- **Route reveal (planner):** choosing a day flies the camera to it, then the day's route draws from
  the first stop to the last (`drawDuration`: 0.7–1.6s by stop count) and each numbered pin pops in
  as the line reaches it. Tile map: progressive GeoJSON; offline SVG map: `pathLength` dash + per-pin delay.
- **List ↔ map:** hovering a stop lifts its pin (`is-hover`, spring easing) and hovering a pin outlines
  the card; picking a pin scrolls its card into view and pulses it once in jade (`animate-select-pulse`).
- **Drag to reorder:** the grip lifts the stop (scale 1.02 + `shadow-pop`), the others slide aside,
  across days too, with edge auto-scroll; keyboard: Space, arrows, Space/Escape, every step announced.
  The move is optimistic; `useFlip` animates every stop to its new place (also for collaborators' edits).
- **Card → planner:** the trip card's cover and title morph into the planner header
  (React `<ViewTransition>`, class `trip-morph`, 380ms). Only one card per trip may carry `morph` on a page.
- `rise` (350ms) for sheets and menus; toasts slide in.

### 2D motion graphics

Hand-drawn SVG + CSS keyframes (no animation library), theme tokens only, so every piece works in
Atlas Night. Each plays at one meaningful moment and animates `transform` / `opacity` /
`stroke-dashoffset` only. Styles live in the "2D motion graphics" block of `globals.css`.

- **Living logo** (`LogoMark`): on first paint the dashed route draws itself through a mask and the
  three stops pop in order; hovering the logo link makes them hop.
- **Route loader** (`RouteLoader`, used by `PageLoader`): a vermilion comet runs the logo route and
  each stop swells as it passes. Replaces the spinner.
- **Atlas hero** (`components/art/AtlasHero.tsx`, auth pages): a paper map inks itself in —
  coastline and contours, then a vermilion route at a steady pace with each city popping as the
  line arrives, a compass needle that spins and settles, then a slow sway. The journey (Vietnam,
  Japan, Italy, Thailand) is picked on the server per request, so there's no hydration mismatch.
- **Sky by local time** (`RouteThumb sky`, planner header): the thumbnail is tinted for dawn / day /
  dusk / night *at the trip's first stop* (sun altitude from its coordinates, `lib/sky.ts`; no time
  zone needed), with the sun or moon on a small arc. It rises in on first paint and drifts each minute.
  The label ("Kyoto right now: dusk") is the thumbnail's accessible name and tooltip.
- **Passport stamps** (`PassportStamps`, profile): a stamp per destination; shape, ink (vermilion,
  jade, gold) and tilt come from the place id. Pressed on the first time the section scrolls into
  view (overshoot + a ring of ink spreading), 110ms apart. Mono type here is printed matter, i.e. data.
- **Ticket stubs** (itinerary): flights and transfers get a notched, perforated stub with the
  arrival time; on hover the stub starts to tear (3° tilt).
- **Route rider**: while a route draws, a vehicle rides its tip — walker (≤ 5 km leg), train
  (≤ 500 km), or a plane that climbs and lands over its ground shadow (longer). Per leg on the tile
  map, per day route on the offline SVG map; it fades out at the end (`components/map/rider.ts`).
- **Empty states** (`components/art/EmptyArt.tsx`, via `EmptyState art`): no trips — a suitcase lid
  swings open and a folded map pops out; no results — binoculars sweep the horizon twice;
  offline — a compass needle spins and settles; 404 — a traveller walks to the torn edge of the map
  and leans over it.
- **Folded-map loading** (`FoldedMap`): card and map placeholders open panel by panel like a paper
  map, then a slow sheen while waiting.

Every animation is disabled under `prefers-reduced-motion` (state changes apply instantly; the
illustrations show their final frame).

## Avoid

- Glassmorphism, gradients as brand colour, neon accents (generic "travel app" looks).
- Raw `accent` text on light backgrounds; grey-on-paper low-contrast text.
- Heavy drop shadows on cards; more than one vermilion element competing outside the map.
- Decorative mono (mono is for data only); emoji as icons; hardcoded hex in components.
- Pins or routes that don't use the day colour of their day.

## Atlas Night (dark mode)

Same token names, re-tuned for a dark canvas (not inverted), under `html[data-theme="dark"]` in
`globals.css`. The theme is **System** by default (follows `prefers-color-scheme`) and can be pinned to
Light or Dark in the account menu, Settings and the auth pages; the choice is kept per device
(`lib/theme.ts`) and applied before first paint by an inline script, so there's no flash.

| Token | Hex | Check |
|---|---|---|
| `sand` (bg) / `surface` / `sand-2` (well) | `#15130f` / `#1e1b16` / `#2a251f` | |
| `ink` / `ink-2` | `#e9e2d4` / `#cbc2b2` | 14.4 / 10.5 on bg |
| `muted` | `#a89e8f` | 7.0 on bg, 5.8 on well, 5.0 on primary-50 |
| `line` / `line-strong` | `#3a342c` / `#5a5147` | |
| `primary` / `-600` / `-50` | `#7cc4b0` / `#9ad3c3` / `#1b3430` | 9.2 on bg, 6.6 on primary-50 |
| `on-primary`, `on-ink` | `#15130f` | 9.2 on primary, 14.4 on ink |
| `accent` / `accent-600` / `accent-700` / `accent-50` | `#ff7a45` / `#c2461b` / `#ff8a5c` / `#3b211a` | accent-700 8.0 on bg; white on accent-600 5.0 |
| `gold-700` on `gold-50` | `#e8bb63` on `#352a14` | 7.9 |
| `danger` | `#ff8a80` | 8.1 on bg |
| `map` / `contour` / `water` | `#1b1915` / `#2e2922` / `#24413a` | |
| `pin-ring` | `#e9e2d4` | day pins (2.3–3.3:1 on the dark map) get a light ring for 3:1+ separation |

Rules that make both themes work:

- Text on a filled `primary` or `ink` surface uses `text-on-primary` / `text-on-ink`, never `text-white`
  (primary and ink turn light in Atlas Night). White stays only on photos, covers, day colours and `accent-600`.
- Category and item-type tints carry `cat-tint` + `--cat` (the pin colour); Atlas Night derives a dark
  tint and a light glyph from it.
- Tile maps switch basemap with the theme (OpenFreeMap Positron ↔ Dark; `NEXT_PUBLIC_MAP_STYLE_URL_DARK`).
- The E2E run checks axe contrast in Vietnamese + dark on the planner, Home, Explore, Settings and Notifications.
