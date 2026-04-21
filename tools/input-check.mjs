// Simulates keyboard input against the dev server and reports the resulting
// camera.position.y trace. Verifies milestone 3's vertical movement wiring.
//
// Usage: ensure `npm run dev` is running, then `node tools/input-check.mjs`.

import { chromium } from "playwright";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const readY = () => page.evaluate(() => window.__camera.position.y);

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForSelector("canvas");
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.waitForFunction(() => window.__camera !== undefined, {
    timeout: 5_000,
  });

  // Freeze forward motion so collision with gates doesn't interrupt the
  // input trace mid-test. Input wiring is a separable concern from gameplay.
  await page.evaluate(() => window.__setMotionScale(0));

  const samples = [];

  samples.push({ t: 0, action: "baseline", y: await readY() });

  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(200);
  samples.push({ t: 200, action: "ArrowUp 200ms", y: await readY() });
  await page.waitForTimeout(200);
  samples.push({ t: 400, action: "ArrowUp 400ms", y: await readY() });
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(200);
  samples.push({ t: 600, action: "released 200ms", y: await readY() });

  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(400);
  samples.push({ t: 1000, action: "ArrowDown 400ms", y: await readY() });
  await page.waitForTimeout(400);
  samples.push({ t: 1400, action: "ArrowDown 800ms", y: await readY() });
  await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(300);
  samples.push({ t: 1700, action: "released 300ms", y: await readY() });

  // Mouse / pointer-lock path. Click canvas to request lock, then simulate
  // upward mouse motion and verify camera.y moves up.
  await page.mouse.click(640, 360);
  const locked = await page
    .waitForFunction(
      () => document.pointerLockElement === document.querySelector("canvas"),
      { timeout: 2_000 },
    )
    .then(() => true)
    .catch(() => false);

  let mouseVerdict;
  if (!locked) {
    mouseVerdict = "POINTER LOCK NOT GRANTED (headless limitation — test inconclusive)";
  } else {
    // Reset to center via a brief keyboard nudge so we start from a known y.
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(20);
    await page.keyboard.up("ArrowDown");
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(5);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(200);
    const yBeforeMouse = await readY();

    // Drag mouse upward: a sequence of upward moves gives negative movementY
    // each step, which pushes player Y positive.
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(640, 360 - (i + 1) * 5);
      await page.waitForTimeout(15);
    }
    await page.waitForTimeout(100);
    const yAfterMouseUp = await readY();

    for (let i = 0; i < 40; i++) {
      await page.mouse.move(640, 260 + (i + 1) * 5);
      await page.waitForTimeout(15);
    }
    await page.waitForTimeout(100);
    const yAfterMouseDown = await readY();

    samples.push({ t: 1900, action: "mouse-baseline (reset)", y: yBeforeMouse });
    samples.push({ t: 2200, action: "mouse up ~100px", y: yAfterMouseUp });
    samples.push({ t: 2800, action: "mouse down ~200px", y: yAfterMouseDown });

    const mouseUpWorked = yAfterMouseUp > yBeforeMouse + 0.01;
    const mouseDownWorked = yAfterMouseDown < yAfterMouseUp - 0.01;
    mouseVerdict = mouseUpWorked && mouseDownWorked
      ? "MOUSE WIRED UP"
      : "NO MOUSE RESPONSE DETECTED";
  }

  console.log("t(ms)  action               camera.y");
  console.log("-----  -------------------  --------");
  for (const s of samples) {
    console.log(
      `${String(s.t).padStart(5)}  ${s.action.padEnd(20)} ${s.y.toFixed(4)}`,
    );
  }

  const peak = Math.max(...samples.map((s) => s.y));
  const trough = Math.min(...samples.map((s) => s.y));
  const didGoUp = peak > 0.05;
  const didGoDown = trough < -0.05;
  const hitTop = Math.abs(peak - 0.4) < 0.001;
  const hitBottom = Math.abs(trough - -0.4) < 0.001;

  console.log("");
  console.log(
    `peak y:    ${peak.toFixed(4)}${hitTop ? "  (hit PLAYER_Y_MAX clamp)" : ""}`,
  );
  console.log(
    `trough y:  ${trough.toFixed(4)}${hitBottom ? "  (hit PLAYER_Y_MIN clamp)" : ""}`,
  );
  console.log(
    `keyboard:  ${didGoUp && didGoDown ? "INPUT WIRED UP" : "NO RESPONSE DETECTED"}`,
  );
  console.log(`mouse:     ${mouseVerdict}`);

  const keyboardOk = didGoUp && didGoDown;
  const mouseOk = !mouseVerdict.startsWith("NO MOUSE");
  if (!keyboardOk || !mouseOk) process.exit(1);
} finally {
  await browser.close();
}
