# HelloRun 2

An auto-forward first-person rhythm runner. Drop in any audio file; the game analyzes it in-browser and builds a corridor of straights, 90° turns, and 3-slot gates from the song's BPM, beat grid, and detected sections. A run is one song. One hit ends it.

Built for [Cerebral Valley's "Built with Opus 4.7: Claude Code" hackathon](https://cerebralvalley.ai/e/built-with-4-7-hackathon).

## Try it

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and either drop an mp3 onto the title screen or click to browse. Analysis takes ~15s the first time you load a track; results are cached in `localStorage`, so reloads are instant.

A `dev-song.mp3` placed in `public/` (gitignored) auto-loads on boot for development convenience.

## Controls

| Key | Action |
|-----|--------|
| Mouse Y / W,S / Arrow Up,Down | Vertical position (3 slots) |
| Click title | Start the run |
| R / Click | Respawn from beginning |
| RMB (when dead) | Continue from start of previous turn |
| Click waveform | Seek to that point (snaps to nearest preceding turn) |
| Esc | Quit to title |

Dev-mode keys (always on in `npm run dev`, opt-in via `?dev` in production builds): Space (pause), B (musical-structure markers), M (top-down debug), I (invincibility), Tab (dev menu).

## How it works

1. **BYOM ingest.** Audio file is hashed (SHA-256), decoded by the browser, and resampled to 44.1 kHz.
2. **Analysis (Web Worker).** [Essentia.js](https://essentia.upf.edu/essentiajs.html) runs `RhythmExtractor2013` and `PercivalBpmEstimator` for BPM consensus, `OnsetRate` for the first-audible bound that fixes the beat grid, and per-16-beat windows of `Loudness` + `SpectralCentroidTime` + averaged `HPCP` chroma for section features.
3. **Section detection (main thread).** Combined energy + chroma novelty places boundaries; first-fit greedy clustering assigns each block a `kind` so musically similar sections share an identity.
4. **Corridor generation.** A growing list of straights and 90° turns is built ahead of the camera. Forward speed is locked to BPM so gates land on beats. Each straight's edge color comes from its audio section's kind; chart difficulty comes from its loudness relative to the song's peak.
5. **Chart generation.** A small vocabulary of hand-curated 3-gate phrases is concatenated under corner-continuity constraints (no two-slot jumps between phrases) and difficulty caps from §4.

The whole pipeline runs in the browser. Nothing is uploaded.

## Tech

- [Vite 5](https://vitejs.dev/) + TypeScript 5.6 (strict)
- [three.js r170](https://threejs.org/) — merged `BufferGeometry` for the corridor, fat-line `LineSegments2` for edges
- Web Audio API + [Essentia.js](https://essentia.upf.edu/essentiajs.html) (WASM, in a Web Worker)
- [Playwright](https://playwright.dev/) for headless visual + integration checks (no test runner — each `tools/*.mjs` is a direct-run Node script)

## Project status

Working through 10 milestones from the [design plan](docs/hellorun2-plan.md) §7:

- **M1–M7 complete.** Cube-tunnel whitebox, forward motion, vertical input, gates + collision, 90° turns, audio-clock-driven motion, procedural charts.
- **M8 essentially done.** BPM detection, BYOM, section analysis, persistent cache.
- **M9 essentially done.** Rolling corridor, section-driven density and palette, RMB-continue.
- **M10 not started.** Bloom, beat pulse, corridor pruning, end-screen polish.

Per-substep detail in [`docs/milestone-status.md`](docs/milestone-status.md).

## Documentation

- [`docs/hellorun2-plan.md`](docs/hellorun2-plan.md) — the design spec. Authoritative for gameplay invariants.
- [`docs/inspiration.md`](docs/inspiration.md) — design DNA: HelloRun (2013), Star Wars Arcade (1983) trench run, Super Hexagon.
- [`docs/architecture.md`](docs/architecture.md) — how the code is organized: path model, state machine, audio pipeline, chart system.
- [`docs/dev-tools.md`](docs/dev-tools.md) — npm scripts, Playwright tools, URL params, dev hooks.
- [`docs/gotchas.md`](docs/gotchas.md) — non-obvious pitfalls (WebGL, audio, Playwright) with fixes.
- [`CLAUDE.md`](CLAUDE.md) — guidance for future Claude Code sessions on this repo.

## License

Source: MIT (see [`LICENSE`](LICENSE) if present, else implied by this README pending finalization).

The bundled `testpattern` font in `public/fonts/` is a bespoke pixel font drawn for this project; no third-party license obligations. See [`public/README.md`](public/README.md).
