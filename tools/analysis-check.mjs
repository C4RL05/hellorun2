// Waits for the Essentia.js analyzer worker to finish, then prints the
// detected BPM / grid offset / confidence / beat count. Useful to verify
// that the analysis pipeline works end-to-end against your dev mp3.
//
// Usage: ensure `npm run dev` is running, then `node tools/analysis-check.mjs`.
// Expect ~30s of wait on a typical song length.

import { chromium } from "playwright";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const TIMEOUT_MS = 120_000;

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on("console", (msg) => {
  const t = msg.type();
  if (t === "error" || t === "warning") console.log(`[${t}]`, msg.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined, {
    timeout: 5_000,
  });

  console.log("waiting for analysis…");
  const start = Date.now();
  await page.waitForFunction(
    () => window.__getSongAnalysis() !== null,
    { timeout: TIMEOUT_MS, polling: 500 },
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const analysis = await page.evaluate(() => window.__getSongAnalysis());
  console.log(`analysis completed in ${elapsed}s`);
  console.log("");
  console.log(`consensus BPM:       ${analysis.bpm.toFixed(2)}`);
  console.log(`gridOffsetSec:       ${analysis.gridOffsetSec.toFixed(3)}`);
  console.log(`multifeature conf:   ${analysis.confidence.toFixed(2)}  (0..5.32; 3.0+ high, 2.5+ solid)`);
  console.log("");
  console.log("algorithm outputs:");
  console.log(`  RhythmExtractor2013 multifeature bpm: ${analysis.bpmMultiFeature.toFixed(2)}`);
  console.log(`  PercivalBpmEstimator bpm:             ${analysis.bpmPercival.toFixed(2)}`);
  console.log(`  bpmEstimates (multifeature internal): [${analysis.bpmEstimates.slice(0, 10).map((b) => b.toFixed(2)).join(", ")}${analysis.bpmEstimates.length > 10 ? ", …" : ""}]`);
  console.log(`  bpmIntervals (first 8): [${analysis.bpmIntervals.slice(0, 8).map((i) => i.toFixed(3)).join(", ")}${analysis.bpmIntervals.length > 8 ? ", …" : ""}]`);
  console.log("");
  console.log(`beats detected: ${analysis.beats.length}`);
  console.log(`first 5 beats:  ${analysis.beats.slice(0, 5).map((b) => b.toFixed(3)).join(", ")}`);
  const avgInterval =
    analysis.beats.length > 1
      ? (analysis.beats[analysis.beats.length - 1] - analysis.beats[0]) /
        (analysis.beats.length - 1)
      : 0;
  console.log(
    `avg beat interval: ${avgInterval.toFixed(3)}s  (implied BPM from avg: ${(60 / avgInterval).toFixed(2)})`,
  );
} finally {
  await browser.close();
}
