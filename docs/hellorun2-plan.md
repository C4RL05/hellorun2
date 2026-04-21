# HelloRun 2 — Design & Build Plan

A rhythm runner where a song is the level. First-person corridor, auto-forward motion, analog vertical movement between 3 gate positions, Tron-style vector visuals, bring-your-own-music.

---

## 1. Core gameplay

- **First-person, auto-forward.** No steering, no throttle. Camera follows a corridor spline at constant speed.
- **Vertical movement only.** Analog position between top and bottom of the corridor. Gates have 3 discrete slots; player hitbox can occupy any vertical position continuously.
- **Gates kill on contact.** No health, no energy, no HUD. One hit = game over.
- **A run = a song.** Game starts when the song starts, ends when the song ends (or the player dies).

## 2. Track structure

- **Corridor is built from straights connected by 90° turns.** Left or right only. No pitch, no roll, no diagonals. Player's vertical reference frame never changes.
- **Two bars = one straight.** In 4/4:
  - Fixed number of gates per straight, one gate per beat.
  - No gates at the turns.
  - Camera arcs through the 90° turn during turn, so the next straight is fully revealed as the bar downbeat hits.
- **Hard reveal.** The player cannot see the next straight's gates until the camera finishes the turn. The straight is memorized and executed as a unit.
- **Gate composition vocabulary.** Each phrase is a n-step path through vertical space (e.g. low-low-high, high-mid-low, mid-high-mid). ~15–20 meaningfully distinct shapes after accounting for symmetry. Hand-curated and difficulty-rated.
- **Corner continuity rule.** The generator ensures gate 1 of a new phrase has an opening within one lane of the player's likely exit lane from the previous phrase. The rule is invisible to the player; it just makes flow feel right.

## 3. Procedural generation

- **Generated at runtime.** The corridors are generated from kitbashed primitives.
- **Difficulty driven by song energy.** Spectral analysis identifies verse/chorus/bridge sections. Denser phrases during high-energy sections; simpler, more spaced-out phrases during calm sections.
- **Song structure → corridor events.** Detected section boundaries (verse→chorus, etc.) are where palette shifts land.

## 4. Audio

- **4/4 only for v1.** Non-4/4 songs are rejected or warned. Expansion later.
- **Bring your own music.** Drag-and-drop local audio files. No streaming services, no uploads, no server storage.
- **Beat detection + section analysis.** Run in-browser at load time using Web Audio API. Library choice TBD: Essentia.js (strongest), aubio.js (lighter), or hand-rolled onset detection.
- **~30s analysis pause is acceptable** in exchange for a perfectly pre-charted run.

## 5. Visuals — Tron 1982 Recognizer

Reference: the Recognizer in Tron (1982). Solid dark faces, bright glowing edges, subtle lighting on the fills to read geometry.

- **Pure black (or near-black dark navy) background.**
- **Filled geometry with edges on top.** Not transparent wireframe.
- **Faces.** `MeshLambertMaterial`, dark desaturated base color, one directional light raking across + very low ambient so facets read.
- **Edges.** `EdgesGeometry` with ~30–40° threshold so only silhouette + major crease edges render (not every triangle edge). `LineBasicMaterial`, emissive, bright neon color, placed on a dedicated bloom render layer.
- **Bloom on edges only.** `EffectComposer` with layer-selective `UnrealBloomPass`. Fills stay crisp, edges halo.
- **Beat-synced brightness pulse.** All edge colors lift ~10–15% on downbeats, more on phrase/bar starts. Free life in the world without gameplay cost.
- **Palette shifts tied to song sections, not fixed cadence.** Every detected section change shifts the edge color. Expect 5–8 shifts per song, each meaningful. Faces stay neutral dark across shifts.
- **Closed-barrier color is fixed** (red or amber) regardless of scene palette. "Danger" must mean the same thing visually in every section.
- **Wave effect** fires on the beat or phrase boundary as a pure visual pulse — decoupled from palette.

## 6. Rendering architecture

- **three.js.**
- **Kit-bashed corridor.** A small library of primitive pieces (straight sections, turn pieces, gate frames) is built procedurally once at init.
- **Per kit piece:** a `Mesh` with `MeshLambertMaterial` + a `LineSegments` with `LineBasicMaterial`, grouped together, sharing a transform. Edges are baked from `EdgesGeometry` at init — never recomputed at runtime.
- **Instancing.** `InstancedMesh` for fills. Plain `LineSegments` per instance for edges — with only 10–20 visible kit pieces deep, there's no need for a custom instanced line shader.
- **Section assembly.** Each straight is a tuple of `[transform, kitPieceId]` placements. Corridor sections are built as the player progresses; older sections are recycled.
- **Target 60fps desktop minimum.** Mobile target TBD; bloom is the main per-pixel cost to watch.

## 7. Build order (first-pass milestones)

Strict sequence — don't skip ahead:

1. **Static scene whitebox.** One straight section, three gates, no movement, no audio. Decide the aesthetic (edges, bloom, palette, faces) once the game is working.
2. **Forward motion.** Constant-speed camera down a straight corridor. No gameplay yet.
3. **Player vertical movement.** Analog input → vertical position. Tune the response curve until it feels right.
4. **Gates with collision.** Three-lane gate geometry, one opening, game-over on hit.
5. **Turns.** 90° left/right, camera arc during beat 4, hard reveal of next straight.
6. **Hardcoded song + hardcoded chart.** Validate the full loop at a fixed tempo before any procedural or audio-analysis code.
7. **Procedural phrase generation.** Vocabulary of 3-gate shapes, corner continuity rule, difficulty curve hooks.
8. **Audio analysis pipeline.** BPM + beat grid + section detection. Drop-in audio files.
9. **Chart generation from audio.** Sections drive difficulty, beats drive gate placement, section boundaries drive palette.
10. **Polish.** Beat pulse, wave effect, palette transitions, ground-line shadow, title/end screens.

## 8. Feel spec

Before writing gameplay code, define a set of numeric constants that govern how the game feels — kept together as a single source of truth (e.g. a TypeScript constants module) so they're easy to tune later:

- Corridor forward speed (units/second)
- Vertical movement speed and acceleration/response curve
- Gate spacing (units between gates) — derivable from speed × beat interval
- Camera FOV, near/far planes
- Corner transition duration (how long the camera takes to arc through a 90°)
- Player hitbox dimensions relative to gate opening size
- Turn-beat empty-corridor length

Set initial values, then tune them by feel during milestones 2–4. Lock them before moving to procedural generation so difficulty tuning isn't fighting feel tuning.

## 9. Open questions for build time

- **Target resolution / DPR / mobile strategy?**
- **Audio analysis library:** Essentia.js vs aubio.js vs hand-rolled?
- **Feel spec format:** JSON, TypeScript constants module, or YAML?
- **Leaderboards?** BYOM makes canonical per-song leaderboards awkward (requires fingerprinting or per-hash tables). Default: no leaderboards in v1.
- **Preview of player's song before the run?** Affects how forgiving the chart needs to be on first listen.

## 10. Deliberate non-goals for v1

- Non-4/4 time signatures
- Streaming from YouTube / Spotify / etc.
- Multiplayer or leaderboards
- Powerups, collectibles, score multipliers
- Mid-run difficulty adjustment based on player skill
- Multiple gate visual variants
- Pitch/roll turns, banking, non-cardinal angles
- Texture mapping on any geometry






































































