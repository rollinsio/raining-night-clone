#!/usr/bin/env node
/**
 * Touch-controls smoke test (the Android build's input path): boots the game in a touch-enabled
 * context, drives real CDP touch events, and checks the virtual stick, look pad, tap-lock-on,
 * action buttons, sprint latch and pause button end-to-end through window.__game.
 * Usage: node tools/touch-smoke.mjs   (dev server must be running on :5173)
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5173';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = async (seconds) => { await page.evaluate((s) => window.__game.advance(s), seconds); await page.waitForTimeout(30); };

const cdp = await page.context().newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); };

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
// swiftshader renders at <2 fps and starves event handlers, breaking tap-duration checks;
// cap the frame loop so pointer handlers run promptly (real devices run 30-60 fps).
await ev(() => { window.__game.setQuality('low'); window.__game.setFps(1); });

// a first touch (in the hub) activates the overlay; while the HUD is hidden so is the overlay
await tap(640, 300);
await page.waitForTimeout(100);
check('first touch activates touch mode', await ev(() => window.__game.game.touch.active && window.__game.game.input.noLock));
check('overlay hidden while HUD is (hub)', await ev(() => document.querySelector('.t-ui .t-btn').offsetParent === null));

await ev(() => window.__game.startExpedition('Wylder'));
await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player);
await ev(() => window.__game.setManual(true));
await step(0.2);
check('overlay visible in expedition', await ev(() => document.querySelector('.t-ui .t-btn').offsetParent !== null));

// virtual stick: press on the left pad, push up -> player walks forward
const p0 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
await touch('touchStart', [{ x: 260, y: 420, id: 1 }]);
await touch('touchMove', [{ x: 260, y: 350, id: 1 }]);
check('stick appears at the touch point', await ev(() => document.querySelector('.t-stick').style.display === 'block'));
await step(1.5);
await touch('touchEnd', []);
const p1 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
check('stick moves the player', moved > 2, `moved ${moved.toFixed(1)} m`);
check('stick release stops movement', await ev(() => window.__game.game.input.touchAxis.x === 0 && window.__game.game.input.touchAxis.y === 0));

// look pad: drag rotates the camera
const yaw0 = await ev(() => window.__game.game.cameraCtl.yaw);
await touch('touchStart', [{ x: 900, y: 300, id: 1 }]);
await touch('touchMove', [{ x: 800, y: 300, id: 1 }]);
await step(0.1);
await touch('touchEnd', []);
const yaw1 = await ev(() => window.__game.game.cameraCtl.yaw);
check('look-pad drag rotates the camera', Math.abs(yaw1 - yaw0) > 0.1, `Δyaw ${(yaw1 - yaw0).toFixed(2)} rad`);

// quick tap on the look pad = lock-on (needs a target in range)
await ev(() => window.__game.spawn('soldier'));
await step(0.1);
await tap(900, 300);
await step(0.1);
check('look-pad tap toggles lock-on', await ev(() => !!window.__game.game.cameraCtl.lockTarget));
await tap(900, 300);
await step(0.1);
check('second tap releases lock-on', await ev(() => !window.__game.game.cameraCtl.lockTarget));

// buttons: ATK feeds `light` on the press edge; ROLL puts the player in the roll state
await touch('touchStart', [{ x: 1144, y: 596, id: 1 }]);
check('ATK button presses `light`', await ev(() => window.__game.game.input.pressed.has('light')));
await touch('touchEnd', []);
await step(1.2); // let the attack finish
await touch('touchStart', [{ x: 1226, y: 664, id: 1 }]);
await touch('touchEnd', []);
let rolled = false;
for (let i = 0; i < 5 && !rolled; i++) { await step(0.1); rolled = await ev(() => window.__game.game.player.state === 'roll'); }
check('ROLL button rolls', rolled);
await step(1.0);

// sprint latch: tap SPR, move -> sprinting; releasing the stick clears the latch
await tap(971, 669);
check('SPR tap latches sprint', await ev(() => window.__game.game.input.held.has('sprint')));
await touch('touchStart', [{ x: 260, y: 420, id: 1 }]);
await touch('touchMove', [{ x: 260, y: 340, id: 1 }]);
await step(1.0);
const sprinting = await ev(() => window.__game.game.player.sprinting);
await touch('touchEnd', []);
check('latched sprint sprints while moving', sprinting);
check('stick release clears the latch', await ev(() => !window.__game.game.input.held.has('sprint')));

// pause button opens the menu; its Resume button answers a tap
await tap(1251, 25);
await step(0.1);
check('pause button opens pause menu', await ev(() => window.__game.game.menus.open === 'pause'));
await page.tap('#m-resume');
await step(0.1);
check('menu Resume answers a tap', await ev(() => !window.__game.game.menus.isOpen()));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} touch checks passed`);
process.exit(failed ? 1 : 0);
