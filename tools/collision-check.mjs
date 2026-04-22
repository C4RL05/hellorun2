// Verifies milestone 4+7's collision pipeline end-to-end against whatever
// chart the generator produces this page load. Finds the first non-spawn-
// safe gate (slot != 1), then:
//   A) coast past it → expect dead
//   B) respawn, coast through the prior gate, steer into the right slot →
//      expect alive
//
// Usage: ensure `npm run dev` is running, then `node tools/collision-check.mjs`.

import { chromium } from "playwright";

// Seed the chart generator so we get a known chart with a lethal gate
// early. Procedural generation can produce all-mid charts which would
// make the collision test unable to exercise the death path.
const URL = process.env.HELLORUN_URL || "http://localhost:5173/?seed=1";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.__getChart !== undefined, {
    timeout: 5_000,
  });

  // Dismiss the title overlay and enable motion.
  await page.evaluate(() => window.__startGame());

  const chart = await page.evaluate(() => window.__getChart());
  const gateMsList = await page.evaluate(() => window.__getGateTimesMs());
  const gateMs = (i) => gateMsList[i];
  let firstLethal = -1;
  for (let i = 0; i < chart.length; i++) {
    if (chart[i] !== 1) {
      firstLethal = i;
      break;
    }
  }
  if (firstLethal < 1) {
    console.log(
      `Chart has no non-mid gates at i>=1 (chart=${chart.join(",")}); can't run.`,
    );
    process.exit(1);
  }
  const lethalSlot = chart[firstLethal];
  const steerKey = lethalSlot === 2 ? "ArrowUp" : "ArrowDown";
  console.log(
    `Chart=[${chart.join(",")}] firstLethal=gate${firstLethal} slot=${lethalSlot} steer=${steerKey}`,
  );

  // Scenario A: no steering, expect death at or before firstLethal gate.
  await page.evaluate(() => window.__respawn());
  await page.waitForTimeout(gateMs(firstLethal) + 200);
  const diedPassively = await page.evaluate(() => window.__isDead());
  const zAtDeath = await page.evaluate(() => window.__camera.position.z);

  // Scenario B: coast past (firstLethal - 1), steer to lethalSlot before
  // gate `firstLethal`, expect alive.
  await page.evaluate(() => window.__respawn());
  const coastMs = Math.max(50, gateMs(firstLethal - 1) + 50);
  await page.waitForTimeout(coastMs);
  await page.keyboard.down(steerKey);
  // Need enough time for: input ease-up to clamp (~300ms) + passing the
  // gate. Total absolute time is gateMs(firstLethal) + a little buffer.
  const remainingMs = gateMs(firstLethal) - coastMs + 250;
  await page.waitForTimeout(remainingMs);
  const survivedWithInput = !(await page.evaluate(() => window.__isDead()));
  const zAfterSurvive = await page.evaluate(() => window.__camera.position.z);
  await page.keyboard.up(steerKey);

  console.log("Scenario A — spawn and coast (no input):");
  console.log(`  died: ${diedPassively}, z=${zAtDeath.toFixed(2)}`);
  console.log(
    `Scenario B — spawn, coast, steer ${steerKey} to slot ${lethalSlot}:`,
  );
  console.log(`  alive past gate ${firstLethal}: ${survivedWithInput}, z=${zAfterSurvive.toFixed(2)}`);

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
