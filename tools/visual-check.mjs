// Headless visual smoke test. Loads the dev server in Chromium, captures
// runtime errors + warnings that tsc can't catch, and saves a screenshot
// of the canvas so the human (or Claude) can actually see what rendered.
//
// Usage: ensure `npm run dev` is running, then `node tools/visual-check.mjs`.
// Env overrides: HELLORUN_URL, HELLORUN_SCREENSHOT.

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PNG } from "pngjs";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const OUT = process.env.HELLORUN_SCREENSHOT || "tools/screenshots/tunnel.png";
const OUT2 = OUT.replace(/\.png$/, ".t+500ms.png");
const VIEWPORT = { width: 1280, height: 720 };
const MOTION_DELAY_MS = 500;

const pageErrors = [];
const consoleErrors = [];
const consoleWarnings = [];

// Use the full Chrome-for-Testing binary instead of chrome-headless-shell.
// Headless-shell has limited WebGL and silently fails to link three.js
// shaders (VALIDATE_STATUS false, empty info log).
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: VIEWPORT });

page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (msg) => {
  const t = msg.type();
  if (t === "error") consoleErrors.push(msg.text());
  else if (t === "warning") consoleWarnings.push(msg.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForSelector("#game-canvas", { timeout: 5_000 });
  // Dismiss the title overlay and enable motion so screenshots capture
  // live gameplay rather than the paused spawn pose.
  await page.waitForFunction(() => window.__startGame !== undefined, {
    timeout: 5_000,
  });
  await page.evaluate(() => window.__startGame());
  // Let two frames actually render before we snapshot.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await mkdir(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT });
  await new Promise((r) => setTimeout(r, MOTION_DELAY_MS));
  await page.screenshot({ path: OUT2 });
} finally {
  await browser.close();
}

const report = [];
if (pageErrors.length) {
  report.push(`PAGE ERRORS (${pageErrors.length}):`);
  for (const e of pageErrors) report.push("  " + e);
}
if (consoleErrors.length) {
  report.push(`CONSOLE ERRORS (${consoleErrors.length}):`);
  for (const e of consoleErrors) report.push("  " + e);
}
if (consoleWarnings.length) {
  report.push(`CONSOLE WARNINGS (${consoleWarnings.length}):`);
  for (const e of consoleWarnings) report.push("  " + e);
}

const pixelStats = await analyzeScreenshot(OUT);
report.push(
  `PIXEL STATS (t=0):`,
  `  size: ${pixelStats.width}×${pixelStats.height}`,
  `  non-black: ${pixelStats.nonBlackPct.toFixed(2)}% (${pixelStats.nonBlack.toLocaleString()} / ${pixelStats.total.toLocaleString()} px)`,
  `  avg RGB: (${pixelStats.avg.map((v) => v.toFixed(1)).join(", ")})`,
  `  max RGB: (${pixelStats.max.join(", ")})`,
  `  unique color buckets (>=1% of pixels): ${pixelStats.topBuckets
    .map(([c, p]) => `${c}:${(p * 100).toFixed(1)}%`)
    .join(", ")}`,
);

const motionDiff = await diffScreenshots(OUT, OUT2);
report.push(
  `MOTION CHECK (t=0 vs t=${MOTION_DELAY_MS}ms):`,
  `  differing pixels: ${motionDiff.diffPct.toFixed(2)}% (${motionDiff.diffCount.toLocaleString()} / ${motionDiff.total.toLocaleString()} px)`,
  `  mean per-channel delta on changed pixels: ${motionDiff.meanDelta.toFixed(2)}`,
  `  verdict: ${motionDiff.diffPct > 0.5 ? "MOTION DETECTED" : "scene appears static"}`,
);

console.log(report.join("\n"));
console.log(`Screenshot: ${OUT}`);
if (pageErrors.length || consoleErrors.length) process.exit(1);

async function diffScreenshots(pathA, pathB) {
  const a = PNG.sync.read(await readFile(pathA));
  const b = PNG.sync.read(await readFile(pathB));
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("screenshot dimensions differ");
  }
  const total = a.width * a.height;
  let diffCount = 0;
  let deltaSum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (dr + dg + db > 0) {
      diffCount++;
      deltaSum += (dr + dg + db) / 3;
    }
  }
  return {
    total,
    diffCount,
    diffPct: (diffCount / total) * 100,
    meanDelta: diffCount === 0 ? 0 : deltaSum / diffCount,
  };
}

async function analyzeScreenshot(path) {
  const buf = await readFile(path);
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  const total = width * height;
  let nonBlack = 0;
  const sum = [0, 0, 0];
  const max = [0, 0, 0];
  // Quantize to 6 levels per channel (216 buckets) to find dominant colors.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    if (r > max[0]) max[0] = r;
    if (g > max[1]) max[1] = g;
    if (b > max[2]) max[2] = b;
    if (r + g + b > 0) nonBlack++;
    const key = `${(r >> 6) << 6}/${(g >> 6) << 6}/${(b >> 6) << 6}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const topBuckets = [...buckets.entries()]
    .map(([k, v]) => [k, v / total])
    .filter(([, p]) => p >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return {
    width,
    height,
    total,
    nonBlack,
    nonBlackPct: (nonBlack / total) * 100,
    avg: sum.map((v) => v / total),
    max,
    topBuckets,
  };
}
