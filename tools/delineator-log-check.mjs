// Capture the [delineator] console lines for the first 4 straights to
// verify the hash hierarchy lands where expected.
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const logs = [];
page.on("console", (msg) => {
  if (msg.type() === "log" && msg.text().startsWith("[delineator]")) {
    logs.push(msg.text());
  }
});

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__setPathS !== undefined);

// Don't start the game — running=false means the RAF loop skips its
// audio-clock pathS override. __setPathS then sticks and the unconditional
// entry-check sees it. Walk through straight boundaries.
for (const s of [0, 40, 80, 120, 160, 200]) {
  await page.evaluate((s) => window.__setPathS(s), s);
  await new Promise((r) => setTimeout(r, 50));
}

console.log(`captured ${logs.length} delineator lines:`);
for (const line of logs) console.log(line);

await browser.close();
