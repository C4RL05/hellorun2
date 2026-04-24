// Reproduce the "buttons clip on hover" bug. Open Post pane, scroll to
// bottom, capture before/during hover to compare clip offsets.

import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__startGame !== undefined);
await page.evaluate(() => window.__startGame());
await page.click("#menu-button");
await page.click('.user-tab[data-tab="post"]');
await page.waitForSelector(".post-panel");

// Scroll the panel to the bottom.
await page.evaluate(() => {
  const p = document.querySelector(".post-panel");
  if (p) p.scrollTop = p.scrollHeight;
});
await page.waitForTimeout(200);

const before = await page.evaluate(() => {
  const panel = document.querySelector(".post-panel");
  const btn = document.querySelector(".post-buttons button");
  return {
    scrollTop: panel.scrollTop,
    scrollHeight: panel.scrollHeight,
    clientHeight: panel.clientHeight,
    btnTop: btn.getBoundingClientRect().top,
    btnBottom: btn.getBoundingClientRect().bottom,
  };
});
console.log("BEFORE HOVER:", before);

await page.screenshot({ path: "tools/screenshots/hover-before.png" });

await page.hover(".post-buttons button");
await page.waitForTimeout(300);

const after = await page.evaluate(() => {
  const panel = document.querySelector(".post-panel");
  const btn = document.querySelector(".post-buttons button");
  return {
    scrollTop: panel.scrollTop,
    scrollHeight: panel.scrollHeight,
    clientHeight: panel.clientHeight,
    btnTop: btn.getBoundingClientRect().top,
    btnBottom: btn.getBoundingClientRect().bottom,
  };
});
console.log("AFTER HOVER:", after);

await page.screenshot({ path: "tools/screenshots/hover-after.png" });

await browser.close();
