// Runs Essentia.js off the main thread. Receives a mono Float32Array +
// sample rate, runs RhythmExtractor2013 ("multifeature" method — the
// strongest beat tracker in the library), posts back { bpm, beats[],
// gridOffsetSec, confidence }.

// @ts-expect-error -- essentia.js ships no types
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
// @ts-expect-error -- essentia.js ships no types
import Essentia from "essentia.js/dist/essentia.js-core.es.js";

// Essentia WASM-Module is a classic emscripten module. `calledRun` is true
// once the WASM has finished bootstrapping. We wait for it before
// constructing the high-level Essentia JS wrapper.
interface EmscriptenModule {
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
  EssentiaJS: new (debug: boolean) => unknown;
  arrayToVector: (a: Float32Array) => unknown;
  vectorToArray: (v: unknown) => Float32Array;
}

interface VectorFloat {
  size(): number;
  get(i: number): number;
  delete?(): void;
}

// Actual RhythmExtractor2013 fields per the .es.js JSDoc:
//   { bpm, ticks, confidence, estimates, bpmIntervals }
// (The core_api.d.ts docstring names "beats_position" — outdated.)
interface RhythmResult {
  bpm: number;
  ticks: VectorFloat;
  confidence: number;
  estimates: VectorFloat;
  bpmIntervals: VectorFloat;
}

let essentia: {
  arrayToVector: (a: Float32Array) => unknown;
  RhythmExtractor2013: (
    signal: unknown,
    maxTempo: number,
    method: string,
    minTempo: number,
  ) => RhythmResult;
  PercivalBpmEstimator: (
    signal: unknown,
    frameSize?: number,
    frameSizeOSS?: number,
    hopSize?: number,
    hopSizeOSS?: number,
    maxBPM?: number,
    minBPM?: number,
    sampleRate?: number,
  ) => { bpm: number };
  OnsetRate: (signal: unknown) => { onsets: VectorFloat; onsetRate: number };
} | null = null;

async function ensureReady(): Promise<void> {
  if (essentia) return;
  const mod = EssentiaWASM as EmscriptenModule;
  await new Promise<void>((resolve) => {
    if (mod.calledRun) {
      resolve();
    } else {
      mod.onRuntimeInitialized = () => resolve();
    }
  });
  essentia = new Essentia(EssentiaWASM);
}

export interface AnalysisRequest {
  readonly type: "analyze";
  readonly channelData: Float32Array;
  readonly sampleRate: number;
}

export type AnalysisResponse =
  | { readonly type: "progress"; readonly stage: string; readonly progress: number }
  | {
      readonly type: "result";
      readonly bpm: number;
      readonly beats: readonly number[];
      readonly gridOffsetSec: number;
      readonly confidence: number;
      // Diagnostic fields: raw outputs of each algorithm we ran. `bpm`
      // above is the consensus pick; these show where it came from.
      readonly bpmMultiFeature: number;
      readonly bpmPercival: number;
      readonly bpmEstimates: readonly number[];
      readonly bpmIntervals: readonly number[];
      // First onset time (seconds) from Essentia's OnsetRate. Used as the
      // lower bound for grid-offset back-extrapolation and exposed so
      // tools can show why that bound stopped back-extrap where it did.
      readonly firstAudibleSec: number;
    }
  | { readonly type: "error"; readonly message: string };

self.onmessage = async (e: MessageEvent<AnalysisRequest>) => {
  try {
    if (e.data.type !== "analyze") return;
    postProgress("loading", 0.05);
    await ensureReady();
    postProgress("loaded", 0.15);

    // essentia.js ignores multi-channel analysis for RhythmExtractor — we
    // already mix down to a single channel on the main thread.
    const signal = essentia!.arrayToVector(e.data.channelData);
    postProgress("rhythm", 0.25);

    const rhythm = essentia!.RhythmExtractor2013(signal, 208, "multifeature", 40);
    postProgress("rhythm", 0.6);

    const ticksVec = rhythm.ticks;
    const beats: number[] = new Array(ticksVec.size());
    for (let i = 0; i < ticksVec.size(); i++) beats[i] = ticksVec.get(i);
    const bpmEstimates = vecToArray(rhythm.estimates);
    const bpmIntervals = vecToArray(rhythm.bpmIntervals);

    // Cross-check with an independent algorithm. PercivalBpmEstimator uses
    // a different onset-detection front-end than the multifeature tracker
    // inside RhythmExtractor2013, so when they agree we have real
    // consensus.
    postProgress("percival", 0.7);
    const percival = essentia!.PercivalBpmEstimator(signal);
    postProgress("consensus", 0.95);

    const consensusBpm = pickConsensusBpm(
      rhythm.bpm,
      rhythm.confidence,
      percival.bpm,
      bpmEstimates,
    );

    // Lower bound for back-extrapolation: the first onset (seconds) found
    // by Essentia's OnsetRate pipeline (HFC + complex-domain methods).
    // Prevents the grid offset from being back-extrapolated into pre-music
    // silence. Falls back to 0 if the detector fails.
    let firstAudibleSec = 0;
    try {
      const onsetResult = essentia!.OnsetRate(signal);
      const onsets = vecToArray(onsetResult.onsets);
      if (onsets.length > 0) firstAudibleSec = onsets[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`OnsetRate failed, grid offset will fall back to 0:`, msg);
    }

    const result: AnalysisResponse = {
      type: "result",
      bpm: consensusBpm,
      beats,
      // Grid offset = earliest beat-aligned time ≥ firstAudibleSec.
      // RhythmExtractor2013 often misses the first real beat because its
      // onset-detection front-end needs a few hundred ms to lock on. We
      // back-extrapolate along the detected BPM grid from beats[0] until
      // the next step would cross into pre-music silence. The beats[]
      // array stays untouched — only the offset is corrected — so
      // downstream consumers still see raw tracker output.
      gridOffsetSec: firstGridBeat(beats, consensusBpm, firstAudibleSec),
      confidence: rhythm.confidence,
      bpmMultiFeature: rhythm.bpm,
      bpmPercival: percival.bpm,
      bpmEstimates,
      bpmIntervals,
      firstAudibleSec,
    };
    self.postMessage(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", message: msg } satisfies AnalysisResponse);
  }
};

function postProgress(stage: string, progress: number): void {
  self.postMessage({ type: "progress", stage, progress } satisfies AnalysisResponse);
}

function vecToArray(v: VectorFloat): number[] {
  const out = new Array<number>(v.size());
  for (let i = 0; i < v.size(); i++) out[i] = v.get(i);
  return out;
}

// Earliest beat-aligned time given the tracker's detected beats, consensus
// BPM, and a silence-derived lower bound on where real audio starts.
//
// Strategy:
//   1. Back-extrapolate from beats[0] along 60/bpm steps, down to
//      lowerBound. Handles the common tracker-warmup case where beats[0]
//      is actually beat 2 or 3 of the song.
//   2. If the back-extrapolated beat is still more than half a beat past
//      lowerBound, the tracker's beat-grid phase is simply wrong (real
//      beats don't align with 60/bpm spacing from beats[0]). In that case
//      fall back to lowerBound — the first audible audio — as beat 1.
//      This accepts up to a half-beat pickup/anacrusis offset but
//      prevents the camera from sitting at pathS=0 through actual music.
function firstGridBeat(
  beats: readonly number[],
  bpm: number,
  lowerBound: number,
): number {
  if (beats.length === 0) return lowerBound;
  if (bpm <= 0) return beats[0];
  const interval = 60 / bpm;
  let t = beats[0];
  while (t - interval >= lowerBound) t -= interval;
  if (t - lowerBound > interval * 0.5) return lowerBound;
  return t;
}


// Consensus heuristic across algorithms. If multifeature is highly
// confident, trust it. Otherwise check if Percival agrees with it or with
// a harmonic (e.g., 2× the reported value — classic half-time error).
// Falls back to whichever candidate is closest to the RhythmExtractor's
// own bpmEstimates median (a proxy for "what the song's onset distribution
// most supports").
function pickConsensusBpm(
  mfBpm: number,
  mfConfidence: number,
  percivalBpm: number,
  estimates: readonly number[],
): number {
  // Strong multifeature confidence wins outright.
  if (mfConfidence >= 3.0) return mfBpm;

  // Check direct agreement (within 1 BPM).
  if (Math.abs(mfBpm - percivalBpm) < 1.0) return mfBpm;

  // Check harmonic agreement (half / double).
  if (Math.abs(mfBpm * 2 - percivalBpm) < 2.0) return percivalBpm;
  if (Math.abs(mfBpm / 2 - percivalBpm) < 1.0) return mfBpm;
  if (Math.abs(percivalBpm * 2 - mfBpm) < 2.0) return mfBpm;

  // No strong consensus — if estimates has a value close to percival,
  // the algorithms are both finding it, pick that.
  const estimatesMedian = median(estimates);
  const candidates = [
    { bpm: mfBpm, tag: "multifeature" },
    { bpm: percivalBpm, tag: "percival" },
    { bpm: estimatesMedian, tag: "estimates-median" },
  ].filter((c) => c.bpm > 0);

  // Tie-break: whichever is closest to percival (Percival tends to be more
  // stable across genres per Essentia's own papers).
  candidates.sort(
    (a, b) => Math.abs(a.bpm - percivalBpm) - Math.abs(b.bpm - percivalBpm),
  );
  return candidates[0].bpm;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
