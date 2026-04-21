import {
  INPUT_EASE_RATE,
  KEY_SENSITIVITY,
  MOUSE_SENSITIVITY,
  PLAYER_Y_MAX,
  PLAYER_Y_MIN,
} from "./constants";

// Unified vertical input pipeline. Every input source (keyboard, mouse
// locked, mouse unlocked, any future device) converges on a single
// normalized accumulator `inputTarget` in [-1, +1]. A separate `inputNow`
// eases toward `inputTarget` each frame for smooth rendering. Final camera
// Y is `inputNow` linearly mapped to [PLAYER_Y_MIN, PLAYER_Y_MAX].
//
// Mouse pipeline (shared for locked and unlocked):
//   mousemove → delta (px) → delta01 = delta / (viewportH / 2)
//   inputTarget -= delta01 * MOUSE_SENSITIVITY (negated: screen-down = world-down)
//   clamp to [-1, +1]
// Locked reads movementY directly; unlocked reconstructs from clientY diffs.
//
// Keyboard:
//   each frame with a key held, inputTarget += axis * KEY_SENSITIVITY * dt
//   (same clamp)
//
// Easing:
//   alpha = 1 - exp(-dt * INPUT_EASE_RATE)   // framerate-independent
//   inputNow += (inputTarget - inputNow) * alpha
//
// Altitude is held when idle (no auto-recenter on vertical — matches the
// game feel of a runner where you don't drift off the line you chose).
export class PlayerController {
  private inputTarget = 0;
  private inputNow = 0;

  private holdingUp = false;
  private holdingDown = false;

  private prevClientY: number | null = null;
  private pointerLocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  // Call from the canvas click handler when you want mouse capture. Kept
  // explicit so the caller can decide whether this click should respawn,
  // lock, or do neither (e.g., UI overlays).
  requestPointerLockIfNeeded(): void {
    if (!this.pointerLocked) this.canvas.requestPointerLock();
  }

  // Returns the world-space Y for this frame.
  update(dt: number): number {
    const axis = (this.holdingUp ? 1 : 0) + (this.holdingDown ? -1 : 0);
    if (axis !== 0) {
      this.inputTarget = clamp(
        this.inputTarget + axis * KEY_SENSITIVITY * dt,
        -1,
        1,
      );
    }

    const alpha = 1 - Math.exp(-dt * INPUT_EASE_RATE);
    this.inputNow += (this.inputTarget - this.inputNow) * alpha;

    const center = (PLAYER_Y_MAX + PLAYER_Y_MIN) * 0.5;
    const halfRange = (PLAYER_Y_MAX - PLAYER_Y_MIN) * 0.5;
    return center + this.inputNow * halfRange;
  }

  // Snaps the player back to the spawn state (centered, no pending motion).
  reset(): void {
    this.inputTarget = 0;
    this.inputNow = 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") this.holdingUp = true;
    else if (e.code === "ArrowDown" || e.code === "KeyS") this.holdingDown = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") this.holdingUp = false;
    else if (e.code === "ArrowDown" || e.code === "KeyS") this.holdingDown = false;
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    // When lock state flips, the next unlocked mousemove must re-seed
    // prevClientY rather than produce a spurious jump from the old value.
    this.prevClientY = null;
  };

  private onMouseMove = (e: MouseEvent) => {
    let deltaPx: number;
    if (this.pointerLocked) {
      deltaPx = e.movementY;
    } else {
      if (this.prevClientY === null) {
        this.prevClientY = e.clientY;
        return;
      }
      deltaPx = e.clientY - this.prevClientY;
      this.prevClientY = e.clientY;
    }
    const delta01 = deltaPx / (window.innerHeight * 0.5);
    this.inputTarget = clamp(
      this.inputTarget - delta01 * MOUSE_SENSITIVITY,
      -1,
      1,
    );
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
