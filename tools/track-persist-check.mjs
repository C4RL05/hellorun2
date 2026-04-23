// Verifies IndexedDB persistence + boot restore + delete eviction.
//
// Sequence:
//   1. Clean slate: open the page, clear IDB + localStorage so we
//      start with no stored tracks.
//   2. Drop a synthetic mp3, wait for it to be added to the list.
//   3. Reload the page. Confirm the dropped track reappears in the
//      list (restored from IDB) without re-dropping.
//   4. Delete the dropped track via the × button. Reload. Confirm it
//      did NOT reappear (IDB + analysis cache both purged).
//
// Run after `npm run dev`.

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text());
});

const dropMp3 = async () => {
  const mp3 = await readFile("public/dev-song.mp3");
  // Make a hash distinct from dev-song so we get a separate row.
  const buf = Buffer.concat([mp3, Buffer.from([0])]);
  const b64 = buf.toString("base64");
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "user-track.mp3", { type: "audio/mpeg" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById("drop-zone")?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }, b64);
};

const openMusicTab = async () => {
  await page.evaluate(() => {
    document.getElementById("menu-button")?.click();
    document
      .querySelector('.user-tab[data-tab="music"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
};

const trackNames = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#track-list .track-item .track-name"))
      .map((el) => el.textContent),
  );

try {
  // ── Phase 1: clean slate ──────────────────────────────────────────────
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined, {
    timeout: 5_000,
  });
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      if (d.name) await new Promise((r) => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = () => r();
      });
    }
  });
  console.log("phase 1: cleared IDB + localStorage");

  // ── Phase 2: drop and persist ────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined);
  await page.waitForFunction(
    () => document.querySelectorAll("#track-list .track-item").length >= 1,
    null,
    { timeout: 60_000, polling: 250 },
  );
  console.log("phase 2: dev-song loaded; dropping user-track.mp3");
  await dropMp3();
  // Wait for both rows to be in `ready` state — analysis-complete +
  // IDB persist fire only at that point.
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll("#track-list .track-item");
      if (rows.length < 2) return false;
      return Array.from(rows).every((r) => r.classList.contains("ready"));
    },
    null,
    { timeout: 120_000, polling: 500 },
  );
  await openMusicTab();
  console.log("phase 2: tracks after drop:", await trackNames());

  // Give the IDB write a moment to flush before we reload.
  await new Promise((r) => setTimeout(r, 500));

  // ── Phase 3: reload, check restore ───────────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined);
  await page.waitForFunction(
    () => document.querySelectorAll("#track-list .track-item").length >= 2,
    null,
    { timeout: 60_000, polling: 250 },
  );
  await openMusicTab();
  console.log("phase 3: tracks after reload (expect both):", await trackNames());

  // ── Phase 4: delete user track, reload, expect only dev-song ─────────
  await page.evaluate(() => {
    const btn = document.querySelector(
      "#track-list .track-item .track-delete",
    );
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  console.log("phase 4: tracks after delete:", await trackNames());

  await new Promise((r) => setTimeout(r, 500));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined);
  await page.waitForFunction(
    () => document.querySelectorAll("#track-list .track-item").length >= 1,
    null,
    { timeout: 60_000, polling: 250 },
  );
  await openMusicTab();
  const finalTracks = await trackNames();
  console.log("phase 4: tracks after delete+reload (expect only dev-song):", finalTracks);

  // Quick verdict.
  const ok =
    finalTracks.length === 1 && finalTracks[0]?.includes("dev-song");
  console.log(ok ? "\nPERSISTENCE OK" : "\nPERSISTENCE BROKEN");
} finally {
  await browser.close();
}
