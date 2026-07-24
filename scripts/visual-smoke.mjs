#!/usr/bin/env node
// Visual smoke test: drives the simulator UI through every city, every enabled
// transport mode, and every camera position, capturing a screenshot of each.
// For Stuttgart it additionally exercises Photo mode and Drive mode for the
// Stadtbahn and Bus modes. Meant to be run manually to eyeball that a change
// didn't visually break anything — it asserts nothing, it just clicks and shoots.
//
// Usage:
//   npm run test:visual                # spawns Vite on :5180, opens a real window
//   HEADLESS=1 npm run test:visual     # no window (screenshots only)
//   ONLY_CITY=odessa npm run test:visual
//   BASE_URL=http://localhost:5173 npm run test:visual   # use a server you started
//   SETTLE_MS=4000 npm run test:visual # wait longer for tiles/WASM per view
//
// Output: ./visual-smoke-output/<NN>__<city>__<mode>__<view>.png plus a run.log

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import process from 'node:process';

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.error('\n[visual-smoke] puppeteer is not installed. Run:\n  npm install\n');
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 5180);
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const SPAWN_SERVER = !process.env.BASE_URL; // only manage Vite if the user didn't point us at one
const HEADLESS = process.env.HEADLESS === '1';
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 3000); // extra wait for terrain/tiles/WASM after each view
const ONLY_CITY = process.env.ONLY_CITY?.toLowerCase();
const KEEP_OPEN = process.env.KEEP_OPEN === '1';
const OUT_DIR = path.resolve('visual-smoke-output');

// Stuttgart-only extra coverage requested: Photo + Drive for these mode labels.
const STUTTGART_EXTRA_MODES = new Set(['Stadtbahn', 'Bus']);
// Camera cycles chase -> passenger -> cab -> chase (see world/CameraController).
const CAMERA_VIEWS = ['chase', 'passenger', 'cab'];

const logLines = [];
function log(message) {
  const line = `[visual-smoke] ${message}`;
  console.log(line);
  logLines.push(line);
}

let shotIndex = 0;
function slug(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}
async function shoot(page, city, mode, view) {
  const name = `${String(++shotIndex).padStart(3, '0')}__${slug(city)}__${slug(mode)}__${slug(view)}.png`;
  await page.screenshot({ path: path.join(OUT_DIR, name) });
  log(`  📸 ${name}`);
}

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(500);
  }
  throw new Error(`server at ${url} did not become ready within ${timeoutMs}ms`);
}

// Waits until the loading overlay is hidden, a canvas exists, then settles.
async function waitForSceneReady(page) {
  await page
    .waitForFunction(
      () => {
        const loading = document.querySelector('.loading');
        const hidden = !loading || loading.classList.contains('hidden');
        const canvas = document.querySelector('canvas');
        return hidden && !!canvas;
      },
      { timeout: 45000, polling: 250 }
    )
    .catch(() => log('  ⚠️  scene-ready wait timed out; capturing anyway'));
  await sleep(SETTLE_MS);
}

async function dismissDisclaimer(page) {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('.disclaimer-acknowledge');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (clicked) {
    log('dismissed disclaimer');
    await sleep(500);
  }
}

async function clickButtonByText(page, text) {
  const clicked = await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label && !b.disabled
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
  return clicked;
}

async function getCityOptions(page) {
  return page.$$eval('select[aria-label="City"] option', (opts) =>
    opts.map((o) => ({ value: o.value, label: o.textContent?.trim() ?? o.value }))
  );
}

// Enabled transport-mode tabs, in DOM order, as { index, label }.
async function getEnabledModeTabs(page) {
  return page.$$eval('[role="tablist"][aria-label="Means of transport"] [role="tab"]', (tabs) =>
    tabs
      .map((t, index) => ({ index, label: t.textContent?.trim() ?? '', disabled: t.disabled }))
      .filter((t) => !t.disabled)
  );
}

async function clickModeTab(page, index) {
  await page.evaluate((i) => {
    const tabs = document.querySelectorAll('[role="tablist"][aria-label="Means of transport"] [role="tab"]');
    tabs[i]?.click();
  }, index);
}

async function cycleCameras(page, cityLabel, modeLabel) {
  // Initial view is 'chase'; capture it, then click Camera to reach each next view.
  await shoot(page, cityLabel, modeLabel, `cam-${CAMERA_VIEWS[0]}`);
  for (let i = 1; i < CAMERA_VIEWS.length; i += 1) {
    const ok = await clickButtonByText(page, 'Camera');
    if (!ok) {
      log('  ⚠️  Camera button not found');
      break;
    }
    await sleep(Math.max(1200, SETTLE_MS / 2));
    await shoot(page, cityLabel, modeLabel, `cam-${CAMERA_VIEWS[i]}`);
  }
  // Cycle once more to return to 'chase' so the next view starts consistently.
  await clickButtonByText(page, 'Camera');
  await sleep(500);
}

async function testDriveMode(page, cityLabel, modeLabel) {
  await page.select('select[aria-label="Mode"]', 'driver');
  await waitForSceneReady(page);
  await shoot(page, cityLabel, modeLabel, 'drive');
  await page.select('select[aria-label="Mode"]', 'ride');
  await waitForSceneReady(page);
}

async function testPhotoMode(page, cityLabel, modeLabel) {
  const entered = await clickButtonByText(page, 'Photo');
  if (!entered) {
    log('  ⚠️  Photo button not found');
    return;
  }
  await page
    .waitForFunction(() => !!document.querySelector('.photo-overlay'), { timeout: 15000 })
    .catch(() => log('  ⚠️  photo overlay did not appear'));
  await sleep(Math.max(1500, SETTLE_MS));
  await shoot(page, cityLabel, modeLabel, 'photo');
  await clickButtonByText(page, 'Exit');
  await sleep(800);
}

async function run() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let server;
  if (SPAWN_SERVER) {
    log(`starting Vite dev server on port ${PORT}...`);
    server = spawn(
      'npx',
      ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
      { stdio: 'ignore', env: process.env }
    );
    server.on('exit', (code) => {
      if (code && code !== 0) log(`vite exited with code ${code}`);
    });
    await waitForServer(BASE_URL);
    log('dev server ready');
  } else {
    log(`using existing server at ${BASE_URL}`);
  }

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--window-size=1460,980', '--use-gl=angle', '--ignore-gpu-blocklist']
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => log(`  🔴 pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') log(`  🔴 console: ${msg.text()}`);
    });

    log(`opening ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissDisclaimer(page);
    await waitForSceneReady(page);

    let cities = await getCityOptions(page);
    if (ONLY_CITY) cities = cities.filter((c) => c.value.toLowerCase() === ONLY_CITY);
    log(`cities to test: ${cities.map((c) => c.label).join(', ')}`);

    for (const city of cities) {
      log(`CITY: ${city.label}`);
      await page.select('select[aria-label="City"]', city.value);
      await dismissDisclaimer(page);
      await waitForSceneReady(page);

      const modes = await getEnabledModeTabs(page);
      log(`  modes: ${modes.map((m) => m.label).join(', ')}`);

      for (const mode of modes) {
        log(`  MODE: ${mode.label}`);
        await clickModeTab(page, mode.index);
        await waitForSceneReady(page);

        await cycleCameras(page, city.label, mode.label);

        const isStuttgart = city.value.toLowerCase() === 'stuttgart';
        if (isStuttgart && STUTTGART_EXTRA_MODES.has(mode.label)) {
          log(`  (Stuttgart extra) drive + photo for ${mode.label}`);
          await testDriveMode(page, city.label, mode.label);
          await testPhotoMode(page, city.label, mode.label);
        }
      }
    }

    log(`DONE — ${shotIndex} screenshots in ${OUT_DIR}`);
    if (KEEP_OPEN) {
      log('KEEP_OPEN set; leaving the browser open. Press Ctrl+C to quit.');
      await new Promise(() => {});
    }
  } finally {
    if (!KEEP_OPEN) await browser.close();
    if (server) server.kill('SIGTERM');
    await writeFile(path.join(OUT_DIR, 'run.log'), logLines.join('\n') + '\n').catch(() => {});
  }
}

run().catch((err) => {
  console.error('[visual-smoke] failed:', err);
  process.exitCode = 1;
});
