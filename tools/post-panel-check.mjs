// Verify the Post panel renders, live-updates the scene, and shows all
// the expected sections. Open the menu, click Post tab, capture before/
// after screenshots while tweaking bloom intensity.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = "http://localhost:5173";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("CONSOLE ERROR:", msg.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__startGame !== undefined);
  await page.evaluate(() => window.__startGame());
  // Let the scene run a bit so the pipeline is warm.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await mkdir("tools/screenshots", { recursive: true });

  await page.click("#menu-button");
  await page.waitForSelector("#menu:not(.hidden)");
  await page.click('.user-tab[data-tab="post"]');
  await page.waitForSelector(".post-panel");

  // Sanity-check: panel has all four section headers.
  const headers = await page.$$eval(".post-section-header", (els) =>
    els.map((e) => e.textContent),
  );
  console.log("SECTIONS:", headers);

  // Count editable inputs.
  const inputs = await page.$$eval(
    ".post-row input, .post-row select",
    (els) => els.length,
  );
  console.log("INPUTS:", inputs);

  // Capture baseline with panel open.
  await page.screenshot({ path: "tools/screenshots/post-panel.png" });

  // Scroll the post panel all the way down + screenshot, so the dark
  // scrollbar shows up in the capture.
  await page.evaluate(() => {
    const p = document.querySelector(".post-panel");
    if (p) p.scrollTop = p.scrollHeight;
  });
  await page.screenshot({ path: "tools/screenshots/post-panel-scrolled.png" });

  // Tweak bloom intensity aggressively to prove live-update works.
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".post-row");
    for (const row of rows) {
      const lab = row.querySelector("label");
      if (lab && lab.textContent === "intensity") {
        const inp = row.querySelector("input");
        inp.value = "3";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    }
  });
  // Close the menu so bloom is visible in the screenshot.
  await page.click("#menu-button");
  await page.waitForSelector("#menu", { state: "hidden" });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.screenshot({ path: "tools/screenshots/post-bloom-tweaked.png" });
} finally {
  await browser.close();
}
