#!/usr/bin/env node
/**
 * Touch-controls smoke test (the Android build's input path): boots the game in a touch-enabled
 * context, drives real CDP touch events, and checks the virtual stick, look pad, tap-lock-on,
 * action buttons, sprint latch and pause button end-to-end through window.__game — in portrait
 * (the Android orientation) and again in landscape (tablets / phone browsers). Button coordinates
 * come from the live DOM, so the per-orientation layout tables are what's actually exercised.
 * Usage: node tools/touch-smoke.mjs   (dev server must be running on :5173)
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5173';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const browser = await chromium.launch({ headless: true, args });

const results = [];

async function run(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${label}] ${name}${info ? '  (' + info + ')' : ''}`); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const step = async (seconds) => { await page.evaluate((s) => window.__game.advance(s), seconds); await page.waitForTimeout(30); };

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); };
  /** Centre of an overlay button, from the live DOM (exercises the orientation's layout table). */
  const btnC = (key) => ev((k) => { const r = window.__game.game.touch.btns[k].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, key);
  const tapBtn = async (key) => { const c = await btnC(key); await tap(c.x, c.y); };

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
  // swiftshader renders at <2 fps and starves event handlers, breaking tap-duration checks;
  // cap the frame loop so pointer handlers run promptly (real devices run 30-60 fps).
  await ev(() => { window.__game.setQuality('low'); window.__game.setFps(1); });

  // a first touch (in the hub) activates the overlay; while the HUD is hidden so is the overlay
  await tap(width * 0.5, height * 0.25);
  await page.waitForTimeout(100);
  check('first touch activates touch mode', await ev(() => window.__game.game.touch.active && window.__game.game.input.noLock));
  check('overlay hidden while HUD is (hub)', await ev(() => getComputedStyle(document.querySelector('.t-ui')).display === 'none'));

  await ev(() => window.__game.startExpedition('Wylder'));
  await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player);
  await ev(() => window.__game.setManual(true));
  await step(0.2);
  check('overlay visible in expedition', await ev(() => getComputedStyle(document.querySelector('.t-ui')).display !== 'none'));

  // virtual stick: press on the left pad, push up -> player walks forward
  const sx = width * 0.2, sy = height * 0.62;
  const p0 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
  await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
  await touch('touchMove', [{ x: sx, y: sy - 70, id: 1 }]);
  check('stick appears at the touch point', await ev(() => document.querySelector('.t-stick').style.display === 'block'));
  await step(1.5);
  await touch('touchEnd', []);
  const p1 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  check('stick moves the player', moved > 2, `moved ${moved.toFixed(1)} m`);
  check('stick release stops movement', await ev(() => window.__game.game.input.touchAxis.x === 0 && window.__game.game.input.touchAxis.y === 0));

  // look pad: drag rotates the camera
  const lx = width * 0.72, ly = height * 0.32;
  const yaw0 = await ev(() => window.__game.game.cameraCtl.yaw);
  await touch('touchStart', [{ x: lx, y: ly, id: 1 }]);
  await touch('touchMove', [{ x: lx - 90, y: ly, id: 1 }]);
  await step(0.1);
  await touch('touchEnd', []);
  const yaw1 = await ev(() => window.__game.game.cameraCtl.yaw);
  check('look-pad drag rotates the camera', Math.abs(yaw1 - yaw0) > 0.1, `Δyaw ${(yaw1 - yaw0).toFixed(2)} rad`);

  // quick tap on the look pad = lock-on (needs a target in range)
  await ev(() => window.__game.spawn('soldier'));
  await step(0.1);
  await tap(lx, ly);
  await step(0.1);
  check('look-pad tap toggles lock-on', await ev(() => !!window.__game.game.cameraCtl.lockTarget));
  await tap(lx, ly);
  await step(0.1);
  check('second tap releases lock-on', await ev(() => !window.__game.game.cameraCtl.lockTarget));

  // buttons: ATK feeds `light` on the press edge; ROLL puts the player in the roll state
  const atk = await btnC('atk');
  await touch('touchStart', [{ x: atk.x, y: atk.y, id: 1 }]);
  check('ATK button presses `light`', await ev(() => window.__game.game.input.pressed.has('light')));
  await touch('touchEnd', []);
  await step(1.2); // let the attack finish
  await tapBtn('roll');
  let rolled = false;
  for (let i = 0; i < 5 && !rolled; i++) { await step(0.1); rolled = await ev(() => window.__game.game.player.state === 'roll'); }
  check('ROLL button rolls', rolled);
  await step(1.0);

  // sprint latch: tap SPR, move -> sprinting; releasing the stick clears the latch
  await tapBtn('spr');
  check('SPR tap latches sprint', await ev(() => window.__game.game.input.held.has('sprint')));
  await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
  await touch('touchMove', [{ x: sx, y: sy - 80, id: 1 }]);
  await step(1.0);
  const sprinting = await ev(() => window.__game.game.player.sprinting);
  await touch('touchEnd', []);
  check('latched sprint sprints while moving', sprinting);
  check('stick release clears the latch', await ev(() => !window.__game.game.input.held.has('sprint')));

  // pause button opens the menu; its Resume button answers a tap
  await tapBtn('pause');
  await step(0.1);
  check('pause button opens pause menu', await ev(() => window.__game.game.menus.open === 'pause'));
  await page.tap('#m-resume');
  await step(0.1);
  check('menu Resume answers a tap', await ev(() => !window.__game.game.menus.isOpen()));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

await run(412, 915, 'portrait');
await run(1280, 720, 'landscape');

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} touch checks passed`);
process.exit(failed ? 1 : 0);
