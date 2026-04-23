// One-shot: load the page, drop a synthetic mp3 file, open the music
// tab, and dump the rendered track-list HTML + computed widths so we can
// see why the user-uploaded row is missing its name in the screenshot.
//
// Usage: ensure `npm run dev` is running, then `node tools/track-list-check.mjs`.

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const URL = process.env.HELLORUN_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text());
});

try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  await page.waitForFunction(() => window.__getSongAnalysis !== undefined, {
    timeout: 5_000,
  });

  // Wait for the dev-song to land in the list (analysis or cache hit).
  await page.waitForFunction(
    () => document.querySelectorAll("#track-list .track-item").length >= 1,
    { timeout: 60_000, polling: 250 },
  );

  // Drop a real mp3 buffer so the analyzer actually runs and adds a
  // user-origin track. Use a copy of the dev-song renamed so it has a
  // different hash (otherwise upsertTrack would just bump dev-song
  // active and we'd have only one row to inspect).
  const mp3 = await readFile("public/music/dev-song.mp3");
  // Append 1 byte so the hash differs from the cached dev-song.
  const buf = Buffer.concat([mp3, Buffer.from([0])]);
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "user-track.mp3", { type: "audio/mpeg" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const dropZone = document.getElementById("drop-zone");
    if (!dropZone) throw new Error("no drop-zone");
    dropZone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      }),
    );
  }, buf.toString("base64"));

  // Wait for second track to appear in the list.
  console.log("waiting for analysis of user-track.mp3 …");
  await page.waitForFunction(
    () => document.querySelectorAll("#track-list .track-item").length >= 2,
    { timeout: 90_000, polling: 500 },
  );

  // Open the menu + music tab so we can screenshot the actual rendered state.
  await page.evaluate(() => {
    document.getElementById("menu-button")?.click();
    document
      .querySelector('.user-tab[data-tab="music"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));

  const dump = await page.evaluate(() => {
    const list = document.getElementById("track-list");
    const items = Array.from(list?.querySelectorAll(".track-item") ?? []);
    const rowSummary = items.map((it) => {
      const nameEl = it.querySelector(".track-name");
      const metaEl = it.querySelector(".track-meta");
      const delEl = it.querySelector(".track-delete");
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const rect = (el) => (el ? el.getBoundingClientRect() : null);
      return {
        outerHTML: it.outerHTML,
        name: nameEl?.textContent ?? null,
        nameWidth: rect(nameEl)?.width ?? null,
        nameOverflowX: cs(nameEl)?.overflowX ?? null,
        nameMinWidth: cs(nameEl)?.minWidth ?? null,
        nameWhiteSpace: cs(nameEl)?.whiteSpace ?? null,
        nameTextOverflow: cs(nameEl)?.textOverflow ?? null,
        nameFlex: cs(nameEl)?.flex ?? null,
        meta: metaEl?.textContent ?? null,
        metaWidth: rect(metaEl)?.width ?? null,
        metaFlex: cs(metaEl)?.flex ?? null,
        hasDelete: !!delEl,
        deleteWidth: rect(delEl)?.width ?? null,
        deleteFlex: cs(delEl)?.flex ?? null,
        rowWidth: it.getBoundingClientRect().width,
        rowDisplay: cs(it)?.display ?? null,
        rowFlexDirection: cs(it)?.flexDirection ?? null,
        rowGap: cs(it)?.gap ?? null,
      };
    });
    return {
      listScrollWidth: list?.scrollWidth ?? null,
      listClientWidth: list?.clientWidth ?? null,
      listOverflowX: list ? getComputedStyle(list).overflowX : null,
      listOverflowY: list ? getComputedStyle(list).overflowY : null,
      rows: rowSummary,
    };
  });
  console.log(JSON.stringify(dump, null, 2));

  await page.screenshot({ path: "tools/screenshots/track-list.png" });
  console.log("screenshot: tools/screenshots/track-list.png");
} finally {
  await browser.close();
}
