# Dev tools

All verification tooling. Each tool is a direct-run Node script in `tools/` that uses Playwright to drive a headless Chromium against the Vite dev server. There's no test runner — tools either exit 0 (pass) or exit 1 (fail), and print a human-readable report.

**Prerequisite**: `npm run dev` must be running on http://localhost:5173 before running any tool.

## Quick reference

| Tool | Asks | Run |
|---|---|---|
| `visual-check.mjs` | Does the game render? Is there motion? | `npm run visual-check` or `node tools/visual-check.mjs` |
| `input-check.mjs` | Does keyboard + pointer-lock mouse reach the player? | `node tools/input-check.mjs` |
| `collision-check.mjs` | Does coasting die? Does steering survive? | `node tools/collision-check.mjs` |
| `turn-check.mjs` | Does the camera correctly arc through the 90° turn? | `node tools/turn-check.mjs` |
| `debug-view-check.mjs` | Does the M-key overlay toggle, zoom, pan correctly? | `node tools/debug-view-check.mjs` |
| `analysis-check.mjs` | What BPM / grid / confidence did Essentia detect? | `node tools/analysis-check.mjs` |

Run all five primary regression tools before committing:

```bash
node tools/input-check.mjs && \
node tools/collision-check.mjs && \
node tools/visual-check.mjs && \
node tools/turn-check.mjs && \
node tools/debug-view-check.mjs
```

## npm scripts

- `npm run dev` — Vite dev server
- `npm run typecheck` — `tsc --noEmit` (strict mode; noUnusedLocals catches dead declarations)
- `npm run build` — typecheck then Vite production build
- `npm run preview` — serve the built assets locally
- `npm run visual-check` — convenience alias for the main visual regression tool

## URL query parameters

Append to `http://localhost:5173/?...`:

- `?seed=N` — Seeds the chart generator's PRNG (mulberry32) with integer N. Deterministic charts for reproducible runs. `tools/collision-check.mjs` uses `?seed=1` so it gets a chart with a lethal gate regardless of today's `Math.random()` roll.

## Dev hooks (`window.__*`)

Registered in `main.ts` under `import.meta.env.DEV`. Production builds dead-code-eliminate these via Vite's static replacement of the env flag. Use them from Playwright via `page.evaluate(() => window.__xxx())`.

| Hook | Returns / does | Used by |
|---|---|---|
| `__camera` | `THREE.Camera` reference (read `.position.x/y/z`, `.rotation.y`) | every tool |
| `__respawn()` | Calls `resetToSpawn()` — state-only reset (no audio touch). Distinct from the user-facing `respawn()` because it doesn't need a user gesture. | collision-check, debug-view-check |
| `__setMotionScale(n)` | Scales the wall-clock-fallback pathS advance. `__setMotionScale(0)` freezes motion for input-only tests. Has no effect while audio is playing (audio clock wins). | input-check, turn-check, debug-view-check |
| `__isDead()` | `boolean` — whether collision flipped `dead=true` | collision-check |
| `__getPathS()` | `number` — current pathS | (available for ad-hoc debugging) |
| `__setPathS(s)` | Sets both `pathS` and `totalPathS` so samplePath() immediately picks up the new value. Used for exploring the path by hand (turn-check). | turn-check |
| `__startGame()` | Flips `running=true` and hides title overlay without requiring user gesture. **Does not start audio** — tests would need a real click for that. Every test calls this to dismiss the title. | every tool |
| `__getChart()` | `number[]` — the generated chart's slot sequence | collision-check |
| `__getGateTimesMs()` | `number[]` — time-to-reach (ms) per gate at current `currentForwardSpeed`. Tests should `await __getSongAnalysis() !== null` before reading, since BPM detection flips the speed. | collision-check |
| `__getSongAnalysis()` | `SongAnalysis \| null` — full Essentia output (bpm, beats, gridOffsetSec, confidence, per-algorithm raw) once analysis completes | analysis-check |
| `__getForwardSpeed()` | `number` — live `currentForwardSpeed` (u/s). Equals `FORWARD_SPEED` before analysis, `forwardSpeedForBpm(bpm)` after. | ad-hoc |
| `__getCorridor()` | `{ straightLength, turnArcLength, turnRadius }` — derived corridor geometry. Use this instead of hardcoding in tools so changes to `TURN_BEATS` don't silently break sample points. | turn-check |

## Tool-by-tool detail

### `visual-check.mjs`

Loads the dev server, captures two screenshots 500 ms apart, computes pixel statistics and a frame-to-frame diff. Emits:

- Pixel stats: non-black %, avg RGB, max RGB per channel, top color buckets at quantized 6-levels-per-channel
- Motion detection: % of pixels that changed; verdict `MOTION DETECTED` / `scene appears static`

Failure modes caught:
- All-black frame → pixel stats flag "0% non-black"
- Broken shader → max RGB hits clear color only
- Camera frozen → motion detection flags "scene appears static"

Screenshot written to `tools/screenshots/tunnel.png` (+ `.t+500ms.png`). That dir is `.gitignore`d.

### `input-check.mjs`

Calls `__startGame()`, then `__setMotionScale(0)` so forward motion doesn't cause collision during the input trace. Drives the keyboard (ArrowUp/Down holds) and the pointer-locked mouse (clicks to request lock, then `mouse.move` deltas). Reads `__camera.position.y` at timed samples and checks:

- Peak Y approaches `PLAYER_Y_MAX`
- Trough Y approaches `PLAYER_Y_MIN`
- Mouse movement changes Y (math should match `MOUSE_SENSITIVITY × delta01`)

### `collision-check.mjs`

Uses `?seed=1` for a deterministic chart. Reads `__getChart()` and `__getGateTimesMs()` to figure out:
- Which gate is the first "non-mid" (slot ≠ 1) — that's where coasting dies
- What slot it requires — determines steering key (ArrowUp for slot 2, ArrowDown for slot 0)

Then runs two scenarios:
- **A**: `__respawn()`, coast for `gateMs(firstLethal) + 200`ms, assert `__isDead() === true`
- **B**: `__respawn()`, coast past `gateMs(firstLethal − 1)`, press steer key, assert alive at `gateMs(firstLethal) + 250`

This test adapts to whatever the generator produced, so it also implicitly validates the generator's spawn-safety + corner-continuity invariants — if either broke, the test would crash or mis-steer.

### `turn-check.mjs`

Samples `__setPathS()` at five waypoints (spawn, end-of-straight1, mid-turn, end-of-turn, mid-straight2) and verifies `__camera.position` + `.rotation.y` match the expected arc. Screenshots each. Reads corridor geometry from `__getCorridor()` so it self-updates when `TURN_BEATS` or `GATE_SPACING` changes. Mid-turn yaw is always `−45°`; position is `(TURN_RADIUS × (1 − √½), 0, −STRAIGHT_LENGTH − TURN_RADIUS × √½)`.

### `debug-view-check.mjs`

Presses `M`, screenshots, scrolls the wheel 5× to zoom in, screenshots again, right-mouse drags to pan, screenshots, presses `M` to toggle off, final screenshot. Four PNGs in `tools/screenshots/debug-view*.png`. Primarily a visual regression — the state assertions are weak because the test was written to catch "debug view renders helpers on top of game view, zoom/pan work" and those are hard to assert programmatically without reading pixels.

### `analysis-check.mjs`

Waits up to 120s for `__getSongAnalysis()` to return non-null (typical ~15s on mobile-class CPU). Prints:

- Consensus BPM (what the worker's `pickConsensusBpm` heuristic chose)
- Raw algorithm outputs: `RhythmExtractor2013` multifeature BPM, `PercivalBpmEstimator` BPM, internal `bpmEstimates` histogram (first 10), `bpmIntervals` (first 8)
- Confidence score + guidance on the 0..5.32 scale
- First 5 detected beat timestamps

Useful as a BYOM sanity check: drop a new mp3, run this, check BPM vs. your DAW's metadata. If algorithms agree with each other but disagree with DAW, trust the algorithms (they only see the audio; DAW reads metadata tags that can be wrong).

## Pattern for adding a new tool

1. Create `tools/<name>.mjs` — ES module, top-level await allowed
2. `import { chromium } from "playwright"`
3. Launch with `chromium.launch({ channel: "chromium" })` — **never omit the `channel`** or you'll get `chrome-headless-shell`, which silently fails to link three.js shaders (see [`gotchas.md`](gotchas.md))
4. `await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 })`
5. `await page.waitForSelector("canvas")`
6. `await page.waitForFunction(() => window.__startGame !== undefined)` — gate on whichever hook the test needs
7. `await page.evaluate(() => window.__startGame())` — dismiss title
8. Drive the game via keyboard / mouse / `__setPathS` / `__setMotionScale`
9. Read state via `__camera`, `__getChart`, `__isDead`, etc.
10. `process.exit(1)` on any assertion failure so the script communicates pass/fail via exit code

Screenshots go to `tools/screenshots/` (gitignored).

## Screenshot dir

`tools/screenshots/` is `.gitignore`d — screenshots are build-time artifacts, not source-controlled fixtures. Clean with `rm -r tools/screenshots` if it gets cluttered; tools recreate it on next run.
