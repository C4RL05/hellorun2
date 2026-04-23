// Main-thread API for audio analysis. Spawns the Essentia.js worker,
// streams progress, and resolves with the analyzed rhythm.

export interface WindowFeature {
  readonly startSec: number;
  readonly loudness: number;
  readonly centroid: number;
  readonly chroma: readonly number[];
}

export interface Section {
  // Beat-aligned start (from gridOffset) and absolute time start.
  readonly startBeat: number;
  readonly startSec: number;
  // Length is one of {16, 32, 64} beats — one of {1, 2, 4} windows.
  readonly beatLength: number;
  readonly windowCount: number;
  // Aggregate features over the section's windows. Drive downstream
  // game decisions: loudness → chart density, centroid → palette hue,
  // chroma → palette/key cues.
  readonly avgLoudness: number;
  readonly avgCentroid: number;
  readonly avgChroma: readonly number[];
  // Cluster assignment from clusterSections(). Sections with the same
  // `kind` have similar features (energy + timbre + harmony) and are
  // likely to be the same musical section type — e.g. all chorus
  // sections share a kind. Kinds are 0-indexed in order-of-first-
  // appearance through the song, so kind 0 is whatever section the song
  // opens with.
  readonly kind: number;
}

export interface SongAnalysis {
  // Consensus BPM across algorithms (see analyzer-worker for heuristic).
  readonly bpm: number;
  readonly beats: readonly number[];
  readonly gridOffsetSec: number;
  // RhythmExtractor2013 multifeature confidence in [0..5.32]; higher is
  // better. A stable 4/4 pop song is typically 2.5+; values near 0 mean
  // the tracker couldn't lock on.
  readonly confidence: number;
  // Raw algorithm outputs for diagnostics / tuning.
  readonly bpmMultiFeature: number;
  readonly bpmPercival: number;
  readonly bpmEstimates: readonly number[];
  readonly bpmIntervals: readonly number[];
  readonly firstAudibleSec: number;
  readonly windowFeatures: readonly WindowFeature[];
  readonly windowDurationSec: number;
  // Detected sections — derived from windowFeatures via detectSections().
  // Cached on the analysis result so consumers don't have to rerun the
  // detector. Re-run with different options if you want to experiment.
  readonly sections: readonly Section[];
}

export interface AnalysisProgress {
  readonly stage: string;
  readonly progress: number;
}

// Essentia.js algorithms have sample rate baked in at algorithm construction
// (default 44100 Hz). Passing audio at any other rate makes BPM detection
// off by a factor of ANALYSIS_SAMPLE_RATE / actualRate — on Windows Chrome
// the AudioContext defaults to 48000, which would report BPM as
// 0.9187× the true value. We resample first.
const ANALYSIS_SAMPLE_RATE = 44100;

// Analyzes an AudioBuffer. Resamples to 44100 Hz if needed, mixes to mono
// (RhythmExtractor wants a 1D signal), copies channel data so the buffer
// transfer doesn't detach the AudioContext's internal storage.
export async function analyzeAudio(
  buffer: AudioBuffer,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<SongAnalysis> {
  const worker = new Worker(
    new URL("./analyzer-worker.ts", import.meta.url),
    { type: "module" },
  );

  const analysisBuffer =
    buffer.sampleRate === ANALYSIS_SAMPLE_RATE
      ? buffer
      : await resampleBuffer(buffer, ANALYSIS_SAMPLE_RATE);
  const mono = mixToMono(analysisBuffer);

  return new Promise<SongAnalysis>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: "progress"; stage: string; progress: number }
        | {
            type: "result";
            bpm: number;
            beats: readonly number[];
            gridOffsetSec: number;
            confidence: number;
            bpmMultiFeature: number;
            bpmPercival: number;
            bpmEstimates: readonly number[];
            bpmIntervals: readonly number[];
            firstAudibleSec: number;
            windowFeatures: readonly WindowFeature[];
            windowDurationSec: number;
          }
        | { type: "error"; message: string };
      if (msg.type === "progress") {
        onProgress?.({ stage: msg.stage, progress: msg.progress });
      } else if (msg.type === "result") {
        worker.terminate();
        resolve({
          bpm: msg.bpm,
          beats: msg.beats,
          gridOffsetSec: msg.gridOffsetSec,
          confidence: msg.confidence,
          bpmMultiFeature: msg.bpmMultiFeature,
          bpmPercival: msg.bpmPercival,
          bpmEstimates: msg.bpmEstimates,
          bpmIntervals: msg.bpmIntervals,
          firstAudibleSec: msg.firstAudibleSec,
          windowFeatures: msg.windowFeatures,
          windowDurationSec: msg.windowDurationSec,
          sections: detectSections(msg.windowFeatures, msg.bpm),
        });
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      reject(new Error(e.message || "worker error"));
    };

    worker.postMessage(
      {
        type: "analyze",
        channelData: mono,
        sampleRate: analysisBuffer.sampleRate,
      },
      [mono.buffer],
    );
  });
}

// OfflineAudioContext-based resampling. Renders the buffer at the target
// sample rate without loss of audio (beyond the inherent band-limiting of
// sample-rate conversion, which is fine for rhythm analysis).
async function resampleBuffer(
  buffer: AudioBuffer,
  targetRate: number,
): Promise<AudioBuffer> {
  const frameCount = Math.ceil(buffer.duration * targetRate);
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    frameCount,
    targetRate,
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

// Coalesces per-window features into variable-length sections. Each section
// spans 1, 2, or 4 windows (16, 32, or 64 beats — the user-defined valid
// section sizes). Boundaries are placed where adjacent-window novelty
// (combined energy + chroma) exceeds mean+1σ; a low-novelty run longer
// than 4 windows is greedily chunked 4→2→1.
//
// Pure JS, no Essentia. Cheap to re-run with different threshold/weight
// options if you want to experiment without re-decoding the audio.
export function detectSections(
  windows: readonly WindowFeature[],
  bpm: number,
): Section[] {
  if (windows.length === 0 || bpm <= 0) return [];
  const beatsPerWindow = 16;
  const secPerBeat = 60 / bpm;

  // Combined novelty per window — same as the analysis-check tool.
  const maxL = windows.reduce((m, w) => Math.max(m, w.loudness), 0) || 1;
  const maxC = windows.reduce((m, w) => Math.max(m, w.centroid), 0) || 1;
  const novelty = windows.map((w, i) => {
    if (i === 0) return 0;
    const prev = windows[i - 1];
    const dl = (w.loudness - prev.loudness) / maxL;
    const dc = (w.centroid - prev.centroid) / maxC;
    const energyNov = Math.sqrt(dl * dl + dc * dc);
    const chromaNov = cosineDistance(w.chroma, prev.chroma);
    return 0.5 * energyNov + 0.5 * chromaNov;
  });
  const mean = novelty.reduce((a, b) => a + b, 0) / novelty.length;
  const std = Math.sqrt(
    novelty.reduce((s, v) => s + (v - mean) ** 2, 0) / novelty.length,
  );
  const threshold = mean + std;

  // Boundary indices = window indices where novelty crosses threshold,
  // bracketed by 0 (start of song) and N (end of song).
  const boundaries: number[] = [0];
  for (let i = 1; i < windows.length; i++) {
    if (novelty[i] > threshold) boundaries.push(i);
  }
  boundaries.push(windows.length);

  // Build sections without kinds first. For each [start, end) run
  // between boundaries, snap length to {1, 2, 4} greedily — prefer 4
  // (period), then 2 (phrase), then 1 — so musical hierarchy stays
  // power-of-two.
  type SectionDraft = Omit<Section, "kind">;
  const drafts: SectionDraft[] = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    let cursor = boundaries[b];
    const end = boundaries[b + 1];
    while (cursor < end) {
      const remaining = end - cursor;
      const chunkSize = remaining >= 4 ? 4 : remaining >= 2 ? 2 : 1;
      const wEnd = cursor + chunkSize;
      let sumL = 0, sumC = 0;
      const sumChroma = new Array<number>(windows[cursor].chroma.length).fill(0);
      for (let w = cursor; w < wEnd; w++) {
        sumL += windows[w].loudness;
        sumC += windows[w].centroid;
        for (let k = 0; k < sumChroma.length; k++) {
          sumChroma[k] += windows[w].chroma[k];
        }
      }
      const startBeat = Math.round(windows[cursor].startSec / secPerBeat);
      drafts.push({
        startBeat,
        startSec: windows[cursor].startSec,
        beatLength: chunkSize * beatsPerWindow,
        windowCount: chunkSize,
        avgLoudness: sumL / chunkSize,
        avgCentroid: sumC / chunkSize,
        avgChroma: sumChroma.map((v) => v / chunkSize),
      });
      cursor = wEnd;
    }
  }

  // Cluster: same-kind sections look/sound alike (chorus = chorus, etc).
  const kinds = clusterSections(drafts);
  return drafts.map((d, i) => ({ ...d, kind: kinds[i] }));
}

// First-fit greedy clustering. For each section in order, find the
// existing cluster whose representative is closest in normalized feature
// space; if within threshold, join it (and update the rep by running
// average). Otherwise seed a new cluster. Returns parallel kinds[].
//
// Distance combines normalized energy/timbre L2 with chroma cosine —
// loudness/centroid catches "drop vs verse with same chords"; chroma
// catches "verse vs chorus with same energy."
// Lower → more distinct kinds (more palette variety, tighter clusters).
// 0.30 surfaces 4–5 kinds on typical pop/EDM (verse/pre/chorus/bridge).
// At 0.40 the dev song collapsed to just 2 (loud-mix vs quiet-breakdown),
// which left only one palette shift per song. Bumping CACHE_VERSION in
// cache.ts when you change this forces re-clustering on reload.
const CLUSTER_THRESHOLD = 0.30;
function clusterSections(
  sections: ReadonlyArray<Omit<Section, "kind">>,
): number[] {
  if (sections.length === 0) return [];
  const maxLoud =
    sections.reduce((m, s) => Math.max(m, s.avgLoudness), 0) || 1;
  const minLogC = Math.log(80);
  const maxLogC = Math.log(8000);
  const normLoud = (l: number) => l / maxLoud;
  const normCent = (c: number) =>
    (Math.log(Math.max(80, c)) - minLogC) / (maxLogC - minLogC);

  interface Rep {
    loud: number;
    cent: number;
    chroma: number[];
    count: number;
  }
  const reps: Rep[] = [];
  const kinds: number[] = [];
  for (const s of sections) {
    const ls = normLoud(s.avgLoudness);
    const cs = normCent(s.avgCentroid);
    let bestK = -1;
    let bestD = Infinity;
    for (let k = 0; k < reps.length; k++) {
      const r = reps[k];
      const dl = ls - r.loud;
      const dc = cs - r.cent;
      const energyD = Math.sqrt(dl * dl + dc * dc);
      const chromaD = cosineDistance(s.avgChroma, r.chroma);
      const d = 0.5 * energyD + 0.5 * chromaD;
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestD < CLUSTER_THRESHOLD && bestK !== -1) {
      kinds.push(bestK);
      const r = reps[bestK];
      r.count++;
      const w = 1 / r.count;
      r.loud = r.loud * (1 - w) + ls * w;
      r.cent = r.cent * (1 - w) + cs * w;
      for (let i = 0; i < r.chroma.length; i++) {
        r.chroma[i] = r.chroma[i] * (1 - w) + s.avgChroma[i] * w;
      }
    } else {
      kinds.push(reps.length);
      reps.push({ loud: ls, cent: cs, chroma: [...s.avgChroma], count: 1 });
    }
  }
  return kinds;
}

function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let k = 0; k < a.length; k++) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return 1 - dot / denom;
}

// Average stereo (or N-channel) audio into a single mono Float32Array.
// RhythmExtractor2013 expects mono input.
function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const src = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += src[i];
  }
  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i++) out[i] *= inv;
  }
  return out;
}
