# Next-session handoff prompt — section detection / wiring

Copy the block below into a fresh Claude Code session. It contains everything needed to pick up where the last session left off without re-deriving context.

---

We're continuing work on **HelloRun 2**, a first-person rhythm runner. Read `CLAUDE.md`, `docs/architecture.md` (especially the Audio pipeline + Section detection sections), and `docs/milestone-status.md` (especially the M9 "still pending" list) before touching anything.

## Where we left off

**Section detection is built and producing reasonable output.** The full pipeline:

1. Worker emits `windowFeatures: WindowFeature[]` — one per 16-beat window — with `loudness` (Essentia Loudness), `centroid` (SpectralCentroidTime), and `chroma` (averaged 12-bin HPCP).
2. `detectSections(windowFeatures, bpm)` in `src/audio-analysis/analyzer.ts` runs combined energy+chroma novelty (mean+1σ threshold for boundaries), greedy-chunks into 16/32/64-beat blocks, then `clusterSections()` does first-fit greedy clustering (`CLUSTER_THRESHOLD = 0.4`) to assign a `kind` per section.
3. `SongAnalysis.sections[]` is the result; cached in localStorage by SHA-256 of the audio bytes.
4. The waveform overlay (top of screen) paints each section in a color picked by its `kind` from a heatmap gradient (blue→green→red), with phrase-grid lines solid white at section starts and dotted otherwise.

**Dev-song result**: 20 sections coalesced into 2 kinds (loud-mix vs quiet-breakdown). Dance track structure reads correctly.

**`run npm run dev` then visit `?dev` (or just dev-server)**, click the top-right hamburger → dev tab for "clear track analysis", Space pauses, B toggles markers, M is the top-down debug.

## What we're doing this session

The analysis side is in good shape. **Now wire it to gameplay** — this is the M9 work that the analysis was blocking. Two threads, in this order:

### 1. Section-driven chart density (smaller, do first)

In `src/main.ts` `appendSection()` — when a corridor straight is appended at a given pathS:
- Compute the audio time the straight represents: `audioTime = pathS / currentForwardSpeed` (or use songAnalysis to find the right window).
- Look up which audio section covers that time.
- Map `section.avgLoudness` (relative to song max) to `maxDifficulty` in 1..4.
- Pass to `generateChart(GATE_COUNT, { rand: chartRand, prevEndSlot, maxDifficulty })`.

Result: quiet sections produce easy phrases (recovery / mid-mid-mid stuff), loud sections unlock the hard phrases (jumps, alternations). This is plan §5's "denser phrases during high-energy sections."

Watch out for the case where `songAnalysis` is null (loading or analysis failed) — fall back to default `maxDifficulty = 4` (current behavior).

### 2. Palette shifts on section kind changes (bigger)

Plan §5: every section-kind transition shifts the corridor's edge color. Closed-barrier red is fixed (don't change it).

Steps:
- Define a small palette of N edge-color hues.
- Track the current kind that the camera is "in" — derived from `pathS / currentForwardSpeed` → audio time → which `section` covers it → `section.kind`.
- When the kind changes, update the tunnel's `LineMaterial.color` (and any markers' edge colors that should follow). Possibly with a smooth interpolation over a beat or two.
- The cube fill color (`COLOR_FACE`) probably stays the same — only edges shift, per plan §5: "Faces stay neutral dark across shifts."

The hard part is figuring out where to keep the per-straight materials and how to update them. Currently each straight is built once via `createTunnel()` which returns its own `LineMaterial`. Updating the color on existing materials should work — the LineMaterial reference is stored in `edgeMaterials[]` per-straight. We need to know which straight belongs to which kind (a function of pathS → kind via audio sections).

A reasonable first cut: when `appendSection()` builds a new straight, look up the kind for its pathS range and set the straight's edge material color from the palette before adding to scene. No interpolation; sections > 16 beats so the color holds for ≥8s at 120 BPM.

## Open questions worth deciding early

- **Should `detectSections` also emit a `musicalSections[]` that coalesces consecutive same-kind sections?** User asked about this last session; we deferred. Useful if you want "one entry per chord-stable section" rather than the chunked 16/32/64 view. Not needed for density wiring; might be needed for palette shifts (so the color holds across multi-block same-kind runs without "shifting" at intra-section block boundaries).
- **CLUSTER_THRESHOLD tuning**: 0.4 is conservative. Dev-song gets 2 kinds. For more typical pop/EDM (verse/pre/chorus/bridge), 0.25–0.30 likely produces 4–5 kinds — a more interesting palette story. Might be worth lowering before wiring palette so we get more visible variety.
- **What palette to use for kinds?** Heatmap blue→red is fine for the analysis viz but might be wrong for in-game. Plan aesthetic is Tron-Recognizer (cyan + red). A constrained palette in the cyan/violet/orange/cyan range would feel more on-brand than a full rainbow.

## Useful tools to validate as you go

- `node tools/analysis-check.mjs` — prints window features + sections + kind distribution. Use after tweaking `CLUSTER_THRESHOLD` or boundary threshold to see how it changes the segmentation.
- The waveform overlay itself is the live visual — color changes per-kind are visible there even before you wire palette to the corridor.
- `node tools/collision-check.mjs` — make sure density wiring doesn't break the seeded collision test (it uses `?seed=1` and assumes a chart with a lethal gate; if quiet-section maxDifficulty=1 produces all-mid charts the test will skip with "no non-mid gates").

## Workflow notes

- Don't commit unless I ask (standing rule).
- Auto mode active — keep it that way. Execute, don't plan.
- If you start a dev server, kill it with `npx kill-port 5173 5174 5175` — Vite leaves zombies on sibling ports if you only kill 5173.
- **Audio caching is on** — first analysis takes ~15s, subsequent reloads ~200ms. If you change `detectSections` or `clusterSections` logic, bump `CACHE_VERSION` in `src/audio-analysis/cache.ts` from 1 → 2 OR press Tab → "clear track analysis" before reloading.
