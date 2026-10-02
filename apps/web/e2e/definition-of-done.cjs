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
      await A.getByRole("button", { name: "Add to Day 1" }).click();
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
    if (await B.getByRole("button", { name: "Add to Day 1" }).count()) throw new Error("viewer can add items");
  });

  await step("7. owner makes them Editor", async () => {
    await A.goto(`${tripUrl}?tab=members`);
    await A.getByLabel("Role for Minh").selectOption("EDITOR");
    await A.getByText("Role updated").waitFor();
  });

  await step("8–9. editor modifies itinerary; owner sees it live (no reload)", async () => {
    await A.goto(tripUrl);
    await A.getByText("Live").waitFor({ timeout: 10000 });
    await B.reload();
    await B.getByText("You · Editor").waitFor();
    await B.getByRole("button", { name: "Item actions", exact: true }).first().click();
    await B.getByRole("button", { name: "Edit", exact: true }).click();
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
    await C.getByLabel("Search").fill(stamp);
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
    await C.getByRole("button", { name: "Delete", exact: true }).click();
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

  await step("privacy: private trips never leak to other users", async () => {
    await C.goto(`${BASE}/u/an.nguyen`);
    await C.getByRole("heading", { name: "An" }).waitFor();
    if (await C.getByText("Japan — 7 Days").count()) throw new Error("private trip on public profile");
    await C.goto(`${BASE}/explore`);
    await C.getByLabel("Search").fill("Japan — 7");
    await C.waitForTimeout(800);
    if (await C.getByRole("link", { name: /Japan — 7 Days/ }).count()) throw new Error("private trip in search");
  });

  await A.screenshot({ path: path.join(shots, "owner-final.png") });
  console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})();
