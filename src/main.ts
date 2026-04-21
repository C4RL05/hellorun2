import * as THREE from "three";
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_START,
  COLOR_BACKGROUND,
} from "./constants";
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

// Raking directional light + very low ambient so cube facets read as 3D
// instead of flat silhouettes. Plan §5.
const key = new THREE.DirectionalLight(0xffffff, 0.6);
key.position.set(1, 2, 1);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.08));

scene.add(createTunnel());

addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
