// Triggers the full-viewport debug overlay (press I) and verifies zoom,
// pan, and toggle. Helpers (yellow bboxes + green player box) layer on
// top of the live game view.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const OUT = "tools/screenshots/debug-view.png";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.__camera !== undefined, {
    timeout: 5_000,
  });

  // Dismiss title overlay and freeze motion so the game view is a
  // deterministic spawn-pose frame.
  await page.evaluate(() => window.__startGame());
  await page.evaluate(() => window.__setMotionScale(0));
  await page.evaluate(() => window.__respawn());

  // Toggle overlay on.
  await page.keyboard.press("KeyM");
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

  await mkdir(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT });
  console.log(`Overlay on (default zoom):     ${OUT}`);

  // Zoom in five clicks. Mouse position doesn't matter — overlay is full
  // viewport.
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -120);
  }
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const zoomedPath = OUT.replace(/\.png$/, ".zoomed.png");
  await page.screenshot({ path: zoomedPath });
  console.log(`After 5 zoom-ins:             ${zoomedPath}`);

  // Right-mouse drag anywhere on the canvas.
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(500, 260);
  await page.mouse.up({ button: "right" });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const pannedPath = OUT.replace(/\.png$/, ".panned.png");
  await page.screenshot({ path: pannedPath });
  console.log(`After RMB drag up-left:       ${pannedPath}`);

  // Toggle overlay off.
  await page.keyboard.press("KeyM");
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const offPath = OUT.replace(/\.png$/, ".off.png");
  await page.screenshot({ path: offPath });
  console.log(`After toggle off:             ${offPath}`);
} finally {
  await browser.close();
}
