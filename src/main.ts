import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { checkCollision, slotForY } from "./collision";
import type { Gate } from "./collision";
import { DebugView } from "./debug-view";
import type { DebugBbox } from "./debug-view";
import type { BarrierInfo } from "./scene/gates";
import {
  BEAT_LENGTH,
  BAR_LENGTH,
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CELL,
  COLOR_BACKGROUND,
  COLOR_EDGE,
  FIRST_GATE_Z,
  FORWARD_SPEED,
  GATE_COUNT,
  GATE_SPACING,
  MARKER_BAR_COLOR,
  MARKER_BAR_SIZE,
  MARKER_BEAT_COLOR,
  MARKER_BEAT_SIZE,
  MARKER_PHRASE_COLOR,
  MARKER_PHRASE_SIZE,
  MARKER_PERIOD_COLOR,
  MARKER_PERIOD_SIZE,
  PERIOD_LENGTH,
  PHRASE_LENGTH,
  SECTION_EDGE_PALETTE,
  TURN_ARC_LENGTH,
  TURN_RADIUS,
  forwardSpeedForBpm,
} from "./constants";
import {
  STRAIGHT_LENGTH,
  samplePath,
  nextStraightAfter,
  nextTurnAfter,
} from "./corridor";
import type { Section } from "./corridor";
import { analyzeAudio } from "./audio-analysis/analyzer";
import type {
  Section as AudioSection,
  SongAnalysis,
} from "./audio-analysis/analyzer";
import {
  clearAnalysisCache,
  getCachedAnalysis,
  hashArrayBuffer,
  setCachedAnalysis,
} from "./audio-analysis/cache";
import { generateChart, mulberry32 } from "./chart";
import { PlayerController } from "./player";
import { createGates } from "./scene/gates";
import { createMarker, updateMarkerResolution } from "./scene/markers";
import { createTunnel } from "./scene/tunnel";
import { WaveformOverlay } from "./waveform";
import { devSong } from "./songs";

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(COLOR_BACKGROUND);
// Debug overlay renders as a second pass into a scissored viewport, so
// the main render must not auto-clear between the two.
renderer.autoClear = false;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  CAMERA_NEAR,
  CAMERA_FAR,
);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
keyLight.position.set(1, 2, 1);
scene.add(keyLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.08));

const edgeMaterials: LineMaterial[] = [];

// Rolling corridor: straights and turns are appended to `sections` as the
// camera advances. Each straight section owns a matching StraightObj
// (scene group + gates + barriers) at the same index in `straightObjects`;
// turns push null there so parallel indexing into `sections[]` stays
// branch-free in the hot path.
interface StraightObj {
  readonly group: THREE.Object3D;
  readonly gates: readonly Gate[];
  readonly openSlots: readonly number[];
  readonly barriers: readonly BarrierInfo[];
  readonly cubeTransforms: readonly THREE.Matrix4[];
  // Tunnel-edge LineMaterial only — barrier edges (gates.edgeMaterial)
  // stay the fixed danger color (plan §5). Held separately so palette
  // shifts on section-kind changes can recolor the tunnel without
  // touching barrier color, and so retroactive recoloring after analysis
  // lands knows which material to mutate.
  readonly tunnelEdgeMaterial: LineMaterial;
}

const sections: Section[] = [];
const straightObjects: (StraightObj | null)[] = [];
const chart: number[] = [];
let prevEndSlot: number | null = null;

// PRNG for chart generation. Seeded via ?seed=N for deterministic tests;
// otherwise Math.random. Reused across sections so the whole run is one
// reproducible sequence under a fixed seed.
const urlParams = new URL(window.location.href).searchParams;
const seedParam = urlParams.get("seed");
const chartRand =
  seedParam !== null ? mulberry32(parseInt(seedParam, 10) || 0) : Math.random;

// Developer-mode flag. Gates the keyboard shortcuts for pause (Space),
// marker toggle (B), debug overlay (M), and invincibility (I) — these are
// playtest / debug tools, not gameplay. Always on in dev builds; in a
// production build, opt in with `?dev` in the URL.
const devMode = import.meta.env.DEV || urlParams.has("dev");

const COLOR_STRAIGHT_BOX = 0xffff00;
const COLOR_BARRIER_BOX = 0xff6060;
const COLOR_CUBE_BOX = 0x303030;

// Shared geometry for per-cube OBB lines. Cheap: compute the cube's edge
// segments once, then clone + transform per cube when building a section's
// debug visual. Lives outside the function so the BoxGeometry / EdgesGeometry
// aren't rebuilt per section.
const CUBE_EDGES = new THREE.EdgesGeometry(
  new THREE.BoxGeometry(CELL, CELL, CELL),
  40,
);

function buildStraightObj(
  openSlots: readonly number[],
  name: string,
  edgeColor: number,
): StraightObj {
  const tunnel = createTunnel();
  tunnel.edgeMaterial.color.setHex(edgeColor);
  const gates = createGates(openSlots);
  edgeMaterials.push(tunnel.edgeMaterial, gates.edgeMaterial);
  const group = new THREE.Group();
  group.name = name;
  group.add(tunnel.object);
  group.add(gates.object);
  return {
    group,
    gates: gates.data,
    openSlots,
    barriers: gates.barriers,
    cubeTransforms: tunnel.cubeTransforms,
    tunnelEdgeMaterial: tunnel.edgeMaterial,
  };
}

// Maps a corridor pathS to the audio Section that covers the same moment
// of the song. pathS=0 corresponds to beat 1 (gridOffsetSec into the
// audio file), so songTime = pathS / forwardSpeed + gridOffsetSec. Returns
// null when no analysis has landed yet, or the last section when pathS
// runs past song-end (long corridor / late seek). Same-kind contiguous
// sections naturally collapse downstream because callers key on
// `Section.kind`, so we don't need a separate musicalSections[] coalescer.
function audioSectionForPathS(s: number): AudioSection | null {
  if (!songAnalysis) return null;
  const songTime = s / currentForwardSpeed + currentGridOffsetSec;
  const secPerBeat = 60 / songAnalysis.bpm;
  const secs = songAnalysis.sections;
  for (const sec of secs) {
    const endSec = sec.startSec + sec.beatLength * secPerBeat;
    if (songTime < endSec) {
      return songTime >= sec.startSec ? sec : null;
    }
  }
  return secs.length > 0 ? secs[secs.length - 1] : null;
}

// Loudness → maxDifficulty bucket. Quiet sections (breakdowns, intros)
// get easy phrases; loudest sections unlock the bouncy D=4 stuff. Linear
// quartiles relative to the song's own peak loudness — keeps difficulty
// distribution stable across songs with different absolute loudness.
function maxDifficultyForSection(audioSection: AudioSection | null): number {
  if (!audioSection || songMaxLoudness <= 0) return 4;
  const t = audioSection.avgLoudness / songMaxLoudness;
  return Math.min(4, Math.max(1, 1 + Math.floor(t * 4)));
}

function edgeColorForSection(audioSection: AudioSection | null): number {
  if (!audioSection) return COLOR_EDGE;
  return SECTION_EDGE_PALETTE[audioSection.kind % SECTION_EDGE_PALETTE.length];
}

// Mounts a section into the scene and keeps `sections` / `straightObjects`
// index-aligned. Straights also build geometry, extend the running chart,
// and (if debugView is already up) register debug bboxes.
function appendSection(section: Section): void {
  sections.push(section);
  if (section.kind !== "straight") {
    straightObjects.push(null);
    return;
  }
  const audioSec = audioSectionForPathS(section.pathStart);
  const openSlots = generateChart(GATE_COUNT, {
    rand: chartRand,
    prevEndSlot: prevEndSlot ?? undefined,
    maxDifficulty: maxDifficultyForSection(audioSec),
  });
  prevEndSlot = openSlots[openSlots.length - 1];
  chart.push(...openSlots);
  const idx = straightObjects.length;
  const obj = buildStraightObj(
    openSlots,
    `straight-${idx}`,
    edgeColorForSection(audioSec),
  );
  obj.group.position.copy(section.position);
  obj.group.rotation.y = section.yaw;
  scene.add(obj.group);
  obj.group.updateMatrixWorld(true);
  straightObjects.push(obj);
  if (debugView) registerStraightDebugHelpers(obj);
}

// Walk every already-built straight and re-set its tunnel edge color from
// the now-available analysis. The first 1–2 straights get built before
// analysis lands (boot lookahead), so without this they'd stay the
// default cyan even if their audio section is a different kind. Density
// is NOT recomputed retroactively — gates are baked geometry and the
// player will be at pathS=0 anyway, so default difficulty=4 on those
// initial straights is acceptable.
function recolorStraightsFromAnalysis(): void {
  for (let i = 0; i < straightObjects.length; i++) {
    const obj = straightObjects[i];
    const sec = sections[i];
    if (!obj || !sec || sec.kind !== "straight") continue;
    const audioSec = audioSectionForPathS(sec.pathStart);
    obj.tunnelEdgeMaterial.color.setHex(edgeColorForSection(audioSec));
  }
}

function registerStraightDebugHelpers(obj: StraightObj): void {
  const bboxes: DebugBbox[] = [
    { box: new THREE.Box3().setFromObject(obj.group), color: COLOR_STRAIGHT_BOX },
  ];
  for (const b of obj.barriers) {
    const box = new THREE.Box3().setFromCenterAndSize(b.localCenter, b.size);
    box.applyMatrix4(obj.group.matrixWorld);
    bboxes.push({ box, color: COLOR_BARRIER_BOX });
  }
  debugView.addBboxes(bboxes);
  scene.add(buildCubeOBBLines(obj));
}

// Per-cube oriented bboxes merged into one LineSegments per section. Each
// cube's full local transform (translation + ±CUBE_JITTER_DEG rotation) is
// composed with the straight's world matrix so the OBBs match the rendered
// jitter. Layer 1 only — the main game camera never sees these.
function buildCubeOBBLines(obj: StraightObj): THREE.LineSegments {
  const geoms: THREE.BufferGeometry[] = [];
  const worldMatrix = new THREE.Matrix4();
  for (const localMat of obj.cubeTransforms) {
    worldMatrix.multiplyMatrices(obj.group.matrixWorld, localMat);
    geoms.push(CUBE_EDGES.clone().applyMatrix4(worldMatrix));
  }
  const merged = mergeGeometries(geoms, false);
  if (!merged) throw new Error("Failed to merge cube bbox geometry");
  for (const g of geoms) g.dispose();
  const lines = new THREE.LineSegments(
    merged,
    new THREE.LineBasicMaterial({ color: COLOR_CUBE_BOX }),
  );
  lines.layers.set(1);
  return lines;
}

// How far ahead of the camera to keep sections materialized. Covers
// current straight + turn + next straight + slack (40+5+40+35=120) so
// the next straight is always fully built before the camera can see it.
const SECTION_LOOKAHEAD = 120;

// Alternates straight → turn → straight → turn from the first section.
// Turns alternate right/left so the corridor zig-zags rather than closing
// into a 4-section square (four all-right turns of the same radius sum to
// a perfect loop and overlap prior geometry — visible as z-fighting in
// the tunnel walls when the player reaches pathS ≈ 4 × (straight+turn)).
let turnsBuilt = 0;
function ensureSectionsAhead(pathS: number): void {
  while (true) {
    const last = sections[sections.length - 1];
    if (last && last.pathStart + last.length >= pathS + SECTION_LOOKAHEAD) return;
    if (!last) {
      appendSection({
        kind: "straight",
        pathStart: 0,
        length: STRAIGHT_LENGTH,
        position: new THREE.Vector3(0, 0, 0),
        yaw: 0,
      });
      continue;
    }
    if (last.kind === "straight") {
      const direction = turnsBuilt % 2 === 0 ? 1 : -1;
      turnsBuilt++;
      appendSection(nextTurnAfter(last, direction));
    } else {
      appendSection(nextStraightAfter(last));
    }
  }
}

// Musical-structure markers. Each type advances its own index independently
// so the placement sequence is O(ΔpathS / interval) per call — bounded and
// cheap. Start indices at 1 so pathS=0 (camera spawn, inside the marker
// plane) isn't generated; the first visible beat marker is at pathS =
// BEAT_LENGTH.
let nextBeatIdx = 1;
let nextBarIdx = 1;
let nextPhraseIdx = 1;
let nextPeriodIdx = 1;

// All musical-structure markers (beat/bar/phrase/period) are toggleable
// with B and start disabled. They're a debug/playtest aid — the gate
// cadence already tells the player what the beat is — so they're opt-in.
let markersVisible = false;
const markers: THREE.Object3D[] = [];

function placeMarkersUpTo(maxPathS: number): void {
  placeOneKind(maxPathS, BEAT_LENGTH, MARKER_BEAT_SIZE, MARKER_BEAT_COLOR, () => nextBeatIdx, (n) => { nextBeatIdx = n; });
  placeOneKind(maxPathS, BAR_LENGTH, MARKER_BAR_SIZE, MARKER_BAR_COLOR, () => nextBarIdx, (n) => { nextBarIdx = n; });
  placeOneKind(maxPathS, PHRASE_LENGTH, MARKER_PHRASE_SIZE, MARKER_PHRASE_COLOR, () => nextPhraseIdx, (n) => { nextPhraseIdx = n; });
  placeOneKind(maxPathS, PERIOD_LENGTH, MARKER_PERIOD_SIZE, MARKER_PERIOD_COLOR, () => nextPeriodIdx, (n) => { nextPeriodIdx = n; });
}

function placeOneKind(
  maxPathS: number,
  interval: number,
  size: number,
  color: number,
  getIdx: () => number,
  setIdx: (n: number) => void,
): void {
  let i = getIdx();
  while (i * interval <= maxPathS) {
    const s = i * interval;
    const pose = samplePath(sections, s);
    const marker = createMarker(size, color);
    marker.position.copy(pose.pos);
    marker.rotation.y = pose.yaw;
    marker.visible = markersVisible;
    scene.add(marker);
    markers.push(marker);
    i++;
  }
  setIdx(i);
}

function toggleMarkers(): void {
  markersVisible = !markersVisible;
  for (const m of markers) m.visible = markersVisible;
}

const syncResolution = () => {
  for (const mat of edgeMaterials) {
    mat.resolution.set(window.innerWidth, window.innerHeight);
  }
  updateMarkerResolution(window.innerWidth, window.innerHeight);
};

addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncResolution();
});

const clock = new THREE.Clock();
const player = new PlayerController(canvas);

// DebugView is created empty; sections register their bboxes as they are
// appended (see registerStraightDebugHelpers). Per-cube OBB lines were a
// static-only visual and have been dropped — they would need re-merging
// every time a new section is generated and weren't worth the complexity.
const debugView = new DebugView(scene, canvas, [], { enabled: devMode });

// Audio-derived state must be declared before the first ensureSectionsAhead
// call below, because appendSection's audioSectionForPathS lookup reads
// these in the boot path. Until analysis lands, audioSectionForPathS
// returns null and the helpers fall back to default difficulty + cyan
// edges — same visual as before any analysis-driven theming.
let currentGridOffsetSec = devSong.gridOffsetSec;
let currentForwardSpeed = FORWARD_SPEED;
let songAnalysis: SongAnalysis | null = null;
// Cached max avgLoudness across the song's sections. Used as the
// denominator when bucketing per-section loudness into chart difficulty,
// so the difficulty scale is per-song rather than absolute. 0 until the
// first analysis lands.
let songMaxLoudness = 0;

// Seed the corridor with enough sections to cover the lookahead before the
// first frame renders. ensureSectionsAhead appends straights/turns until
// there's headroom past the given pathS.
ensureSectionsAhead(0);
placeMarkersUpTo(SECTION_LOOKAHEAD);
syncResolution();

const waveform = new WaveformOverlay({ onSeek: seekToWaveformClick });

let dead = false;
let pathS = 0;
let motionScale = 1;
let invincible = false;
// Plan §1: "A run = a song. Game starts when the song starts, ends when
// the song ends (or the player dies)." `running` gates pathS advancement
// so nothing moves until the user clicks the title screen.
let running = false;
// Spacebar-toggled freeze. Audio is stopped and the song position is
// snapshotted into pauseOffsetSec; unpausing creates a fresh
// AudioBufferSourceNode started at that offset and realigns audioStartTime
// so getAudioNow() picks up seamlessly — beat sync survives any number of
// pause/unpause cycles because the offset comes from the audio context's
// sample clock, not wall time.
let paused = false;
let pauseOffsetSec = 0;
// True if audio was actually playing at the moment of pause. Tracks
// whether the unpause branch should recreate an AudioBufferSourceNode or
// just flip the flag — e.g., tests without a user gesture never start
// audio, so unpause must not spontaneously start it.
let pauseHadAudio = false;

// Audio pipeline. Preload on boot; play on user gesture (click).
let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let audioSource: AudioBufferSourceNode | null = null;
// AudioContext.currentTime at which the song's first sample started.
// Subtracting this (and gridOffsetSec) from audioCtx.currentTime gives
// "audio time since beat 1" — the master clock for pathS.
let audioStartTime = 0;
// currentGridOffsetSec / currentForwardSpeed / songAnalysis / songMaxLoudness
// are declared earlier (above ensureSectionsAhead's boot call) — see the
// "Audio-derived state must be declared before…" comment.

const titleOverlay = document.getElementById("title-screen");
const titleSubtitle = titleOverlay?.querySelector(".subtitle") as
  | HTMLElement
  | null;

// Race-safe load: each call increments `analysisGen`; stale callbacks
// check their captured gen against the latest and bail. Dropping a new
// file during a prior analysis correctly supersedes it.
let analysisGen = 0;

// Maps analyzer-worker stage names (technical) to subtitle labels (friendly).
// Stages that go unmapped fall through to the raw worker name.
const STAGE_LABELS: Record<string, string> = {
  loading: "loading analyzer",
  loaded: "analyzer ready",
  rhythm: "detecting beats",
  percival: "verifying tempo",
  consensus: "finalizing",
};

async function loadAndAnalyzeSource(
  source: File | string,
  label: string,
): Promise<void> {
  const gen = ++analysisGen;
  if (!audioCtx) audioCtx = new AudioContext();

  const setSubtitle = (text: string) => {
    if (gen === analysisGen && titleSubtitle) titleSubtitle.textContent = text;
  };

  try {
    setSubtitle(`loading ${label}…`);
    const arr =
      source instanceof File
        ? await source.arrayBuffer()
        : await (await fetch(source)).arrayBuffer();
    if (gen !== analysisGen) return;

    // Hash before decode — decodeAudioData detaches the ArrayBuffer in
    // Chromium, after which the bytes are unreadable.
    const hash = await hashArrayBuffer(arr);
    if (gen !== analysisGen) return;
    const cached = getCachedAnalysis(hash);

    // Tear down any prior audio source playing the old buffer, so the
    // replacement isn't mixed with leftover audio.
    stopAudio();
    audioBuffer = await audioCtx.decodeAudioData(arr);
    if (gen !== analysisGen) return;
    waveform.setAudioBuffer(audioBuffer);
    songAnalysis = null;

    let result: SongAnalysis;
    if (cached) {
      console.log(`analysis cache hit for ${label} (${hash.slice(0, 8)}…)`);
      setSubtitle("loaded from cache");
      result = cached;
    } else {
      // The worker's beat-detection and tempo-verification steps are single
      // synchronous WASM calls that can run for tens of seconds; no progress
      // messages fire during them. Tick elapsed time on the main thread so
      // the subtitle keeps moving even while the worker is WASM-bound.
      const analysisStart = performance.now();
      let stage = "starting";
      const renderTick = () => {
        const elapsed = Math.round((performance.now() - analysisStart) / 1000);
        setSubtitle(`analyzing audio — ${stage} (${elapsed}s)`);
      };
      renderTick();
      const tickInterval = setInterval(renderTick, 250);
      try {
        result = await analyzeAudio(audioBuffer, (p) => {
          stage = STAGE_LABELS[p.stage] ?? p.stage;
          renderTick();
        });
      } finally {
        clearInterval(tickInterval);
      }
      if (gen !== analysisGen) return;
      setCachedAnalysis(hash, result);
    }
    if (gen !== analysisGen) return;
    songAnalysis = result;
    currentGridOffsetSec = result.gridOffsetSec;
    currentForwardSpeed = forwardSpeedForBpm(result.bpm);
    songMaxLoudness = result.sections.reduce(
      (m, s) => Math.max(m, s.avgLoudness),
      0,
    );
    recolorStraightsFromAnalysis();
    waveform.setSongStructure(result.bpm, result.gridOffsetSec, result.sections);
    console.log(
      `analyzed ${label}: bpm=${result.bpm.toFixed(2)}, ` +
        `forwardSpeed=${currentForwardSpeed.toFixed(2)} u/s, ` +
        `gridOffsetSec=${result.gridOffsetSec.toFixed(3)}, ` +
        `confidence=${result.confidence.toFixed(2)}, ` +
        `beats=${result.beats.length}`,
    );
    setSubtitle("click to start");
  } catch (err) {
    if (gen !== analysisGen) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`failed to load ${label}:`, err);
    setSubtitle(`failed — drop an mp3 to try again (${msg})`);
  }
}

function startAudio(): void {
  if (!audioCtx || !audioBuffer) return;
  // Autoplay policy: AudioContext may start suspended; resume inside the
  // user-gesture call chain.
  void audioCtx.resume();
  audioSource = audioCtx.createBufferSource();
  audioSource.buffer = audioBuffer;
  audioSource.connect(audioCtx.destination);
  audioSource.onended = () => {
    running = false;
  };
  audioStartTime = audioCtx.currentTime;
  audioSource.start();
}

// Seconds since beat 1 of the song (negative during the intro if
// currentGridOffsetSec > 0). Returns null if no audio is actively playing
// — callers should fall back to wall-clock advance in that case.
function getAudioNow(): number | null {
  if (!audioCtx || !audioSource) return null;
  if (audioCtx.state !== "running") return null;
  return audioCtx.currentTime - audioStartTime - currentGridOffsetSec;
}

// Raw playback position in seconds from sample 0 of the audio file.
// Used for the waveform playhead. While paused, returns the saved offset.
// While not playing (title screen, dead, no audio loaded), returns 0.
function getSongTimeSec(): number {
  if (paused) return pauseOffsetSec;
  if (!audioCtx || !audioSource) return 0;
  if (audioCtx.state !== "running") return 0;
  return Math.max(0, audioCtx.currentTime - audioStartTime);
}

function stopAudio(): void {
  if (!audioSource) return;
  // Null the handler first so the manual stop() doesn't flip running=false.
  // running is managed by the caller (respawn keeps it true; collision
  // leaves it true because the `if (running && !dead)` guard already
  // freezes pathS).
  audioSource.onended = null;
  try {
    audioSource.stop();
  } catch {
    // stop() throws if the source hasn't started; safe to ignore.
  }
  audioSource.disconnect();
  audioSource = null;
}

function startGame(): void {
  if (running) return;
  paused = false;
  startAudio();
  running = true;
  titleOverlay?.classList.add("hidden");
}

// Spacebar toggle. Pause stops the current AudioBufferSourceNode (it's
// one-shot; can't resume) and snapshots the song position via the audio
// context's sample clock. Unpause creates a fresh source started at that
// offset and realigns audioStartTime so getAudioNow() is continuous —
// beat sync is preserved across arbitrary pause/unpause cycles. When no
// audio is active (e.g., headless tests without a user gesture), toggle
// just flips the `paused` flag; the animation loop's `!paused` guard
// freezes pathS in wall-clock fallback mode too.
function togglePause(): void {
  if (!running || dead) return;
  if (paused) {
    paused = false;
    if (pauseHadAudio && audioCtx && audioBuffer) {
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.connect(audioCtx.destination);
      audioSource.onended = () => {
        running = false;
      };
      audioStartTime = audioCtx.currentTime - pauseOffsetSec;
      audioSource.start(0, pauseOffsetSec);
    }
  } else {
    pauseHadAudio = false;
    if (audioCtx && audioSource) {
      pauseOffsetSec = audioCtx.currentTime - audioStartTime;
      pauseHadAudio = true;
    }
    stopAudio();
    paused = true;
  }
}

titleOverlay?.addEventListener("click", () => {
  if (audioBuffer) startGame();
});

// Dev menu (Tab toggle, dev-mode-only). Placeholder action for now —
// later this'll host runtime tunables (cluster threshold, marker sizes,
// section probes, etc).
const devMenu = document.getElementById("dev-menu");
function toggleDevMenu(): void {
  devMenu?.classList.toggle("hidden");
}
// Backdrop click closes the menu. The full-viewport #dev-menu wraps a
// centered .dev-modal child; e.target === devMenu means the click landed
// on the dimmed backdrop (clicks inside the modal bubble up with target
// set to a child element).
devMenu?.addEventListener("click", (e) => {
  if (e.target === devMenu) toggleDevMenu();
});
document.getElementById("dev-clear-cache")?.addEventListener("click", () => {
  const removed = clearAnalysisCache();
  console.log(`cleared ${removed} cached analysis entr${removed === 1 ? "y" : "ies"}`);
});

// Click-on-waveform handler. Maps the click x to a song time, then jumps
// pathS, restarts audio from that offset, and forces play state — works
// the same regardless of whether the game was on title, running, paused,
// or dead. The click itself is a user gesture so audioCtx.resume()
// succeeds even from the title screen.
function seekToSongTime(songTimeSec: number): void {
  if (!audioCtx || !audioBuffer) return;
  const audioNow = songTimeSec - currentGridOffsetSec;
  pathS = Math.max(0, audioNow * currentForwardSpeed);
  ensureSectionsAhead(pathS);
  placeMarkersUpTo(pathS + SECTION_LOOKAHEAD);

  // Snap camera to the new pose. prevWorldPos must update too — without
  // this the next frame's collision check would Z-cross every gate plane
  // between old position and new, triggering a false hit.
  const pose = samplePath(sections, pathS);
  camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
  camera.rotation.y = pose.yaw;
  prevWorldPos.copy(camera.position);

  stopAudio();
  void audioCtx.resume();
  audioSource = audioCtx.createBufferSource();
  audioSource.buffer = audioBuffer;
  audioSource.connect(audioCtx.destination);
  audioSource.onended = () => {
    running = false;
  };
  audioStartTime = audioCtx.currentTime - songTimeSec;
  audioSource.start(0, songTimeSec);

  paused = false;
  pauseHadAudio = true;
  dead = false;
  running = true;
  titleOverlay?.classList.add("hidden");
}

// Page-level defaults: intercept drags anywhere on the window so a
// misaimed drop doesn't navigate the browser to the file URL. The actual
// file handling lives on the drop zone below.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

const dropZone = document.getElementById("drop-zone");
const filePicker = document.getElementById("file-picker") as HTMLInputElement | null;

if (dropZone) {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("drag-over"),
  );
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!isAudioFile(file)) {
      console.warn(`not an audio file: ${file.name} (${file.type})`);
      return;
    }
    void loadAndAnalyzeSource(file, file.name);
  });
  dropZone.addEventListener("click", (e) => {
    e.stopPropagation(); // don't trigger startGame on the title overlay
    filePicker?.click();
  });
}

filePicker?.addEventListener("change", () => {
  const file = filePicker.files?.[0];
  if (file) void loadAndAnalyzeSource(file, file.name);
  filePicker.value = ""; // allow re-selecting the same file
});

function isAudioFile(f: File): boolean {
  return (
    f.type.startsWith("audio/") || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name)
  );
}

// Auto-load the dev song on boot as a dev convenience. Tests depend on
// this so __getSongAnalysis() has something to return. Drop a different
// file to replace.
void loadAndAnalyzeSource(devSong.url, devSong.url.replace(/^\//, ""));

const tmpLocalPrev = new THREE.Vector3();
const tmpLocalCurr = new THREE.Vector3();

interface Hit {
  readonly gate: Gate;
  readonly straight: string;
  readonly playerSlot: number;
}

function collisionAcrossStraights(
  prevWorld: THREE.Vector3,
  currWorld: THREE.Vector3,
): Hit | null {
  for (const s of straightObjects) {
    if (!s) continue;
    tmpLocalPrev.copy(prevWorld);
    s.group.worldToLocal(tmpLocalPrev);
    tmpLocalCurr.copy(currWorld);
    s.group.worldToLocal(tmpLocalCurr);
    const gate = checkCollision(
      tmpLocalCurr.y,
      tmpLocalCurr.z,
      tmpLocalPrev.z,
      s.gates,
    );
    if (gate) {
      return { gate, straight: s.group.name, playerSlot: slotForY(tmpLocalCurr.y) };
    }
  }
  return null;
}

const prevWorldPos = new THREE.Vector3();

// State-only reset: camera, player input, dead flag. Doesn't touch audio,
// the running flag, or the built section geometry (sections remain valid
// across respawn; the player re-enters at pathS=0 = start of section 0).
const resetToSpawn = () => {
  pathS = 0;
  player.reset();
  dead = false;
  const pose = samplePath(sections, 0);
  camera.position.copy(pose.pos);
  camera.rotation.set(0, pose.yaw, 0);
  prevWorldPos.copy(camera.position);
};

// Full user-facing respawn: reset state, rewind the song to its start,
// resume play. Plan §1: "A run = a song" — each respawn is a new run.
const respawn = () => {
  resetToSpawn();
  paused = false;
  if (audioBuffer) {
    stopAudio();
    startAudio();
  }
  running = true;
  titleOverlay?.classList.add("hidden");
};

// Walks the built section list backwards from `targetPathS` looking for
// the most recent turn at or before it. Returns null when no prior turn
// exists (player still in the first straight). Caller should
// ensureSectionsAhead(targetPathS) before invoking, in case the target
// lies past the currently-built corridor.
function previousTurnPathStart(targetPathS: number): number | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];
    if (sec.kind === "turn" && sec.pathStart <= targetPathS) {
      return sec.pathStart;
    }
  }
  return null;
}

// On-death "continue" shortcut (RMB while dead). Jumps back to the start
// of the most recent turn — the corner immediately before the straight
// the player died in — so the brief turn arc gives a couple beats of
// lead-in before gates resume. Falls back to a full respawn if the player
// died in the very first straight (no prior turn yet built).
const continueFromPreviousTurn = () => {
  if (!dead) return;
  const turnPathStart = previousTurnPathStart(pathS);
  if (turnPathStart === null) {
    respawn();
    return;
  }
  const songTime = turnPathStart / currentForwardSpeed + currentGridOffsetSec;
  seekToSongTime(songTime);
};

// Waveform click handler. Snaps the seek target back to the start of the
// turn immediately before the clicked time, so the player gets the turn
// arc as a lead-in instead of being thrown straight into gates with no
// reaction window. Mirrors the RMB-on-death continue behavior; both want
// "land at a corner, fly the arc, then meet gates."
function seekToWaveformClick(songTimeSec: number): void {
  const targetPathS = Math.max(
    0,
    (songTimeSec - currentGridOffsetSec) * currentForwardSpeed,
  );
  // Grow the corridor up to (and a lookahead past) the click target so a
  // turn at-or-before targetPathS is actually built and findable.
  ensureSectionsAhead(targetPathS);
  const turnPathStart = previousTurnPathStart(targetPathS);
  if (turnPathStart === null) {
    seekToSongTime(songTimeSec);
    return;
  }
  const turnSongTime =
    turnPathStart / currentForwardSpeed + currentGridOffsetSec;
  seekToSongTime(turnSongTime);
}

// Quit back to the title screen: stop the song and put game state in the
// same shape as initial page load. Next click resumes the start-flow.
const quitToTitle = () => {
  stopAudio();
  running = false;
  paused = false;
  resetToSpawn();
  titleOverlay?.classList.remove("hidden");
};

// Seed initial pose before the first frame.
resetToSpawn();

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const playerY = player.update(dt);

  prevWorldPos.copy(camera.position);

  if (running && !dead && !paused) {
    if (motionScale === 1) {
      // Real play: audio clock is master. Falls back to wall-clock when
      // no audio is playing yet (e.g., headless tests without a user
      // gesture). pathS is monotonic — no wrap since the corridor now
      // generates sections ahead indefinitely (bounded by song length).
      const audioNow = getAudioNow();
      if (audioNow !== null) {
        pathS = Math.max(0, audioNow * currentForwardSpeed);
      } else {
        pathS += currentForwardSpeed * dt;
      }
    } else {
      // Scaled test mode: wall-clock advance with the scale factor.
      // motionScale=0 freezes motion entirely.
      pathS += currentForwardSpeed * motionScale * dt;
    }
    ensureSectionsAhead(pathS);
    placeMarkersUpTo(pathS + SECTION_LOOKAHEAD);
  }

  const pose = samplePath(sections, pathS);
  camera.position.set(pose.pos.x, pose.pos.y + playerY, pose.pos.z);
  camera.rotation.y = pose.yaw;

  if (!dead && !invincible) {
    const hit = collisionAcrossStraights(prevWorldPos, camera.position);
    if (hit) {
      dead = true;
      stopAudio();
      console.log(
        `GAME OVER — ${hit.straight} gate z=${hit.gate.z.toFixed(2)}, needed slot ${hit.gate.openSlot}, player in slot ${hit.playerSlot}. Press R or click to respawn.`,
      );
    }
  }

  debugView.updatePlayerBox(camera.position);
  waveform.draw(getSongTimeSec());

  // Main render: full-viewport game view, clearing both color and depth.
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.clear();
  renderer.render(scene, camera);

  // Debug overlay: helpers drawn on top with a fresh depth buffer but the
  // same color buffer — the game view shows wherever helper lines don't
  // rasterize. Debug camera is on layer 1 only, so this pass renders
  // only the bboxes (not the tunnel/gate geometry twice).
  if (debugView.isActive) {
    renderer.clearDepth();
    renderer.render(scene, debugView.camera);
  }
});

window.addEventListener("keydown", (e) => {
  // Core gameplay keys — always available.
  if (e.code === "KeyR") respawn();
  else if (e.code === "Escape") quitToTitle();
  // Dev-only: Space pause, B marker toggle, I invincibility, Tab dev menu.
  // M (debug overlay) is gated inside DebugView via its `enabled` option.
  else if (devMode && e.code === "Space") {
    e.preventDefault(); // don't scroll the page
    togglePause();
  } else if (devMode && e.code === "KeyB") {
    toggleMarkers();
  } else if (devMode && e.code === "KeyI") {
    invincible = !invincible;
    console.log(`invincibility: ${invincible ? "ON" : "OFF"}`);
  } else if (devMode && e.code === "Tab") {
    e.preventDefault(); // don't shift focus
    toggleDevMenu();
  }
});

canvas.addEventListener("click", () => {
  if (!running && audioBuffer) startGame();
  else if (dead) respawn();
  else player.requestPointerLockIfNeeded();
});

// RMB-on-death = continue from the previous turn (a partial-restart that
// preserves song progress). preventDefault stops the contextmenu from
// flashing on the brief mousedown→up window. mousedown rather than click
// because a right-click never fires the `click` event in browsers.
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2 && dead) {
    e.preventDefault();
    continueFromPreviousTurn();
  }
});

// Suppress the browser's right-click context menu globally — RMB is a
// game input (debug-view pan), never "open a context menu."
window.addEventListener("contextmenu", (e) => e.preventDefault());

if (import.meta.env.DEV) {
  const w = window as unknown as {
    __camera: THREE.Camera;
    __respawn: () => void;
    __setMotionScale: (s: number) => void;
    __isDead: () => boolean;
    __getPathS: () => number;
    __setPathS: (s: number) => void;
    // Bypasses the title overlay + audio gesture requirement. Sets the
    // running flag and hides the overlay so tools can exercise gameplay
    // without clicking to start.
    __startGame: () => void;
  };
  w.__camera = camera;
  // Dev hook uses the state-only reset — tests don't need (and can't
  // trigger without a user gesture) the audio rewind.
  w.__respawn = resetToSpawn;
  w.__setMotionScale = (s) => {
    motionScale = s;
  };
  w.__isDead = () => dead;
  w.__getPathS = () => pathS;
  w.__setPathS = (s) => {
    pathS = s;
    // Grow the corridor if the test jumps the camera past what's built.
    ensureSectionsAhead(s);
  };
  w.__startGame = () => {
    running = true;
    titleOverlay?.classList.add("hidden");
  };
  (w as unknown as { __getChart: () => number[] }).__getChart = () => [...chart];
  (w as unknown as {
    __getSongAnalysis: () => SongAnalysis | null;
  }).__getSongAnalysis = () => songAnalysis;
  // Test-only: arrival time (in ms at currentForwardSpeed) for each gate
  // currently built, in chart order across all straight sections. Tests
  // should `await __getSongAnalysis() !== null` before reading, since BPM
  // detection flips the speed.
  (w as unknown as { __getGateTimesMs: () => number[] }).__getGateTimesMs = () => {
    const times: number[] = [];
    for (const sec of sections) {
      if (sec.kind !== "straight") continue;
      for (let i = 0; i < GATE_COUNT; i++) {
        const localPathAtGate = -FIRST_GATE_Z + i * GATE_SPACING;
        const globalPathAtGate = sec.pathStart + localPathAtGate;
        times.push(Math.round((globalPathAtGate / currentForwardSpeed) * 1000));
      }
    }
    return times;
  };
  (w as unknown as { __getForwardSpeed: () => number }).__getForwardSpeed = () =>
    currentForwardSpeed;
  (w as unknown as {
    __getCorridor: () => {
      straightLength: number;
      turnArcLength: number;
      turnRadius: number;
    };
  }).__getCorridor = () => ({
    straightLength: STRAIGHT_LENGTH,
    turnArcLength: TURN_ARC_LENGTH,
    turnRadius: TURN_RADIUS,
  });
}
