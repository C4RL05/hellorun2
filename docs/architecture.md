# Architecture

Code layout and how the systems fit together. Read alongside [`hellorun2-plan.md`](hellorun2-plan.md) for the authoritative design intent.

## File map

```
src/
├── main.ts                      — entry point: renderer, scene, game loop, UI wiring
├── constants.ts                 — feel-spec (plan §8): every tunable number
├── corridor.ts                  — parametric path (pathS → world pose) + Section type
├── chart.ts                     — procedural chart generator (phrases, corner continuity)
├── collision.ts                 — Z-crossing collision math (slotForY, checkCollision)
├── player.ts                    — PlayerController: input → inputTarget → inputNow → camera.y
├── debug-view.ts                — top-down overlay: bboxes on layer 1, ortho camera
├── waveform.ts                  — 2D-canvas waveform overlay (top of screen)
├── songs.ts                     — SongMetadata type + devSong default (points at /music/)
├── track-storage.ts             — shared IndexedDB (track-meta + track-bytes + analysis-cache stores)
├── track-editor.ts              — music editor modal: waveform + zoom/pan + BPM input + grid drag
├── audio-analysis/
│   ├── analyzer.ts              — main-thread API + Section type + detectSections + clusterSections
│   ├── analyzer-worker.ts       — Web Worker: BPM/grid + per-frame prefix-summed features
│   ├── framewise.ts             — O(1) per-window aggregator from prefix-sum arrays
│   ├── sidecar.ts               — JSON sidecar load/save for shipping precomputed analyses
│   └── cache.ts                 — IDB analysis cache (SHA-256 keyed; uses track-storage's openDb)
└── scene/
    ├── tunnel.ts                — cube-grid tunnel (merged geometry, per-cube jitter rotation)
    ├── gates.ts                 — 3-slot barriers + per-barrier metadata
    └── markers.ts               — beat/bar/phrase/period fly-through square markers
```

## Corridor path model

`src/corridor.ts`. The corridor is an ordered list of **sections** (straights and turns) appended on demand as the camera advances. Each frame the game calls `samplePath(sections, pathS)` → `{pos, yaw}` and writes those to the camera.

- **Section types**: `StraightSection { position, yaw, length }` and `TurnSection { center, radius, startYaw, direction, length }`. Straights carry gameplay (tunnel cubes + gates); turns are empty transitions (plan §2 "no gates at turns").
- **Sampling**: `samplePath` linearly scans for the section owning `pathS`, converts to local offset, and returns the world pose. For turns, the (center → camera) vector rotates rigidly with yaw around +Y: `pos = center + R · direction · (−cos(yaw), 0, sin(yaw))`.
- **Rolling generation** (`ensureSectionsAhead(pathS)` in `main.ts`): appends straight → turn → straight → turn while the last section's end is closer than `SECTION_LOOKAHEAD` (120 units) past the camera. Turn direction alternates right/left per turn so the corridor zig-zags instead of closing into a 4-section square. Called each frame and from `__setPathS` so tests that jump the camera forward don't run off the built corridor.
- **No wrap**: `pathS` is monotonic. The song ending (via `audioSource.onended`) is what bounds a run.

`STRAIGHT_LENGTH = TUNNEL_DEPTH × CELL` (= 40 units). Uniform across all straights — `CAMERA_START.z = 0` removed the 2-unit approach that used to live on the first straight and complicate beat math.

## Game state machine

Plain flags in `main.ts`, no formal state machine class:

| flag | meaning |
|---|---|
| `running` | pathS is being advanced this frame |
| `dead` | player hit a barrier; pathS frozen at hit point |
| `invincible` | collision detection skipped entirely (I key toggle) |
| `motionScale` | test-only scalar multiplied into wall-clock advance fallback |

There's no `totalPathS` anymore — `pathS` itself is monotonic because the corridor doesn't loop.

Transitions:

- **title → running**: click title overlay → `startGame()` → starts audio, hides title, `running = true`.
- **running → dead**: collision detected → `dead = true`, `stopAudio()`, camera freezes.
- **dead → running**: R key or click canvas → `respawn()` → `resetToSpawn()` + restarts audio from start.
- **running → ended**: audio `source.onended` → `running = false`. Same-screen behavior as title (camera frozen, waits for click).
- **any → title**: Esc → `quitToTitle()` → `stopAudio()` + `resetToSpawn()` + show overlay.

`respawn()` vs `resetToSpawn()`:
- `resetToSpawn()` — state-only reset (pathS=0, player.reset(), dead=false). No audio side effects. Used at boot and by the `__respawn` dev hook.
- `respawn()` — full user-facing: resetToSpawn + stop/start audio + hide title + running=true.

## Input pipeline (`src/player.ts`)

Unified delta-based model from all input sources (keyboard, locked-mouse, unlocked-mouse; gamepad/touch slot in trivially).

1. Event handlers write to a normalized `inputTarget` in `[-1, +1]`, clamped.
   - Keyboard: `inputTarget += axis × KEY_SENSITIVITY × dt` per frame while a key is held.
   - Mouse (locked or unlocked): `inputTarget -= (deltaPx / (viewportHeight/2)) × MOUSE_SENSITIVITY` per mousemove, consumed immediately (no accumulator across frames).
2. Each frame, `inputNow` eases toward `inputTarget` with framerate-independent exponential smoothing: `inputNow += (inputTarget − inputNow) × (1 − exp(−dt × INPUT_EASE_RATE))`.
3. Output: `inputNow` linearly mapped from `[-1, +1]` to `[PLAYER_Y_MIN, PLAYER_Y_MAX]`.

Altitude is held when idle (no auto-recenter on vertical). RMB-drag in the debug overlay calls `stopPropagation()` on mousemove so pan motion doesn't leak into `inputTarget`. `PlayerController.setEnabled(false)` disables all input paths without tearing down listeners.

## Chart system (`src/chart.ts`)

- **Vocabulary**: 19 hand-curated 3-gate phrases, difficulty 1–4. Each phrase is `{ slots: [s0, s1, s2], difficulty }` where slot ∈ {0=bottom, 1=mid, 2=top}.
- **Generator**: `generateChart(gateCount, { maxDifficulty?, rand? })` emits a flat `number[]` of slot indices.
- **First-phrase rule**: `pickFirstPhrase` requires `slots[0] === 1` (spawn-safe — player spawns at y=0, can't react to gate 0 if it's at top/bottom).
- **Corner continuity rule** (plan §2): `pickContinuationPhrase` requires `|nextPhrase.slots[0] − prevPhrase.slots[2]| ≤ 1`. Prevents two-slot jumps between phrases.
- **Determinism**: pass `rand: mulberry32(seed)` for reproducible charts (used by `?seed=N` URL param and `tools/collision-check.mjs`).

`main.ts` generates one chart of length `GATE_COUNT * 2` at boot, slices into the two straights, passes to `createGates(openSlots)`.

Gate density knob: `BEATS_PER_GATE` in `constants.ts`. Derives `GATE_COUNT = BEATS_PER_STRAIGHT / BEATS_PER_GATE`. At 120 BPM with BEATS_PER_GATE=4, gates arrive every 2s.

## Scene graph

```
scene
├── DirectionalLight  (raking key)
├── AmbientLight      (very low — plan §5)
├── straight-0 group  (position+yaw from its StraightSection)
│   ├── tunnel.object (merged Mesh + LineSegments2)
│   └── gates.object  (merged transparent Mesh + LineSegments2)
├── straight-1 group  (...)
├── …                 (added dynamically as ensureSectionsAhead runs)
└── DebugView.helpers (Box3Helpers for each straight + barriers + player, layer 1)
```

Each straight group is built from identical `createTunnel()` + `createGates(slots)`; world placement comes entirely from the group's `position`/`rotation.y` set from the matching `StraightSection`. Collision iterates `straightObjects[]` (parallel to `sections[]`, with `null` for turn indices) and transforms the camera's world prev/curr into each straight's local space via `group.worldToLocal`.

## Audio pipeline

```
fetch(url) / file.arrayBuffer ──►  ArrayBuffer
                                    │ (built-ins also fire fetchSidecarText in parallel)
                                    │
                                    ├──► hashArrayBuffer (SHA-256)
                                    │       │
                                    │       ├──► getCachedAnalysis (IDB) ──┐
                                    │       │                              │
                                    │       └──► parseSidecar (built-ins) ►│
                                    ▼                                      │
                              decodeAudioData                              │
                              (native sample rate)                         │
                                    │                                      │
                                    ▼                                      │
                              waveform.setAudioBuffer                      │
                                    │                                      │
                                    ▼                                      │
                              cache or sidecar hit? ─yes─► use cached ────►│
                                    │                                      │
                                    no                                     │
                                    ▼                                      │
                              resampleBuffer → 44100 Hz                    │
                                    │                                      │
                                    ▼                                      │
                              mixToMono (Float32Array)                     │
                                    │                                      │
                              Worker pipeline:                             │
                              1. RhythmExtractor2013 → bpm, ticks          │
                              2. PercivalBpmEstimator → cross-check        │
                              3. OnsetRate → first onset (lower bound)     │
                              4. Per-frame prefix sums (single pass):      │
                                 mean-square, energy, energy×centroid,     │
                                 12-bin chroma — each accumulated into     │
                                 cumulative arrays of length numFrames+1   │
                                    │                                      │
                                    ▼                                      │
                              SongAnalysis { bpm, beats[],                 │
                                gridOffsetSec, confidence,                 │
                                framewise: FramewiseFeatures, … }          │
                                    │                                      │
                              setCachedAnalysis(hash, result) → IDB        │
                                    │                                      │
                                    ▼ ◄────────────────────────────────────┘
                              windowsFromFramewise(framewise, bpm, gridOffsetSec)
                              (main thread, O(1) per window)
                                    │
                              detectSections(windowFeatures, bpm)
                                    │
                              clusterSections → kinds
                                    │
                                    ▼
                              commitAnalysisUpdate → in-memory songAnalysis
                              + recolor straights + waveform.setSongStructure
                              + currentForwardSpeed = forwardSpeedForBpm(bpm)
                                    │
                                    ▼
                              click to start → startAudio()
```

The expensive Essentia work runs **once per song** — every subsequent recompute (editor save, beat-sync click) re-aggregates from the cached framewise prefix sums in sub-millisecond pure JS. See [framewise.ts](../src/audio-analysis/framewise.ts) for the algorithm.

- `main.ts` holds `audioCtx`, `audioBuffer` (native rate), `audioSource` (current playback node), `audioStartTime`, `currentGridOffsetSec`.
- **Audio clock** drives pathS in real play: `audioNow = audioCtx.currentTime − audioStartTime − gridOffsetSec`, `pathS = max(0, audioNow × currentForwardSpeed)`. During intro (negative audioNow) pathS is clamped to 0 — camera waits at spawn through silence. `currentForwardSpeed = forwardSpeedForBpm(bpm)` after analysis; default `FORWARD_SPEED` before.
- **Wall-clock fallback**: when no audio playing (tests), `pathS += currentForwardSpeed × motionScale × dt`. Tests set `motionScale=0` to freeze.
- **Pause/unpause** (Space, dev-mode-only): on pause, snapshot `audioCtx.currentTime − audioStartTime` as `pauseOffsetSec` and stop the source. On unpause, create a fresh BufferSourceNode and call `.start(0, pauseOffsetSec)` with `audioStartTime` realigned so getAudioNow continues seamlessly. Beat sync survives any number of cycles because the offset comes from the audio context's sample clock.
- **Click-to-seek on waveform**: same restart-with-offset mechanism as unpause, plus `pathS = (songTime − gridOffsetSec) × forwardSpeed` and `prevWorldPos.copy(camera.position)` to prevent a fake long-distance Z-crossing collision. Always sets `running=true, dead=false, paused=false` — clicking the waveform means "play from here" regardless of prior state.
- **Drag-drop**: drop-zone handler calls `loadAndAnalyzeSource(file, file.name)` → same analyzer path as the auto-load. Generation counter (`analysisGen`) ensures racing loads don't clobber each other.
- **Autoplay policy**: `startAudio()` is called synchronously inside a click handler so Chromium accepts the gesture. AudioContext is `.resume()`-ed inside the same call chain.

### Section detection (`src/audio-analysis/analyzer.ts`)

Pure-JS post-processing on `windowFeatures[]` (which is itself derived from `framewise` prefix sums via `windowsFromFramewise`). Two passes:

1. **`detectSections(windowFeatures, bpm)`** — for each adjacent pair of windows, compute a combined novelty (0.5 × normalized energy L2 + 0.5 × chroma cosine distance). Boundaries are placed where novelty exceeds `mean + 1σ`. Each between-boundary run is then chunked greedily into blocks of {4, 2, 1} windows = {64, 32, 16} beats. Aggregates loudness/centroid/chroma per block. Emits `Section[]`.
2. **`clusterSections(drafts)`** — first-fit greedy clustering. Walk sections in order; each one either joins an existing cluster whose representative is within `CLUSTER_THRESHOLD = 0.30` (combined energy L2 + chroma cosine) or seeds a new cluster. Cluster representatives update by running average. Returns `kind` per section.

Tunables that change boundary granularity vs cluster granularity are independent: lowering the novelty threshold gives more (shorter) sections; lowering the cluster threshold gives more distinct kinds among the same set of sections.

### Recompute paths (instant)

`recomputeSectionsFromFramewise(framewise, bpm, gridOffsetSec)` derives a fresh `windowFeatures[]` + `sections[]` from the cached prefix sums. Synchronous; no worker. Called by:

- **Editor save** (`applyEditorSave` in `main.ts`) — when bpm or gridOffsetSec changed.
- **Beat-sync click** (`syncFromCurrentMoment`) — after the click sets `currentGridOffsetSec` to the click moment.

Both feed into `commitAnalysisUpdate(next, gridOffsetSec)`, the single landing point that:
- replaces in-memory `songAnalysis`
- recomputes `currentForwardSpeed`, `songMaxLoudness`
- calls `recolorStraightsFromAnalysis()` (per-straight tunnel edge color from new `Section.kind`)
- calls `waveform.setSongStructure()` (early-outs if inputs match cached state)

### Sidecar files (`src/audio-analysis/sidecar.ts`)

Built-in tracks at `public/music/foo.mp3` may ship a `public/music/foo.mp3.analysis.json` sidecar. When present, first-time visitors skip the ~15s worker pass — `loadAndAnalyzeSource` fires `fetchSidecarText` in parallel with the audio download + hash, then `parseSidecar` validates format version + audio hash before accepting. Successful sidecar loads also populate IDB so the second visit hits the cache directly.

Generation: dev tab → "export analysis sidecar" button (`downloadSidecar` in sidecar.ts).

### Storage layout (IndexedDB)

Single DB `hellorun2`, version 2, three stores (all defined in `src/track-storage.ts`):

- `track-meta`: lightweight per-track row info (hash, name, durationSec, bpm, addedAt)
- `track-bytes`: raw mp3 ArrayBuffer for user uploads
- `analysis-cache`: full `SongAnalysis` (incl. ~1MB framewise prefix-sum arrays) keyed by hash

The split keeps the boot-time list query cheap. `cache.ts` imports `openDb` + `ANALYSIS_STORE` from `track-storage.ts` to share the DB. localStorage is no longer used for analysis; `clearAnalysisCache()` still sweeps any legacy `hr2-analysis-v*` entries as a one-time courtesy.

## Debug overlay (`src/debug-view.ts`)

M-key toggles; full-viewport overlay layered on the game view (not PIP).

Two-pass render in `main.ts`:

```
// pass 1 — game
renderer.setViewport(0, 0, W, H);
renderer.clear();                // color + depth
renderer.render(scene, camera);  // perspective

// pass 2 — helpers only, if active
if (debugView.isActive) {
  renderer.clearDepth();         // depth-only clear preserves game's color buffer
  renderer.render(scene, debugView.camera);
}
```

Debug camera has `layers.set(1)` — sees ONLY layer-1 objects. Helpers (Box3Helpers, merged cube-OBB LineSegments) are all on layer 1. Main camera is layer 0, never sees helpers. When debug overlay is active, both renders happen; when inactive, just the game.

Interactions (all gated on `active`):
- mousewheel → zooms the orthographic camera's `.zoom`
- right-mouse drag → pans `orthoCamera.position.x/z` (calls `stopPropagation` on mousemove so PlayerController doesn't see the drag)

Bboxes are registered incrementally via `debugView.addBboxes(...)` — each new straight calls it as it's appended. Player bbox mutates its `Box3.min/max` each frame (Box3Helper picks that up via its `updateMatrixWorld`). Per-cube OBB lines were dropped when the corridor went rolling — they would have needed re-merging each time a section was appended, not worth the complexity for a debug visual.

## Waveform overlay (`src/waveform.ts`)

Top-of-screen 2D-canvas overlay (separate `<canvas>` from the WebGL one). Renders the audio buffer once into an offscreen cache, then per frame `drawImage`s the cache + a 2px playhead line. Decoupled from the three.js render loop.

Cache contents (rebuilt on `setAudioBuffer` and on resize):
- Per-pixel-column min/max amplitude bars, colored by section.
- Phrase grid (every 16 beats from `gridOffsetSec`): solid white where a section starts, dotted 50% otherwise.

Section colors are hue-spread evenly across a heatmap gradient (blue 240° → red 0°) by `kind` index, all sections of the same kind painting identical. `WAVEFORM_ALPHA = 0.5` for the bars; full opacity for section-boundary lines.

Click-to-seek is enabled when the host passes `onSeek` to the constructor; the canvas raises its z-index above the title overlay (5 → 15) and converts click x to song time. Wired in `main.ts` to `seekToSongTime(songTimeSec)`.

## Dev mode (`devMode` in `main.ts`)

`devMode = import.meta.env.DEV || urlParams.has("dev")` — always true in `npm run dev`, opt-in via `?dev` for production builds. Gates these keyboard shortcuts (core game keys R / Esc stay always-available):

| Key | Action |
|---|---|
| Space | Pause/unpause (sample-accurate beat sync via audio context clock) |
| B | Toggle markers (beat/bar/phrase/period squares) |
| M | Toggle debug overlay (top-down) — gated inside `DebugView` via its `enabled` option |
| I | Toggle invincibility (skip collision checks) |

Dev-only runtime actions (currently "clear track analysis" → `clearAnalysisCache()`) live in the user menu's `dev` tab — any element carrying `data-dev-only` is pruned from the DOM when `devMode` is false. The previous Tab-toggled `#dev-menu` modal has been removed.

## Collision (`src/collision.ts`)

Z-crossing check per straight per frame:

```ts
if (prevLocal.z > gate.z && currLocal.z <= gate.z) {
  if (slotForY(currLocal.y) !== gate.openSlot) return gate;
}
```

`main.ts` iterates all currently-built straights in `straightObjects[]` (skipping `null` turn slots), transforming camera world-space prev/curr into each straight's local space via `group.worldToLocal`. Collision runs every frame — no wrap to guard against.

## Title + BYOM UI

`index.html` has a single `#title-screen` div with:
- `<h1>` HELLO RUN
- `.subtitle` status text (loading / analyzing / click to start / failed)
- `#drop-zone` with dashed cyan border (drag target + click-to-browse)
- hidden `<input id="file-picker">` for the browse fallback

`main.ts` adds:
- `window`-level `dragover` / `drop` with `preventDefault()` so misaimed drops don't navigate the browser to the file URL
- drop-zone `drop` → `isAudioFile` check → `loadAndAnalyzeSource(file)`
- drop-zone `click` → `filePicker.click()` with `stopPropagation()` so it doesn't also trigger `startGame` via the title overlay's click handler
- filepicker `change` → same loader path + `filePicker.value = ""` to allow re-selecting the same file

Auto-load of `devSong.url` at boot is kept for dev convenience — tests rely on it.

## Dev hooks

`window.__*` functions registered in `main.ts` under `import.meta.env.DEV` (dead-code-eliminated in production builds). Full inventory in [`dev-tools.md`](dev-tools.md).

## What changes rarely vs often

**Rarely touched** (stable foundation):
- `corridor.ts` path model
- `collision.ts` Z-crossing math
- `player.ts` input pipeline
- `debug-view.ts`

**Often touched** (active development area):
- `main.ts` (game loop, new state, new dev hooks)
- `constants.ts` (tuning)
- `chart.ts` (vocabulary expansion, difficulty curves for M9)
- `audio-analysis/` (new algorithms, section detection for M8 continuation)
