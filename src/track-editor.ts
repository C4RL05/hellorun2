// Per-track editor: lets the user audition a track and correct the
// auto-detected BPM + first-beat offset when the analyzer got them wrong.
//
// Layout: full-screen modal hosting a large 2D-canvas waveform. Beat lines
// from the current bpm + gridOffset overlay it. Interactions:
//   - mouse wheel       → zoom centered on cursor x
//   - RMB drag          → pan visible window left/right
//   - LMB press/release → audition from cursor while held
//   - LMB drag          → shift the beat grid (changes gridOffsetSec)
//
// Audio preview is fully decoupled from the game's audio source so opening
// the editor doesn't disturb the game's pause/seek state. The host pauses
// the game on open and restores prior state on close.
//
// Callbacks the host wires:
//   - onSave(patch)  — persist new bpm/gridOffset and apply to live state
//   - onClose()      — restore game state (resume pause if it was paused)

export interface TrackEditOpen {
  readonly hash: string;
  readonly name: string;
  readonly bpm: number;
  readonly gridOffsetSec: number;
  readonly confidence: number;
  readonly audioBuffer: AudioBuffer;
}

export interface TrackEditPatch {
  readonly bpm: number;
  readonly gridOffsetSec: number;
}

export interface TrackEditorOptions {
  readonly audioCtx: AudioContext;
  readonly onSave: (hash: string, patch: TrackEditPatch) => Promise<void>;
  readonly onClose: () => void;
}

const MIN_PIXELS_PER_SEC = 5; // very zoomed out: ~7-min track in ~2000px
const MAX_PIXELS_PER_SEC = 1000; // very zoomed in: ~2px per ms
const ZOOM_FACTOR = 1.25;
const DRAG_THRESHOLD_PX = 3;

// Grid styling. Phrases (16 beats) are the only musical division shown
// — the editor's job is to align the phrase grid against the audio, and
// per-beat lines just create visual noise.
const PHRASE_LINE_COLOR = "rgba(255, 255, 255, 0.7)";
const PLAYHEAD_COLOR = "rgba(255, 255, 255, 1)";
const WAVEFORM_COLOR = "rgba(255, 255, 255, 0.55)";
const BEATS_PER_PHRASE = 16;

export class TrackEditor {
  private readonly modal: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly nameEl: HTMLElement;
  private readonly bpmInput: HTMLInputElement;
  private readonly gridOffsetEl: HTMLElement;
  private readonly confidenceEl: HTMLElement;
  private readonly durationEl: HTMLElement;

  private readonly audioCtx: AudioContext;
  private readonly onSave: TrackEditorOptions["onSave"];
  private readonly onClose: TrackEditorOptions["onClose"];

  // Live edit state — populated on open, mutated by interactions, applied
  // on Save.
  private hash = "";
  private bpm = 120;
  private gridOffsetSec = 0;
  private audioBuffer: AudioBuffer | null = null;
  private duration = 0;

  // Visible window in seconds. Zoom + pan adjust these.
  private viewStartSec = 0;
  private viewEndSec = 1;

  // Audio preview — owned by the editor, separate from the game's
  // audioSource. previewBaseTime + previewStartedAt let us derive the
  // current playhead via the audio context's clock.
  private previewSource: AudioBufferSourceNode | null = null;
  private previewStartedAt = 0; // audioCtx.currentTime when start() was called
  private previewBaseTime = 0; // song time at which playback started

  // Cached offscreen waveform per zoom level (rebuilt when view window
  // size changes; pan reuses the same cache).
  private cache: HTMLCanvasElement | null = null;
  private cacheStartSec = 0;
  private cacheEndSec = 0;
  private cacheWidth = 0;

  // Interaction state.
  private dragMode: "none" | "pan" | "grid" | "maybeClick" = "none";
  private dragStartX = 0;
  private dragStartGridOffsetSec = 0;
  private dragStartViewStart = 0;

  // RAF handle for the per-frame playhead redraw.
  private rafHandle = 0;

  // DPR captured at last resizeCanvas. Stored so draw() uses the SAME
  // value resize used (window.devicePixelRatio can change between calls
  // — typically when the user zooms the browser — and a mismatch causes
  // the rendering to fill only a fraction of the canvas).
  private dpr = 1;

  constructor(options: TrackEditorOptions) {
    this.audioCtx = options.audioCtx;
    this.onSave = options.onSave;
    this.onClose = options.onClose;

    this.modal = document.getElementById("track-editor")!;
    this.canvas = document.getElementById(
      "editor-waveform",
    ) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.nameEl = document.getElementById("editor-name")!;
    this.bpmInput = document.getElementById(
      "editor-bpm",
    ) as HTMLInputElement;
    this.gridOffsetEl = document.getElementById("editor-grid-offset")!;
    this.confidenceEl = document.getElementById("editor-confidence")!;
    this.durationEl = document.getElementById("editor-duration")!;

    // Backdrop click closes (dispatch like menu/dev-menu).
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.handleClose();
    });
    document
      .getElementById("editor-close")
      ?.addEventListener("click", () => this.handleClose());
    document
      .getElementById("editor-cancel")
      ?.addEventListener("click", () => this.handleClose());
    document
      .getElementById("editor-save")
      ?.addEventListener("click", () => void this.handleSave());

    this.bpmInput.addEventListener("input", () => {
      const v = parseFloat(this.bpmInput.value);
      if (!isFinite(v) || v <= 0) return;
      this.bpm = v;
      this.invalidateCache();
      this.draw();
    });

    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    // Suppress the default context menu so RMB drag is usable.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // Keep the canvas matched to its CSS box across browser zoom or
    // window resize — without this the cached DPR goes stale and the
    // rendering shrinks to a fraction of the canvas.
    window.addEventListener("resize", this.onWindowResize);
  }

  isOpen(): boolean {
    return !this.modal.classList.contains("hidden");
  }

  open(track: TrackEditOpen): void {
    this.hash = track.hash;
    this.bpm = track.bpm;
    this.gridOffsetSec = track.gridOffsetSec;
    this.audioBuffer = track.audioBuffer;
    this.duration = track.audioBuffer.duration;
    this.viewStartSec = 0;
    this.viewEndSec = this.duration;

    this.nameEl.textContent = track.name;
    this.bpmInput.value = track.bpm.toFixed(2);
    this.confidenceEl.textContent = track.confidence.toFixed(2);
    this.durationEl.textContent = formatDuration(this.duration);
    this.updateGridOffsetReadout();

    this.modal.classList.remove("hidden");
    this.resizeCanvas();
    this.invalidateCache();
    this.draw();
    this.startRaf();
  }

  // Close handler — Esc key delegate calls this from main.ts.
  closeFromEsc(): void {
    this.handleClose();
  }

  private async handleSave(): Promise<void> {
    if (!this.hash) return;
    const saveBtn = document.getElementById("editor-save") as HTMLButtonElement | null;
    const cancelBtn = document.getElementById("editor-cancel") as HTMLButtonElement | null;
    const closeBtn = document.getElementById("editor-close") as HTMLButtonElement | null;
    const originalSaveText = saveBtn?.textContent ?? "save";
    if (saveBtn) {
      saveBtn.textContent = "saving…";
      saveBtn.disabled = true;
    }
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    try {
      await this.onSave(this.hash, {
        bpm: this.bpm,
        gridOffsetSec: this.gridOffsetSec,
      });
    } finally {
      if (saveBtn) {
        saveBtn.textContent = originalSaveText;
        saveBtn.disabled = false;
      }
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
    }
    this.handleClose();
  }

  private handleClose(): void {
    this.stopPreview();
    this.stopRaf();
    this.modal.classList.add("hidden");
    this.audioBuffer = null;
    this.hash = "";
    this.onClose();
  }

  private resizeCanvas(): void {
    // Match canvas pixel dimensions to its CSS size for crisp rendering.
    // Don't clamp DPR — at hidpi displays + browser zoom the real DPR
    // can be 3+; clamping here while draw() reads raw window.dpr was
    // the source of "waveform fills only part of the canvas" reports.
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private onWindowResize = () => {
    if (!this.isOpen()) return;
    this.resizeCanvas();
    this.invalidateCache();
    this.draw();
  };

  private invalidateCache(): void {
    this.cache = null;
  }

  private startRaf(): void {
    if (this.rafHandle) return;
    const tick = () => {
      this.draw();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

  // Draws waveform (cached) + beat grid (cheap) + playhead (cheap).
  private draw(): void {
    if (!this.audioBuffer) return;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.ctx.clearRect(0, 0, w, h);
    this.drawWaveform(w, h);
    this.drawBeatGrid(w, h);
    this.drawPlayhead(w, h);
  }

  // Per-pixel min/max amplitude bars within the visible window. Cached
  // per-window so panning during a single zoom level reuses the same
  // cache for the overlapping range — but for simplicity we just rebuild
  // when the window changes.
  private drawWaveform(w: number, h: number): void {
    if (!this.audioBuffer) return;
    if (
      !this.cache ||
      this.cacheStartSec !== this.viewStartSec ||
      this.cacheEndSec !== this.viewEndSec ||
      this.cacheWidth !== w
    ) {
      this.cache = document.createElement("canvas");
      this.cache.width = Math.max(1, Math.floor(w));
      this.cache.height = Math.max(1, Math.floor(h));
      this.cacheStartSec = this.viewStartSec;
      this.cacheEndSec = this.viewEndSec;
      this.cacheWidth = w;
      const cctx = this.cache.getContext("2d");
      if (!cctx) return;
      const samples = this.audioBuffer.getChannelData(0);
      const sampleRate = this.audioBuffer.sampleRate;
      const startSample = Math.max(0, Math.floor(this.viewStartSec * sampleRate));
      const endSample = Math.min(
        samples.length,
        Math.floor(this.viewEndSec * sampleRate),
      );
      const samplesPerPixel = Math.max(
        1,
        (endSample - startSample) / this.cache.width,
      );
      const halfH = this.cache.height * 0.5;
      cctx.fillStyle = WAVEFORM_COLOR;
      for (let x = 0; x < this.cache.width; x++) {
        const s0 = startSample + Math.floor(x * samplesPerPixel);
        const s1 = Math.min(
          endSample,
          startSample + Math.floor((x + 1) * samplesPerPixel),
        );
        let min = 0;
        let max = 0;
        for (let i = s0; i < s1; i++) {
          const v = samples[i];
          if (v < min) min = v;
          else if (v > max) max = v;
        }
        const yTop = halfH - max * halfH;
        const yBot = halfH - min * halfH;
        cctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
      }
    }
    this.ctx.drawImage(this.cache, 0, 0, w, h);
  }

  // Phrase grid based on current bpm + gridOffsetSec. One vertical
  // white line every 16 beats from the offset — matches the in-game
  // corridor cadence (a corridor straight = 2 bars = 8 beats; a phrase
  // = 16 beats = one straight + turn cycle).
  private drawBeatGrid(w: number, h: number): void {
    if (this.bpm <= 0) return;
    const secPerPhrase = (BEATS_PER_PHRASE * 60) / this.bpm;
    if (secPerPhrase <= 0) return;
    // First phrase line at or after viewStart.
    const firstIdx = Math.max(
      0,
      Math.ceil((this.viewStartSec - this.gridOffsetSec) / secPerPhrase),
    );
    this.ctx.fillStyle = PHRASE_LINE_COLOR;
    for (let i = firstIdx; ; i++) {
      const t = this.gridOffsetSec + i * secPerPhrase;
      if (t > this.viewEndSec) break;
      const x = this.timeToX(t, w);
      this.ctx.fillRect(x, 0, 1, h);
    }
  }

  private drawPlayhead(w: number, h: number): void {
    const t = this.previewTimeNow();
    if (t === null) return;
    if (t < this.viewStartSec || t > this.viewEndSec) return;
    const x = this.timeToX(t, w);
    this.ctx.fillStyle = PLAYHEAD_COLOR;
    this.ctx.fillRect(x, 0, 2, h);
  }

  // Returns current preview playback time in seconds (song time), or
  // null when no preview is playing.
  private previewTimeNow(): number | null {
    if (!this.previewSource) return null;
    const elapsed = this.audioCtx.currentTime - this.previewStartedAt;
    return this.previewBaseTime + elapsed;
  }

  private timeToX(t: number, w: number): number {
    const span = this.viewEndSec - this.viewStartSec;
    return ((t - this.viewStartSec) / span) * w;
  }

  private xToTime(x: number, w: number): number {
    const span = this.viewEndSec - this.viewStartSec;
    return this.viewStartSec + (x / w) * span;
  }

  private clientXToCanvasX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return clientX - rect.left;
  }

  // === Interactions ===========================================

  private onWheel = (e: WheelEvent) => {
    if (!this.audioBuffer) return;
    e.preventDefault();
    const w = this.canvas.clientWidth;
    const cursorX = this.clientXToCanvasX(e.clientX);
    const cursorTime = this.xToTime(cursorX, w);
    const factor = e.deltaY < 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;

    const oldSpan = this.viewEndSec - this.viewStartSec;
    let newSpan = oldSpan * factor;
    // Clamp to MIN_PIXELS_PER_SEC / MAX_PIXELS_PER_SEC.
    const maxSpan = w / MIN_PIXELS_PER_SEC;
    const minSpan = w / MAX_PIXELS_PER_SEC;
    newSpan = Math.max(minSpan, Math.min(maxSpan, newSpan));
    // Pivot zoom on cursor: keep cursorTime under the cursor.
    const cursorFrac = cursorX / w;
    this.viewStartSec = cursorTime - cursorFrac * newSpan;
    this.viewEndSec = this.viewStartSec + newSpan;
    this.clampView();
    this.invalidateCache();
    this.draw();
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.audioBuffer) return;
    if (e.target !== this.canvas) return;
    e.preventDefault();
    this.dragStartX = this.clientXToCanvasX(e.clientX);
    if (e.button === 2) {
      // RMB: pan
      this.dragMode = "pan";
      this.dragStartViewStart = this.viewStartSec;
    } else if (e.button === 0) {
      // LMB: audition-while-held. Preview starts immediately from the
      // pressed x and stops on release (or drag end, both funnel through
      // onMouseUp). Drag past threshold switches into "grid" mode and
      // shifts the beat grid; audio keeps playing during the drag so the
      // user can hear the grid line up as they nudge it.
      this.dragMode = "maybeClick";
      this.dragStartGridOffsetSec = this.gridOffsetSec;
      const w = this.canvas.clientWidth;
      const t = Math.max(0, Math.min(this.duration, this.xToTime(this.dragStartX, w)));
      this.startPreviewAt(t);
      this.draw();
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.dragMode === "none") return;
    const x = this.clientXToCanvasX(e.clientX);
    const w = this.canvas.clientWidth;
    const span = this.viewEndSec - this.viewStartSec;

    if (this.dragMode === "maybeClick") {
      if (Math.abs(x - this.dragStartX) > DRAG_THRESHOLD_PX) {
        this.dragMode = "grid";
      } else {
        return;
      }
    }

    if (this.dragMode === "pan") {
      const deltaSec = ((x - this.dragStartX) / w) * span;
      this.viewStartSec = this.dragStartViewStart - deltaSec;
      this.viewEndSec = this.viewStartSec + span;
      this.clampView();
      this.invalidateCache();
      this.draw();
    } else if (this.dragMode === "grid") {
      const deltaSec = ((x - this.dragStartX) / w) * span;
      this.gridOffsetSec = this.dragStartGridOffsetSec + deltaSec;
      this.updateGridOffsetReadout();
      this.draw();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (this.dragMode === "none") return;
    this.dragMode = "none";
    if (e.button === 0) {
      // LMB release ends audition (preview started on press).
      this.stopPreview();
      this.draw();
    }
  };

  private clampView(): void {
    const span = this.viewEndSec - this.viewStartSec;
    if (this.viewStartSec < 0) {
      this.viewStartSec = 0;
      this.viewEndSec = span;
    }
    if (this.viewEndSec > this.duration) {
      this.viewEndSec = this.duration;
      this.viewStartSec = Math.max(0, this.viewEndSec - span);
    }
  }

  private updateGridOffsetReadout(): void {
    this.gridOffsetEl.textContent = `${this.gridOffsetSec.toFixed(3)}s`;
  }

  // === Preview audio ==========================================

  private startPreviewAt(songTimeSec: number): void {
    if (!this.audioBuffer) return;
    this.stopPreview();
    void this.audioCtx.resume();
    const src = this.audioCtx.createBufferSource();
    src.buffer = this.audioBuffer;
    src.connect(this.audioCtx.destination);
    this.previewSource = src;
    this.previewStartedAt = this.audioCtx.currentTime;
    this.previewBaseTime = songTimeSec;
    src.onended = () => {
      // Natural end (or our manual stop) — null the ref so playhead
      // disappears.
      if (this.previewSource === src) this.previewSource = null;
    };
    src.start(0, songTimeSec);
  }

  private stopPreview(): void {
    if (!this.previewSource) return;
    const src = this.previewSource;
    this.previewSource = null;
    src.onended = null;
    try {
      src.stop();
    } catch {
      // ignore (not started or already stopped)
    }
    src.disconnect();
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}
