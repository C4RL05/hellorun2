# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Pre-implementation. The repo currently contains only `docs/hellorun2-plan.md` — the full design brief for HelloRun 2, a first-person rhythm runner where a song is the level. No `package.json`, no source, no build system exists yet. Read the plan before proposing any code.

## What this game is (one-paragraph orientation)

Auto-forward first-person runner on a corridor built from straights + 90° turns. Analog vertical movement, 3-slot gates, one-hit death. A run = a song: the player drops in a local audio file, it's analyzed in-browser (BPM + beat grid + section detection), and the corridor/chart is generated from the song. Visual target is Tron (1982) Recognizer — solid dark fills, glowing edges, layer-selective bloom. See `docs/hellorun2-plan.md` for the authoritative spec.

## Locked architectural decisions

These are already decided in the plan. Don't re-open them without the user asking:

- **Renderer:** three.js. Kit-bashed corridor primitives built once at init; `InstancedMesh` for fills, per-instance `LineSegments` for edges. Edges baked from `EdgesGeometry` at init — **never recomputed at runtime**.
- **Bloom:** `EffectComposer` with layer-selective `UnrealBloomPass` on the edge layer only. Fills stay crisp.
- **Audio:** Web Audio API, in-browser analysis, 4/4 only for v1. Bring-your-own-music via local drag-drop — **no uploads, no streaming, no server storage**.
- **Gameplay constraints:** no steering/throttle, no HUD, no health, no collectibles, no leaderboards, no pitch/roll (left/right 90° turns only).
- **Hard reveal rule:** player cannot see the next straight's gates until the camera finishes the turn. Camera arcs through the corner during beat 4 so the downbeat hits as the new straight is revealed.

## Build order is strict

`docs/hellorun2-plan.md` §7 lists 10 milestones in a fixed sequence. The plan explicitly says *"Strict sequence — don't skip ahead."* Before adding anything, check which milestone is current and whether the proposed work belongs to it. In particular: milestones 6 (hardcoded song + hardcoded chart) must be fully working before any procedural (7) or audio-analysis (8) code is written.

## Feel spec comes before gameplay code

Per §8, numeric constants governing game feel (forward speed, vertical response curve, gate spacing, FOV, corner transition duration, hitbox dimensions, turn-beat empty-corridor length) must live in a **single source of truth** — kept in one module so they're tunable. Locked before procedural generation starts so difficulty tuning doesn't fight feel tuning. If asked to hardcode a feel value inline during milestones 2–5, put it in the constants module instead.

## Open questions not yet resolved

Flagged in §9 — don't assume answers:

- Audio analysis library (Essentia.js vs aubio.js vs hand-rolled)
- Feel spec format (TS constants module vs JSON vs YAML)
- Target resolution / DPR / mobile strategy
- Song preview before a run

When work touches one of these, surface the choice to the user rather than picking silently.
