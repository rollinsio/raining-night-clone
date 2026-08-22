#!/usr/bin/env node
/**
 * Headless gameplay smoke test: drives the full slice loop through window.__game and keyboard input.
 * Usage: node tools/smoke.mjs   (dev server must be running on :5173)
 * Checks: movement, attack -> damage, enemy aggro -> player damage, kill -> runes, grace rest -> level-up,
 * ring damage, boss spawn/kill -> day advance, day 3 boss kill -> RESULTS, no console errors.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.URL || 'http://localhost:5173';
function findChromium() {
  const cache = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cache)) return undefined;
  const c = [];
  for (const dir of fs.readdirSync(cache)) {
    const m = /^chromium_headless_shell-(\d+)$/.exec(dir); if (!m) continue;
    const p = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    if (fs.existsSync(p)) c.push({ rev: +m[1], p });
  }
  c.sort((a, b) => b.rev - a.rev); return c[0]?.p;
}
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
let browser;
try { browser = await chromium.launch({ headless: true, args }); } catch { browser = await chromium.launch({ headless: true, args, executablePath: findChromium() }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = async (seconds) => { await page.evaluate((s) => window.__game.advance(s), seconds); await page.waitForTimeout(30); };
const realWait = async (seconds) => { await page.waitForTimeout(seconds * 1000); };

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
await ev(() => window.__game.setQuality('low'));
check('boot: state HUB', await ev(() => window.__game.state === 'HUB'));

await ev(() => window.__game.startExpedition('Wylder'));
await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player);
await ev(() => window.__game.setManual(true));
check('expedition started', true);

// movement via keyboard (no pointer lock needed)
const p0 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
await page.keyboard.down('KeyW'); await step(1.5); await page.keyboard.up('KeyW');
const p1 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
check('WASD movement moves the player', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 2, `moved ${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1)} m`);

// sprint drains stamina, roll gives i-frames
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await step(1.0);
const st = await ev(() => window.__game.game.player.stamina);
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
check('sprint drains stamina', st < 110, `stamina ${st.toFixed(0)}`);
await page.keyboard.press('Space'); await step(0.1);
check('roll state + i-frames', await ev(() => window.__game.game.player.state === 'roll' && window.__game.game.player.iframes > 0));
await step(0.8);

// spawn a soldier in front and attack it with F (light)
await ev(() => { const g = window.__game.game; g.player.teleport(10, 60); g.player.yaw = 0; g.cameraCtl.setOrbit(Math.PI, 0.3, 5.6); g.cameraCtl.snap(); });
const soldierHp0 = await ev(() => { const e = window.__game.spawn('soldier'); e.teleport(10, 62.2); window.__soldier = e; return e.hp; });
await page.keyboard.press('KeyF'); await step(0.6);
const soldierHp1 = await ev(() => window.__soldier.hp);
check('light attack damages enemy', soldierHp1 < soldierHp0, `${soldierHp0} -> ${soldierHp1.toFixed(0)}`);
check('enemy aggro after hit', await ev(() => window.__soldier.aggro === true));

// let the soldier fight back
const hp0 = await ev(() => window.__game.game.player.hp);
await step(6);
const hp1 = await ev(() => window.__game.game.player.hp);
check('enemy attacks damage the player', hp1 < hp0, `${hp0} -> ${hp1.toFixed(0)}`);

// kill it -> runes credited
const runes0 = await ev(() => window.__game.game.player.runes);
await ev(() => window.__game.killAll());
await step(2.0);
const runes1 = await ev(() => window.__game.game.player.runes);
check('kill pays runes', runes1 > runes0, `${runes0} -> ${runes1}`);
check('enemy:died counted', await ev(() => window.__game.game.run.stats.kills >= 1));

// lock-on
await ev(() => { const e = window.__game.spawn('wolf'); e.teleport(10, 66); });
await page.keyboard.press('KeyQ'); await step(0.2);
check('lock-on acquires a target', await ev(() => !!window.__game.game.player.lockTarget));
await page.keyboard.press('KeyQ');
await ev(() => window.__game.killAll()); await step(1.5);

// grace rest -> level-up menu
await ev(() => { const g = window.__game.game; const s = g.graces.sites[7]; g.player.teleport(s.x + 1.5, s.z); g.player.hp = 50; g.player.runes += 2000; });
await step(0.3);
await page.keyboard.press('KeyE'); await step(0.4);
check('grace rest opens level-up menu', await ev(() => window.__game.game.menus.open === 'levelup'));
check('grace rest heals', await ev(() => window.__game.game.player.hp === window.__game.game.player.maxHp));
const lvl0 = await ev(() => window.__game.game.player.level);
await page.click('#m-lvl'); await step(0.2);
check('level up spends runes and raises level', await ev((l) => window.__game.game.player.level === l + 1, lvl0));
await page.click('#m-leave'); await step(0.2);
check('leaving menu resumes sim', await ev(() => !window.__game.game.paused && !window.__game.game.menus.isOpen()));

// ring damage outside the circle
await ev(() => { const g = window.__game.game; const r = g.run.ring; r.setImmediate({ x: 400, z: 400 }, 60); g.player.teleport(10, 60); g.player.hp = g.player.maxHp; });
await step(2.0);
check('outside ring ticks damage + flag', await ev(() => window.__game.game.player.hp < window.__game.game.player.maxHp && window.__game.game.player.outsideRing));

// boss phase day 1 -> kill -> day 2
await ev(() => window.__game.setTime(1, 1));
await step(0.2);
check('setTime(1, 1) spawns day-1 boss', await ev(() => window.__game.game.run.bossActive && window.__game.game.run.boss && window.__game.game.run.boss.isBoss));
const bossName = await ev(() => window.__game.game.run.boss.name);
await ev(() => window.__game.killAll());
await step(5.5);
check('boss death advances to day 2', await ev(() => window.__game.game.run.day === 2), `killed ${bossName}`);

// day 3 nightlord -> win -> RESULTS
await ev(() => window.__game.setTime(3, 1));
await step(0.2);
const nl = await ev(() => window.__game.game.run.boss && window.__game.game.run.boss.name);
check('day 3 boss is the Nightlord placeholder', /Nightlord/.test(nl || ''), nl);
await ev(() => window.__game.killAll());
await step(5.5);
check('nightlord death -> RESULTS', await ev(() => window.__game.state === 'RESULTS'));
await page.click('#m-return'); await step(0.3);
check('return to hub', await ev(() => window.__game.state === 'HUB'));

// player death + respawn
await ev(() => window.__game.startExpedition('Raider'));
await page.waitForFunction(() => window.__game.state === 'EXPEDITION');
await ev(() => { const p = window.__game.game.player; p.takeRawDamage(1e9); });
await step(0.3); await realWait(0.2);
check('player death emits overlay', await ev(() => !window.__game.game.player.alive && !!document.querySelector('.m-death')));
await step(3.6);
check('player respawns at grace', await ev(() => window.__game.game.player.alive && window.__game.game.player.hp === window.__game.game.player.maxHp));

// pause + map toggles
await page.keyboard.press('Escape'); await step(0.2);
check('Esc opens pause', await ev(() => window.__game.game.menus.open === 'pause' && window.__game.game.paused));
await page.keyboard.press('Escape'); await step(0.2);
check('Esc closes pause', await ev(() => !window.__game.game.menus.isOpen()));
await page.keyboard.press('KeyM'); await step(0.3);
check('M opens map', await ev(() => window.__game.game.map.isOpen));
await page.keyboard.press('KeyM'); await step(0.2);

const fps = await ev(() => window.__game.fps);
console.log(`rolling fps (headless swiftshader, low quality, 1280x720): ${fps.toFixed(1)}`);
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of errors) console.log(' ', e); }
check('no console errors', errors.length === 0, `${errors.length} errors`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
