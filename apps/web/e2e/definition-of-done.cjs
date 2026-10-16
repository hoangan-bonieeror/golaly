/**
 * MVP Definition-of-Done journey (spec §51) against the REAL stack: web → API → Postgres.
 *
 *   npm run db:seed              # demo users: an@ / minh@ / sarah@triply.dev, password demo1234
 *   npm run dev                  # API on :4000, web on :3000
 *   npx playwright install chromium   # once
 *   npm run e2e                  # (BASE_URL=... to override)
 *
 * Each user gets a separate browser context (separate cookies), like separate people.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const shots = path.join(__dirname, "artifacts");
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  let failed = 0;
  const pages = [];
  const newUser = async (tag) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && !/401|403|404|Failed to load resource/.test(m.text()) && errors.push(`${tag}: ${m.text()}`));
    pages.push([tag, p]);
    return p;
  };
  const step = async (name, fn) => {
    try {
      await fn();
      console.log("✓", name);
    } catch (e) {
      failed++;
      console.log("✗", name, "—", e.message.split("\n")[0]);
      for (const [tag, p] of pages) await p.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, "_")}-${tag}.png`) }).catch(() => {});
    }
  };
  const login = async (p, email) => {
    await p.goto(`${BASE}/login`);
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Password").fill("demo1234");
    await p.getByRole("button", { name: "Log in", exact: true }).click();
    await p.waitForURL("**/home");
  };
  const itemCount = (p) => p.locator("ol li[data-item-id]").count();

  const A = await newUser("owner");
  const stamp = Date.now().toString(36);
  const tripTitle = `E2E Tokyo ${stamp}`;
  let tripUrl;

  await step("1. user registers (and onboards)", async () => {
    await A.goto(`${BASE}/register`);
    await A.getByLabel("Email").fill(`tester.${stamp}@example.com`);
    await A.getByLabel("Username").fill(`tester_${stamp}`);
    await A.getByLabel("Password").fill("walnut-harbor-2026");
    await A.getByRole("button", { name: "Create account" }).click();
    await A.waitForURL("**/onboarding");
    await A.getByRole("button", { name: "Friends" }).click();
    await A.getByRole("button", { name: "Continue" }).click();
    await A.getByRole("button", { name: "Food" }).click();
    await A.getByRole("button", { name: "Start exploring" }).click();
    await A.waitForURL("**/home");
  });

  await step("2–3. creates a trip with a destination", async () => {
    await A.goto(`${BASE}/trips/new`);
    await A.getByLabel("Search destinations").fill("Tok");
    await A.getByRole("button", { name: /\+ Tokyo/ }).click();
    await A.getByLabel("Trip name").fill(tripTitle);
    await A.getByLabel("Start date").fill("2027-04-01");
    await A.getByLabel("End date").fill("2027-04-02");
    await A.getByRole("button", { name: "Create trip" }).click();
    await A.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
    tripUrl = A.url();
    await A.getByText("Tokyo").first().waitFor();
  });

  await step("4. adds 3 itinerary items", async () => {
    for (const [query, name] of [["Shibuya Cr", "Shibuya Crossing"], ["Sensō", "Sensō-ji"], ["Ichiran", "Ichiran Shibuya"]]) {
      await A.getByRole("button", { name: "Add a place to Day 1" }).click();
      await A.getByLabel("Search places").fill(query);
      await A.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).first().click();
      await A.getByRole("button", { name: "Add to itinerary" }).click();
      await A.getByRole("dialog").waitFor({ state: "detached" });
    }
    await A.waitForFunction(() => document.querySelectorAll("ol li[data-item-id]").length === 3);
  });

  let inviteLink;
  await step("5. invites another person (link)", async () => {
    await A.getByRole("button", { name: "Invite" }).first().click();
    await A.getByRole("tab", { name: /Invite link/ }).click();
    await A.getByRole("radio", { name: /Viewer/ }).click();
    await A.getByRole("button", { name: "Create invite link" }).click();
    inviteLink = await A.getByTestId("invite-link").innerText();
    await A.keyboard.press("Escape");
  });

  const B = await newUser("minh");
  await step("6. second person accepts — as Viewer they can't edit", async () => {
    await login(B, "minh@triply.dev");
    await B.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE));
    await B.getByRole("button", { name: /Accept/ }).click();
    await B.waitForURL(tripUrl);
    await B.getByText("You · Viewer").waitFor();
    if (await B.getByRole("button", { name: "Add a place to Day 1" }).count()) throw new Error("viewer can add items");
  });

  await step("7. owner makes them Editor", async () => {
    await A.goto(`${tripUrl}?tab=members`);
    await A.getByLabel("Role for Minh").selectOption("EDITOR");
    await A.getByText("Role updated").waitFor();
  });

  await step("8–9. editor modifies itinerary; owner sees presence and the change live (no reload)", async () => {
    await A.goto(tripUrl);
    await B.reload();
    await B.getByText("You · Editor").waitFor();
    await A.getByText("Minh is here too").waitFor({ timeout: 10000 });
    await B.getByRole("button", { name: "Item actions", exact: true }).first().click();
    await B.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await A.getByText("Minh is editing Day 1").waitFor({ timeout: 10000 });
    await B.getByLabel("Title").fill("Shibuya at night (Minh)");
    await B.getByRole("button", { name: "Save changes" }).click();
    await A.getByText("Shibuya at night (Minh)").waitFor({ timeout: 10000 });
    await A.getByText(/Edited by Minh/).first().waitFor();
    if (await B.getByRole("button", { name: "Trip settings" }).count()) throw new Error("editor sees owner settings");
  });

  await step("10. owner makes the trip public", async () => {
    await A.goto(`${tripUrl}/settings`);
    await A.getByRole("radio", { name: /Public/ }).click();
    await A.getByRole("button", { name: "Save changes" }).click();
    await A.waitForURL(tripUrl);
    await A.getByText("Public", { exact: true }).first().waitFor();
  });

  const C = await newUser("sarah");
  let forkUrl;
  await step("11–13. another user discovers, saves and forks the trip", async () => {
    await login(C, "sarah@triply.dev");
    await C.goto(`${BASE}/explore`);
    await C.getByLabel("Search", { exact: true }).fill(stamp);
    await C.getByRole("link", { name: new RegExp(tripTitle) }).first().click();
    await C.waitForURL(tripUrl);
    await C.getByRole("button", { name: "Save", exact: true }).click();
    await C.getByRole("button", { name: "Saved", exact: true }).waitFor();
    await C.getByRole("button", { name: "Use this trip" }).click();
    await C.getByRole("button", { name: "Make it mine" }).click();
    await C.waitForURL((u) => /\/trips\/[0-9a-f-]{36}$/.test(u.pathname) && u.href !== tripUrl);
    forkUrl = C.url();
  });

  await step("14. forked trip is independently editable", async () => {
    await C.getByText("You · Owner").waitFor();
    await C.waitForFunction(() => document.querySelectorAll("ol li[data-item-id]").length === 3);
    await C.getByRole("button", { name: "Item actions", exact: true }).first().click();
    await C.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await C.waitForFunction(() => document.querySelectorAll("ol li[data-item-id]").length === 2);
    await C.goto(`${forkUrl}?tab=members`);
    await C.getByText("Trip members · 1").waitFor();
  });

  await step("15. original trip remains unchanged", async () => {
    await A.goto(tripUrl);
    await A.waitForFunction(() => document.querySelectorAll("ol li[data-item-id]").length === 3);
    await A.goto(`${tripUrl}?tab=members`);
    await A.getByText("Trip members · 2").waitFor();
  });

  await step("16. fork attribution is preserved", async () => {
    await C.goto(forkUrl);
    await C.getByText("Based on").waitFor();
    await C.getByRole("link", { name: tripTitle }).waitFor();
    await C.getByRole("link", { name: `@tester_${stamp}` }).waitFor();
  });

  let placeUrl;
  await step("17. explores places around a destination and adds one to a trip", async () => {
    await A.goto(`${BASE}/explore?tab=places&dest=tokyo`);
    await A.getByText(/places within 10 km of Tokyo/).waitFor();
    await A.getByRole("group", { name: "Kind of place" }).getByRole("button", { name: /^Food/ }).click();
    await A.waitForFunction(() => location.search.includes("group=food"));
    await A.locator('ol[aria-label="Places"][aria-busy="false"]').waitFor();
    const names = await A.locator('ol[aria-label="Places"] li a').allInnerTexts();
    if (!names.includes("Omoide Yokochō") || names.includes("Shibuya Crossing")) throw new Error(`food filter: ${names.join(", ")}`);
    await A.getByRole("link", { name: "Omoide Yokochō" }).click();
    await A.getByRole("heading", { level: 1, name: "Omoide Yokochō" }).waitFor();
    placeUrl = A.url();
    await A.getByRole("button", { name: "Add to trip" }).first().click();
    const sheet = A.getByRole("dialog");
    await sheet.getByRole("button", { name: new RegExp(tripTitle) }).click();
    await sheet.locator("label", { hasText: /^Day 2\b/ }).click();
    await sheet.getByRole("button", { name: "Add to Day 2" }).click();
    await sheet.getByRole("status").getByText(/is on Day 2 of/).waitFor();
    await sheet.getByRole("link", { name: "View trip" }).click();
    await A.waitForURL(tripUrl);
    await A.getByText("Omoide Yokochō").first().waitFor();
  });

  await step("17b. the group pools an idea, votes on it, and plans it into a day around who's there", async () => {
    await A.goto(tripUrl);
    await A.getByRole("button", { name: "Add an idea" }).click();
    const sheet = A.getByRole("dialog");
    await sheet.getByLabel("Search places").fill("Meiji");
    await sheet.getByRole("button", { name: /Meiji Jingu/ }).first().click();
    await sheet.getByRole("button", { name: "Add to itinerary" }).click();
    await sheet.waitFor({ state: "detached" });
    const idea = A.locator("#pool-body li", { hasText: "Meiji Jingu" });
    await idea.waitFor();

    // Minh (an editor) votes; the owner sees it live.
    await B.goto(tripUrl);
    await B.locator("#pool-body li", { hasText: "Meiji Jingu" }).getByRole("button", { name: /^Really want/ }).click();
    await idea.getByRole("button", { name: "Really want: 1 (Minh)" }).waitFor({ timeout: 10000 });

    // Minh leaves after Day 1.
    await A.goto(`${tripUrl}?tab=members`);
    await A.getByRole("button", { name: "Dates for Minh" }).click();
    const dates = A.getByRole("form", { name: "Dates for Minh" });
    await dates.getByLabel("Leaves").fill("2027-04-01");
    await dates.getByRole("button", { name: "Save dates" }).click();
    await A.getByText("Until Apr 1").waitFor();
    await A.keyboard.press("Escape");

    // Plan the idea into Day 2 afternoon: the sheet warns that Minh won't be there.
    await A.goto(tripUrl);
    await A.locator("#pool-body li", { hasText: "Meiji Jingu" }).getByRole("button", { name: "Item actions" }).click();
    await A.getByRole("menuitem", { name: "Plan into a day…" }).click();
    const plan = A.getByRole("dialog");
    await plan.locator("label", { hasText: /^Day 2\b/ }).click();
    await plan.getByRole("radio", { name: "Afternoon" }).click();
    await plan.getByText("Minh won't be here that day — and really wants Meiji Jingu.").waitFor();
    await plan.getByRole("button", { name: "Plan it" }).click();
    await A.getByRole("group", { name: "Day 2 · Afternoon" }).getByText("Meiji Jingu").waitFor();
    await A.getByText("Minh really wants this but won't be here that day").waitFor();
    if (await A.locator("#pool-body li", { hasText: "Meiji Jingu" }).count()) throw new Error("planned idea is still in the pool");
  });

  // After the trip (roadmap phase 3), on the seeded past trip "Hội An with the crew" (Minh is an editor).
  let hoianTrip;
  await step("17c. after the trip: mark a stop, split an expense, settle up, see the recap", async () => {
    const id = await B.evaluate(() =>
      fetch("/api/v1/trips?filter=all&limit=48", { headers: { "X-Requested-With": "triply" } })
        .then((r) => r.json())
        .then((r) => r.items.find((t) => t.title === "Hội An with the crew")?.id),
    );
    if (!id) throw new Error("seeded Hội An trip not found (run npm run db:seed)");
    hoianTrip = `/trips/${id}`;
    await B.goto(`${BASE}${hoianTrip}`);
    await B.getByText("This trip is over.").waitFor();
    // One tap: the rained-out basket boats did happen after all… then back to skipped.
    const went = B.getByRole("button", { name: "Mark Basket boats, Coconut Forest as visited" });
    await went.click();
    await B.locator('[aria-pressed="true"][aria-label="Mark Basket boats, Coconut Forest as visited"]').first().waitFor();
    await B.getByRole("button", { name: "Mark Basket boats, Coconut Forest as skipped" }).click();
    await B.locator('[aria-pressed="true"][aria-label="Mark Basket boats, Coconut Forest as skipped"]').first().waitFor();

    // An expense split by amount, from the stop's menu.
    await B.locator("li[data-item-id]", { hasText: "Dinner at Mót" }).getByRole("button", { name: "Item actions" }).click();
    await B.getByRole("menuitem", { name: "Add expense" }).click();
    const sheet = B.getByRole("dialog", { name: "Expenses" });
    await sheet.getByLabel("What for").fill(`E2E dessert ${stamp}`);
    await sheet.getByLabel("Amount (VND)").fill("300000");
    await sheet.getByRole("radio", { name: "By amount" }).click();
    await sheet.getByLabel("An's share").fill("200000");
    await sheet.getByText(/100,000 left to assign/).waitFor();
    await sheet.getByLabel("Minh's share").fill("100000");
    await sheet.getByText("Adds up").waitFor();
    await sheet.getByRole("button", { name: "Save expense" }).click();
    const row = sheet.getByRole("button", { name: `Edit: E2E dessert ${stamp}` });
    await row.waitFor();
    // Settle the first suggested transfer, then undo it.
    const before = await sheet.getByRole("button", { name: /^Mark that / }).count();
    await sheet.getByRole("button", { name: /^Mark that / }).first().click();
    await B.getByText("Payment recorded").waitFor();
    if ((await sheet.getByRole("button", { name: /^Mark that / }).count()) >= before) throw new Error("settling didn't reduce the transfers");
    await sheet.getByText(/Payments made/).click();
    await sheet.getByRole("button", { name: "Undo" }).last().click();
    await B.getByText("Payment removed").waitFor();
    // Clean up the expense.
    await row.click();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await B.getByText("Expense deleted").waitFor();
    await B.keyboard.press("Escape");

    // The recap: places the group went to.
    await B.goto(`${BASE}${hoianTrip}/recap`);
    await B.getByRole("heading", { name: "Hội An with the crew" }).waitFor();
    await B.getByText("8 of 11 places").waitFor();
    await B.getByRole("heading", { name: "The group's favorites" }).waitFor();

    // A visitor sees how it went, but never the money.
    await C.goto(`${BASE}${hoianTrip}`);
    await C.getByText("This trip is over.").waitFor();
    if (await C.getByRole("button", { name: "Expenses" }).count()) throw new Error("visitor sees the expenses button");
    const status = await C.evaluate((u) => fetch(`/api/v1${u}/expenses`, { headers: { "X-Requested-With": "triply" } }).then((r) => r.status), hoianTrip);
    if (status !== 403) throw new Error(`visitor got ${status} for expenses`);
  });

  // During the trip (roadmap phase 2), on the seeded in-progress "Saigon long weekend" (Minh is an editor).
  let saigonTrip;
  await step("17d. during the trip: today, swipe to mark, where to now, split the group", async () => {
    const id = await B.evaluate(() =>
      fetch("/api/v1/trips?filter=all&limit=48", { headers: { "X-Requested-With": "triply" } })
        .then((r) => r.json())
        .then((r) => r.items.find((t) => t.title === "Saigon long weekend")?.id),
    );
    if (!id) throw new Error("seeded Saigon trip not found (run npm run db:seed)");
    saigonTrip = `/trips/${id}`;
    await B.goto(`${BASE}${saigonTrip}`);
    // Opens on today, with the part of the day it is now marked.
    await B.locator('button[aria-current="date"][aria-pressed="true"]', { hasText: "Today" }).waitFor();
    await B.locator('[aria-current="time"]').first().waitFor();
    // The rest happens on Day 2 (today, unless this machine's clock is near midnight).
    await B.getByRole("group", { name: "Show day" }).getByRole("button", { name: /^Day 2/ }).click();

    // The group splits this afternoon: lanes, who's going, and the meet-up point.
    await B.getByRole("group", { name: "The group splits up" }).first().waitFor();
    await B.getByText("Meet-up point").first().waitFor();
    await B.locator("li[data-item-id]", { hasText: "Book Street" }).getByRole("button", { name: "Item actions" }).click();
    await B.getByRole("menuitem", { name: "Who's going?" }).click();
    const who = B.getByRole("dialog", { name: "Who's going to Book Street?" });
    await who.getByRole("checkbox", { name: "Minh" }).check();
    await who.getByRole("button", { name: "Save" }).click();
    await B.getByLabel("Going: Minh & Nam").or(B.getByLabel("Going: Nam & Minh")).first().waitFor();
    await B.locator("li[data-item-id]", { hasText: "Book Street" }).getByRole("button", { name: "Item actions" }).click();
    await B.getByRole("menuitem", { name: "Who's going?" }).click();
    await who.getByRole("checkbox", { name: "Minh" }).uncheck();
    await who.getByRole("button", { name: "Save" }).click();
    await B.getByLabel("Going: Nam").first().waitFor();

    // Where to now? (no location permission here: the plan without distances).
    await B.getByRole("button", { name: "Where to now?" }).click();
    const next = B.getByRole("dialog", { name: "Where to now?" });
    await next.getByRole("heading", { name: "Left in today's plan" }).waitFor();
    await next.getByRole("link", { name: /^Directions to / }).first().waitFor();
    await B.keyboard.press("Escape");

    // Phones: a swipe marks a stop (right = went, again = undo).
    await B.setViewportSize({ width: 390, height: 844 });
    await B.goto(`${BASE}${saigonTrip}`);
    await B.getByRole("group", { name: "Show day" }).getByRole("button", { name: /^Day 2/ }).click();
    const card = B.locator("li[data-item-id]", { hasText: "War Remnants Museum" });
    const went = card.getByRole("button", { name: "Mark War Remnants Museum as visited" });
    const swipe = () =>
      card.locator(".touch-pan-y").first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y }));
        ev("pointerdown", r.left + 20);
        for (const dx of [16, 40, 80, 120]) ev("pointermove", r.left + 20 + dx);
        ev("pointerup", r.left + 140);
      });
    const before = await went.getAttribute("aria-pressed");
    await swipe();
    await B.locator(`[aria-label="Mark War Remnants Museum as visited"][aria-pressed="${before === "true" ? "false" : "true"}"]:visible`).waitFor();
    await swipe();
    await B.locator(`[aria-label="Mark War Remnants Museum as visited"][aria-pressed="${before}"]:visible`).waitFor();
    await B.setViewportSize({ width: 1360, height: 900 });
  });

  // A 96×64 PNG: the smallest image the media pipeline accepts is 64×64.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAwElEQVR4nO3ZwQnDQADEQNejRtL6lZV/IP6EsH4MXAVCK5/t67xyzncIFzrnVhGAAqhfVsKgAIpB/e9RY2IBFIMysVYXWg0KoBiUiaVBPfO7gkgHUAzKxNKg5j0W6QCKQZlY8+64KAZQDMrEmgfIy2oAxaBMLA1qHmORDqAYlIk1j46LYgDFoEyshxx/VgMoBmViaVDzHot0AMWgTKx5d1wUAygGZWLNA+RlNYBiUCaWBjWPsUgHUAzKxJpH5+O8ATloWbTqlBPYAAAAAElFTkSuQmCC",
    "base64",
  );
  await step("18. a traveler adds a photo to a place page", async () => {
    await C.goto(placeUrl);
    await C.getByRole("button", { name: "Be the first to add one" }).click();
    const sheet = C.getByRole("dialog");
    await sheet.getByLabel("Choose a photo").setInputFiles({ name: "alley.png", mimeType: "image/png", buffer: PNG });
    await sheet.getByRole("img", { name: "Your photo" }).waitFor();
    await sheet.getByLabel("Caption (optional)").fill(`Lanterns ${stamp}`);
    await sheet.getByRole("checkbox").check();
    await sheet.getByRole("button", { name: "Share photo" }).click();
    await sheet.getByRole("status").getByText("Your photo is on the place page").waitFor();
    await sheet.getByRole("button", { name: "Done" }).click();
    await C.getByRole("button", { name: new RegExp(`Open photo 1 of 1: Lanterns ${stamp}`) }).click();
    await C.getByRole("dialog").getByText("Photo by").waitFor();
    await C.keyboard.press("Escape");
    // The owner sees it too, with the uploader's credit.
    await A.goto(placeUrl);
    await A.getByText("Photo by").first().waitFor();
  });

  await step("privacy: private trips never leak to other users", async () => {
    await C.goto(`${BASE}/u/an.nguyen`);
    await C.getByRole("heading", { name: "An", exact: true }).waitFor();
    if (await C.getByText("Japan — 7 Days").count()) throw new Error("private trip on public profile");
    await C.goto(`${BASE}/explore`);
    await C.getByLabel("Search", { exact: true }).fill("Japan — 7");
    await C.waitForTimeout(800);
    if (await C.getByRole("link", { name: /Japan — 7 Days/ }).count()) throw new Error("private trip in search");
  });

  // Accessibility gate: no serious/critical axe-core violations on the main screens.
  await step("accessibility: no serious or critical axe violations", async () => {
    const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    const routes = ["/home", "/explore", "/explore?tab=places&dest=hoi-an", "/explore/hoi-an", "/trips", tripUrl.replace(BASE, ""), "/u/an.nguyen", "/saved", "/notifications", "/settings"];
    if (placeUrl) routes.push(placeUrl.replace(BASE, ""));
    const problems = [];
    // Visitor (C) on the public pages, and the owner (A) on the planner they can edit: list, map and members.
    const trip = tripUrl.replace(BASE, "");
    // …and once more in Vietnamese with the dark theme (contrast is re-checked in Atlas Night).
    const runs = [
      [C, routes, false],
      [A, [trip, `${trip}?view=map`, `${trip}?tab=members`, "/admin/analytics", "/admin/analytics?days=90"], false],
      ...(saigonTrip ? [[B, [saigonTrip], false], [B, [saigonTrip], true]] : []),
      ...(hoianTrip ? [[B, [hoianTrip, `${hoianTrip}?tab=expenses`, `${hoianTrip}/recap`], false], [B, [hoianTrip, `${hoianTrip}?tab=expenses`, `${hoianTrip}/recap`], true]] : []),
      [A, [trip, `${trip}?view=map`, "/home", "/explore", "/settings", "/notifications", "/admin/analytics"], true],
    ];
    for (const [page, list, viDark] of runs)
      for (const vp of [{ width: 1360, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(vp);
        if (viDark) {
          await page.context().addCookies([{ name: "triply-locale", value: "vi", url: BASE }]);
          await page.evaluate(() => localStorage.setItem("triply-theme", "dark"));
        }
        for (const r of list) {
          await page.goto(`${BASE}${r}`);
          await page.waitForLoadState("networkidle");
          await page.addScriptTag({ content: axeSource });
          const res = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
          for (const v of res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) problems.push(`${vp.width}px ${r}: ${v.id} (${v.nodes.length})`);
          // No sideways scrolling on phones.
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (overflow > 1) problems.push(`${vp.width}px ${r}: page is ${overflow}px wider than the screen`);
          if (viDark) {
            const state = await page.evaluate(() => [document.documentElement.lang, document.documentElement.dataset.theme].join("/"));
            if (state !== "vi/dark") problems.push(`${r}: expected vi/dark, got ${state}`);
          }
        }
        if (viDark) {
          await page.context().clearCookies({ name: "triply-locale" });
          await page.evaluate(() => localStorage.removeItem("triply-theme"));
        }
      }
    await A.setViewportSize({ width: 1360, height: 900 });
    await C.setViewportSize({ width: 1360, height: 900 });
    if (problems.length) throw new Error(problems.join("; "));
  });

  // Catalog admin (phase 3): an admin manages a sync job and checks every admin screen (axe + no sideways scroll).
  await step("19. an admin manages sync jobs and reviews the catalog screens", async () => {
    const ADM = await newUser("admin");
    await login(ADM, "an@triply.dev");
    await ADM.goto(`${BASE}/admin/jobs`);
    await ADM.getByRole("heading", { name: "Sync jobs" }).waitFor();
    await ADM.getByRole("button", { name: "New job" }).first().click();
    const d = ADM.getByRole("dialog");
    const name = `E2E job ${stamp}`;
    await d.getByLabel("Name").fill(name);
    await d.getByLabel("Area").fill("hoi-an");
    await d.getByLabel("Schedule (cron, UTC)").fill("61 * * * *");
    await d.getByRole("button", { name: "Create job" }).click();
    await d.getByRole("alert").first().waitFor(); // invalid cron is caught before saving
    await d.getByRole("button", { name: /Weekly/ }).click();
    await d.getByRole("button", { name: "Create job" }).click();
    const card = ADM.locator("li", { has: ADM.getByRole("heading", { name }) });
    await card.getByText("Scheduled").waitFor();
    await card.getByRole("button", { name: "Pause" }).click();
    await card.getByText("Paused").waitFor();
    await card.getByRole("button", { name: `Delete ${name}` }).click();
    await card.getByRole("button", { name: "Confirm delete" }).click();
    await ADM.getByRole("heading", { name }).waitFor({ state: "detached" });

    const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    const problems = [];
    for (const vp of [{ width: 1360, height: 900 }, { width: 390, height: 844 }]) {
      await ADM.setViewportSize(vp);
      for (const r of ["/admin", "/admin/jobs", "/admin/runs", "/admin/duplicates", "/admin/places", "/admin/categories", "/admin/photos"]) {
        await ADM.goto(`${BASE}${r}`);
        await ADM.waitForLoadState("networkidle");
        await ADM.addScriptTag({ content: axeSource });
        const res = await ADM.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
        for (const v of res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) problems.push(`${vp.width}px ${r}: ${v.id} (${v.nodes.length})`);
        const overflow = await ADM.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) problems.push(`${vp.width}px ${r}: page is ${overflow}px wider than the screen`);
      }
    }
    if (problems.length) throw new Error(problems.join("; "));
    // Non-admins see a polite refusal, not the tools.
    await C.goto(`${BASE}/admin/jobs`);
    await C.getByRole("heading", { name: "Admins only" }).waitFor();
  });

  // Leave the shared dev database as we found it: test trips must not linger in public Explore.
  await step("cleanup: delete the trips this run created", async () => {
    const del = (p, url) => p.evaluate((id) => fetch(`/api/v1/trips/${id}`, { method: "DELETE", headers: { "X-Requested-With": "triply" } }).then((r) => r.status), url.split("/trips/")[1].split(/[?#]/)[0]);
    if (forkUrl && (await del(C, forkUrl)) !== 200) throw new Error("fork not deleted");
    if (placeUrl) {
      const placeId = placeUrl.split("/places/")[1];
      const status = await C.evaluate(async (id) => {
        const place = await fetch(`/api/v1/places/${id}`).then((r) => r.json());
        const mine = place.photos.filter((p) => p.mine);
        const res = await Promise.all(mine.map((p) => fetch(`/api/v1/place-photos/${p.id}`, { method: "DELETE", headers: { "X-Requested-With": "triply" } }).then((r) => r.status)));
        return res.every((s) => s === 200) ? 200 : 500;
      }, placeId);
      if (status !== 200) throw new Error("place photo not deleted");
    }
    if ((await del(A, tripUrl)) !== 200) throw new Error("trip not deleted");
  });

  await A.screenshot({ path: path.join(shots, "owner-final.png") });
  console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})();
