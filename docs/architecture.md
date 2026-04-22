# Architecture

Code layout and how the systems fit together. Read alongside [`hellorun2-plan.md`](hellorun2-plan.md) for the authoritative design intent.

## File map

```
src/
├── main.ts                      — entry point: renderer, scene, game loop, UI wiring
├── constants.ts                 — feel-spec (plan §8): every tunable number
├── corridor.ts                  — parametric path (pathS → world pose)
├── chart.ts                     — procedural chart generator (phrases, corner continuity)
├── collision.ts                 — Z-crossing collision math (slotForY, checkCollision)
├── player.ts                    — PlayerController: input → inputTarget → inputNow → camera.y
├── debug-view.ts                — top-down overlay: bboxes on layer 1, ortho camera
├── songs.ts                     — SongMetadata type + devSong default
├── audio-analysis/
│   ├── analyzer.ts              — main-thread API: spawn worker, resample, transfer buffer
│   └── analyzer-worker.ts       — Web Worker: Essentia.js RhythmExtractor2013 + Percival
└── scene/
    ├── tunnel.ts                — cube-grid tunnel (merged geometry, per-cube jitter rotation)
    └── gates.ts                 — 3-slot barriers + per-barrier metadata
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
fetch(url) ──────────►  ArrayBuffer
                         │
                         ▼
                    decodeAudioData (Web Audio, native sample rate)
                         │
                         ▼
                    resampleBuffer → 44100 Hz (required by Essentia.js)
                         │
                         ▼
                    mixToMono (Float32Array)
                         │
                         ├──► Worker: RhythmExtractor2013 + PercivalBpmEstimator
                         │          │
                         │          ▼
                         │       SongAnalysis { bpm, beats[], gridOffsetSec, confidence, … }
                         │
                         ▼
                    (original AudioBuffer retained for playback; resampled buffer is analysis-only)
                         │
                         ▼
                    click → startAudio() → BufferSourceNode at native rate
```

- `main.ts` holds `audioCtx`, `audioBuffer` (native rate), `audioSource` (current playback node), `audioStartTime`, `currentGridOffsetSec`.
- **Audio clock** drives pathS in real play: `audioNow = audioCtx.currentTime − audioStartTime − gridOffsetSec`, `pathS = max(0, audioNow × currentForwardSpeed)`. During intro (negative audioNow) pathS is clamped to 0 — camera waits at spawn through silence. `currentForwardSpeed = forwardSpeedForBpm(bpm)` after analysis; default `FORWARD_SPEED` before.
- **Wall-clock fallback**: when no audio playing (tests), `pathS += currentForwardSpeed × motionScale × dt`. Tests set `motionScale=0` to freeze.
- **Drag-drop**: drop-zone handler calls `loadAndAnalyzeSource(file, file.name)` → same analyzer path as the auto-load. Generation counter (`analysisGen`) ensures racing loads don't clobber each other.
- **Autoplay policy**: `startAudio()` is called synchronously inside a click handler so Chromium accepts the gesture. AudioContext is `.resume()`-ed inside the same call chain.

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
