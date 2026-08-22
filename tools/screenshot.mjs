#!/usr/bin/env node
/**
 * Playwright screenshot tool. Usage: node tools/screenshot.mjs [poseName...]
 * Requires a running dev server (npx vite --port 5173). Launches headless Chromium with SwiftShader,
 * starts an expedition as Wylder, captures shots/<pose>.png for each pose and prints fps over 3 s.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.URL || 'http://localhost:5173';
const ALL = ['vista', 'combat', 'grace', 'ring', 'boss', 'church', 'catacomb', 'hub'];
const poses = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

const SWIFT = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--no-sandbox'];
const FALLBACK = ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'];

/** Newest cached headless Chromium in ~/Library/Caches/ms-playwright (falls back to playwright's default). */
function findChromium() {
  const cache = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cache)) return undefined;
  const candidates = [];
  for (const dir of fs.readdirSync(cache)) {
    const m = /^(chromium_headless_shell|chromium)-(\d+)$/.exec(dir);
    if (!m) continue;
    const rev = +m[2];
    const exe = m[1] === 'chromium'
      ? path.join(cache, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    const alt = m[1] === 'chromium' ? path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium') : path.join(cache, dir, 'chrome-headless-shell-mac', 'chrome-headless-shell');
    const p = fs.existsSync(exe) ? exe : fs.existsSync(alt) ? alt : null;
    if (p) candidates.push({ rev, p, shell: m[1] !== 'chromium' });
  }
  candidates.sort((a, b) => b.rev - a.rev || (a.shell ? -1 : 1));
  return candidates[0]?.p;
}

async function launch() {
  const attempts = [{ args: SWIFT }, { args: SWIFT, executablePath: findChromium() }, { args: FALLBACK, executablePath: findChromium() }, { args: FALLBACK }];
  let lastErr;
  for (const a of attempts) {
    if ('executablePath' in a && !a.executablePath) continue;
    try { const b = await chromium.launch({ headless: true, ...a }); console.log('launched chromium', a.executablePath || '(playwright default)', 'args:', a.args[0]); return b; }
    catch (e) { lastErr = e; console.warn('launch failed:', e.message.split('\n')[0]); }
  }
  throw lastErr;
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const problems = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error') problems.push(`[console.${t}] ${m.text()}`); else if (t === 'warning') console.log(`[console.warning] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

/** (Re)open the game and start an expedition. Retries across Vite full reloads caused by parallel edits. */
async function openGame() {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
      await page.evaluate(() => { window.__game.setQuality('high'); window.__game.startExpedition('Wylder'); });
      await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player, null, { timeout: 30000 });
      await page.waitForTimeout(800);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`open attempt ${attempt} failed: ${String(e.message).split('\n')[0]} — retrying in 8 s`);
      problems.length = 0; // errors from a half-reloaded page are not the build's fault
      await page.waitForTimeout(8000);
    }
  }
  console.error(`Could not open ${URL} after retries — start the dev server first: npx vite --port 5173\n${lastErr && lastErr.message}`);
  await browser.close(); process.exit(2);
}
await openGame();
const gl = await page.evaluate(() => { const g = window.__game.game.renderer.getContext(); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log('renderer:', gl);

/** Mean luma of a PNG via ffmpeg signalstats (NaN if ffmpeg is unavailable). A black frame is a capture fault. */
function meanLuma(file) {
  try {
    const r = spawnSync('ffmpeg', ['-loglevel', 'info', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /YAVG=([\d.]+)/.exec(String(r.stdout || '') + String(r.stderr || ''));
    return m ? Number(m[1]) : NaN;
  } catch { return NaN; }
}

const outDir = path.join(ROOT, 'shots');
fs.mkdirSync(outDir, { recursive: true });
for (const pose of poses) {
  const file = path.join(outDir, `${pose}.png`);
  let ok = false, lastMsg = '';
  for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
    try {
      await page.evaluate((p) => window.__game.screenshotPose(p), pose);
      await page.waitForTimeout(attempt === 1 ? 500 : 1500);
      await page.screenshot({ path: file });
      const luma = meanLuma(file);
      if (!Number.isNaN(luma) && luma < 30) throw new Error(`blank frame (mean luma ${luma.toFixed(1)})`);
      console.log('wrote', path.relative(ROOT, file));
      ok = true;
    } catch (e) {
      lastMsg = String(e.message).split('\n')[0];
      console.warn(`[pose ${pose}] attempt ${attempt} failed: ${lastMsg}`);
      if (/context|destroyed|navigation|detached|Target closed|__game/i.test(lastMsg) || /blank/.test(lastMsg)) {
        await page.waitForTimeout(6000);
        await openGame();
      }
    }
  }
  if (!ok) problems.push(`[pose ${pose}] ${lastMsg}`);
}

// fps: resume the sim in the vista composition and measure frames over 3 s
await page.evaluate(() => { if (window.__game.state !== 'EXPEDITION') window.__game.startExpedition('Wylder'); window.__game.screenshotPose('vista'); window.__game.resume(); });
await page.waitForTimeout(500);
const f0 = await page.evaluate(() => window.__game.frameCount);
await page.waitForTimeout(3000);
const f1 = await page.evaluate(() => window.__game.frameCount);
const rolling = await page.evaluate(() => window.__game.fps);
console.log(`fps (3 s, headless ${gl.includes('SwiftShader') ? 'swiftshader' : 'gpu'}): ${((f1 - f0) / 3).toFixed(1)}  rolling: ${rolling.toFixed(1)}`);

const drawCalls = await page.evaluate(() => { const i = window.__game.game.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, programs: i.programs.length }; });
console.log('renderer.info:', JSON.stringify(drawCalls));

if (problems.length) { console.log('\nPROBLEMS:'); for (const p of problems) console.log(' ', p); }
else console.log('no console errors');
await browser.close();
process.exit(problems.length ? 1 : 0);
