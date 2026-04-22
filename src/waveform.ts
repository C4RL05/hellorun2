// Top-of-screen waveform overlay — 2D canvas layered above the WebGL
// canvas. Renders the audio buffer once into an offscreen cache, then
// per frame blits the cache + draws a playhead line at the current
// playback position. Decoupled from the three.js render loop; the only
// per-frame call is `draw(songTimeSec)`.

import type { Section } from "./audio-analysis/analyzer";

const HEIGHT_PX = 80;
const WAVEFORM_FILL = "rgba(255, 255, 255, 0.25)";
const PHRASE_FILL = "rgba(255, 255, 255, 0.5)";
const SECTION_BOUNDARY_FILL = "rgba(255, 255, 255, 1)";
const PLAYHEAD_FILL = "rgba(255, 255, 255, 1)";
const PLAYHEAD_WIDTH_PX = 2;
const BEATS_PER_PHRASE = 16;
const PHRASE_DASH_ON_PX = 2;
const PHRASE_DASH_OFF_PX = 2;
const WAVEFORM_ALPHA = 0.5;
// Heatmap gradient endpoints. Hues go from 240 (blue, low-index kind)
// down through 120 (green, middle) to 0 (red, high-index kind). HSV
// (h, 100, 100) = HSL (h, 100%, 50%) — pure saturated colors.
const HEATMAP_HUE_START = 240;
const HEATMAP_HUE_END = 0;

export interface WaveformOptions {
  // Called when the user clicks the waveform. The argument is the song
  // time (seconds from sample 0) corresponding to the click x position.
  // The host is expected to seek/start audio from that offset.
  readonly onSeek?: (songTimeSec: number) => void;
}

export class WaveformOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onSeek: ((songTimeSec: number) => void) | null;
  private cache: HTMLCanvasElement | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private duration = 0;
  // Set after audio analysis lands. Drives the per-phrase vertical lines
  // and per-section waveform coloring baked into the cache. Defaults of
  // 0 / [] mean no grid or coloring is drawn yet.
  private bpm = 0;
  private gridOffsetSec = 0;
  private sections: readonly Section[] = [];

  constructor(options: WaveformOptions = {}) {
    this.onSeek = options.onSeek ?? null;
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "fixed";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = `${HEIGHT_PX}px`;
    // Above the title overlay (z-index 10) when seeking is wired up, so
    // the top 80px routes to this canvas instead of "click to start". The
    // rest of the title (drop zone, h1) stays clickable below.
    this.canvas.style.zIndex = this.onSeek ? "15" : "5";
    this.canvas.style.pointerEvents = this.onSeek ? "auto" : "none";
    this.canvas.style.cursor = this.onSeek ? "pointer" : "default";
    document.body.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("WaveformOverlay: 2D canvas context unavailable");
    this.ctx = ctx;
    if (this.onSeek) this.canvas.addEventListener("click", this.handleClick);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private handleClick = (e: MouseEvent) => {
    if (!this.onSeek || this.duration === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const songTime = Math.max(
      0,
      Math.min(this.duration, fraction * this.duration),
    );
    this.onSeek(songTime);
  };

  setAudioBuffer(buffer: AudioBuffer): void {
    this.audioBuffer = buffer;
    this.duration = buffer.duration;
    this.renderCache();
    this.draw(0);
  }

  // Called once the analyzer worker reports BPM + grid offset + sections.
  // Triggers a cache rebuild so phrase grid + per-section waveform color
  // bake in together.
  setSongStructure(
    bpm: number,
    gridOffsetSec: number,
    sections: readonly Section[] = [],
  ): void {
    this.bpm = bpm;
    this.gridOffsetSec = gridOffsetSec;
    this.sections = sections;
    this.renderCache();
    this.draw(0);
  }

  draw(songTimeSec: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    if (!this.cache) return;
    this.ctx.drawImage(this.cache, 0, 0);
    if (this.duration > 0) {
      const x = Math.floor(
        (Math.max(0, Math.min(this.duration, songTimeSec)) / this.duration) * w,
      );
      this.ctx.fillStyle = PLAYHEAD_FILL;
      this.ctx.fillRect(x, 0, PLAYHEAD_WIDTH_PX, h);
    }
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = HEIGHT_PX;
    // Re-bin the cache at the new width if we have a buffer; otherwise
    // the next setAudioBuffer call will populate it.
    if (this.audioBuffer) {
      this.renderCache();
      this.draw(0);
    }
  }

  // Rebuilds the offscreen cache by walking the channel-0 samples and
  // computing per-column min/max amplitudes. Drawn as vertical fillRects
  // — the union of column extents reads as the familiar waveform shape.
  // When sections are known, each column picks up the color of the
  // section that owns it (centroid → hue, loudness → saturation).
  private renderCache(): void {
    if (!this.audioBuffer) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.cache = document.createElement("canvas");
    this.cache.width = w;
    this.cache.height = h;
    const cctx = this.cache.getContext("2d");
    if (!cctx) return;
    const samples = this.audioBuffer.getChannelData(0);
    const samplesPerPixel = samples.length / w;
    const halfH = h * 0.5;

    // Color per CLUSTER (Section.kind). Each unique kind gets a hue
    // spread evenly across the heatmap gradient — same kind = same
    // color, different kinds maximally distinct.
    const sectionColors = clusterColors(this.sections);
    const colSection = new Int32Array(w).fill(-1);
    if (this.sections.length > 0 && this.bpm > 0 && this.duration > 0) {
      const secPerBeat = 60 / this.bpm;
      let sIdx = 0;
      for (let x = 0; x < w; x++) {
        const t = (x / w) * this.duration;
        while (sIdx < this.sections.length) {
          const s = this.sections[sIdx];
          const endSec = s.startSec + s.beatLength * secPerBeat;
          if (t >= endSec) sIdx++;
          else break;
        }
        if (
          sIdx < this.sections.length &&
          t >= this.sections[sIdx].startSec
        ) {
          colSection[x] = sIdx;
        }
      }
    }

    for (let x = 0; x < w; x++) {
      const sIdx = colSection[x];
      cctx.fillStyle = sIdx === -1 ? WAVEFORM_FILL : sectionColors[sIdx];
      const start = Math.floor(x * samplesPerPixel);
      const end = Math.min(samples.length, Math.floor((x + 1) * samplesPerPixel));
      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const s = samples[i];
        if (s < min) min = s;
        else if (s > max) max = s;
      }
      const yTop = halfH - max * halfH;
      const yBot = halfH - min * halfH;
      cctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
    }

    // Phrase grid: vertical lines every 16 beats from gridOffsetSec.
    // Phrase boundaries that also start a section render as solid white
    // (full opacity); pure phrase boundaries render dotted at 50%.
    // Skipped silently if BPM is zero (analysis not landed yet).
    if (this.bpm > 0 && this.duration > 0) {
      const phraseSec = (BEATS_PER_PHRASE * 60) / this.bpm;
      // Section starts always coincide with phrase boundaries; round to
      // ms for float-tolerant lookup.
      const sectionStartMs = new Set(
        this.sections.map((s) => Math.round(s.startSec * 1000)),
      );
      for (let t = this.gridOffsetSec; t <= this.duration; t += phraseSec) {
        const x = Math.floor((t / this.duration) * w);
        if (sectionStartMs.has(Math.round(t * 1000))) {
          cctx.fillStyle = SECTION_BOUNDARY_FILL;
          cctx.fillRect(x, 0, 1, h);
        } else {
          cctx.fillStyle = PHRASE_FILL;
          for (let y = 0; y < h; y += PHRASE_DASH_ON_PX + PHRASE_DASH_OFF_PX) {
            cctx.fillRect(x, y, 1, PHRASE_DASH_ON_PX);
          }
        }
      }
    }
  }
}

// Returns a color per section, where all sections sharing a `kind`
// resolve to the exact same color. Each unique kind index gets a hue
// spread evenly across the heatmap gradient (blue → green → red), with
// kind 0 at the start of the gradient and the highest kind at the end.
function clusterColors(sections: readonly Section[]): string[] {
  const uniqueKinds = [...new Set(sections.map((s) => s.kind))].sort(
    (a, b) => a - b,
  );
  const n = uniqueKinds.length;
  const colorByKind = new Map<number, string>();
  uniqueKinds.forEach((kind, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const hue = HEATMAP_HUE_START + t * (HEATMAP_HUE_END - HEATMAP_HUE_START);
    // hsv(h, 100, 100) = hsl(h, 100%, 50%).
    colorByKind.set(kind, `hsla(${hue.toFixed(0)}, 100%, 50%, ${WAVEFORM_ALPHA})`);
  });
  return sections.map((s) => colorByKind.get(s.kind) ?? WAVEFORM_FILL);
}
