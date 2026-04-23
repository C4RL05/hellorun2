# Game Over — "Rewind Camera" + "Vinyl Stop" Audio

Two small effects that, combined, make a game-over feel physical:

1. **Rewind camera** — when the run ends, the view drifts *backward* along the track with an initial recoil and a slow residual drift.
2. **Vinyl stop** — the music slows down in both tempo and pitch, like a turntable losing power, before cutting out.

Both are implemented in ~20 lines of code each. The trick in both cases is to reuse a parameter that something else already depends on every frame (a spline parameter `t` for the camera; `AudioBufferSourceNode.playbackRate` for the audio) and just ramp it. No dedicated "game over animation" system is needed.

---

## 1. Rewind Camera (negative spline speed)

### Premise

The camera normally follows a precomputed spline through the world. Its position is a pure function of a normalized parameter `t ∈ [0, 1)`, and during gameplay some controller advances `t` forward each frame:

```js
// During gameplay:
t += speed * deltaTime;
camera.position = spline.sample(t);
```

Because `spline.sample(t)` is a pure function of `t`, nothing in the sampling path cares which *direction* `t` is moving. Moving `t` backward just samples earlier points on the curve — free reverse playback.

### Implementation

On game over, hand control of `t` to an idle/attract controller that does three things:

```js
onGameOver() {
    this.t           = race.t;   // pick up exactly where the run ended
    this.speed       = -0.1;     // initial backward kick
    this.targetSpeed = -0.02;    // slow residual backward drift
}

update(deltaTime) {
    const ease = this.ease * deltaTime;            // e.g. this.ease = 1

    // 1. Integrate signed speed into t
    this.t += this.speed * deltaTime;

    // 2. Exponentially ease speed toward target
    this.speed -= (this.speed - this.targetSpeed) * ease;

    // 3. Wrap into [0, 1) — works for negatives thanks to floor()
    this.t -= Math.floor(this.t);

    // 4. Re-sample the spline
    spline.tween(this.camera, this.t);
}
```

### Why it feels right

- **Starting from `race.t`** (not zero, not a fixed point) means the camera pulls back *from the exact spot the player died*. There is no teleport.
- **Two-value speed profile**: a fast initial recoil (`-0.1`) reads as "being thrown back", then the exponential ease settles to a slow ambient drift (`-0.02`) that keeps the idle scene alive. One constant would either recoil too long or not at all.
- **First-order ease** `v -= (v - vTarget) * ease` is frame-rate independent as long as `ease * deltaTime` stays small (< ~0.5). For large `deltaTime` steps, prefer `v = lerp(v, vTarget, 1 - Math.exp(-k * deltaTime))` for true frame-rate independence.
- **`Math.floor()` wrap** handles negative `t` correctly in JS: `-0.05 - Math.floor(-0.05) = -0.05 - (-1) = 0.95`. A plain `t % 1` would return `-0.05` and break the spline sampler if it expects `[0, 1)`.

### Tuning guide

| Param           | Typical value | Effect                                              |
| --------------- | ------------- | --------------------------------------------------- |
| `speed` (init)  | `-0.1`        | Strength of the initial backward kick               |
| `targetSpeed`   | `-0.02`       | Ambient idle drift speed and direction              |
| `ease`          | `1.0`         | How quickly the recoil decays into the drift        |

Sign the speeds however the spline sampler is oriented — negative "backward" is only a convention.

---

## 2. Vinyl Stop (ramping `playbackRate`)

### Premise

The Web Audio API's `AudioBufferSourceNode` has a `playbackRate` AudioParam that scales playback **without time-stretching**. Reduce it and both tempo *and* pitch drop together — which is physically what a turntable does when the motor cuts. This is the opposite of most "slowdown" DSP (which tries to preserve pitch); here we want the pitch drop.

### Implementation

Grab the `playbackRate` AudioParam once at startup and keep a direct reference:

```js
// At start:
const source = howl._audioNode[0];              // if using Howler; otherwise your source node
this.playbackRate = source.bufferSource.playbackRate;
this.playbackRate.value = 1;                    // normal speed

this.musicOff = false;
```

On game over, do **not** call `source.stop()` immediately. Instead set a flag, and let the per-frame update ramp the rate down:

```js
onGameOver() {
    this.musicOff = true;   // start the vinyl slowdown
}

update(deltaTime) {
    if (!this.musicOff) return;

    const next = this.playbackRate.value - deltaTime;  // linear ramp, ~1s from full speed to stop

    if (next < 0.01) {
        source.stop();       // finally cut the source — almost silent by now
        this.musicOff = false;
    } else {
        this.playbackRate.value = next;
    }
}
```

### Why it feels right

- **Tempo and pitch drop together.** This is the key difference from a volume fade or a tempo-preserving time-stretch — neither sounds like a dying turntable. Pitch-locked slowdown sounds like a DJ; rate-based slowdown sounds like power loss.
- **Linear ramp of `deltaTime`.** Per second, the rate drops by 1.0, so a full-speed track reaches zero in ~1s. If you want a longer slowdown, multiply: `next = value - deltaTime * 0.5` for 2s, etc.
- **Cut at `< 0.01`, not at `0`.** At extremely low rates the source is nearly inaudible and can produce clicks or DC offset; cutting slightly above zero keeps the stop clean.
- **Set the flag, don't stop immediately.** The stop is a two-phase state machine: *slowing* then *stopped*. Stopping the source up-front would skip the whole effect.

### Using with Howler.js

Howler wraps Web Audio, so reach under the abstraction once to get the raw node:

```js
const howl = new Howl({ src: ['music.mp3'], html5: false });  // html5: false is required
howl.play();

// After play(), the bufferSource exists:
const source = howl._audioNode[0];
const playbackRate = source.bufferSource.playbackRate;
```

Caveats:
- `_audioNode` is a private Howler field and may change between major versions. If you upgrade Howler, verify it still exists or pin the version.
- `html5: false` (the default for short buffered sounds) is required — HTML5 audio mode does not expose a `bufferSource`.
- `AudioBufferSourceNode` is single-use. After calling `.stop()`, replay requires a new source — Howler handles this on the next `.play()` but your cached `playbackRate` reference becomes stale. Re-grab it on every start.

### Plain Web Audio (no Howler)

```js
const ctx    = new AudioContext();
const buffer = await fetch('music.mp3').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b));

let source, playbackRate;

function play() {
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    playbackRate = source.playbackRate;   // AudioParam
    source.start();
}

function onGameOver() { musicOff = true; }

function update(deltaTime) {
    if (!musicOff) return;
    const next = playbackRate.value - deltaTime;
    if (next < 0.01) { source.stop(); musicOff = false; }
    else             { playbackRate.value = next; }
}
```

### Alternative: AudioParam automation

Instead of mutating `playbackRate.value` each frame, you can schedule the ramp with the Web Audio scheduler:

```js
playbackRate.setValueAtTime(playbackRate.value, ctx.currentTime);
playbackRate.linearRampToValueAtTime(0.01, ctx.currentTime + 1.0);
setTimeout(() => source.stop(), 1000);
```

Trade-offs:
- **Pro:** runs on the audio thread, jitter-free even if the render thread stutters.
- **Con:** you lose per-frame control — cannot vary the ramp shape based on gameplay state once scheduled. The manual ramp is preferable when the slowdown curve needs to react to something (e.g. boss hit intensity, player distance from explosion).

### Tuning guide

| Param                    | Typical value    | Effect                                        |
| ------------------------ | ---------------- | --------------------------------------------- |
| `deltaTime` multiplier   | `1.0`            | ~1 second total slowdown                      |
|                          | `0.5`            | ~2 second slowdown (more "tired" feel)        |
|                          | `2.0`            | ~0.5 second (snappy, more "glitch" feel)      |
| Cut threshold            | `0.01`           | Below this the source is stopped              |
| Initial `playbackRate`   | `1.0`            | Normal speed (higher is also legal)           |

---

## Combining them

Fire both on the same `onGameOver` event. They run on independent data and have no shared state, so they compose naturally:

```js
onGameOver() {
    camera.startRewind();    // Effect 1
    music.startVinylStop();  // Effect 2
    // + whatever scoring / UI logic
}
```

Because the camera rewind settles into a persistent slow drift and the audio slowdown terminates itself after ~1s, the scene transitions smoothly into its idle/menu state without needing an explicit "done" callback from either effect.

---

## Summary — what to copy

- A spline-driven camera can rewind for free by letting a controller push a **signed speed** into its spline parameter `t`. Use `Math.floor()` to wrap, not `%`.
- A Web Audio buffer source slows down like a vinyl record when you **ramp `playbackRate` down linearly** over ~1 second, then stop when it gets below a small threshold. The pitch drop is the feature, not a bug — don't use a pitch-preserving time-stretch for this.
- Both effects replace a "stop immediately" action with a **two-phase state machine** (running → winding-down → stopped), driven each frame by the existing update loop.
