# Gotchas

Things that silently bite. Read this section before debugging issues in WebGL rendering, audio analysis, or Playwright.

## Essentia.js assumes 44100 Hz sample rate

**Symptom**: BPM detection is off by a consistent ratio — e.g., reports 110 BPM when the song is actually 120. Two independent algorithms (`RhythmExtractor2013` multifeature + `PercivalBpmEstimator`) agree on the wrong value.

**Cause**: `RhythmExtractor2013(signal, maxTempo, method, minTempo)` has **no sample-rate parameter** in the JS API. The algorithm uses its C++ default (44100 Hz). If the audio is at any other rate (Chrome on Windows defaults `AudioContext.sampleRate` to 48000 Hz), BPM is off by the ratio `44100 / actualRate`. For 48000 Hz audio, that's 0.9187× — which is exactly 120 × 0.9187 = 110.2.

**Fix**: Resample to 44100 Hz via `OfflineAudioContext` **before** passing to the worker. Already implemented in `src/audio-analysis/analyzer.ts` (`resampleBuffer`). Don't remove this unless Essentia.js adds a per-algorithm sample-rate parameter.

Applies to most Essentia algorithms, not just rhythm extraction. Rule of thumb: **always resample to 44100 for Essentia.js input** unless the specific algorithm clearly takes sample rate as an argument.

## Essentia.js field names differ between TS definitions and runtime

**Symptom**: `Cannot read properties of undefined (reading 'size')` when accessing the expected field on an Essentia result.

**Cause**: `node_modules/essentia.js/dist/core_api.d.ts` documents `RhythmExtractor2013` as returning `{ beats_position, ... }`. The actual runtime object returns `{ ticks, ... }`. The JSDoc inside `essentia.js-core.es.js` matches the runtime; the .d.ts is outdated.

**Fix**: Trust the JSDoc in the `.es.js` source over the .d.ts. Or just log the result object when wiring a new algorithm.

## Playwright's default Chromium silently fails WebGL

**Symptom**: Visual tests screenshot pure white or black pixels; pixel stats show `max RGB = (255, 255, 255)` or `(0, 0, 0)`. Console has "THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false" with an empty info log.

**Cause**: `chromium.launch()` defaults to `chrome-headless-shell` (a stripped-down binary Google publishes for minimal automation). Its WebGL pipeline silently fails to link three.js material shaders.

**Fix**: Always pass `channel: "chromium"` to use the full Chrome-for-Testing binary:

```js
const browser = await chromium.launch({ channel: "chromium" });
```

Every tool in `tools/` pins this. Never remove it.

## `LineMaterial.resolution` needs per-pass update

**Symptom**: Fat lines (`LineSegments2` + `LineMaterial`) appear at the wrong thickness — hairline or missing — in a secondary render pass. Especially visible in PIP-style viewport changes.

**Cause**: `LineMaterial` uses a `resolution` uniform to compute screen-pixel thickness. The value is captured at `renderer.render()` call time; if the viewport changes between passes, `resolution` needs to be updated accordingly.

**Fix**: Before each `renderer.render()` call, if the viewport differs from the last pass:

```js
for (const mat of edgeMaterials) {
  mat.resolution.set(vp.width, vp.height);
}
```

Only an issue if you have multiple passes at different viewport sizes. The current full-viewport debug overlay avoids this (both passes use full canvas). PIP-style approaches would need it back.

## Browser autoplay policy blocks AudioContext

**Symptom**: Audio never plays. `audioSource.start()` doesn't throw, but no sound. `audioCtx.state === "suspended"`.

**Cause**: Browsers won't allow audio playback without a user gesture. `new AudioContext()` starts suspended; the game needs to resume it inside a `click` / `keydown` / `touch` event handler.

**Fix**:
1. Call `audioCtx.resume()` inside the same synchronous call chain as the triggering event handler (not `await`ed — it's fire-and-forget).
2. `audioSource.start()` must also run in that chain. This is why `startAudio()` runs inside `startGame()` which runs inside the canvas/overlay click handler.

Playwright's `page.mouse.click()` and `page.keyboard.press()` both count as user gestures for this policy.

## Playwright tests can't start audio (no gesture context in `page.evaluate`)

**Symptom**: Dev hook `__startGame` sets `running=true` but audio doesn't actually play. Depending on the test, pathS may advance via wall-clock fallback — but if you're testing audio-clock-driven behavior, it won't fire.

**Cause**: `page.evaluate()` code doesn't count as a user gesture. Audio playback via `BufferSourceNode.start()` silently fails (or starts but produces no audio on the suspended context).

**Fix**: Tests either (a) use `page.mouse.click()` on the title overlay to trigger the real `startGame()` path (genuine gesture), or (b) run with `motionScale` fallback and don't depend on audio. Current tests use the fallback path; `__startGame()` just sets the flag without requiring audio.

## Tiny PNG screenshots render as broken-image icon in Read tool

**Symptom**: `Read` tool shows a broken-image icon when reading a screenshot file that `file` confirms is a valid PNG.

**Cause**: Some PNGs that compress heavily (nearly-uniform color, e.g., 4.6 KB for 1280×720 of mostly black pixels) render as broken in the display layer of the tool, despite being valid PNG bytes.

**Fix**: Use pixel statistics (via `pngjs` in `tools/visual-check.mjs`) instead of visual inspection for tiny/near-uniform screenshots. If the image *should* have content but compresses that small, there's likely a rendering bug.

## Layered rendering: `clearDepth()` preserves color, full `clear()` wipes both

**Symptom**: When rendering a second pass (e.g., the debug overlay) into the same viewport, either the game view disappears (second pass cleared color) or the overlay draws behind the game geometry (second pass uses stale depth buffer from the first pass).

**Cause**: Default `renderer.clear()` clears both color and depth. For layered rendering, you want depth cleared (second pass gets a fresh depth buffer) but color preserved (game view stays on screen wherever the overlay doesn't rasterize).

**Fix**:

```js
renderer.autoClear = false;    // at setup
// pass 1
renderer.clear();              // full clear
renderer.render(scene, gameCamera);
// pass 2
renderer.clearDepth();         // only depth; color preserved
renderer.render(scene, overlayCamera);  // camera should have .layers set so it only renders overlay objects
```

## `Quaternion.random()` ≠ 3 independent Euler angles

**Symptom**: Random rotations visibly bias toward certain orientations; some faces appear more often than others in the cube jitter.

**Cause**: Uniformly sampling three Euler angles does not produce a uniform distribution on SO(3). The distribution oversamples gimbal-lock-adjacent orientations.

**Fix**: `new THREE.Quaternion().random()` uses the correct algorithm (Marsaglia's). For small angles (≤±10°), Euler vs. quaternion is visually indistinguishable — we use Euler in `tunnel.ts` because it's more tunable by degrees. For full-range random rotation, always use `Quaternion.random()`.

## Merged transparent geometry draw order issues

**Symptom**: Transparent barriers in a merged mesh appear to render in wrong Z-order — distant barriers appearing in front of nearer ones.

**Cause**: three.js sorts transparent meshes by world position, but **within** a single merged mesh it draws triangles in the order they appear in the index buffer. Manual `mergeGeometries` preserves input order; if we built near-to-far, the draw order is wrong for alpha blending (painter's algorithm needs far-to-near).

**Fix**: Build merged transparent geometries in far-to-near order. See `src/scene/gates.ts` — the gate loop iterates `GATE_COUNT - 1 → 0` so the merge is far-first. Combined with `depthWrite: false` on the fill material, this gives correct blending without needing true per-triangle sort.

## `page.mouse.click()` doesn't fire canvas `click` event for right button

**Symptom**: Playwright test tries to trigger the canvas click handler via `page.mouse.click({ button: "right" })`; nothing happens.

**Cause**: The `click` event (MouseEvent type=click) only fires for the primary button by default. Right-clicks fire `contextmenu` (which we prevent) and `mousedown`/`mouseup`, but not `click`.

**Fix**: For the game's click-to-start flow, use `page.mouse.click(x, y)` with default (left) button. If you need to trigger RMB-specific handlers, use separate `page.mouse.down({ button: "right" })` / `.up({ button: "right" })` calls.

## pointer-lock in Playwright headless actually works

**Symptom**: You might assume pointer-lock events don't fire in headless testing and skip related tests.

**Actually**: `chromium.launch({ channel: "chromium" })` (full CfT binary) grants pointer lock on `canvas.requestPointerLock()` when triggered by a `page.mouse.click()`. Subsequent `page.mouse.move()` events fire with correct `movementY`. `input-check.mjs` proves this.

## Windows: `core.autocrlf=true` warnings on every `git add`

**Symptom**: `warning: in the working copy of 'src/foo.ts', LF will be replaced by CRLF the next time Git touches it`.

**Cause**: Git's default on Windows converts LF→CRLF in the working tree while keeping LF in the repo. Harmless but noisy.

**Fix**: Ignore, or add `* text=auto eol=lf` to a repo-local `.gitattributes` to pin LF everywhere. Not critical for a solo-dev project.

## `.mp3` globally gitignored — dev audio never accidentally committed

The `.gitignore` from M1 has `*.mp3` (and `.wav`/`.ogg`/`.flac`/`.m4a`/`.aac`). Dev audio in `public/` is ignored automatically. If you ever *want* to commit a license-clean sample, add `!public/song-name.mp3` to override.

## Vite `public/` serves files at root, but doesn't exist by default

**Symptom**: `fetch('/music/dev-song.mp3')` returns 404; the `public/` folder isn't in `ls`.

**Cause**: Vite's `public/` is a convention — if present, Vite auto-serves its contents at the site root; if absent, no 404, no folder. It's not created by default.

**Fix**: `mkdir public` and drop files in. No config needed.

## Essentia.js ES module exports

Two packages, both need explicit dist paths:

```js
import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
```

Both must be awaited separately — `EssentiaWASM` is an emscripten module that needs to initialize before `new Essentia(EssentiaWASM)` can call `new EssentiaJS()`. Pattern:

```js
await new Promise((resolve) => {
  if (EssentiaWASM.calledRun) resolve();
  else EssentiaWASM.onRuntimeInitialized = resolve;
});
const essentia = new Essentia(EssentiaWASM);
```

Implemented in `analyzer-worker.ts` `ensureReady()`.

## `audioSource.onended` fires on both natural end AND manual `.stop()`

**Symptom**: Calling `stopAudio()` (e.g., on player death) unexpectedly flips `running = false`, which then breaks respawn flow.

**Cause**: The `ended` event fires for any source cessation, not just buffer-exhausted-natural.

**Fix**: Null out `onended` before calling `.stop()`:

```js
audioSource.onended = null;
audioSource.stop();
```

Implemented in `stopAudio()` in `main.ts`.

## `AudioBuffer.getChannelData()` returns a view, not a copy

**Symptom**: Transferring the array buffer to a worker detaches the AudioContext's internal storage — subsequent playback fails silently.

**Cause**: `getChannelData(0)` returns a `Float32Array` that's a view over the AudioBuffer's internal data. Passing `.buffer` to `postMessage(..., [transferList])` transfers ownership away.

**Fix**: Copy to a new `Float32Array` before transfer, OR just pass without transfer (structured clone is still fast for a few MB). `analyzer.ts` uses `mixToMono` which always creates a fresh array.
