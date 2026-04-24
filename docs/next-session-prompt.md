# Next session — refine the rig editor

We're continuing **HelloRun 2**, a first-person rhythm runner for the Cerebral Valley "Built with Opus 4.7: Claude Code" hackathon. **Submission is Mon 2026-04-27 at 01:00 BST** (Sun 20:00 EDT). Today is 2026-04-26 morning when this resumes — **~1.5 days to ship**.

**Read these first** (in order):
1. `CLAUDE.md` — project overview + auto-mode working style.
2. `docs/hellorun2-plan.md` §5 (visuals) — aesthetic contract; rigs exist to deliver the "road-like emissive markers" line.
3. `docs/milestone-status.md` — where M10 stands; rig system is mostly there.

## Where we are

M1–M9 done. M10 substantial progress:
- **HDR pipeline shipped**: pmndrs `EffectComposer` (HalfFloatType) → Bloom → Exposure → ACES tone map. Dev-only Post tab in the menu tunes live; exports a `public/post-settings.json`. See `src/render-pipeline.ts`, `src/post-panel.ts`, `src/post-settings.ts`.
- **Rig system shipped** (catalog of per-straight emissive markers). Details below.
- **Rig editor MVP shipped** (side-docked dev panel for tuning rig fixture params).
- **Menu structure**: `settings` (invincibility) · `music` (tracks) · `post` (dev) · `setup` (dev, fixture enable toggles) · `debug` (dev, view flags + rig editor + data buttons) · `about` (logo + v__APP_VERSION__).

Last commit before this session: `a79626b` (cateye → InstancedMesh). Several commits on top — rename to "rig/fixture" (option A), rig editor MVP, debug-tab section headers. Not yet committed when this prompt was written; the user asked for a commit right before starting this file.

## The rig system — option A vocabulary

Each straight has one **rig** — a collection of 1–3 **fixtures** picked from the catalog. Mental model: stage rigging. The rig is the whole lighting assembly on that straight; the fixtures are the individual units (cateyes, spikes, etc.) mounted on it.

| Concept | Code name | Where |
|---|---|---|
| Fixture kind | `FixtureType<Params>` | `src/scene/fixtures/shared.ts` |
| One built fixture attached to a straight | `Fixture` (extends `BuiltFixture` + `typeName`) | `src/scene/fixtures/index.ts` |
| Per-straight collection | `rig: Fixture[]` on `StraightObj` | `src/main.ts` |
| Plan for one rig (what the hash picks) | `RigSpec` | `src/scene/fixtures/index.ts` |
| Catalog | `CATALOG: ReadonlyArray<FixtureType>` | `src/scene/fixtures/index.ts` |
| Log tag | `[rig] straight=N … \| cateye[…] + spike[…]` | one line per straight on first camera crossing |

**Catalog today**: `cateye` (cubes/tetras/capsules in 9 layouts, 1/2/4 density — `InstancedMesh`), `spike` (cones scattered on all 4 surfaces, noise-driven length + spawn mask, 100/200/400 density, `InstancedMesh`).

**Variation hierarchy**:
- Kind (audio-section kind) → shape, pulse, color, density
- Section (audio-section `startBeat`) → layout
- Phrase block (every 2 phrases = 4 corridors) → sizeScale, rotation

All picks seeded through `mulberry32` for determinism. Each picked type's seeds are salted by `djb2(type.name)` so two types on the same straight roll independently.

**Build timing**: corridor is deferred until analysis lands (~15s boot). No retroactive rebuild. Generate ranges load from `public/setup/<typename>.json` at boot if present; otherwise code defaults.

## The rig editor — where it is now

Located at `src/dev-fixture-editor.ts`, toggled by "rig editor" button in Debug tab (persists under `hellorun2.fixtureEditor` in localStorage). Side-docked panel, right edge, 22rem wide. Game renders behind.

**What works today**:
- Dropdown of all `FixtureType` names from the catalog.
- For each numeric param in the selected type's `ranges` record, a min + max stepper pair (stacked vertically inside each param row).
- **Generate** button → `regenerateAllRigs(typeName)` in `main.ts`: tears down every built straight's rig (scene graph + registry + GPU dispose), attaches ONE fresh fixture of the selected type with random params rolled from the current ranges via `randomSingleSpec`. Isolates the type under edit — other types removed for clean viewing.
- **Export json** button → downloads `<typename>.json` with the type's current `ranges`. User drops it into `public/setup/` and reloads to bake in.
- Boot loader: `src/fixture-range-loader.ts` fetches `/setup/<name>.json` per catalog type, merges over code defaults. Tolerant of missing/malformed files.

**Editable today**:
- `cateye.ts` ranges: `sizeScale`
- `spike.ts` ranges: `baseLength`, `radiusRatio`, `threshold`, `noiseScale`

**Persistence model**: in-memory edits are ephemeral. Export → drop into `public/setup/` → reload is the checkpoint path. No auto-save. This is the clean separation the user asked for — "ranges are not mixed up with the code itself."

## What to refine — the actual task

The editor is MVP. It works, but most of what makes a rig visually distinct is *still code-driven* and not reachable from the editor. The user values the editor highly ("the better we make the editor more time we save"). Goal this session: make it a real tuning tool.

**Gaps, roughly in order of value per hour**:

1. **Union params aren't editable at all.** `shape`, `layout`, `pulse`, `density` for cateye; `pulse`, `density` for spike. Today they're picked from fixed arrays in the type's `specFor`. The editor can't pin them, can't restrict the pool. Two options:
   - **Pin to one value**: editor shows a dropdown per union param, selected value always used.
   - **Restrict the pool**: editor shows a multi-select checkbox list; Generate picks randomly from the remaining checked options.
   Either one unlocks serious variety. Multi-select is more powerful but more UI; pin is simpler. Recommend: start with multi-select and default to "all checked".

2. **Editor doesn't show what was actually rolled.** After Generate, you see results in-world but can't read the exact params that got picked. Log line helps but is noisy to scroll. A "last rolled" readout next to each param row would let you zero in on a good roll and then narrow the range around it.

3. **Seed lock / reproduce.** "I like THIS specific roll. Let me lock the seed and tweak one range to see how that single param moves without rerolling the others." Needs either: (a) a seed field you can freeze, or (b) a "lock rolled values as new min/max=exact" button that collapses ranges to single values.

4. **Isolated preview corridor.** Generate currently wipes all visible corridors. If you're mid-song and want to compare type A vs type B, you can't — each Generate replaces everything. A dedicated stub straight behind the spawn (or a floating preview frame in the side panel) would let you A/B.

5. **Reset-to-defaults per type.** Currently editor mutates the type's `ranges` record in place. No undo. A "reset" button per type would restore the code-default ranges (would require stashing the original values somewhere — currently lost once the loader overwrites).

6. **Regeneration scope controls.** Today Generate wipes the currently-picked type across all built straights. Might want: "generate for current straight only", "generate for next N straights", "generate and keep all other types".

7. **Copy ranges between types.** Probably not worth it unless types end up sharing a param name (most don't).

8. **Type-specific non-range knobs**. Things like `CONE_RADIAL_SEGMENTS` (4 = pyramid vs 8 = smooth cone) or `BASE_SIZE` for cateye — not really random ranges but do affect the look. Would need an expanded "constants" section per type.

**Probably NOT worth doing**:
- Saving multiple preset files per type (over-engineering — one JSON per type is plenty).
- Mid-session hot-reload of JSON (user already has Export → drop → reload as the canonical path).
- Editing color (color is section-palette driven; changing it per type breaks the tunnel/rig harmony).

## Suggested implementation order

1. **Union param multi-selects** (biggest unlock). Extend `FixtureType` interface with optional `unionParams: Record<string, readonly string[]>`. Each type declares which param names are unions + their options. Editor renders a checkbox list per union param; the type's `specFor` reads from the filtered pool. Tell the user when Generate runs with an empty pool (fall back to full pool, log a warning).
2. **Last-rolled readout** per param row. Panel subscribes to Generate; each row shows "rolled: 0.24" next to its min/max. Readout goes stale (grey out) if the user edits the range.
3. **Seed lock** — one field at the top of the editor, editable integer. When set, `randomSingleSpec` uses those seeds instead of Math.random; Generate produces the same roll every click until the user changes the seed or clears it.
4. **Isolated preview corridor** — stash a dedicated `StraightObj` at pathS = -40 or similar (behind spawn) and aim a stub camera at it from the panel. Too much scope for 1.5 days; skip unless time permits.
5. **Reset-to-defaults** — capture each type's initial `ranges` at module load (deep copy) and expose via `resetToDefaults(typeName)`. Cheap.

## Gotchas / invariants — don't regress

- **`public/setup/`** is the JSON dir for fixture ranges (and the Setup tab's enable toggles). Log tag stays `[rig]`.
- **`hellorun2.fixtures.enabled`**, **`hellorun2.fixtureEditor`**, **`hellorun2.markers`**, **`hellorun2.map`**, **`hellorun2.invincible`** — don't rename; existing users' state lives there.
- **Corridor build is gated on analysis landing.** No retroactive rebuild path. If the editor needs to affect already-built straights, use `regenerateAllRigs` (ephemeral, non-deterministic) rather than re-entering the build path.
- **Determinism invariant**: during normal (non-editor) play, `specForRig(kind, sectionKey, phraseIndex)` is deterministic. The editor's Generate bypasses this on purpose (uses `Math.random`). Don't leak editor-driven randomness into the production build path.
- **`Fixture` in code = one built+attached unit**. Multiple of these per straight. Don't use it as the type name — `FixtureType` is the type.
- **Fixtures use `InstancedMesh`**. Pulse updates drive shared material color (not per-instance). Per-instance pulse is a one-liner (`setColorAt`) if needed — haven't shipped it.
- **No gate changes**. The rig system is purely visual; gates remain baked, deterministic, chart-driven. Don't accidentally wire rigs into collision or chart.

## Workflow rules (carried over)

- **Auto mode active**: execute, don't plan. Surface only true branch points.
- **No `git commit`** unless Carlos explicitly says so. Never push.
- **No mp3 commits** ever.
- **Tracks not songs** in user-facing copy and new identifiers.
- **Release pointer lock before any UI overlay appears**.
- **Feel-spec discipline**: any new tunable defaults go in `src/constants.ts`. Editable ranges go in the type's `ranges` record.
- Kill stale dev servers with `npx kill-port 5173 5174 5175`.
- Playwright scripts target `#game-canvas`.
- Timestamps for commits: user writes `commit with timestamp +Nh`. Compute via `date -d "+N hours" -Iseconds` and set both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`.

## Honest scope note

1.5 days to ship. Union param multi-selects + last-rolled readout covers ~80% of the tuning value and is ~3-4 hours of clean work. Seed lock and reset-to-defaults are each ~30min. Isolated preview corridor is a rabbit hole — skip unless the above three fly.

Most important: keep the fixture modules self-contained. Any editor feature that requires a new contract on `FixtureType` goes into `shared.ts`, and each type either opts in (union params declaration) or doesn't. A type added to the catalog next session (arches, runway lines, pylons?) should need zero changes outside its own file.
