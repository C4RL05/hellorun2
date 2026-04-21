// Verifies milestone 4's collision pipeline end-to-end. The hardcoded chart's
// gate 1 (second gate, z=-7.5) is slot 2 (top); the player spawns at slot 1
// (mid), so with no input the camera should die crossing gate 1 at ~0.95s.
// Then respawn + steering to the correct slot should survive.
//
// Usage: ensure `npm run dev` is running, then `node tools/collision-check.mjs`.

import { chromium } from "playwright";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.__isDead !== undefined, {
    timeout: 5_000,
  });

  // Dismiss the title overlay and enable motion so the camera actually
  // advances through the corridor.
  await page.evaluate(() => window.__startGame());

  // Scenario 1: no steering, expect death around gate 1 (~0.95s).
  await page.evaluate(() => window.__respawn());
  await page.waitForTimeout(1_400);
  const diedPassively = await page.evaluate(() => window.__isDead());
  const yAtDeath = await page.evaluate(() => window.__camera.position.y);
  const zAtDeath = await page.evaluate(() => window.__camera.position.z);

  // Scenario 2: respawn, coast through gate 0 (slot 1 = spawn-safe), then
  // press ArrowUp to reach slot 2 before gate 1 at z=-7.5 / t=0.95s.
  await page.evaluate(() => window.__respawn());
  await page.waitForTimeout(600); // coast past gate 0 at t=0.45s
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(500); // steering window: up to slot 2 before gate 1
  const survivedWithInput = !(await page.evaluate(() => window.__isDead()));
  const zAfterSurvive = await page.evaluate(() => window.__camera.position.z);
  await page.keyboard.up("ArrowUp");

  console.log("Scenario A — spawn and coast (no input):");
  console.log(
    `  died: ${diedPassively}, y=${yAtDeath.toFixed(3)}, z=${zAtDeath.toFixed(2)}`,
  );
  console.log("Scenario B — spawn and hold ArrowUp to slot 2:");
  console.log(
    `  alive past gate 1: ${survivedWithInput}, z=${zAfterSurvive.toFixed(2)}`,
  );

  const verdictA = diedPassively ? "DEATH DETECTED" : "SHOULD HAVE DIED";
  const verdictB = survivedWithInput
    ? "INPUT AVOIDED DEATH"
    : "DIED DESPITE INPUT";
  console.log("");
  console.log(`collision passive:  ${verdictA}`);
  console.log(`collision avoided:  ${verdictB}`);

  if (!diedPassively || !survivedWithInput) process.exit(1);
} finally {
  await browser.close();
}
