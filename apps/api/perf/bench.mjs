#!/usr/bin/env node
/* eslint-disable no-console -- a command-line report */
/**
 * Times the API calls the app makes against a running API, with parameters taken from your own data
 * (the busiest province, a real place, a real destination…). Read-only.
 *
 *   npm run perf -w @triply/api                 # API on http://localhost:4000
 *   API_URL=https://api.example.com PERF_EMAIL=you@x PERF_PASSWORD=… npm run perf -w @triply/api
 *
 * Each call runs 1 + RUNS times; the first (cold) run is shown separately and the budget applies to the median
 * of the rest. Exit code 1 when a call is over budget, so it can gate CI or a deploy.
 */
const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "") + "/api/v1";
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const EMAIL = process.env.PERF_EMAIL ?? "an@golaly.dev";
const PASSWORD = process.env.PERF_PASSWORD ?? "demo1234";
const BUDGET = { user: Number(process.env.PERF_BUDGET_MS ?? 300), admin: Number(process.env.PERF_ADMIN_BUDGET_MS ?? 800) };

let cookie = "";
async function call(path) {
  const t = performance.now();
  const res = await fetch(API + path, { headers: { cookie, accept: "application/json" } });
  const body = await res.text();
  const ms = performance.now() - t;
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${body.slice(0, 200)}`);
  return { ms, json: JSON.parse(body) };
}

async function login() {
  const res = await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "golaly" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) return false;
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return true;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const admin = await login();
  // Parameters from the data itself.
  const areas = (await call("/places/areas")).json;
  const countries = areas.filter((a) => a.kind === "country").sort((a, b) => b.placeCount - a.placeCount);
  const country = countries[0];
  const provinces = areas.filter((a) => a.parentSlug === country?.slug).sort((a, b) => b.placeCount - a.placeCount);
  const busiest = provinces[0];
  const quiet = provinces[provinces.length - 1];
  const sample = (await call(`/places/browse?area=${busiest.slug}&limit=1`)).json.items[0];
  const destinations = (await call("/destinations")).json;
  const areaDest = destinations.find((d) => d.kind === "area") ?? destinations[0];
  const curated = destinations.find((d) => d.kind === "curated") ?? destinations[0];
  const groups = (await call("/places/categories")).json;
  const group = groups[0]?.key;
  const category = groups[0]?.children?.[0]?.key;
  const near = sample ? `${sample.lat.toFixed(4)},${sample.lng.toFixed(4)}` : "16.0544,108.2022";
  console.log(`data: ${countries.map((c) => `${c.slug} ${c.placeCount}`).join(", ")}; busiest province ${busiest?.slug} (${busiest?.placeCount})\n`);

  const user = [
    ["Explore home", "/explore"],
    ["Where picker (areas)", "/places/areas"],
    ["Categories", "/places/categories"],
    ["Browse: everywhere", "/places/browse"],
    ["Browse: biggest country", `/places/browse?area=${country.slug}`],
    ["Browse: busiest province", `/places/browse?area=${busiest.slug}`],
    ["Browse: quiet province", `/places/browse?area=${quiet.slug}`],
    ["Browse: province + group", `/places/browse?area=${busiest.slug}&group=${group}`],
    ["Browse: province + category", `/places/browse?area=${busiest.slug}&category=${category}`],
    ["Browse: province, top rated", `/places/browse?area=${busiest.slug}&sort=rating`],
    ["Browse: province, page 3", `/places/browse?area=${busiest.slug}&cursor=48`],
    ["Browse: near me 5 km", `/places/browse?near=${near}`],
    ["Browse: near me, nearest", `/places/browse?near=${near}&sort=distance`],
    ["Browse: curated destination", `/places/browse?destination=${curated.slug}`],
    ["Browse: area destination", `/places/browse?destination=${areaDest.slug}`],
    ["Browse: text everywhere", "/places/browse?q=pho"],
    ["Browse: text, accented", `/places/browse?q=${encodeURIComponent("phở")}`],
    ["Browse: text, typo", "/places/browse?q=restaurnt"],
    ["Browse: text in province", `/places/browse?area=${busiest.slug}&q=${encodeURIComponent("bánh mì")}`],
    ["Search: all", "/search?q=pho"],
    ["Search: places, 2 words", "/search?q=hoi%20an&type=places"],
    ["Search: rare word", "/search?q=xyzzyq"],
    ["Itinerary place search", "/places/search?q=banh%20mi"],
    ["Place page", `/places/${sample.id}`],
    ["Destination page (area)", `/destinations/${areaDest.slug}`],
    ["Destination page (curated)", `/destinations/${curated.slug}`],
    ["Destinations list", "/destinations"],
  ];
  const adminCalls = admin
    ? [
        ["Admin: countries", "/admin/areas"],
        ["Admin: provinces", `/admin/areas?parent=${country.slug}`],
        ["Admin: places", "/admin/places"],
        ["Admin: places search", "/admin/places?q=pho"],
        ["Admin: places by area+category", `/admin/places?area=${busiest.slug}&category=${group}`],
        ["Admin: hidden places", "/admin/places?status=hidden"],
        ["Admin: duplicates", "/admin/merge-candidates"],
        ["Admin: duplicates by province", `/admin/merge-candidates?area=${busiest.slug}`],
        ["Admin: categories", "/admin/categories"],
        ["Admin: unmapped categories", "/admin/category-maps?unmapped=true"],
        ["Admin: runs", "/admin/sync-runs"],
      ]
    : [];
  if (!admin) console.log(`(admin calls skipped: couldn't log in as ${EMAIL})\n`);

  let over = 0;
  const rows = [];
  for (const [kind, list] of [["user", user], ["admin", adminCalls]]) {
    for (const [name, path] of list) {
      try {
        const cold = (await call(path)).ms;
        const warm = [];
        for (let i = 0; i < RUNS; i++) warm.push((await call(path)).ms);
        const m = median(warm);
        const ok = m <= BUDGET[kind];
        if (!ok) over++;
        rows.push({ name, cold: Math.round(cold), median: Math.round(m), max: Math.round(Math.max(...warm)), budget: BUDGET[kind], ok: ok ? "" : "SLOW" });
      } catch (e) {
        over++;
        rows.push({ name, cold: "-", median: "-", max: "-", budget: BUDGET[kind], ok: e.message.slice(0, 60) });
      }
    }
  }
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`${pad("call", 32)}${lpad("cold", 8)}${lpad("median", 8)}${lpad("max", 8)}${lpad("budget", 8)}  `);
  for (const r of rows) console.log(`${pad(r.name, 32)}${lpad(r.cold, 8)}${lpad(r.median, 8)}${lpad(r.max, 8)}${lpad(r.budget, 8)}  ${r.ok}`);
  console.log(`\n${rows.length - over}/${rows.length} within budget (ms, median of ${RUNS} warm runs)`);
  process.exitCode = over ? 1 : 0;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 2;
});
