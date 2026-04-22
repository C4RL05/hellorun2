// Main-thread API for audio analysis. Spawns the Essentia.js worker,
// streams progress, and resolves with the analyzed rhythm.

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
