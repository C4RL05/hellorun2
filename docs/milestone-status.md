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

## ✅ M8 — Audio analysis pipeline (essentially done)

Plan: BPM + beat grid + section detection. Drop-in audio files.

**Done**:
- ✅ **Essentia.js integration** via Web Worker (analysis off the main thread)
- ✅ **BPM detection** via `RhythmExtractor2013` (multifeature) + cross-check with `PercivalBpmEstimator`
- ✅ **Consensus heuristic**: if multifeature confidence ≥ 3.0 use it; else check agreement with Percival (direct or harmonic); else median of `bpmEstimates`
- ✅ **Beat grid** via the `ticks` output
- ✅ **Grid offset**: `OnsetRate` provides a first-onset lower bound; back-extrapolate from `beats[0]` along the BPM grid until the next step would cross below the onset, with a half-beat fallback to the onset itself when the tracker's grid is more than half a beat off (see analyzer-worker `firstGridBeat`). Replaces a custom RMS detector — pure-Essentia path now.
- ✅ **Sample-rate fix**: resample to 44100 before analysis (see [`gotchas.md`](gotchas.md))
- ✅ **Drag-drop BYOM UI**: title screen has a drop zone (click-to-browse fallback). Race-safe via generation counter.
- ✅ **BPM → FORWARD_SPEED wiring**: `currentForwardSpeed = forwardSpeedForBpm(bpm)` after analysis. `__getGateTimesMs()` reads live speed.
- ✅ **Per-16-beat window features**: `WindowFeature` per 16-beat slice — `loudness` (Essentia Loudness), `centroid` (SpectralCentroidTime), `chroma` (averaged 12-bin HPCP via Windowing → Spectrum → SpectralPeaks → HPCP). 22 windows on a 7-min track at 120 BPM.
- ✅ **Section detection**: `detectSections(windowFeatures, bpm)` — combined energy+chroma novelty, mean+1σ threshold for boundaries, greedy chunking into runs of {1, 2, 4} windows (= 16/32/64 beats). Then `clusterSections()` first-fit greedy clustering on normalized features (loudness L2 + chroma cosine, threshold 0.4) assigns a `kind` per section. All same-kind sections render in the same waveform color.
- ✅ **Persistent analysis cache**: `src/audio-analysis/cache.ts` — localStorage keyed by SHA-256 of audio bytes. Skip the worker when re-loading a known song. Versioned key (`hr2-analysis-v1:`) for schema-bump invalidation. "Clear track analysis" button (user menu → dev tab) sweeps all versions.

**Deferred**:
- ❌ **Confidence threshold UX**: warn the player when multifeature confidence < 2.5 ("analysis uncertain — sync may feel off"). Today the low-confidence case falls through silently.

**Tunables** (live in `src/audio-analysis/analyzer.ts`):
- `CLUSTER_THRESHOLD = 0.4` — lower → more distinct kinds. Dev-song splits into 2 kinds at 0.4; 4–5 at 0.25.
- Boundary threshold: `mean + 1σ` of combined novelty inside `detectSections`. Lower constant → more boundaries → more (shorter) sections.

**Files**: `src/audio-analysis/{analyzer,analyzer-worker,cache}.ts`, `src/main.ts` (loadAndAnalyzeSource flow), `src/waveform.ts` (visualization), `tools/analysis-check.mjs` (debugging).

## ✅ M9 — Chart generation from audio (essentially done)

Plan: sections drive difficulty, beats drive gate placement, section boundaries drive palette shifts.

**Done early** (moved up from M10 because beat-alignment couldn't be finalized without it):
- ✅ **Rolling corridor generation**: `src/corridor.ts` exports `Section` (straight or turn) and `samplePath(sections, s)`; `main.ts` maintains a growing `sections[]` with `ensureSectionsAhead(pathS)` appending straight→turn→straight→turn on demand. Turn direction alternates right/left so the corridor zig-zags. Chart generator is streamed per-corridor-straight via `generateChart(GATE_COUNT, { prevEndSlot })`, preserving corner continuity.
- ✅ **Section data ready** (M8): `analysis.sections[]` provides the per-block `kind`, `avgLoudness`, `avgCentroid`, `avgChroma`. Everything needed to drive density and palette is now exposed.

**Done**:
- ✅ **Section→chart density**: `appendSection` looks up the audio section covering each corridor straight and maps `section.avgLoudness / songMaxLoudness` to `maxDifficulty` quartiles (1–4). Quiet → easy phrases; loud → hard.
- ✅ **Palette shifts on `kind`**: `SECTION_EDGE_PALETTE` in `constants.ts`; per-straight tunnel edge color from `palette[section.kind % len]`. Barrier red untouched. `recolorStraightsFromAnalysis()` propagates new colors to existing built straights when analysis updates.
- ✅ **CLUSTER_THRESHOLD lowered to 0.30** (CACHE_VERSION bumps as needed). Dev song still resolves to 2 kinds — too internally similar — typical pop/EDM should surface 4–5.
- ✅ **Game-over rewind + vinyl audio** (`docs/game-over-rewind-and-vinyl-audio.md`). Backward path drift + Steven's-law audio playbackRate ramp.
- ✅ **RMB-on-death = continue from previous turn** (`continueFromPreviousTurn` → `seekToSongTime`).
- ✅ **Waveform LMB seek snaps to nearest preceding turn** so player gets the corner as a lead-in, not gates immediately.
- ✅ **Pointer lock auto-acquire on transitions INTO active play** (start, respawn, seek); auto-release on transitions OUT (collision, pause, quit, song end).
- ✅ **User menu** (top-right hamburger) with Settings / Music / Dev tabs. Drop-zone moved into Music tab.
- ✅ **Track list with status lifecycle** (`loading → analyzing → ready / failed`); progress label per row; × to delete user tracks.
- ✅ **IndexedDB persistence**: track-meta + track-bytes for user uploads; analysis-cache for `SongAnalysis` (incl. ~1MB framewise per song). Supports 20+ cached songs without quota concerns.
- ✅ **Music editor modal** (`src/track-editor.ts`): waveform with wheel zoom, RMB-drag pan, LMB click-to-preview + LMB-drag-to-shift-grid; numeric BPM; phrase-grid lines.
- ✅ **Beat-sync click** (LMB during play): the moment becomes beat 1; corridor rebuilds from pathS=0 with new gridOffset; white flash bridges the cut; sections recompute instantly via framewise prefix sums.
- ✅ **Framewise prefix-sum architecture** (`src/audio-analysis/framewise.ts`): per-frame Essentia work runs ONCE per song into cumulative arrays; recompute paths (editor save, sync, future per-section gameplay tweaks) re-aggregate in O(1) per window.
- ✅ **Sidecar files** (`src/audio-analysis/sidecar.ts`): `<track>.mp3.analysis.json` next to the mp3 lets first-time visitors skip the 15s analysis. Format-versioned + audio-hash-validated. Dev tab has an "export analysis sidecar" button.

**Deferred (optional)**:
- ❌ `musicalSections[]` coalescing consecutive same-kind sections. Not needed: callers key on `Section.kind`, so contiguous same-kind sections naturally produce no palette shift.
- ❌ Drop `windowFeatures` / `windowDurationSec` from `SongAnalysis` (derivable from framewise + bpm + gridOffsetSec). Cleaner type, but invasive.
- ❌ Confidence threshold UX ("analysis uncertain — sync may feel off") when multifeature confidence < 2.5.

**Open for next session — gate setup per section**: the only section→gameplay knob currently wired is the `maxDifficulty` quartile from loudness. Density (gates per straight) is fixed at `BEATS_PER_GATE = 4`. Phrase vocabulary biasing per section kind isn't exploited. See `docs/next-session-prompt.md`.

## ⏳ M10 — Polish (not started)

Plan §10 non-goals and §5/§6 visual upgrades:
- **Bloom pass** on edge layer (plan §5 prescribes it; currently no bloom — just 2px fat lines)
- **Beat pulse**: edge brightness lift on downbeats (~10–15%, more on phrase/bar starts)
- **Wave effect** on beat / phrase boundary
- **Palette transitions** tied to song sections (M9 dependency)
- **Corridor recycling** (plan §6) — rolling generation is done (see M9), but we never prune old sections behind the camera. A long song will accumulate dozens of straight groups that the player can't see. Add a prune step keyed to `pathS − last_section_end` distance.
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
- `src/songs.ts` — `devSong.url` points at the mp3 under `public/music/` (gitignored). Optional sibling `.analysis.json` sidecar skips the first-load analyze.
- `src/constants.ts` — `BEATS_PER_GATE` default is `4` as of commit `99a5b32`; if the user is feel-testing they may have changed to 2 or 1.
- `src/main.ts` — should have `loadAndAnalyzeSource` as the loader entry (post-drag-drop commit) or `loadAudio` (pre-drag-drop).
