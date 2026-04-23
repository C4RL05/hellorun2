# Next session — gate setup per section

We're continuing **HelloRun 2**, a first-person rhythm runner for the Cerebral Valley "Built with Opus 4.7: Claude Code" hackathon. **Submission is Mon 2026-04-27 at 01:00 BST** (Sun 20:00 EDT). Today is 2026-04-24 morning when this resumes.

**Read these first** (in order):
1. `CLAUDE.md` — project overview + auto-mode working style
2. `docs/architecture.md` — current code layout and audio pipeline (recently updated for framewise + IDB + sidecar)
3. `docs/milestone-status.md` — what's done (most of M9) and what's open
4. `docs/hellorun2-plan.md` §5 (sections drive density/palette/transitions) and §7 M9 lines

## Where we are

M1–M8 done. M9 covers most of what was planned: rolling corridor, per-straight density (loudness → maxDifficulty), per-kind palette, game-over polish, music editor, beat sync, IDB persistence, framewise architecture. **What's not yet exploited is the richness of section data for varying gate setups.**

Current section→gameplay wiring is one knob, applied uniformly:

```ts
// src/main.ts appendSection — only one section field reaches gameplay:
const audioSec = audioSectionForPathS(section.pathStart);
const openSlots = generateChart(GATE_COUNT, {
  rand: chartRand,
  prevEndSlot: prevEndSlot ?? undefined,
  maxDifficulty: maxDifficultyForSection(audioSec),  // ← from avgLoudness only
});
```

`GATE_COUNT` is constant per straight: with `BEATS_PER_STRAIGHT=7`, `FIRST_GATE_BEAT=2`, `BEATS_PER_GATE=4` → `floor((7-2)/4)+1 = 2` gates. `BEATS_PER_GATE` is a global constant. Phrase vocabulary in `chart.ts` is uniform (19 hand-curated phrases, picked by max-difficulty filter only). `section.avgCentroid` and `section.avgChroma` are unused for gameplay.

## What "gate setup per section" means

Plan §5 says sections should drive "denser phrases during high-energy sections" and similar. The current implementation is the minimum viable version. There's a lot of latent expressiveness in `Section` we haven't tapped:

- **Density (gates per straight)**: vary `BEATS_PER_GATE` per section. Loud chorus → gate every 2 beats (4 gates per straight). Quiet breakdown → gate every 8 beats (1 gate, basically a long no-decision passage).
- **Phrase vocabulary biasing**: the existing `PHRASES[]` array has difficulty 1–4. We currently filter by max-difficulty. Could also bias by:
  - Section centroid (high centroid = bright mix → bouncier slot patterns?)
  - Section chroma (chord stability → rhythmic patterns vs jumpy patterns?)
  - Position within section (start = ease in, middle = peak, end = wind down)
- **Section-boundary cues**: at the moment palette changes are the only acknowledgment. Could:
  - Force a "transition phrase" on the first straight of a new kind (smooth lead-in)
  - Add a "rest beat" between sections (skip first gate on new section)
  - Spawn a marker/cue gate at the boundary
- **Section length awareness**: 16/32/64-beat sections each fit 2/4/8 corridor straights. Current code processes each straight independently. Could plan a coherent gate arc across the section's straights instead.

## What's already in place that you can use

- `audioSectionForPathS(pathS): AudioSection | null` in `main.ts` — maps a corridor pathS to the audio Section covering that moment
- `Section { kind, avgLoudness, avgCentroid, avgChroma, beatLength, startBeat, startSec, windowCount }`
- `songMaxLoudness` cached in `main.ts` — denominator for normalized comparisons
- `SECTION_EDGE_PALETTE` already cycles by kind
- `commitAnalysisUpdate(next, gridOffsetSec)` — single landing point for state changes; if you re-derive sections you can route through this

The chart generator (`src/chart.ts`) is small and easy to extend:
- `generateChart(gateCount, { maxDifficulty, prevEndSlot, rand })` — current API
- `PHRASES[]` constant lists 19 phrases with `{slots, difficulty}`
- Add new options without breaking existing calls

## Open design questions (decide early)

1. **Density: variable or fixed?** Variable density means `GATE_COUNT` is no longer a constant. The corridor straight length stays uniform (geometric simplicity), but gates land at variable beats. Code touch: `appendSection` derives `gateCount` per-straight; `createGates(openSlots)` already takes a runtime slot array. Plan §2 "gates never at turns" still holds.
2. **Per-section feel coherence vs per-straight independence**: a section spans 1/2/4 windows = 2/4/8 corridor straights. Should the chart be planned for the whole section at once, or each straight still independently with section-level filters? Independent is simpler; whole-section planning enables phrase arcs (intro / build / peak / cool).
3. **Centroid mapping**: high centroid = bright/treble = bouncy patterns? Or = busy = denser? Pick a hypothesis and ship; iterate by feel. The dev song's two kinds happen to differ in centroid significantly (kind 0: ~140-1000Hz, kind 1: ~1700-4400Hz) so the contrast will be obvious.
4. **Section boundary handling**: insert any gameplay marker (rest beat, transition phrase) or just let palette change do the talking?
5. **Difficulty curve over the song**: should the chart get progressively harder regardless of section, or strictly mirror loudness? "Always more challenging by minute 3" is a runner convention. "Easy outro" is too. Decide.

## What to test with

- **Dev song**: 7-min track, 2 kinds (loud-mix vs quiet-breakdown), kind-1 transitions at 128s and 200s. Good for feel-testing density/palette contrast.
- **Drop a different track**: any pop/EDM with verse/chorus/bridge structure. Should produce 4–5 kinds at the current `CLUSTER_THRESHOLD = 0.30`.
- **`tools/analysis-check.mjs`** — prints per-window features + per-section features. Use after tweaking section detection or section-driven gameplay to see what numerical inputs are reaching the gate generator.
- **`tools/collision-check.mjs`** — seeded chart with `?seed=1`. If you change `generateChart` API, may need updates to keep the assertion meaningful.

## Workflow rules (carried over from prior sessions)

- **Auto mode active**: execute, don't plan. Surface only true branch points.
- **No `git commit`** unless Carlos explicitly says so. Never push.
- **No mp3 commits** ever (gitignore is authoritative; never `git add -f` audio).
- **Tracks not songs** in user-facing copy and new identifiers.
- **Release pointer lock before any UI overlay appears** (already wired for existing transitions; remember when adding new ones).
- **Feel-spec discipline**: every tunable lives in `src/constants.ts`. New per-section gameplay knobs go there too.
- Kill stale dev servers with `npx kill-port 5173 5174 5175` (Vite leaves zombies on sibling ports).

## Suggested approach for the session

1. Start the dev server, drop a track with clear verse/chorus structure, take note of how the existing density variation feels.
2. Pick one or two of the design choices above, propose to Carlos, build the smallest viable version.
3. Tune by feel, not by spec. The whole §5 chart-generation work is a feel-spec exercise.
4. If a tunable should live in `constants.ts`, put it there from the start.
5. Don't over-engineer the section→gate pipeline. There's only ~2 days to submission and what's there already works — incremental wins compound.

After this, what's left for M10 polish: bloom on edges, beat pulse, end-of-song screen, corridor pruning. Visual polish is intentionally deferred until gameplay is locked.
