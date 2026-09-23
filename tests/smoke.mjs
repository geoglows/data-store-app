/**
 * Headless smoke test: every page renders without a console error, a watershed can be picked on the
 * map, and a retrospective subset and a hydrography subset both download.
 *
 *   npm run dev            # in one terminal
 *   node tests/smoke.mjs   # in another
 *
 * Downloads land in tests/out/. Nothing here is a unit test — it is the click-through, automated.
 */
import {chromium} from "playwright";
import {mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:5173/rfs-data-store/";
mkdirSync(OUT, {recursive: true});

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
const errors = [];
page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
page.on("console", m => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 160)}`));
// Which request failed matters more than that one did — a basemap tile refusing is not a bug here.
page.on("response", r => r.status() >= 400 && errors.push(`http ${r.status()}: ${r.url().slice(0, 120)}`));

/** Click around the middle of the map until a reach is hit, and answer how many rivers it selected. */
async function pickOnMap(route, {center = [-61.5, -3.0], zoom = 6, mode = null} = {}) {
  await page.goto(`${BASE}${route}`, {waitUntil: "networkidle"});
  await page.waitForTimeout(1500);
  await page.evaluate(([c, z]) => window.__map?.jumpTo({center: c, zoom: z}), [center, zoom]);
  await page.waitForTimeout(3500);
  await page.waitForSelector("#aoi-map", {timeout: 20000});
  if (mode) await page.click(`[data-mode="${mode}"]`);
  const box = await page.locator("#aoi-map").boundingBox();
  for (const [dx, dy] of [[0, 0], [30, 20], [-40, -25], [60, -40], [-70, 55], [15, -60]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await page.waitForTimeout(400);
    const rivers = await page.locator(".stat .v").first().innerText();
    if (rivers !== "0") return rivers;
  }
  return "0";
}

async function download(label) {
  const wait = page.waitForEvent("download", {timeout: 180_000});
  await page.click("#btn-download");
  const file = await wait;
  await file.saveAs(join(OUT, file.suggestedFilename()));
  console.log(`${label}: ${file.suggestedFilename()}`);
}

await page.goto(BASE, {waitUntil: "networkidle"});
console.log("landing:", await page.locator("h1").first().innerText(), `· ${await page.locator(".card.version-row").count()} versions`);

await page.screenshot({path: join(OUT, "landing.png")});
await page.click('.card.version-row[href$="/datasets/v3"]');
await page.waitForTimeout(400);
console.log("listing:", await page.locator("#result-count").innerText());
await page.goto(`${BASE}datasets/v3?category=retrospective`, {waitUntil: "networkidle"});
await page.waitForTimeout(300);

await page.click('#topnav [data-section="packages"]');
await page.waitForTimeout(300);
await page.click('.card.result[href$="/packages/javascript"]');
await page.waitForTimeout(300);
await page.screenshot({path: join(OUT, "packages.png")});
console.log("packages:", await page.locator("h1").first().innerText(), `· ${await page.locator(".code").count()} code blocks`);

await page.click('#topnav [data-section="spec"]');
await page.waitForTimeout(1500);
await page.waitForSelector(".doc-body h1", {timeout: 20000});
console.log("spec:", await page.locator(".doc-body h1").first().innerText(), `· ${await page.locator("#toc li").count()} headings`);
await page.click('.spec-nav a[href$="/spec/v3"]');
await page.waitForTimeout(1200);
await page.screenshot({path: join(OUT, "spec.png")});
console.log("spec v3:", await page.locator(".doc-body h1").first().innerText(), `· ${await page.locator("#toc li").count()} headings ·`, await page.locator(".doc-body table").count(), "tables");

// One river rather than a watershed: the daily store is chunked one river to a chunk, so a
// watershed here would pull tens of megabytes to prove a few kilobytes of plumbing works.
console.log("daily · rivers:", await pickOnMap("datasets/v3/retrospective-daily/download", {mode: "reach"}));
console.log("js example:", (await page.locator('[data-cli="javascript"]').isVisible()) ? "tab present" : "MISSING");
await page.fill('input[name="start"]', "2020-12-01");
await page.fill('input[name="end"]', "2020-12-31");
await page.dispatchEvent('input[name="end"]', "input");
await page.click("#btn-sign-in");
await page.click("#terms-accept");
await page.waitForTimeout(200);
await download("retrospective");

console.log("streams · rivers:", await pickOnMap("datasets/v3/streams/download"));
await download("hydrography");

await page.goto(`${BASE}datasets/v3/forecast-flood-maps/access`, {waitUntil: "networkidle"});
await page.waitForTimeout(600);
console.log("deep link:", await page.locator("h1").first().innerText(), "·", await page.locator(".tabs .tab.active").innerText());

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 8).join("\n")}` : "no page errors");
if (errors.length) process.exitCode = 1;
