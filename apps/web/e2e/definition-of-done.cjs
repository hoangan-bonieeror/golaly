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
  const itemCount = (p) => p.locator("ol li[draggable]").count();

  const A = await newUser("owner");
  const stamp = Date.now().toString(36);
  const tripTitle = `E2E Tokyo ${stamp}`;
  let tripUrl;

  await step("1. user registers (and onboards)", async () => {
    await A.goto(`${BASE}/register`);
    await A.getByLabel("Email").fill(`tester.${stamp}@example.com`);
    await A.getByLabel("Username").fill(`tester_${stamp}`);
    await A.getByLabel("Password").fill("supersecret");
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
    await A.waitForFunction(() => document.querySelectorAll("ol li[draggable]").length === 3);
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
    await C.waitForFunction(() => document.querySelectorAll("ol li[draggable]").length === 3);
    await C.getByRole("button", { name: "Item actions", exact: true }).first().click();
    await C.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await C.waitForFunction(() => document.querySelectorAll("ol li[draggable]").length === 2);
    await C.goto(`${forkUrl}?tab=members`);
    await C.getByText("Trip members · 1").waitFor();
  });

  await step("15. original trip remains unchanged", async () => {
    await A.goto(tripUrl);
    await A.waitForFunction(() => document.querySelectorAll("ol li[draggable]").length === 3);
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
    await C.getByRole("heading", { name: "An" }).waitFor();
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
      [A, [trip, `${trip}?view=map`, `${trip}?tab=members`], false],
      [A, [trip, `${trip}?view=map`, "/home", "/explore", "/settings", "/notifications"], true],
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
