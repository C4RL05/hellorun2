import * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { checkCollision, slotForY } from "./collision";
import type { Gate } from "./collision";
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  COLOR_BACKGROUND,
  FORWARD_SPEED,
} from "./constants";
import {
  PATH_TOTAL,
  samplePath,
  STRAIGHT2_POS,
  STRAIGHT2_YAW,
} from "./corridor";
import { PlayerController } from "./player";
import { createGates } from "./scene/gates";
import { createTunnel } from "./scene/tunnel";

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(COLOR_BACKGROUND);

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
}

function buildStraight(name: string): Straight {
  const tunnel = createTunnel();
  const gates = createGates();
  edgeMaterials.push(tunnel.edgeMaterial, gates.edgeMaterial);
  const group = new THREE.Group();
  group.name = name;
  group.add(tunnel.object);
  group.add(gates.object);
  return { group, gates: gates.data };
}

const straight1 = buildStraight("straight1");
scene.add(straight1.group);

const straight2 = buildStraight("straight2");
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

let dead = false;
let pathS = 0;
let motionScale = 1;

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

const respawn = () => {
  pathS = 0;
  player.reset();
  dead = false;
  const pose = samplePath(0);
  camera.position.copy(pose.pos);
  camera.rotation.set(0, pose.yaw, 0);
  prevWorldPos.copy(camera.position);
};

// Seed initial pose before the first frame.
respawn();

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const playerY = player.update(dt);

  prevWorldPos.copy(camera.position);

  let wrapped = false;
  if (!dead) {
    pathS += FORWARD_SPEED * motionScale * dt;
    if (pathS >= PATH_TOTAL) {
      pathS -= PATH_TOTAL;
      wrapped = true;
    }
  }

  const pose = samplePath(pathS);
  camera.position.set(pose.pos.x, pose.pos.y + playerY, pose.pos.z);
  camera.rotation.y = pose.yaw;

  if (!dead && !wrapped) {
    const hit = collisionAcrossStraights(prevWorldPos, camera.position);
    if (hit) {
      dead = true;
      console.log(
        `GAME OVER — ${hit.straight} gate z=${hit.gate.z.toFixed(2)}, needed slot ${hit.gate.openSlot}, player in slot ${hit.playerSlot}. Press R or click to respawn.`,
      );
    }
  }

  renderer.render(scene, camera);
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") respawn();
});

canvas.addEventListener("click", () => {
  if (dead) respawn();
  else player.requestPointerLockIfNeeded();
});

if (import.meta.env.DEV) {
  const w = window as unknown as {
    __camera: THREE.Camera;
    __respawn: () => void;
    __setMotionScale: (s: number) => void;
    __isDead: () => boolean;
    __getPathS: () => number;
  };
  w.__camera = camera;
  w.__respawn = respawn;
  w.__setMotionScale = (s) => {
    motionScale = s;
  };
  w.__isDead = () => dead;
  w.__getPathS = () => pathS;
  (w as unknown as { __setPathS: (s: number) => void }).__setPathS = (s) => {
    pathS = s;
  };
}
