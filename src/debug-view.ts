import * as THREE from "three";

// Full-viewport debug overlay. Toggle with `M`. When active, the render
// loop (main.ts) does a second pass with this camera after the game draw:
// depth buffer cleared, color buffer kept, so the game shows through
// wherever this pass doesn't rasterize.
//
// While visible:
//   - mousewheel zooms
//   - right-mouse drag pans in world XZ
// Player input keeps running; a RMB-drag suppresses the mousemove in
// PlayerController so dragging doesn't leak into player.inputTarget.
//
// orthoCamera.up = (0, 0, -1) → world -Z (gameplay forward) is at the
// top of the overlay. Camera layers are set to 1 only, so this pass
// renders only helpers (Box3Helpers added here), not the tunnel/gate
// geometry which lives on layer 0.

const FRUSTUM_SIZE = 100;
const PLAYER_BBOX_HALF = 0.5;
const COLOR_OBJECT_BOX = 0xffff00;
const COLOR_PLAYER_BOX = 0x00ff00;
const ZOOM_STEP = 1.1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 50;
const HELPER_LAYER = 1;

export interface DebugBbox {
  readonly box: THREE.Box3;
  readonly color?: number;
}

export class DebugView {
  private readonly orthoCamera: THREE.OrthographicCamera;
  private readonly helpers: THREE.Group;
  private readonly playerBox: THREE.Box3;
  private active = false;
  private dragging = false;

  constructor(
    scene: THREE.Scene,
    canvas: HTMLCanvasElement,
    bboxes: readonly DebugBbox[],
  ) {
    const aspect = window.innerWidth / window.innerHeight;
    this.orthoCamera = new THREE.OrthographicCamera(
      -FRUSTUM_SIZE * aspect * 0.5,
      FRUSTUM_SIZE * aspect * 0.5,
      FRUSTUM_SIZE * 0.5,
      -FRUSTUM_SIZE * 0.5,
      0.1,
      500,
    );
    this.orthoCamera.position.set(0, 100, -20);
    this.orthoCamera.up.set(0, 0, -1);
    this.orthoCamera.lookAt(0, 0, -20);
    this.orthoCamera.updateProjectionMatrix();
    // Helpers-only overlay — do not render game geometry (layer 0) in this
    // pass, just bboxes (layer 1).
    this.orthoCamera.layers.set(HELPER_LAYER);

    this.helpers = new THREE.Group();
    scene.add(this.helpers);

    for (const b of bboxes) {
      const helper = new THREE.Box3Helper(b.box, b.color ?? COLOR_OBJECT_BOX);
      helper.layers.set(HELPER_LAYER);
      this.helpers.add(helper);
    }

    this.playerBox = new THREE.Box3(
      new THREE.Vector3(-PLAYER_BBOX_HALF, -PLAYER_BBOX_HALF, -PLAYER_BBOX_HALF),
      new THREE.Vector3(PLAYER_BBOX_HALF, PLAYER_BBOX_HALF, PLAYER_BBOX_HALF),
    );
    const playerHelper = new THREE.Box3Helper(this.playerBox, COLOR_PLAYER_BOX);
    playerHelper.layers.set(HELPER_LAYER);
    this.helpers.add(playerHelper);

    window.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);
  }

  get isActive(): boolean {
    return this.active;
  }

  get camera(): THREE.OrthographicCamera {
    return this.orthoCamera;
  }

  updatePlayerBox(pos: THREE.Vector3): void {
    this.playerBox.min.set(
      pos.x - PLAYER_BBOX_HALF,
      pos.y - PLAYER_BBOX_HALF,
      pos.z - PLAYER_BBOX_HALF,
    );
    this.playerBox.max.set(
      pos.x + PLAYER_BBOX_HALF,
      pos.y + PLAYER_BBOX_HALF,
      pos.z + PLAYER_BBOX_HALF,
    );
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "KeyM") {
      this.active = !this.active;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.active) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.orthoCamera.zoom = THREE.MathUtils.clamp(
      this.orthoCamera.zoom * factor,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    this.orthoCamera.updateProjectionMatrix();
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.active || e.button !== 2) return;
    this.dragging = true;
    e.preventDefault();
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging || !this.active) return;
    const worldPerPixel =
      FRUSTUM_SIZE / (this.orthoCamera.zoom * window.innerHeight);
    this.orthoCamera.position.x -= e.movementX * worldPerPixel;
    this.orthoCamera.position.z -= e.movementY * worldPerPixel;
    // Keep player input from also reacting to the drag motion.
    e.stopPropagation();
  };

  private onContextMenu = (e: MouseEvent) => {
    if (this.active) e.preventDefault();
  };

  private onResize = () => {
    const aspect = window.innerWidth / window.innerHeight;
    this.orthoCamera.left = -FRUSTUM_SIZE * aspect * 0.5;
    this.orthoCamera.right = FRUSTUM_SIZE * aspect * 0.5;
    this.orthoCamera.top = FRUSTUM_SIZE * 0.5;
    this.orthoCamera.bottom = -FRUSTUM_SIZE * 0.5;
    this.orthoCamera.updateProjectionMatrix();
  };
}
