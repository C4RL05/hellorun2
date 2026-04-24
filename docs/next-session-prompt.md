# Next session — HDR pipeline (M10 kickoff)

We're continuing **HelloRun 2**, a first-person rhythm runner for the Cerebral Valley "Built with Opus 4.7: Claude Code" hackathon. **Submission is Mon 2026-04-27 at 01:00 BST** (Sun 20:00 EDT). Today is 2026-04-25 morning when this resumes — **two days to ship**.

**Read these first** (in order):
1. `CLAUDE.md` — project overview + auto-mode working style
2. `docs/hellorun2-plan.md` §5 (visuals) + §6 (rendering) — the aesthetic this session is finally going to deliver
3. `docs/architecture.md` — current render pipeline (two-pass: main game + debug-overlay layer 1)
4. `docs/milestone-status.md` M10 — the full polish checklist; HDR is the gate that unlocks most of it

## Where we are

M1–M9 done. Gameplay is locked: BYOM analysis, per-section density tiers with sweep atoms + per-chorus ramp, corridor rolling/rebuild, beat-sync (RMB mid-play), white UI chrome with M PLUS 1 logo, menu (Tab) auto-pauses and hides all other UI. Last commit: `2274410` white-UI + menu work.

Renderer is vanilla. `WebGLRenderer` with SDR output, no post-processing, no bloom, no tone-mapping. Faces are `MeshLambertMaterial`, edges are fat-line `LineSegments2` with `LineMaterial`. Colors are just `color.setHex(...)` on linear RGB.

## What "HDR pipeline" means here

Plan §5 is explicit: **"`EffectComposer` with layer-selective `UnrealBloomPass`. Fills stay crisp, edges halo."** That's the headline. Minimum viable HDR pipeline:

1. **Half-float render target** (`WebGLRenderTarget` with `type: THREE.HalfFloatType`) so edge colors can carry emissive values >1.0 without clipping.
2. **EffectComposer** chain replacing the bare `renderer.render(scene, camera)` call in `main.ts`'s RAF loop:
   - `RenderPass(scene, camera)` — writes HDR scene
   - `UnrealBloomPass` configured to only affect bright pixels — `threshold = 1.0`, `strength`/`radius` tuned by feel
   - `OutputPass` (or manual `renderer.toneMapping = ACESFilmicToneMapping`) to map HDR → sRGB for display
3. **Edge materials get `emissive` values > 1.0** — probably scale via a new `EDGE_EMISSIVE_STRENGTH` constant so feel-spec discipline holds. Faces stay ≤ 1.0 so they don't bloom.
4. **Layer routing**: the second render pass (`debugView.camera` on layer 1) must NOT go through the composer — debug helpers shouldn't bloom. Either skip the composer for the debug pass, or move debug to a separate RenderTarget.

## Current render pipeline touchpoints

`main.ts` RAF loop (search `renderer.render`):
```ts
renderer.clear();
renderer.render(scene, camera);          // pass 1 — game, layer 0
if (debugView.isActive) {
  renderer.clearDepth();
  renderer.render(scene, debugView.camera); // pass 2 — helpers, layer 1
}
```

HDR swaps pass 1 for `composer.render(dt)`. Pass 2 stays on the bare renderer and needs `renderer.autoClear = false` to not stomp the composer's output — which it already is. Should be a clean split.

`COLOR_EDGE` in `constants.ts` is currently `0x00aaff`. Under HDR with emissive intensity > 1, this reads as "bright cyan that halos." Don't change the hex — multiply via a new `EDGE_EMISSIVE_STRENGTH` uniform or via `LineMaterial`'s color set to `COLOR_EDGE × strength`.

## Gotchas specific to this project

- **Transparent barriers** (`barrier.fillMaterial` has `opacity: 0.3, depthWrite: false`) interact poorly with HDR + bloom — the half-float buffer does the right thing numerically but the no-depth-write pass can cause order issues. Test: barrier closer than an edge behind it should not bloom through. If it does, the fix is `transparent: false` on the barrier fill (it'll look fine if you drop the emissive-edge color into the composer and treat barrier red as bloom-target too).
- **Debug overlay camera** (`layers.set(1)`) uses an orthographic camera with bboxes. Those lines should NOT bloom. Easiest: render debug pass AFTER composer output, bare renderer, layer 1 only. Already the existing structure — just don't route it through the composer.
- **Device pixel ratio**: `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` already caps the game canvas. The composer's internal targets need the same cap or bloom gets expensive fast at 4K. `composer.setPixelRatio(...)` and `composer.setSize(w, h)` on window resize.
- **Tone-mapping interaction**: once `renderer.toneMapping` is set, *all* face colors get tone-mapped too. The "dark fills" become slightly darker. Compensate by bumping base `COLOR_FACE` if needed — or use a dedicated `ToneMappingPass` in the composer chain so the face layer isn't double-affected by the renderer's built-in mapping.
- **sRGB output**: `renderer.outputColorSpace = THREE.SRGBColorSpace` (three r152+ default). OutputPass handles it automatically. If skipping OutputPass, make sure the swap-chain target is sRGB.

## Suggested implementation order

1. **Scaffold the composer** around current render call. Single `RenderPass` + `OutputPass`, no bloom yet. Verify the game looks identical to today. Any regression here means color-space or pixel-ratio is off.
2. **Turn on tone-mapping** via `renderer.toneMapping = ACESFilmicToneMapping`. Tune base face color if fills go too dark.
3. **Add UnrealBloomPass** with threshold = 1.0, strength = 0.6, radius = 0.5. Edges still clip at 1.0 so no visible change yet — confirms the pass is wired correctly.
4. **Bump edge emissive > 1.0** (new `EDGE_EMISSIVE_STRENGTH = 2.5` or similar in `constants.ts`). Now edges halo. Tune strength/radius by feel.
5. **Check debug overlay** doesn't bloom. Fix routing if it does.
6. **Resize handling** — composer.setSize on the existing resize listener.
7. **Measure FPS** — `performance.now()` at start/end of frame. Plan §6 calls bloom the main per-pixel cost; if 60fps drops on a 1440p display, lower the bloom internal target resolution via `UnrealBloomPass`'s third constructor arg.

## What stays deferred for this session

M10 also lists beat pulse, wave effect, corridor pruning, title/end screens polish. **Do HDR + bloom first** — beat pulse is a 15-min addition once emissive values can exceed 1.0 (just modulate `EDGE_EMISSIVE_STRENGTH` per frame from a beat-phase LFO), and is much more dramatic with bloom than without. Corridor pruning is correctness/memory work that can hide behind any performance issue bloom introduces. Title/end screens polish only matters if HDR makes the logo read differently.

## Workflow rules (carried over)

- **Auto mode active**: execute, don't plan. Surface only true branch points.
- **No `git commit`** unless Carlos explicitly says so. Never push.
- **No mp3 commits** ever.
- **Tracks not songs** in user-facing copy and new identifiers.
- **Release pointer lock before any UI overlay appears** (already wired; remember for any new state transitions).
- **Feel-spec discipline**: bloom strength/radius, edge emissive strength, tone-mapping exposure all go in `src/constants.ts`.
- Kill stale dev servers with `npx kill-port 5173 5174 5175`.
- `tools/` Playwright scripts now target `#game-canvas` — if you add another canvas to the DOM for post-processing (shouldn't need to — composer reuses the WebGL canvas), keep that id stable.

## Honest scope note

HDR pipeline is a 2–4 hour job if the scaffolding-first approach goes clean, 8+ hours if color-space issues chase you. We have ~two days. Once bloom is landing correctly, the ROI on further polish (beat pulse, wave effect, screens) is huge per hour spent. Don't chase bloom perfection — "obviously glowing edges, hits 60fps on desktop" is the bar.
