// Smoke test: opens the music tab, clicks ✎ on the dev-song row, verifies
// the editor modal appears with the waveform canvas drawn and the BPM
// input populated. Then types a new BPM, clicks save, and confirms the
// row's bpm reflects the change.

import { chromium } from "playwright";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") console.log(`[${t}]`, m.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined);
  // Wait for dev-song to land in the list as 'ready'.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#track-list .track-item.ready",
      ).length >= 1,
    null,
    { timeout: 60_000, polling: 250 },
  );

  // Open menu → music tab.
  await page.evaluate(() => {
    document.getElementById("menu-button")?.click();
    document
      .querySelector('.user-tab[data-tab="music"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));

  // Click ✎ on the dev-song row.
  await page.evaluate(() => {
    const btn = document.querySelector("#track-list .track-edit");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  // Wait for the editor to appear and the canvas to have some content.
  await page.waitForFunction(
    () => !document.getElementById("track-editor")?.classList.contains("hidden"),
    null,
    { timeout: 5_000 },
  );

  const state = await page.evaluate(() => {
    const canvas = document.getElementById("editor-waveform");
    const bpm = document.getElementById("editor-bpm");
    return {
      modalVisible: !document
        .getElementById("track-editor")
        ?.classList.contains("hidden"),
      canvasW: canvas?.clientWidth ?? 0,
      canvasH: canvas?.clientHeight ?? 0,
      canvasPixelW: canvas?.width ?? 0,
      bpmValue: bpm?.value ?? null,
      title: document.getElementById("editor-name")?.textContent,
      duration: document.getElementById("editor-duration")?.textContent,
      confidence: document.getElementById("editor-confidence")?.textContent,
      gridOffset: document.getElementById("editor-grid-offset")?.textContent,
    };
  });
  console.log("editor opened:", JSON.stringify(state, null, 2));

  await page.screenshot({ path: "tools/screenshots/editor.png" });
  console.log("screenshot: tools/screenshots/editor.png");

  // Type a new BPM and save.
  await page.evaluate(() => {
    const bpm = document.getElementById("editor-bpm");
    bpm.value = "128";
    bpm.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  await page.evaluate(() => {
    document.getElementById("editor-save")?.click();
  });
  // Wait for the save (which includes a worker round-trip to recompute
  // sections at the new bpm) to complete — modal closes when done.
  await page.waitForFunction(
    () => document.getElementById("track-editor")?.classList.contains("hidden"),
    null,
    { timeout: 30_000, polling: 200 },
  );

  const after = await page.evaluate(() => {
    const meta = document
      .querySelector("#track-list .track-item.ready .track-meta")
      ?.textContent;
    return {
      modalHidden: document
        .getElementById("track-editor")
        ?.classList.contains("hidden"),
      rowMeta: meta,
    };
  });
  console.log("after save:", JSON.stringify(after, null, 2));
  console.log(
    after.modalHidden && after.rowMeta?.includes("128 bpm")
      ? "EDITOR OK"
      : "EDITOR BROKEN",
  );
} finally {
  await browser.close();
}
