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
  await page.waitForSelector("#game-canvas");
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
  console.log(`gridOffsetSec:       ${analysis.gridOffsetSec.toFixed(3)}  (back-extrapolated from beats[0]=${analysis.beats[0]?.toFixed(3) ?? "n/a"})`);
  console.log(`firstAudibleSec:     ${analysis.firstAudibleSec.toFixed(3)}  (Essentia OnsetRate; lower bound for back-extrap)`);
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

  // Per-16-beat-window features. Adjacent-window distance (normalized
  // L2 over [loudness, centroid]) gives a novelty score — peaks are
  // candidate section boundaries.
  const wf = analysis.windowFeatures;
  const wd = analysis.windowDurationSec;
  console.log("");
  console.log(`window features: ${wf.length} × ${wd.toFixed(2)}s windows (16 beats each)`);
  if (wf.length > 0) {
    const maxL = Math.max(...wf.map((w) => w.loudness));
    const maxC = Math.max(...wf.map((w) => w.centroid));
    // Energy + timbre novelty (normalized L2 over loudness + centroid).
    const energyNov = (i) => {
      if (i === 0) return 0;
      const dl = (wf[i].loudness - wf[i - 1].loudness) / (maxL || 1);
      const dc = (wf[i].centroid - wf[i - 1].centroid) / (maxC || 1);
      return Math.sqrt(dl * dl + dc * dc);
    };
    // Harmonic novelty (cosine distance over 12-bin chroma).
    const cosDist = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let k = 0; k < a.length; k++) {
        dot += a[k] * b[k];
        na += a[k] * a[k];
        nb += b[k] * b[k];
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      if (denom === 0) return 0;
      return 1 - dot / denom;
    };
    const chromaNov = (i) =>
      i === 0 ? 0 : cosDist(wf[i].chroma, wf[i - 1].chroma);

    const eNov = wf.map((_, i) => energyNov(i));
    const cNov = wf.map((_, i) => chromaNov(i));
    // Combined: equal weight (chroma is already 0..~1, energy already
    // ≈0..~1 from normalization).
    const combined = wf.map((_, i) => 0.5 * eNov[i] + 0.5 * cNov[i]);
    const mean = combined.reduce((a, b) => a + b, 0) / combined.length;
    const std = Math.sqrt(
      combined.reduce((s, v) => s + (v - mean) ** 2, 0) / combined.length,
    );
    const threshold = mean + std;
    console.log(`  combined novelty mean=${mean.toFixed(3)}  std=${std.toFixed(3)}  → boundary threshold ${threshold.toFixed(3)}`);
    console.log("");
    console.log("  idx  startSec  loudness  centroidHz  energyNov  chromaNov  combined  bound?");
    console.log("  ---  --------  --------  ----------  ---------  ---------  --------  ------");
    for (let i = 0; i < wf.length; i++) {
      const w = wf[i];
      const isBound = combined[i] > threshold ? "  ◀" : "";
      console.log(
        `  ${String(i).padStart(3)}  ${w.startSec.toFixed(2).padStart(8)}  ${w.loudness.toFixed(2).padStart(8)}  ${w.centroid.toFixed(1).padStart(10)}  ${eNov[i].toFixed(3).padStart(9)}  ${cNov[i].toFixed(3).padStart(9)}  ${combined[i].toFixed(3).padStart(8)}${isBound}`,
      );
    }
  }

  // Coalesced sections.
  const sec = analysis.sections;
  console.log("");
  console.log(`detected sections: ${sec.length}`);
  if (sec.length > 0) {
    console.log("  idx  kind  startSec  beats  windows  avgLoudness  avgCentroidHz");
    console.log("  ---  ----  --------  -----  -------  -----------  -------------");
    for (let i = 0; i < sec.length; i++) {
      const s = sec[i];
      console.log(
        `  ${String(i).padStart(3)}  ${String(s.kind).padStart(4)}  ${s.startSec.toFixed(2).padStart(8)}  ${String(s.beatLength).padStart(5)}  ${String(s.windowCount).padStart(7)}  ${s.avgLoudness.toFixed(2).padStart(11)}  ${s.avgCentroid.toFixed(1).padStart(13)}`,
      );
    }
    const totals = sec.reduce(
      (acc, s) => {
        if (s.beatLength === 16) acc.s16++;
        else if (s.beatLength === 32) acc.s32++;
        else if (s.beatLength === 64) acc.s64++;
        return acc;
      },
      { s16: 0, s32: 0, s64: 0 },
    );
    const uniqueKinds = new Set(sec.map((s) => s.kind)).size;
    console.log(`  → ${totals.s64} × 64-beat, ${totals.s32} × 32-beat, ${totals.s16} × 16-beat`);
    console.log(`  → ${uniqueKinds} distinct section kind${uniqueKinds === 1 ? "" : "s"}`);
  }
} finally {
  await browser.close();
}
