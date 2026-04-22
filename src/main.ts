import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { checkCollision, slotForY } from "./collision";
import type { Gate } from "./collision";
import { DebugView } from "./debug-view";
import type { DebugBbox } from "./debug-view";
import type { BarrierInfo } from "./scene/gates";
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_START,
  CELL,
  COLOR_BACKGROUND,
  FIRST_GATE_Z,
  FORWARD_SPEED,
  GATE_COUNT,
  GATE_SPACING,
  TURN_ARC_LENGTH,
} from "./constants";
import {
  PATH_TOTAL,
  STRAIGHT_LENGTH,
  samplePath,
  STRAIGHT2_POS,
  STRAIGHT2_YAW,
} from "./corridor";
import { analyzeAudio } from "./audio-analysis/analyzer";
import type { SongAnalysis } from "./audio-analysis/analyzer";
import { generateChart, mulberry32 } from "./chart";
import { PlayerController } from "./player";
import { createGates } from "./scene/gates";
import { createTunnel } from "./scene/tunnel";
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

interface Straight {
  readonly group: THREE.Object3D;
  readonly gates: readonly Gate[];
  readonly barriers: readonly BarrierInfo[];
  readonly cubeTransforms: readonly THREE.Matrix4[];
}

function buildStraight(
  name: string,
  openSlots: readonly number[],
): Straight {
  const tunnel = createTunnel();
  const gates = createGates(openSlots);
  edgeMaterials.push(tunnel.edgeMaterial, gates.edgeMaterial);
  const group = new THREE.Group();
  group.name = name;
  group.add(tunnel.object);
  group.add(gates.object);
  return {
    group,
    gates: gates.data,
    barriers: gates.barriers,
    cubeTransforms: tunnel.cubeTransforms,
  };
}

// Procedural chart (plan §7 M7): 16 gates across both straights. Seed
// from URL (?seed=N) for deterministic playtests; otherwise Math.random
// for a fresh chart each page load.
const seedParam = new URL(window.location.href).searchParams.get("seed");
const chartRand =
  seedParam !== null ? mulberry32(parseInt(seedParam, 10) || 0) : Math.random;
const chart = generateChart(GATE_COUNT * 2, { rand: chartRand });

const straight1 = buildStraight("straight1", chart.slice(0, GATE_COUNT));
scene.add(straight1.group);

const straight2 = buildStraight(
  "straight2",
  chart.slice(GATE_COUNT, GATE_COUNT * 2),
);
straight2.group.position.copy(STRAIGHT2_POS);
straight2.group.rotation.y = STRAIGHT2_YAW;
scene.add(straight2.group);

const straights: readonly Straight[] = [straight1, straight2];

const syncResolution = () => {
  for (const mat of edgeMaterials) {
    mat.resolution.set(window.innerWidth, window.innerHeight);
  }
};
syncResolution();

addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncResolution();
});

const clock = new THREE.Clock();
const player = new PlayerController(canvas);

// Compute debug bboxes in world space for each straight group and each
// individual barrier inside its gates. updateMatrixWorld first so
// straight2's positioned/rotated transform is baked in.
const COLOR_STRAIGHT_BOX = 0xffff00;
const COLOR_BARRIER_BOX = 0xff6060;
const COLOR_CUBE_BOX = 0x4080c0;
const debugBboxes: DebugBbox[] = [];
for (const s of straights) {
  s.group.updateMatrixWorld(true);
  debugBboxes.push({
    box: new THREE.Box3().setFromObject(s.group),
    color: COLOR_STRAIGHT_BOX,
  });
  for (const b of s.barriers) {
    const box = new THREE.Box3().setFromCenterAndSize(b.localCenter, b.size);
    box.applyMatrix4(s.group.matrixWorld);
    debugBboxes.push({ box, color: COLOR_BARRIER_BOX });
  }
}

const debugView = new DebugView(scene, canvas, debugBboxes);

// Per-cube oriented bboxes merged into one LineSegments. Each cube uses
// its full local transform (translation + ±CUBE_JITTER_DEG rotation), then
// composed with the straight's world matrix. 1920 cubes cost one draw
// call.
const cubeBboxLines = buildCubeBboxLines(straights, COLOR_CUBE_BOX);
scene.add(cubeBboxLines);

function buildCubeBboxLines(
  straights: readonly Straight[],
  color: number,
): THREE.LineSegments {
  const cubeBox = new THREE.BoxGeometry(CELL, CELL, CELL);
  const cubeEdges = new THREE.EdgesGeometry(cubeBox, 40);
  const geoms: THREE.BufferGeometry[] = [];
  const worldMatrix = new THREE.Matrix4();
  for (const s of straights) {
    for (const localMat of s.cubeTransforms) {
      worldMatrix.multiplyMatrices(s.group.matrixWorld, localMat);
      geoms.push(cubeEdges.clone().applyMatrix4(worldMatrix));
    }
  }
  const merged = mergeGeometries(geoms, false);
  if (!merged) throw new Error("Failed to merge cube bbox geometry");
  for (const g of geoms) g.dispose();
  cubeBox.dispose();
  cubeEdges.dispose();
  const lines = new THREE.LineSegments(
    merged,
    new THREE.LineBasicMaterial({ color }),
  );
  lines.layers.set(1);
  return lines;
}

let dead = false;
let pathS = 0;
// Monotonic distance traveled — tracks total meters regardless of corridor
// wrap. Used to derive pathS and to detect loop wraparounds under the
// audio clock (where a frame can in principle jump across multiple wraps).
let totalPathS = 0;
let motionScale = 1;
let invincible = false;
// Plan §1: "A run = a song. Game starts when the song starts, ends when
// the song ends (or the player dies)." `running` gates pathS advancement
// so nothing moves until the user clicks the title screen.
let running = false;

// Audio pipeline. Preload on boot; play on user gesture (click).
let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let audioSource: AudioBufferSourceNode | null = null;
// AudioContext.currentTime at which the song's first sample started.
// Subtracting this (and gridOffsetSec) from audioCtx.currentTime gives
// "audio time since beat 1" — the master clock for pathS.
let audioStartTime = 0;
// Filled by the analyzer worker after decode. gridOffsetSec is the only
// analyzed field that feeds back into runtime behavior right now — it
// aligns the audio-clock math so pathS=0 coincides with beat 1 of the
// song. bpm and beats[] are exposed via songAnalysis for M9 wiring.
let currentGridOffsetSec = devSong.gridOffsetSec;
let songAnalysis: SongAnalysis | null = null;

const titleOverlay = document.getElementById("title-screen");
const titleSubtitle = titleOverlay?.querySelector(".subtitle") as
  | HTMLElement
  | null;

async function loadAudio(): Promise<void> {
  audioCtx = new AudioContext();
  const res = await fetch(devSong.url);
  if (!res.ok) throw new Error(`audio fetch failed (${res.status})`);
  const arr = await res.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arr);

  if (titleSubtitle) titleSubtitle.textContent = "analyzing audio…";
  try {
    songAnalysis = await analyzeAudio(audioBuffer, (p) => {
      if (titleSubtitle) {
        titleSubtitle.textContent = `analyzing audio: ${Math.round(p.progress * 100)}%`;
      }
    });
    currentGridOffsetSec = songAnalysis.gridOffsetSec;
    console.log(
      `analyzed: bpm=${songAnalysis.bpm.toFixed(2)}, ` +
        `gridOffsetSec=${songAnalysis.gridOffsetSec.toFixed(3)}, ` +
        `confidence=${songAnalysis.confidence.toFixed(2)}, ` +
        `beats=${songAnalysis.beats.length}`,
    );
  } catch (err) {
    // Analysis failure falls back to devSong defaults. Game still runs —
    // just at the hardcoded BPM/offset. Worth surfacing to the user so
    // they know why sync might feel off.
    console.error("analysis failed, using defaults:", err);
    if (titleSubtitle)
      titleSubtitle.textContent =
        `analysis failed — using ${devSong.bpm} BPM, click to start`;
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
  startAudio();
  running = true;
  titleOverlay?.classList.add("hidden");
}

titleOverlay?.addEventListener("click", () => {
  if (audioBuffer) startGame();
});

loadAudio()
  .then(() => {
    // Don't overwrite an "analysis failed" message that loadAudio's own
    // inner catch may have set — only set the happy-path text when
    // analysis actually succeeded.
    if (titleSubtitle && songAnalysis !== null) {
      titleSubtitle.textContent = "click to start";
    }
  })
  .catch((err) => {
    console.error("audio load failed:", err);
    if (titleSubtitle)
      titleSubtitle.textContent =
        "audio missing — drop an mp3 at public/dev-song.mp3";
  });

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
  for (const s of straights) {
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

// State-only reset: camera, player input, dead flag. Doesn't touch audio
// or the running flag. Used at boot and by the __respawn dev hook.
const resetToSpawn = () => {
  pathS = 0;
  totalPathS = 0;
  player.reset();
  dead = false;
  const pose = samplePath(0);
  camera.position.copy(pose.pos);
  camera.rotation.set(0, pose.yaw, 0);
  prevWorldPos.copy(camera.position);
};

// Full user-facing respawn: reset state, rewind the song to its start,
// resume play. Plan §1: "A run = a song" — each respawn is a new run.
const respawn = () => {
  resetToSpawn();
  if (audioBuffer) {
    stopAudio();
    startAudio();
  }
  running = true;
  titleOverlay?.classList.add("hidden");
};

// Quit back to the title screen: stop the song and put game state in the
// same shape as initial page load. Next click resumes the start-flow.
const quitToTitle = () => {
  stopAudio();
  running = false;
  resetToSpawn();
  titleOverlay?.classList.remove("hidden");
};

// Seed initial pose before the first frame.
resetToSpawn();

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const playerY = player.update(dt);

  prevWorldPos.copy(camera.position);

  let wrapped = false;
  if (running && !dead) {
    const prevTotal = totalPathS;
    if (motionScale === 1) {
      // Real play: audio clock is master. Falls back to wall-clock when
      // no audio is playing yet (e.g., headless tests without a user
      // gesture).
      const audioNow = getAudioNow();
      if (audioNow !== null) {
        totalPathS = Math.max(0, audioNow * FORWARD_SPEED);
      } else {
        totalPathS += FORWARD_SPEED * dt;
      }
    } else {
      // Scaled test mode: wall-clock advance with the scale factor.
      // motionScale=0 freezes motion entirely.
      totalPathS += FORWARD_SPEED * motionScale * dt;
    }
    wrapped =
      Math.floor(totalPathS / PATH_TOTAL) !== Math.floor(prevTotal / PATH_TOTAL);
    pathS = totalPathS % PATH_TOTAL;
  }

  const pose = samplePath(pathS);
  camera.position.set(pose.pos.x, pose.pos.y + playerY, pose.pos.z);
  camera.rotation.y = pose.yaw;

  if (!dead && !wrapped && !invincible) {
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
  if (e.code === "KeyR") respawn();
  else if (e.code === "Escape") quitToTitle();
  else if (e.code === "KeyI") {
    invincible = !invincible;
    console.log(`invincibility: ${invincible ? "ON" : "OFF"}`);
  }
});

canvas.addEventListener("click", () => {
  if (!running && audioBuffer) startGame();
  else if (dead) respawn();
  else player.requestPointerLockIfNeeded();
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
    totalPathS = s;
  };
  w.__startGame = () => {
    running = true;
    titleOverlay?.classList.add("hidden");
  };
  (w as unknown as { __getChart: () => number[] }).__getChart = () => [...chart];
  (w as unknown as {
    __getSongAnalysis: () => SongAnalysis | null;
  }).__getSongAnalysis = () => songAnalysis;
  // Test-only: returns arrival time (in ms, wall-clock at FORWARD_SPEED)
  // for each gate in chart order. Straight 1 gates first, then straight 2.
  // Derived from current constants so tests don't drift when GATE_COUNT or
  // BEATS_PER_GATE changes.
  (w as unknown as { __getGateTimesMs: () => number[] }).__getGateTimesMs = () => {
    const times: number[] = [];
    for (let i = 0; i < GATE_COUNT; i++) {
      const pathAtGate = CAMERA_START.z - (FIRST_GATE_Z - i * GATE_SPACING);
      times.push(Math.round((pathAtGate / FORWARD_SPEED) * 1000));
    }
    for (let i = 0; i < GATE_COUNT; i++) {
      const localPathAtGate =
        CAMERA_START.z - (FIRST_GATE_Z - i * GATE_SPACING);
      const fullPathS = STRAIGHT_LENGTH + TURN_ARC_LENGTH + localPathAtGate;
      times.push(Math.round((fullPathS / FORWARD_SPEED) * 1000));
    }
    return times;
  };
}
