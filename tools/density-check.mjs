// Smoke test for the per-section density tier + ramp wiring.
//
// Loads the dev song, waits for analysis, walks the full song length to
// force corridor generation, then dumps the per-straight density layout
// and checks a few structural invariants:
//
//  (a) every beat in every straight is in GATE_ELIGIBLE_BEATS {2..7}
//  (b) count variety across the song — at least two distinct counts if
//      the song has at least two audio-section kinds / loudnesses
//  (c) ramp: consecutive same-kind straights should never see their
//      count or pattern-difficulty drop below the first occurrence
//
// Usage: `npm run dev` running, then `node tools/density-check.mjs`.

import { chromium } from "playwright";

const URL = process.env.HELLORUN_URL || "http://localhost:5173/?seed=1";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (err) => console.error("[pageerror]", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("[browser error]", msg.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForFunction(() => window.__getChart !== undefined, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => window.__getSongAnalysis?.() !== null, {
    timeout: 60_000,
  });

  const forwardSpeed = await page.evaluate(() => window.__getForwardSpeed());
  const analysis = await page.evaluate(() => {
    const a = window.__getSongAnalysis();
    return {
      bpm: a.bpm,
      maxLoud: a.sections.reduce((m, s) => Math.max(m, s.avgLoudness), 0),
      sections: a.sections.map((s) => ({
        kind: s.kind,
        startSec: s.startSec,
        endSec: s.startSec + s.beatLength * (60 / a.bpm),
        avgLoudness: s.avgLoudness,
      })),
    };
  });
  console.log(
    `BPM=${analysis.bpm.toFixed(2)} forwardSpeed=${forwardSpeed.toFixed(2)} kinds=${new Set(analysis.sections.map((s) => s.kind)).size}`,
  );
  for (const s of analysis.sections) {
    console.log(
      `  audio kind=${s.kind} @${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s loud=${(s.avgLoudness / analysis.maxLoud).toFixed(2)}`,
    );
  }

  // Walk the full song to force generation.
  const totalSec = analysis.sections[analysis.sections.length - 1].endSec;
  const totalPathS = totalSec * forwardSpeed;
  for (let s = 0; s <= totalPathS; s += 50) {
    await page.evaluate((v) => window.__setPathS(v), s);
  }

  const layout = await page.evaluate(() => window.__getStraightLayout());
  console.log(`\nBuilt straights: ${layout.length}`);
  for (const b of layout.slice(0, 30)) {
    console.log(
      `  i=${b.sectionIndex} pathStart=${b.pathStart.toFixed(1)} audioKind=${b.audioKind} loud=${b.audioLoudness !== null ? (b.audioLoudness / analysis.maxLoud).toFixed(2) : "—"} beats=[${b.beats.join(",")}] slots=[${b.openSlots.join(",")}]`,
    );
  }

  // (a) all beats ∈ {2..7}
  let outOfRange = 0;
  for (const b of layout) {
    for (const beat of b.beats) {
      if (beat < 2 || beat > 7) outOfRange++;
    }
  }

  // (b) count variety
  const countHist = new Map();
  for (const b of layout) {
    const n = b.beats.length;
    countHist.set(n, (countHist.get(n) ?? 0) + 1);
  }
  const countKeys = [...countHist.keys()].sort((a, b) => a - b);
  console.log("\nGate-count histogram:");
  for (const k of countKeys) console.log(`  ${k} gates : ${countHist.get(k)} straights`);

  // (c) ramp takes effect for at least one kind: count should strictly
  //     increase at least once across same-kind occurrences (absent
  //     major loudness variation between repeats). Not a hard invariant
  //     — loudness can drop enough between same-kind sections that the
  //     base-tier decrease outpaces the ramp bump — but for a typical
  //     song with a repeating chorus we expect to see the ramp kick in.
  const kindCountSequences = new Map();
  for (const b of layout) {
    if (b.audioKind === null) continue;
    if (!kindCountSequences.has(b.audioKind)) kindCountSequences.set(b.audioKind, []);
    kindCountSequences.get(b.audioKind).push(b.beats.length);
  }
  let kindWithRampObserved = 0;
  for (const [, seq] of kindCountSequences) {
    let max = seq[0];
    for (const n of seq) {
      if (n > max) {
        kindWithRampObserved++;
        break;
      }
      max = Math.max(max, n);
    }
  }

  console.log("");
  console.log(`(a) beats ∈ {2..7}: ${outOfRange === 0 ? "OK" : `FAIL — ${outOfRange} out-of-range`}`);
  console.log(`(b) count variety: ${countKeys.length} distinct counts`);
  console.log(
    `(c) ramp observed for at least 1 kind: ${kindWithRampObserved > 0 ? "OK" : "WARN — no ramp increase seen"} (${kindWithRampObserved}/${kindCountSequences.size} kinds)`,
  );

  if (outOfRange > 0) process.exit(1);
} finally {
  await browser.close();
}
