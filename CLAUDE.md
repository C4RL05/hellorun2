# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this game is

Auto-forward first-person rhythm runner. The corridor is built from straights connected by 90° turns. The player has analog vertical movement between 3 gate-slots per gate. Gates kill on contact (one-hit death). A run = a song: BYOM audio analyzed in-browser, corridor + chart generated from the song. Tron (1982) Recognizer aesthetic — dark fills, glowing cyan edges, red "danger" barriers. Authoritative spec: [`docs/hellorun2-plan.md`](docs/hellorun2-plan.md).

## Current state

Working through plan §7's 10-milestone sequence. See [`docs/milestone-status.md`](docs/milestone-status.md) for per-milestone detail.

- **Milestones 1–7 complete**: cube-tunnel whitebox, forward motion, player input, gates + collision, 90° turn + second straight, audio-clock-driven pathS, procedural chart generation.
- **Milestone 8 essentially done**: Essentia.js worker; BPM + grid-offset detection (with onset-bounded back-extrapolation); BPM-driven forward speed; drag-drop BYOM; per-16-beat window features (loudness/centroid/HPCP chroma); section detection (combined energy+chroma novelty → 16/32/64-beat blocks → first-fit clustering into "kinds"); persistent localStorage analysis cache.
- **Milestone 9 partially done**: rolling corridor generation (section list, `ensureSectionsAhead`, alternating turns, streamed per-section charts with corner continuity). Section-driven palette shifts and density modulation are the remaining work — analysis side now provides everything needed.
- **Milestone 10 not started**.

Note on terminology: a "section" in this codebase has two unrelated meanings.
- **Audio section** (`SongAnalysis.sections[]`): variable-length 16/32/64-beat block of audio with shared features (kind). The thing that drives palette/density.
- **Corridor section** (`Section` in `corridor.ts`): one straight or one turn span in the rolling-generation list. Pure geometry.

These never overlap conceptually. Don't conflate them.

## Read these before touching gameplay

- [`docs/hellorun2-plan.md`](docs/hellorun2-plan.md) — design brief. Plan §2/§4/§5 define gameplay invariants that are not up for re-negotiation without user input.
- [`docs/architecture.md`](docs/architecture.md) — how the code is organized: path model, state machine, input pipeline, chart system, audio pipeline, debug overlay.
- [`docs/dev-tools.md`](docs/dev-tools.md) — npm scripts, Playwright tools, URL query params, dev-hook `window.__*` inventory.
- [`docs/gotchas.md`](docs/gotchas.md) — non-obvious pitfalls encountered during development. **Read this before debugging WebGL/audio/Playwright issues** — many common failure modes are documented there with fixes.
- [`docs/milestone-status.md`](docs/milestone-status.md) — which substeps of each milestone are done, pending, or deferred.

## Commands

- `npm run dev` — Vite dev server at http://localhost:5173
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck then Vite production build
- `npm run visual-check` — full regression screenshot + pixel stats + motion detection
- `node tools/<name>.mjs` — individual Playwright dev tools (see `docs/dev-tools.md`)

## Stack

Vite 5 + TypeScript 5.6 (strict, noUnusedLocals, noUnusedParameters) + three.js r170. WebGL 2 via three.js `WebGLRenderer`. Audio via Web Audio API + Essentia.js (in a Web Worker). Playwright for automated dev-verification. No test runner — each `tools/*.mjs` is a direct-run Node script.

## Axis convention

**−Z = forward, +X = right, +Y = up**. three.js default; never changes. Plan §1: "Player's vertical reference frame never changes."

## Locked architectural decisions

From plan §4/§5/§6. Don't reopen without explicit user ask:

- **Renderer**: three.js; merged `BufferGeometry` for the tunnel fills, merged fat-line (`LineSegments2` with `LineMaterial`) for edges. Cube edges are baked from `EdgesGeometry` at init — never recomputed per frame.
- **Audio**: Web Audio API; Essentia.js for BPM/beat analysis, WASM-backed; **analysis must run in a Web Worker** (main thread cannot block for 30s). BYOM only — no uploads, no streaming, no server.
- **Corridor**: built from "straights" (2 bars = 8 beats at 4/4) connected by 90° turns (left or right only, never pitch/roll). Gates never at turns.
- **Gameplay**: no HUD, no health, no steering/throttle, no collectibles, no leaderboards. One-hit death. 4/4 time only for v1.
- **Hard reveal**: player cannot see the next straight's gates until the camera finishes the turn arc (plan §2).

## Feel-spec single source of truth

Every tunable number lives in [`src/constants.ts`](src/constants.ts). When adding a new parameter that affects game feel, extend that file rather than inlining the value at the call site. This is plan §8, and it matters because difficulty-tuning later should not fight feel-tuning.

## Auto mode working style

The user (Carlos, `carlos@helloenjoy.com`, GitHub `C4RL05`) typically works in Claude Code Auto mode with terse answers — often single letters. Default behavior: state what you're about to do in one sentence, then execute. Only stop and ask when you hit a genuine branch point with different trade-offs. Match his terseness in return; avoid ceremony and don't summarize diffs he can read himself.

## Project repo

GitHub: `https://github.com/C4RL05/hellorun2.git`. Main branch tracks `origin/main`. Local is usually several commits ahead; push only when the user asks. Never force-push to main.
