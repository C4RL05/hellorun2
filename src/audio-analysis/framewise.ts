// Aggregator for the worker's per-frame prefix-sum arrays. Given a
// FramewiseFeatures (computed once per song in the analyzer worker),
// derives per-window features at any (bpm, gridOffsetSec) in O(1) per
// window via cumulative-sum subtraction.
//
// Why this exists: the expensive Essentia per-frame work
// (Spectrum / SpectralPeaks / HPCP) is invariant of bpm/gridOffset —
// only the windowing changes. By splitting "what's in the audio"
// (framewise) from "how we slice it" (windowing), every recompute
// after the initial analysis becomes pure JS arithmetic. Editor save
// and beat-sync recomputes both go from a ~2s worker round-trip to
// sub-millisecond.

import type { FramewiseFeatures } from "./analyzer-worker";
import type { WindowFeature } from "./analyzer";

const HPCP_SIZE = 12;
// Steven's-law exponent: window loudness ≈ (mean-square)^STEVENS_EXP.
// Matches Essentia.Loudness's perceptual weighting closely enough for
// section novelty (which only cares about RELATIVE differences between
// adjacent windows). Absolute magnitude differs from Essentia by a
// constant scaler, irrelevant for downstream use.
const STEVENS_EXP = 0.67;

// Returns null when the window range covers no complete frames.
export function windowFromFramewise(
  fw: FramewiseFeatures,
  startSec: number,
  endSec: number,
): WindowFeature | null {
  const a = Math.max(
    0,
    Math.floor((startSec * fw.sampleRate) / fw.hopSize),
  );
  const b = Math.min(
    fw.numFrames,
    Math.floor((endSec * fw.sampleRate) / fw.hopSize),
  );
  const n = b - a;
  if (n < 1) return null;
  const meanMS = (fw.cumMS[b] - fw.cumMS[a]) / n;
  const loudness = meanMS > 0 ? Math.pow(meanMS, STEVENS_EXP) : 0;
  const energyDiff = fw.cumEnergy[b] - fw.cumEnergy[a];
  const centroid =
    energyDiff > 0
      ? (fw.cumCentroid[b] - fw.cumCentroid[a]) / energyDiff
      : 0;
  const chroma = new Array<number>(HPCP_SIZE);
  const baseB = b * HPCP_SIZE;
  const baseA = a * HPCP_SIZE;
  for (let k = 0; k < HPCP_SIZE; k++) {
    chroma[k] = (fw.cumChroma[baseB + k] - fw.cumChroma[baseA + k]) / n;
  }
  return { startSec, loudness, centroid, chroma };
}

// Skips the trailing partial window (matches the previous worker
// behavior).
export function windowsFromFramewise(
  fw: FramewiseFeatures,
  bpm: number,
  gridOffsetSec: number,
): WindowFeature[] {
  if (bpm <= 0) return [];
  const windowDurationSec = (16 * 60) / bpm;
  const songDurationSec = (fw.numFrames * fw.hopSize) / fw.sampleRate;
  const out: WindowFeature[] = [];
  for (let i = 0; ; i++) {
    const startSec = gridOffsetSec + i * windowDurationSec;
    const endSec = startSec + windowDurationSec;
    if (endSec > songDurationSec) break;
    const w = windowFromFramewise(fw, startSec, endSec);
    if (!w) break;
    out.push(w);
  }
  return out;
}

export function windowDurationSecForBpm(bpm: number): number {
  return bpm > 0 ? (16 * 60) / bpm : 0;
}
