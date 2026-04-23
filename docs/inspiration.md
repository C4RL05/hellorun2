# Inspiration & References

The design DNA behind HelloRun 2. Read this when you want to understand *why* a gameplay invariant exists — the [plan](hellorun2-plan.md) says what the rules are; this doc says where they came from.

Three lineages feed the design. Each contributes a distinct strand.

## 1. HelloRun (2013) — the direct ancestor

- **Link**: https://helloenjoy.itch.io/hellorun
- **Relation**: HelloRun 2 is a deliberate reimagining of the original HelloEnjoy project. Same core verb (auto-forward first-person runner), same aesthetic family (stark vector-adjacent visuals), same BYOM music-as-level premise.

**What we keep from HelloRun:**
- First-person, auto-forward. The player never controls throttle or steering.
- A run is bounded by a song. The song *is* the level; when it ends, the run ends.
- Minimalist UI. No HUD, no meters, no tutorial text — the corridor communicates everything.
- Music-reactive visuals as a free aesthetic layer on top of gameplay.

**What HelloRun 2 changes:**
- The corridor is now **built from straights + 90° turns**, not a single endless tube. Turns create the "hard reveal" memorization beat (plan §2) that HelloRun's continuous corridor did not have.
- Vertical-only movement between 3 gate slots, versus HelloRun's different movement vocabulary. This narrows the input surface to a single analog axis — the Super Hexagon lesson (below).
- Procedural chart generation is driven by **analyzed song structure** (sections, BPM, energy), not just beat pulses. Gates fall on beats; density and palette shift on detected section boundaries.

## 2. Star Wars Arcade (1983) — the trench run

- **Reference**: Atari's 1983 vector-graphics *Star Wars* arcade cabinet, specifically the Death Star trench run final phase.
- **Why it matters**: The trench run is the canonical first-person on-rails corridor with obstacles. Everything about HelloRun 2's camera framing and gate vocabulary is downstream of it.

**What we inherit:**
- **Vector aesthetic.** Solid dark geometry, bright glowing edges. Our Tron-Recognizer palette (plan §5) is the same visual family — filled faces with emissive edges on a dedicated bloom layer, not transparent wireframe.
- **Corridor as the only space.** The world is a channel. There is no "outside the track" — off-path doesn't exist as a concept, which removes a whole category of input ambiguity.
- **Obstacles as timing puzzles, not navigation puzzles.** A barrier in the trench run is read, dodged, forgotten. That's exactly how a gate works here: a single binary "which slot" decision per beat.
- **The forward-motion camera teaches the player to read shapes, not positions.** By the time an obstacle is close enough to see clearly, it's too late to plan — you had to recognize the pattern at distance. This is the entire justification for the plan §2 "hard reveal" rule: you memorize a straight as one gestalt shape the moment you come out of a turn.

**What we don't take:** the shooting. HelloRun 2 is dodging-only. Adding an offensive verb would break the "single analog input, no other decisions" constraint we inherit from Super Hexagon.

## 3. Super Hexagon (2012) — the reflex loop

- **Reference**: Terry Cavanagh's *Super Hexagon*.
- **Why it matters**: It's the cleanest example in the medium of a music-driven, reflex-only, fail-and-retry game loop. It proves how much depth you can extract from a single-axis input plus escalating pattern vocabulary.

**What we inherit:**
- **One input, one decision per beat.** Our player has vertical position only; the single "which slot" choice arrives on every beat. No combo system, no meter management, no resource to spend — just read, move, survive.
- **One-hit death → instant retry.** A run is short, a death is cheap, and the player's only currency is pattern familiarity. This is why plan §1 locks in "gates kill on contact, no health, no HUD" — adding health would dilute the read-and-react feedback loop that makes runs feel sharp.
- **Patterns are the content.** Super Hexagon's ~25 named patterns map to our "phrase vocabulary" (plan §2: ~15–20 meaningfully distinct vertical shape paths through a straight). The generator draws from a hand-curated set, not random noise, because recognizability is what makes the game teachable.
- **Music is the clock, not the decoration.** Beats *are* the grid the game is sampled on. A gate on a beat you can hear lets the ear pre-load the eye.

**What we don't take:** the rotating frame. Super Hexagon spins the world around the player; plan §1 explicitly fixes the vertical reference frame ("Player's vertical reference frame never changes"). Rotation would conflict with the trench-run camera that the Star Wars lineage commits us to.

## How the three lineages compose

| Strand | Contributes |
|---|---|
| HelloRun (2013) | Project continuity: auto-forward FP runner, BYOM, song=level, music-reactive visuals |
| Star Wars Arcade (1983) | Camera framing, vector aesthetic, corridor-only world, read-shapes-at-distance |
| Super Hexagon (2012) | Single-axis input, one-hit death, pattern vocabulary as content, music-as-clock |

These are not alternatives — each owns a different layer of the design. When a proposed feature would violate the spirit of one of the three, that's the signal to push back. Examples:

- "Let's add a dash ability" → breaks the Super Hexagon constraint (one input, one decision).
- "Let's let the player see around the corner" → breaks the Star Wars constraint (read-at-distance, hard reveal).
- "Let's stream the audio from a service" → breaks the HelloRun constraint (BYOM, no server).

## Related, not direct

Worth acknowledging as family but not in the primary DNA:

- **Tron (1982)** — visual reference only, captured in plan §5. Not a gameplay ancestor.
- **Audiosurf, Beat Saber, Thumper** — same BYOM-or-rhythm-runner genre, but each makes different constraint choices. We cite them for context, not for inheritance.
- **F-Zero / WipEout** — first-person auto-forward corridors, but steering-heavy; the opposite end of the input-complexity axis from where we live.
