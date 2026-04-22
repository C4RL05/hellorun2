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

`src/corridor.ts`. The corridor is parameterized by a scalar `s` (distance traveled in world units since spawn). Each frame the game calls `samplePath(pathS)` → `{pos, yaw}` and writes those to the camera.

- **Straight 1** (0 ≤ s ≤ `STRAIGHT_LENGTH`): `pos = (0, 0, CAMERA_START.z − s)`, yaw = 0.
- **Right-turn arc** (inside the corridor's fixed radius `TURN_RADIUS`, ¼ circle): `yaw = −t·π/2`, position on arc.
- **Straight 2** (after turn): `pos` in world +X direction, yaw = −π/2.
- Past the end: wraps back to `s=0` via modulo of `PATH_TOTAL`. Wrap frames skip collision (see below).

`STRAIGHT_LENGTH = CAMERA_START.z + TUNNEL_DEPTH` (= 42 units). Approach + tunnel.

Two scalars are tracked in `main.ts`:
- `pathS` — current sample coord, wrapped to `[0, PATH_TOTAL)`. Used for `samplePath()`.
- `totalPathS` — monotonic distance traveled since respawn. Used to detect loop wraps via floor-division.

Wrap detection: `Math.floor(totalPathS / PATH_TOTAL) !== Math.floor(prevTotal / PATH_TOTAL)`. Robust to multi-wrap frames (rare but real under browser-throttled tabs).

## Game state machine

Plain flags in `main.ts`, no formal state machine class:

| flag | meaning |
|---|---|
| `running` | pathS is being advanced this frame |
| `dead` | player hit a barrier; pathS frozen at hit point |
| `invincible` | collision detection skipped entirely (I key toggle) |
| `motionScale` | test-only scalar multiplied into wall-clock advance fallback |

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
├── straight1Group    (no transform; local = world)
│   ├── tunnel.object (merged Mesh + LineSegments2)
│   └── gates.object  (merged transparent Mesh + LineSegments2)
├── straight2Group    (position=(TURN_RADIUS, 0, −STRAIGHT_LENGTH−TURN_RADIUS), rotation.y=−π/2)
│   └── ...same as straight1
├── DebugView.helpers (Box3Helpers for straight bboxes + player bbox)
└── cubeBboxLines     (merged LineSegments of per-cube OBBs, layer 1)
```

Both straight groups are built from identical `createTunnel()` + `createGates(slots)`; world placement comes entirely from the parent group's transform. Collision checks transform the camera's world prev/curr into each straight's local space via `group.worldToLocal`.

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
- **Audio clock** drives pathS in real play: `audioNow = audioCtx.currentTime − audioStartTime − gridOffsetSec`, `pathS = max(0, audioNow × FORWARD_SPEED)`. During intro (negative audioNow) pathS is clamped to 0 — camera waits at spawn through silence.
- **Wall-clock fallback**: when no audio playing (tests), `pathS += FORWARD_SPEED × motionScale × dt`. Tests set `motionScale=0` to freeze.
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

Bboxes built once at init from `straight.group.matrixWorld` + per-barrier/per-cube local transforms. Player bbox mutates its `Box3.min/max` each frame (Box3Helper picks that up via its `updateMatrixWorld`).

## Collision (`src/collision.ts`)

Z-crossing check per straight per frame:

```ts
if (prevLocal.z > gate.z && currLocal.z <= gate.z) {
  if (slotForY(currLocal.y) !== gate.openSlot) return gate;
}
```

`main.ts` iterates both straights, transforming camera world-space prev/curr into each straight's local space via `group.worldToLocal`. Wrap frames skip collision entirely (otherwise the teleport from end-of-corridor to spawn would trace a straight line through many gate planes at weird slots, triggering false positives).

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
