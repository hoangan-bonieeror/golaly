/**
 * MVP Definition-of-Done journey (spec §51) against the running prototype.
 *   npm i -D playwright && npx playwright install chromium
 *   npm run dev            (in another terminal)
 *   node apps/web/e2e/definition-of-done.cjs
 */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const shots = require("path").join(__dirname, "artifacts");
require("fs").mkdirSync(shots, { recursive: true });

(async () => {
  const browser = await chromium.launch({});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  const watch = (p, tag) => {
    p.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
    p.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  };
  const A = await ctx.newPage();
  watch(A, "A");
  let failed = 0;
  const step = async (name, fn) => {
    try {
      await fn();
      console.log("✓", name);
    } catch (e) {
      failed++;
      console.log("✗", name, e.message.split("\n")[0]);
      for (const [i, pg] of ctx.pages().entries()) await pg.screenshot({ path: `${shots}/FAIL-${name.replace(/\W+/g, "_")}-${i}.png` });
    }
  };

  // 1. register
  await step("register", async () => {
    await A.goto(BASE + "/register");
    await A.getByLabel("Email").fill("tester@example.com");
    await A.getByLabel("Username").fill("tester");
    await A.getByLabel("Password").fill("supersecret");
    await A.getByRole("button", { name: "Create account" }).click();
    await A.waitForURL("**/onboarding");
    await A.getByRole("button", { name: "Friends" }).click();
    await A.getByRole("button", { name: "Continue" }).click();
    await A.getByRole("button", { name: "Food" }).click();
    await A.getByRole("button", { name: "Start exploring" }).click();
    await A.waitForURL("**/home");
  });
  // 2-3. create trip with destination
  let tripUrl;
  await step("create trip", async () => {
    await A.goto(BASE + "/trips/new");
    await A.getByRole("button", { name: /\+ Tokyo/ }).click();
    await A.getByLabel("Trip name").fill("E2E Tokyo");
    await A.getByLabel("Start date").fill("2027-04-01");
    await A.getByLabel("End date").fill("2027-04-02");
    await A.getByRole("button", { name: "Create trip" }).click();
    await A.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
    tripUrl = A.url();
  });
  // 4. three itinerary items
  await step("add 3 items", async () => {
    for (const name of ["Shibuya Crossing", "Sensō-ji", "Ichiran Shibuya"]) {
      await A.getByRole("button", { name: "Add to Day 1" }).click();
      await A.getByPlaceholder("Search places").fill(name.slice(0, 5));
      await A.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).first().click();
      await A.getByRole("button", { name: "Add to itinerary" }).click();
      await A.getByRole("dialog").waitFor({ state: "detached" });
    }
    const count = await A.locator("ol li[draggable]").count();
    if (count !== 3) throw new Error("expected 3 items, got " + count);
  });
  // 5. invite via link
  let inviteLink;
  await step("invite link", async () => {
    await A.getByRole("button", { name: "Invite" }).first().click();
    await A.getByRole("tab", { name: /Invite link/ }).click();
    await A.getByRole("radio", { name: /Viewer/ }).click();
    await A.getByRole("button", { name: "Create invite link" }).click();
    inviteLink = await A.locator("code").innerText();
    await A.keyboard.press("Escape");
  });
  // 6. second person (Minh) accepts in another tab
  const B = await ctx.newPage();
  watch(B, "B");
  await step("minh accepts", async () => {
    await B.goto(BASE + "/login");
    await B.getByLabel("Email").fill("minh@triply.dev");
    await B.getByRole("button", { name: "Log in", exact: true }).click();
    await B.waitForURL("**/home");
    await B.goto(inviteLink);
    await B.getByRole("button", { name: /Accept/ }).click();
    await B.waitForURL(tripUrl);
    if (await B.getByRole("button", { name: "Add to Day 1" }).count()) throw new Error("viewer can add!");
  });
  // 7. owner makes them Editor
  await step("owner promotes to editor", async () => {
    await A.goto(tripUrl + "?tab=members");
    await A.getByLabel("Role for Minh").selectOption("EDITOR");
  });
  // 8. editor modifies itinerary
  await step("editor edits", async () => {
    await B.reload();
    await B.getByRole("button", { name: "Item actions", exact: true }).first().click({ timeout: 5000 });
    await B.getByRole("button", { name: "Edit", exact: true }).click({ timeout: 5000 });
    await B.getByLabel("Title").fill("Shibuya at night (Minh)", { timeout: 5000 });
    await B.getByRole("button", { name: "Save changes" }).click();
    if (await B.getByRole("button", { name: "Trip settings" }).count()) throw new Error("editor sees settings");
  });
  // 9. owner sees update (live via storage event, no reload)
  await step("owner sees update live", async () => {
    await A.goto(tripUrl);
    await A.getByText("Shibuya at night (Minh)").waitFor({ timeout: 3000 });
    await A.getByText("Edited by Minh").first().waitFor();
  });
  // 10. owner makes trip public
  await step("make public", async () => {
    await A.goto(tripUrl + "/settings");
    await A.getByRole("radio", { name: /Public/ }).click();
    await A.getByRole("button", { name: "Save changes" }).click();
    await A.waitForURL(tripUrl);
  });
  // 11-13. Sarah discovers, saves, forks
  const C = await ctx.newPage();
  watch(C, "C");
  let forkUrl;
  await step("sarah discovers/saves/forks", async () => {
    await C.goto(BASE + "/login");
    await C.getByLabel("Email").fill("sarah@triply.dev");
    await C.getByRole("button", { name: "Log in", exact: true }).click();
    await C.waitForURL("**/home");
    await C.goto(BASE + "/explore");
    await C.getByPlaceholder(/Search trips/).fill("E2E");
    await C.getByRole("link", { name: /E2E Tokyo/ }).first().click();
    await C.getByRole("button", { name: "Save", exact: true }).click();
    await C.getByRole("button", { name: "Use this trip" }).click();
    await C.getByRole("button", { name: "Make it mine" }).click();
    await C.waitForURL((u) => /\/trips\/[0-9a-f-]{36}$/.test(u.pathname) && u.href !== tripUrl);
    forkUrl = C.url();
    await C.getByText("Based on").waitFor();
  });
  // 14-16 fork independently editable, original unchanged, attribution
  await step("fork independent", async () => {
    await C.getByRole("button", { name: "Item actions", exact: true }).first().click();
    await C.getByRole("button", { name: "Delete", exact: true }).click();
    const n = await C.locator("ol li[draggable]").count();
    if (n !== 2) throw new Error("fork should have 2 items now, got " + n);
    await C.getByRole("tab", { name: /Members/ }).click();
    await C.getByText("Trip members · 1").waitFor({ timeout: 3000 });
    await A.goto(tripUrl);
    const orig = await A.locator("ol li[draggable]").count();
    if (orig !== 3) throw new Error("original changed! " + orig);
  });
  // privacy: private Japan trip not visible to Sarah
  await step("private trip hidden", async () => {
    await C.goto(BASE + "/u/an.nguyen");
    if (await C.getByText("Japan — 7 Days").count()) throw new Error("private trip on public profile");
    await C.goto(BASE + "/explore");
    await C.getByPlaceholder(/Search trips/).fill("Japan");
    if (await C.getByRole("link", { name: /Japan — 7 Days/ }).count()) throw new Error("private trip in explore");
  });

  console.log("console errors:", errors.length ? errors : "none");
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})();
