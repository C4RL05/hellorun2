import * as THREE from "three";
import { checkCollision, slotForY } from "./collision";
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_START,
  CELL,
  COLOR_BACKGROUND,
  FORWARD_SPEED,
  TUNNEL_DEPTH,
} from "./constants";
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
camera.position.set(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z);
camera.lookAt(0, 0, -10);

const key = new THREE.DirectionalLight(0xffffff, 0.6);
key.position.set(1, 2, 1);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.08));

const tunnel = createTunnel();
scene.add(tunnel.object);

const gates = createGates();
scene.add(gates.object);

const syncResolution = () => {
  tunnel.edgeMaterial.resolution.set(window.innerWidth, window.innerHeight);
  gates.edgeMaterial.resolution.set(window.innerWidth, window.innerHeight);
};
syncResolution();

addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncResolution();
});

const LOOP_END_Z = -TUNNEL_DEPTH * CELL;
const LOOP_LENGTH = CAMERA_START.z - LOOP_END_Z;
const clock = new THREE.Clock();
const player = new PlayerController(canvas);

let dead = false;
let prevCameraZ = camera.position.z;
// motionScale lets dev tools freeze forward motion while still exercising
// input — see tools/input-check.mjs.
let motionScale = 1;

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  camera.position.y = player.update(dt);

  if (!dead) {
    prevCameraZ = camera.position.z;
    camera.position.z -= FORWARD_SPEED * motionScale * dt;
    if (camera.position.z < LOOP_END_Z) {
      camera.position.z += LOOP_LENGTH;
      prevCameraZ = camera.position.z;
    }

    const hit = checkCollision(
      camera.position.y,
      camera.position.z,
      prevCameraZ,
      gates.data,
    );
    if (hit !== null) {
      dead = true;
      const playerSlot = slotForY(camera.position.y);
      console.log(
        `GAME OVER — crossed z=${hit.z.toFixed(2)}, needed slot ${hit.openSlot}, player in slot ${playerSlot}. Press R to respawn.`,
      );
    }
  }

  renderer.render(scene, camera);
});

const respawn = () => {
  camera.position.set(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z);
  player.reset();
  dead = false;
  prevCameraZ = camera.position.z;
};

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
  };
  w.__camera = camera;
  w.__respawn = respawn;
  w.__setMotionScale = (s) => {
    motionScale = s;
  };
  w.__isDead = () => dead;
}
