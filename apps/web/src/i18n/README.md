# Interface languages (English / Tiếng Việt)

Golaly's interface is available in English and Vietnamese. No i18n library: the catalogs are plain
typed TypeScript objects, so a missing or misspelt key is a type error, not a blank label at runtime.

## How the language is chosen

1. The `triply-locale` cookie (set by the language switch in the account menu, Settings and the auth pages).
2. Otherwise the browser's `Accept-Language` (Vietnamese if it prefers `vi`, else English).
3. Signed in: the language saved on the account (`user_profiles.locale`) wins after sign-in on a new device,
   and switching saves it back, so emails and other devices follow.

The root layout reads it on the server (`getLocale()` in `server.ts`) so the first HTML is already in the right
language; `I18nProvider` (in `client.tsx`) switches instantly afterwards and refetches server-built text.
Every API call sends `X-Triply-Locale`; the API answers errors, notification sentences and category names in it.
Place names follow the interface language unless Settings pins another (`lib/placeLanguage.ts`).

## Catalog layout

```
i18n/en/<namespace>.ts   English — the source of truth; its shape is the `Messages` type
i18n/vi/<namespace>.ts   Vietnamese — typed `Messages["<namespace>"]`, must match exactly
```

| Namespace | What's in it |
|---|---|
| `common` | Buttons and words used everywhere (Save, Cancel, Loading…), generic errors |
| `labels` | Enum labels: roles, visibility, item types, traveler types, interests, leg modes |
| `format` | Pluralised counts and relative times (`days(n)`, `places(n)`, `justNow`) |
| `nav` | Navbar, tab bar, account menu, create sheet, theme/language switches |
| `titles` | Route `<title>`s (used by `titleFor()` in server layouts) |
| `auth`, `settings`, `home`, `social`, `explore`, `trips` | One namespace per area of the app |

## Writing components

```tsx
"use client";
import { useFormat, useT } from "@/i18n/client";

const t = useT();          // t.trips.planner.addPlace(3)
const f = useFormat();     // f.dateRange(start, end), f.timeAgo(iso), f.count(n), f.day(iso)
```

- Plain strings for fixed text; **functions** for anything with variables or plurals:
  `addPlace: (day: number) => \`Add a place to Day ${day}\``. Never concatenate translated fragments
  in components — word order differs between the languages.
- Text with inline markup (a bold name, a link): split into `before` / `after` keys around the element.
- Server components: `const t = await getMessages()` from `@/i18n/server`.
- Admin screens stay English (they're for the team that runs the catalog).
- User content (trip titles, descriptions, place names, comments) is never translated.

## Vietnamese style

Address the user as **bạn**; short, friendly, no exclamation marks. Sentence case. Typographic quotes “ ”.
Keep product terms consistent:

| English | Tiếng Việt |
|---|---|
| trip / itinerary / day | chuyến đi / lịch trình / Ngày (Day 2 → Ngày 2) |
| place / destination / stop | địa điểm / điểm đến / điểm dừng |
| Owner / Editor / Viewer | Chủ chuyến đi / Người chỉnh sửa / Người xem |
| travelers (members) | bạn đồng hành |
| remix / fork | remix ("Use this trip" → "Dùng chuyến đi này") |
| save / saved | lưu / đã lưu |
| invite / invitation | mời / lời mời |
| post / comment / like / follow | bài viết / bình luận / thích / theo dõi |
| Explore / For you / Following | Khám phá / Dành cho bạn / Đang theo dõi |
| Public / Link only / Private | Công khai / Chỉ người có link / Riêng tư |
