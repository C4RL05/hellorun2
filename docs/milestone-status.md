# Milestone status

Snapshot of where we are in plan §7's 10-milestone sequence. Each entry lists what's done, what's deferred, and pointers to the code.

## ✅ M1 — Static scene whitebox

Commit `5aaa6c7`. Single straight, cube-grid tunnel (5×5 cross-section × 40 deep) with a 1-cell hollow center column. Merged `BufferGeometry` for fills and fat-line (`LineSegments2`) for edges. ~960 cubes per tunnel; 2 draw calls each.

**Follow-on polish** (`639657c`): per-cube ±10° random rotation jitter, 2px fat-line edges.

**Files**: `src/scene/tunnel.ts`, `src/constants.ts`.

## ✅ M2 — Forward motion

Commit `d475507`. Constant-speed camera along −Z. `THREE.Clock`-driven delta-time initially; superseded by audio-clock in M6.

Loop-back behavior: when `pathS` reaches `PATH_TOTAL`, wraps to 0. Wrap frames skip collision (see [`architecture.md`](architecture.md)).

## ✅ M3 — Player vertical input

Commit `dbadb68`. Unified delta-pipeline from plan §8 feel spec:
- Keyboard (ArrowUp/W, ArrowDown/S) — rate-based writes to `inputTarget`
- Mouse — `movementY / (viewportH/2) × MOUSE_SENSITIVITY`, works both pointer-locked and free
- `inputNow` eases toward `inputTarget` with framerate-independent exponential smoothing

Resolution-independent (viewport-normalized) sensitivity; altitude held when idle.

**Files**: `src/player.ts`, `src/constants.ts` (KEY_SENSITIVITY, MOUSE_SENSITIVITY, INPUT_EASE_RATE, PLAYER_Y_MIN/MAX).

## ✅ M4 — Gates + collision

Commit `bb4af7e`. Three-lane gate geometry, one open slot per gate, one-hit death.
- Z-crossing collision check per frame per straight
- Barriers transparent (opacity 0.3, `depthWrite: false`) so multiple gates ahead are visible through nearer ones — effectively doubles chart planning horizon
- R key / click-when-dead respawns

**Files**: `src/scene/gates.ts`, `src/collision.ts`.

## ✅ M5 — 90° turn + second straight

Commit `c81008f`. Corridor = straight 1 → right-turn arc → straight 2. Camera samples a parametric path (`src/corridor.ts`), not a raw Z value. Each straight is a scene Group with transform; collision uses `group.worldToLocal` to map camera into each straight's local frame.

Turn radius = 5 units; arc length ≈ 7.854 at 120 BPM gives ~0.785s to traverse (plan prescribes "beat 4" which is 0.5s at 120 BPM — off by a feel-spec tuning margin, not re-committed yet).

**Files**: `src/corridor.ts`, `src/main.ts` (two-straight build + collision-across-straights).

## ✅ M6 — Hardcoded song + audio-clock sync

Commit `62a650a`. Title overlay, audio preloads, click-to-start, audio ends → game ends. Audio is the master clock for pathS:

```
audioNow = audioCtx.currentTime − audioStartTime − gridOffsetSec
pathS    = max(0, audioNow × FORWARD_SPEED)
```

Wall-clock fallback when audio is suspended (tests). `totalPathS` (monotonic) tracks cycles for wrap detection.

**Files**: `src/main.ts` (audio pipeline), `src/songs.ts` (SongMetadata type).

## ✅ M7 — Procedural phrase generation

Commit `99a5b32` (`c97d126` amended for timestamp). Hand-curated vocabulary of 19 three-gate phrases with difficulty tiers 1–4. Generator enforces:
- **Spawn safety**: first phrase's first slot must be 1 (mid)
- **Corner continuity** (plan §2): next phrase's first slot within ±1 of previous phrase's last slot
- **Max difficulty cap**: `generateChart(n, { maxDifficulty })` filters the vocabulary

Density knob: `BEATS_PER_GATE` constant (currently 4 — gates every 2s at 120 BPM, generous for feel). `GATE_COUNT = BEATS_PER_STRAIGHT / BEATS_PER_GATE` derived.

Determinism: `?seed=N` URL param passes a mulberry32 PRNG to the generator. Tests use `?seed=1` for reproducible charts.

**Files**: `src/chart.ts`, `src/constants.ts` (BEATS_PER_GATE, GATE_COUNT), `src/scene/gates.ts` (takes `openSlots: readonly number[]`).

## 🟡 M8 — Audio analysis pipeline (in progress)

Plan: BPM + beat grid + section detection. Drop-in audio files.

**Done** (in commit `99a5b32` and later uncommitted work):
- ✅ **Essentia.js integration** via Web Worker (analysis off the main thread)
- ✅ **BPM detection** via `RhythmExtractor2013` (multifeature method) + cross-check with `PercivalBpmEstimator`
- ✅ **Beat grid** via the `ticks` output (list of per-beat timestamps)
- ✅ **Grid offset** derived from first beat position; wired into audio-clock math (camera waits through intro silence)
- ✅ **Sample-rate fix**: resample to 44100 before analysis (was causing 110 vs 120 miscount — see [`gotchas.md`](gotchas.md))
- ✅ **Consensus heuristic**: if multifeature confidence ≥ 3.0 use it; else check agreement with Percival (direct or harmonic); else use median of `bpmEstimates`
- ✅ **Drag-drop BYOM UI**: title screen has a drop zone (also click-to-browse). Any dropped audio replaces the current song, re-analyzes. Race-safe via generation counter.

**Deferred / not started**:
- ❌ **Section detection** — verse/chorus/bridge. Essentia has `SBic` (Bayesian-info-criterion segmentation); plan §9 flagged the library choice as open. Could alternatively use novelty segmentation from spectral flux. Needed for M9 palette shifts and per-section difficulty.
- ❌ **BPM → FORWARD_SPEED wiring**: `FORWARD_SPEED` is still a constant `10`. Detected BPM should set it to `GATE_SPACING × bpm / (BEATS_PER_GATE × 60)` so gates land on the beats of *any* song, not just 120-BPM ones.
- ❌ **Confidence threshold UX**: low-confidence analyses should warn the player ("analysis uncertain — sync may feel off"). Currently analysis failures fall back to defaults silently.

**Files**: `src/audio-analysis/analyzer.ts`, `src/audio-analysis/analyzer-worker.ts`, `src/songs.ts`, `src/main.ts` (loadAndAnalyzeSource flow + drop handlers), `tools/analysis-check.mjs`.

## ⏳ M9 — Chart generation from audio (not started)

Plan: sections drive difficulty, beats drive gate placement, section boundaries drive palette shifts.

Prerequisites:
- M8's section detection (blocking)
- BPM → FORWARD_SPEED coupling (can be done standalone but M9 will depend on it)

Scope when it starts:
- Replace `generateChart(gateCount)` with a song-aware generator that reads section boundaries and emits higher-density / higher-difficulty charts during high-energy sections
- Trigger palette shifts on section boundaries (plan §5)
- Consider streaming chart generation (instead of generating all gates at init, generate the next straight as the previous one recycles — plan §6 "Corridor sections are built as the player progresses")

## ⏳ M10 — Polish (not started)

Plan §10 non-goals and §5/§6 visual upgrades:
- **Bloom pass** on edge layer (plan §5 prescribes it; currently no bloom — just 2px fat lines)
- **Beat pulse**: edge brightness lift on downbeats (~10–15%, more on phrase/bar starts)
- **Wave effect** on beat / phrase boundary
- **Palette transitions** tied to song sections (M9 dependency)
- **Corridor recycling** (plan §6) — currently we just loop through 2 straights; real game recycles straights with fresh chart content from M9
- **Title / end screens** polish
- **Bloom performance tuning** — plan §6 calls it out as the main per-pixel cost

## Commits reference

```
99a5b32  M7 procedural charts + M8 essentia.js audio analysis (BPM working)
62a650a  Milestone 6: hardcoded song + audio-clock sync
d6d87b8  Debug overlay with per-object oriented bboxes + invincibility
c81008f  Milestone 5: 90° turn between two straights
bb4af7e  Milestone 4: 3-slot gates, collision, respawn
dbadb68  Milestone 3: player vertical input (unified delta pipeline)
d475507  Milestone 2: constant-speed forward camera motion
639657c  Jitter cubes 10° and draw edges as 2px fat lines
5aaa6c7  Milestone 1 whitebox: cube-tunnel scene + visual smoke test
7f548d1  Initial commit: design plan and Claude Code guide
```

Main is ~9 commits ahead of `origin/main` at time of last docs update.

## Non-obvious in-progress state

If you're resuming and find uncommitted changes, check:
- `src/songs.ts` — `devSong.url` points at whichever mp3 the user last tested (`/dev-song.mp3` or `/dev-120.mp3`). Both files are in `public/` (gitignored) if the user has them locally.
- `src/constants.ts` — `BEATS_PER_GATE` default is `4` as of commit `99a5b32`; if the user is feel-testing they may have changed to 2 or 1.
- `src/main.ts` — should have `loadAndAnalyzeSource` as the loader entry (post-drag-drop commit) or `loadAudio` (pre-drag-drop).
