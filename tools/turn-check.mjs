// Samples the scene at four points along the corridor path and verifies
// the camera pose + yaw progression through the turn.
//
// Usage: ensure `npm run dev` is running, then `node tools/turn-check.mjs`.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const OUT_DIR = "tools/screenshots";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
await page.waitForSelector("canvas");
await page.waitForFunction(() => window.__setPathS !== undefined, {
  timeout: 5_000,
});

// Dismiss title overlay and freeze the render loop so pathS stays where
// we set it.
await page.evaluate(() => window.__startGame());
await page.evaluate(() => window.__setMotionScale(0));
await mkdir(OUT_DIR, { recursive: true });

// Pull corridor geometry from the page so this tool self-updates when
// TURN_BEATS / GATE_SPACING / etc. change in constants.ts.
const corridor = await page.evaluate(() => window.__getCorridor());

const snap = async (label, pathS) => {
  await page.evaluate((s) => window.__setPathS(s), pathS);
  // Two rAFs so camera.position + rotation catch up.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const pose = await page.evaluate(() => ({
    pos: {
      x: window.__camera.position.x,
      y: window.__camera.position.y,
      z: window.__camera.position.z,
    },
    yaw: window.__camera.rotation.y,
  }));
  const path = `${OUT_DIR}/turn-${label}.png`;
  await page.screenshot({ path });
  return { label, pathS, pose, path };
};

const { straightLength: STRAIGHT_LENGTH, turnArcLength: TURN_ARC } = corridor;

const samples = [];
samples.push(await snap("spawn", 0));
samples.push(await snap("end-of-straight1", STRAIGHT_LENGTH));
samples.push(await snap("mid-turn", STRAIGHT_LENGTH + TURN_ARC * 0.5));
samples.push(await snap("start-of-straight2", STRAIGHT_LENGTH + TURN_ARC));
samples.push(
  await snap("mid-straight2", STRAIGHT_LENGTH + TURN_ARC + STRAIGHT_LENGTH * 0.5),
);

await browser.close();

console.log("label                     pathS    pos(x, y, z)              yaw(deg)");
console.log("------------------------- -------- ------------------------- --------");
for (const s of samples) {
  const { x, y, z } = s.pose.pos;
  const yawDeg = (s.pose.yaw * 180) / Math.PI;
  console.log(
    `${s.label.padEnd(25)} ${s.pathS.toFixed(2).padStart(8)} (${x.toFixed(2).padStart(6)}, ${y.toFixed(2).padStart(5)}, ${z.toFixed(2).padStart(7)})  ${yawDeg.toFixed(1).padStart(7)}`,
  );
  console.log(`  → ${s.path}`);
}
