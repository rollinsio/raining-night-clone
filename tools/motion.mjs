#!/usr/bin/env node
/**
 * Motion review tool: captures one action (a swing, combo, roll, run cycle, or an enemy attack) from fixed camera
 * angles with the sim stepped deterministically, then writes everything needed to judge the *motion* rather than a
 * single frame:
 *
 *   shots/motion/<name>/sheet_<view>.png   contact sheet, every frame labelled with time and attack phase
 *   shots/motion/<name>/onion_<view>.png   onion skin: frames composited with rising opacity + the blade-tip path
 *                                          (dots per frame: grey windup, red active, blue recover — dot spacing is speed)
 *   shots/motion/<name>/motion_<view>.gif  the frames at capture rate (needs ffmpeg on PATH; skipped otherwise)
 *   shots/motion/<name>/trace.json         per-frame numbers (phase, blade hand/tip in the subject's frame, tip speed,
 *                                          ground clearance, elbow angle, hand-to-torso distance, root displacement)
 *   shots/motion/<name>/report.md          summary + checks (blade through ground, peak speed vs hitbox window,
 *                                          motion outside the active window, clipping, trail coverage)
 *
 * Usage: node tools/motion.mjs <action> [--views side,front,rear,top] [--step 2] [--dur 1.4] [--nf Wylder] [--name x]
 *   action: light1 | light2 | light3 | heavy | combo (light x3) | skill | roll | run
 *           soldier:light | soldier:heavy | knight:light | knight:heavy | wolf:light
 * Requires the dev server on :5173 (npx vite --port 5173).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.URL || 'http://localhost:5173';
const W = 640, H = 480;

// ---------------------------------------------------------------------------------------------------- args
const argv = process.argv.slice(2);
const action = argv.find((a) => !a.startsWith('--')) || 'light1';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const VIEWS = opt('views', 'side,front,top').split(',');
const STEP = +opt('step', 2);            // sim frames (1/60 s) per captured frame
const DUR = +opt('dur', action === 'combo' ? 2.0 : action === 'run' ? 1.0 : 1.4);
const NF = opt('nf', 'Wylder');
const NAME = opt('name', action.replace(':', '_'));
const OUT = path.join(ROOT, 'shots', 'motion', NAME);
fs.mkdirSync(OUT, { recursive: true });

// camera placement per view, in the subject's frame: [right, up, forward] offsets from the chest, in units of subject height
const VIEW_DEFS = {
  side: { off: [2.4, 0.35, 0.3], lookUp: 0.0 },    // subject's right side (sword arm nearest the camera)
  front: { off: [1.2, 0.4, 2.2], lookUp: 0.0 },    // front-right three-quarter
  rear: { off: [-1.0, 0.5, -2.3], lookUp: 0.0 },   // behind-left (the gameplay camera side)
  top: { off: [0.25, 3.4, 0.25], lookUp: -0.45 },  // high, looking down: swing arcs in plan
};

// ---------------------------------------------------------------------------------------------------- browser
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
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
await page.evaluate((nf) => { window.__game.setQuality('low'); window.__game.startExpedition(nf); }, NF);
await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player, null, { timeout: 30000 });
await page.waitForTimeout(400);

// ---------------------------------------------------------------------------------------------------- in-page rig
// Installs window.__motion: subject setup, fixed camera, one-step capture with measurements.
await page.evaluate(() => {
  const g = window.__game.game, api = window.__game;
  const V = g.player.pos.constructor, M = g.player.rig.mesh.skeleton.bones[0].matrixWorld.constructor;
  const _m = new M(), _v = new V(), _w = new V(), _a = new V(), _b = new V(), _c = new V();
  const boneWorld = (rig, bone, local, out) => {
    const idx = rig.mesh.skeleton.bones.indexOf(bone);
    _m.multiplyMatrices(bone.matrixWorld, rig.mesh.skeleton.boneInverses[idx]);
    return out.copy(local).applyMatrix4(_m);
  };
  const toLocal = (p, subj, out) => { // subject frame: x right(-), z forward, origin at the feet, facing +z
    out.copy(p).sub(subj.pos);
    const s = Math.sin(-subj.yaw), c = Math.cos(-subj.yaw), x = out.x, z = out.z;
    out.x = x * c + z * s; out.z = -x * s + z * c; return out;
  };
  const segDist = (p, a, b) => { // distance from p to segment ab
    _c.subVectors(b, a); const l2 = _c.lengthSq(); let t = l2 > 0 ? _v.subVectors(p, a).dot(_c) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return _w.copy(a).addScaledVector(_c, t).distanceTo(p);
  };
  const st = { subject: null, camUpdate: null, hudVis: true, prevTip: null, prevDir: null, prevT: 0 };

  window.__motion = {
    /** Prepare: player or a spawned enemy standing on a flat spot, HUD hidden, sim manual, camera frozen. */
    setup(kind) {
      g.manualSim = true;
      const p = g.player;
      api.teleport(150, 210); p.yaw = 0; p.setState('idle'); p.anim.play('idle', { restart: true }); p.attack.phase = 'none';
      for (const e of g.entities) if (e !== p) e.frozen = true;
      let subj = p;
      if (kind !== 'player') {
        const e = api.spawn(kind === 'knight' ? 'guard' : kind); // guard = tier-2 soldier (knight weapon)
        e.teleport(150, 214); e.yaw = Math.PI; e.stop && e.stop(); // faces the player, held frozen until start()
        e.setState('idle'); e.anim.play('idle', { restart: true }); e.frozen = true;
        p.teleport(150, 200); p.yaw = 0; // player well behind the camera
        subj = e;
      }
      st.subject = subj;
      if (!st.camUpdate) { st.camUpdate = g.cameraCtl.update; g.cameraCtl.update = () => {}; }
      st.hudVis = g.hud.visible; g.hud.setVisible(false);
      api.advance(0.5); // settle idle
      st.prevTip = null;
      return { name: subj.name || 'player', weapon: subj.weapon && subj.weapon.visual, height: subj.height * subj.scale, moveset: subj.moveset && Object.keys(subj.moveset) };
    },
    /** Fixed camera in the subject's frame: off = [right, up, forward] × subject height from the chest. */
    camera(off, lookUp = 0) {
      const s = st.subject, h = s.height * s.scale, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -fz, rz = fx; // model right is -X when facing +Z
      const cx = s.pos.x, cz = s.pos.z, cy = s.pos.y + h * 0.6;
      g.camera.position.set(cx + rx * off[0] * h + fx * off[2] * h, cy + off[1] * h, cz + rz * off[0] * h + fz * off[2] * h);
      g.camera.lookAt(cx, cy + lookUp * h, cz);
      g.camera.updateMatrixWorld(true);
    },
    /** Kick off the action on the subject. */
    start(action) {
      const s = st.subject;
      if (s === g.player) {
        if (action === 'roll') { s.buffer('roll'); return; }
        if (action === 'run') { return; } // driven by input in step()
        if (action === 'skill') { s.buffer('skill'); return; }
        if (action === 'heavy') { s.buffer('heavy'); return; }
        s.buffer('light'); return;
      }
      const def = action === 'heavy' ? s.moveset.heavy : s.moveset.light[0];
      s.frozen = false; s.setAggro && s.setAggro(); s.comboNext = false; s.startAttack(def); // aggro first: setAggro() would flip a fresh attack to 'alert'
    },
    /** Advance n sim frames (with the combo buffer re-pressed at the right time), render, measure. */
    step(n, action, t) {
      const s = st.subject, p = g.player;
      for (let i = 0; i < n; i++) {
        if (s === p && action === 'combo' && p.state === 'attack' && p.attack.phase === 'recover' && !p.bufferAction) p.buffer('light');
        g.update(1 / 60);
      }
      this.camera(this._off, this._lookUp); // tracks the root (translation only): the onion skin is in the subject's frame
      g.render();
      // measurements
      const rig = s.rig, out = { t, state: s.state, phase: s.attack ? s.attack.phase : 'none', clip: s.anim.name };
      const def = s.attack && s.attack.def;
      if (def && out.phase !== 'none') {
        const a = s.attack.t; out.u = a < def.windup ? a / def.windup : a < def.windup + def.active ? 1 + (a - def.windup) / def.active : 2 + Math.min(1, (a - def.windup - def.active) / def.recover);
      }
      toLocal(s.pos, { pos: st.origin || (st.origin = s.pos.clone()), yaw: s.yaw }, _a); out.root = [+_a.x.toFixed(3), +_a.z.toFixed(3)];
      const handBone = rig && rig.bones && (rig.bones.wristR || rig.bones.elbowR); // enemy rigs have no wrist bone
      if (handBone && rig.handRLocal) {
        const h = rig.handRLocal, span = (window.__motionSpan || 1.0), c = Math.cos(0.35), sn = Math.sin(0.35);
        _v.set(h.x, h.y - span * c, h.z + span * sn);
        boneWorld(rig, handBone, _v, _w); const tipW = _w.clone();
        boneWorld(rig, handBone, h, _w); const handW = _w.clone();
        toLocal(tipW, s, _a); out.tip = [+_a.x.toFixed(3), +_a.y.toFixed(3), +_a.z.toFixed(3)];
        toLocal(handW, s, _a); out.hand = [+_a.x.toFixed(3), +_a.y.toFixed(3), +_a.z.toFixed(3)];
        out.tipClear = +(tipW.y - g.terrain.getHeight(tipW.x, tipW.z)).toFixed(3);
        if (st.prevTip) out.tipSpeed = +(tipW.distanceTo(st.prevTip) / Math.max(1e-6, t - st.prevT)).toFixed(2);
        _a.subVectors(tipW, handW).normalize();
        if (st.prevDir) out.bladeDegPerFrame = +(((Math.acos(Math.max(-1, Math.min(1, _a.dot(st.prevDir)))) * 180) / Math.PI) / Math.max(1, (t - st.prevT) * 60)).toFixed(1);
        st.prevDir = _a.clone();
        st.prevTip = tipW; st.prevT = t;
        _v.copy(tipW).project(g.camera); out.tipScreen = [+(((_v.x + 1) / 2) * innerWidth).toFixed(1), +(((1 - _v.y) / 2) * innerHeight).toFixed(1)];
        // elbow angle + hand-to-torso clearance
        const b = rig.bones;
        _a.setFromMatrixPosition(b.shoulderR.matrixWorld); _b.setFromMatrixPosition(b.elbowR.matrixWorld);
        if (b.wristR) _c.setFromMatrixPosition(b.wristR.matrixWorld); else _c.copy(handW);
        const u1 = _a.clone().sub(_b).normalize(), u2 = _c.clone().sub(_b).normalize();
        out.elbowDeg = +((Math.acos(Math.max(-1, Math.min(1, u1.dot(u2)))) * 180) / Math.PI).toFixed(1);
        if (b.hips && b.head) { _a.setFromMatrixPosition(b.hips.matrixWorld); _b.setFromMatrixPosition(b.head.matrixWorld); out.handTorso = +segDist(handW, _a, _b).toFixed(3); }
      }
      if (s.attack && s.attack.hitSet) out.hits = s.attack.hitSet.size;
      const trail = s._trail && s._trail.owner === s ? s._trail : null; out.trailSamples = trail ? trail.count : 0;
      return out;
    },
    setView(off, lookUp) { this._off = off; this._lookUp = lookUp; this.camera(off, lookUp); },
    /**
     * Subject-only render over a magenta key (no fog) so the sheet builder can cut ghosts out of the frame. The
     * page's own frame loop keeps rendering, so while `on` the game's render() is swapped for this pass.
     */
    mask(on) {
      if (!on) { if (st.render) { g.render = st.render; st.render = null; } g.render(); return; }
      const s = st.subject, sc = g.scene, C = g.player.flashColor.constructor, key = new C(1, 0, 1);
      const pass = () => {
        const vis = sc.children.map((o) => o.visible), bg = sc.background, fog = sc.fog;
        for (const o of sc.children) o.visible = o === s.object3d;
        sc.background = key; sc.fog = null;
        g.renderer.render(sc, g.camera);
        sc.children.forEach((o, i) => { o.visible = vis[i]; }); sc.background = bg; sc.fog = fog;
      };
      if (!st.render) st.render = g.render;
      g.render = pass; pass();
    },
    bladeSpan(v) { window.__motionSpan = v; },
    restore() { if (st.camUpdate) { g.cameraCtl.update = st.camUpdate; st.camUpdate = null; } g.hud.setVisible(st.hudVis); st.origin = null; },
    resetOrigin() { st.origin = null; st.prevTip = null; st.prevDir = null; },
  };
});

const [kind, sub] = action.includes(':') ? action.split(':') : ['player', action];
const info = await page.evaluate((k) => window.__motion.setup(k), kind);
// blade length for the tip probe: trail span tip per weapon visual (mirrors combat/Weapons.js TRAIL_SPAN)
const SPAN = { greatsword: 1.56, sword: 1.02, katana: 1.0, halberd: 2.0, axe: 0.98, dagger: 0.55, staff: 1.3, spear: 2.28 };
await page.evaluate((v) => window.__motion.bladeSpan(v), SPAN[info.weapon] || 1.0);
console.log(`subject: ${info.name}  weapon: ${info.weapon}  action: ${action}  views: ${VIEWS.join(',')}  ${1 / (STEP / 60)} fps for ${DUR}s`);

// ---------------------------------------------------------------------------------------------------- capture
const nFrames = Math.round((DUR * 60) / STEP);
const frames = {}; // view -> [{file, trace}]
for (const view of VIEWS) {
  const vd = VIEW_DEFS[view]; if (!vd) { console.warn('unknown view', view); continue; }
  await page.evaluate((k) => window.__motion.setup(k), kind);
  await page.evaluate(({ off, lookUp }) => window.__motion.setView(off, lookUp), vd);
  await page.evaluate(() => window.__motion.resetOrigin());
  await page.evaluate((a) => window.__motion.start(a), sub);
  if (sub === 'run') { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); } // real input: W is camera-relative forward (+Z here)
  const list = [];
  for (let i = 0; i < nFrames; i++) {
    const t = +(((i + 1) * STEP) / 60).toFixed(3);
    const trace = await page.evaluate(([n, a, tt]) => window.__motion.step(n, a, tt), [STEP, sub, t]);
    const file = path.join(OUT, `${view}_${String(i).padStart(3, '0')}.png`), mask = file.replace('.png', '_m.png');
    await page.screenshot({ path: file });
    await page.evaluate(() => window.__motion.mask(true));
    await page.screenshot({ path: mask });
    await page.evaluate(() => window.__motion.mask(false));
    list.push({ file, mask, trace });
  }
  frames[view] = list;
  if (sub === 'run') { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
}
await page.evaluate(() => window.__motion.restore());

// ---------------------------------------------------------------------------------------------------- analysis (from the first view's trace; geometry is view-independent)
const trace = frames[VIEWS[0]].map((f) => f.trace);
fs.writeFileSync(path.join(OUT, 'trace.json'), JSON.stringify({ action, subject: info, step: STEP, frames: trace }, null, 1));
const checks = [];
const active = trace.filter((f) => f.phase === 'active'), moving = trace.filter((f) => f.tipSpeed !== undefined && f.phase !== 'none');
const withTip = trace.filter((f) => f.tip), swing = trace.filter((f) => f.phase && f.phase !== 'none');
if (withTip.length && swing.length) {
  const minClear = Math.min(...swing.map((f) => f.tipClear ?? 9));
  const under = swing.filter((f) => (f.tipClear ?? 9) < 0);
  checks.push({ ok: under.length === 0, name: 'blade stays above ground', detail: under.length ? `tip below ground on ${under.length} frame(s), lowest ${minClear.toFixed(2)} m (t=${under.map((f) => f.t).join(', ')})` : `lowest tip clearance ${minClear.toFixed(2)} m` });
  const cutFrames = moving.filter((f) => f.u === undefined || f.u >= 0.85); // ignore the anticipation raise
  const peak = cutFrames.reduce((a, f) => (f.tipSpeed > (a ? a.tipSpeed : -1) ? f : a), null);
  if (peak) {
    const inActive = peak.phase === 'active';
    checks.push({ ok: inActive, name: 'peak tip speed inside the hitbox window', detail: `peak ${peak.tipSpeed} m/s at t=${peak.t} (${peak.phase}${peak.u !== undefined ? ', u=' + peak.u.toFixed(2) : ''})` });
    // readability: real cuts peak at 1100–2300°/s (18–38° per 60 fps frame); with a trail, ~25°/frame (1500°/s) still reads as a swing.
    // Judged over the cut (last 15 % of the windup through recovery); the anticipation snap is reported separately.
    const cut = swing.filter((f) => f.u !== undefined && f.u >= 0.85), antic = swing.filter((f) => f.u !== undefined && f.u < 0.85);
    const maxDeg = Math.max(0, ...cut.map((f) => f.bladeDegPerFrame ?? 0)), anticDeg = Math.max(0, ...antic.map((f) => f.bladeDegPerFrame ?? 0));
    const cutPeak = cut.reduce((a, f) => ((f.tipSpeed ?? 0) > a ? f.tipSpeed : a), 0);
    checks.push({ ok: maxDeg <= 25, name: 'cut readable at 60 fps (blade ≤ 25° per frame)', detail: `blade turns up to ${maxDeg.toFixed(1)}° per 1/60 s frame through the cut (tip ${(cutPeak / 60).toFixed(2)} m per frame); anticipation snap up to ${anticDeg.toFixed(1)}° per frame` });
  }
  const dist = (ph) => trace.filter((f) => f.phase === ph && f.tipSpeed !== undefined).reduce((s, f) => s + f.tipSpeed * (STEP / 60), 0);
  const dW = dist('windup'), dA = dist('active'), dR = dist('recover'), dT = dW + dA + dR;
  if (dT > 0) checks.push({ ok: dA / dT > 0.4, name: 'most blade travel happens during active frames', detail: `tip path: windup ${dW.toFixed(2)} m, active ${dA.toFixed(2)} m (${((100 * dA) / dT).toFixed(0)} %), recover ${dR.toFixed(2)} m` });
  const nearTorso = swing.filter((f) => f.handTorso !== undefined && f.handTorso < 0.14);
  checks.push({ ok: nearTorso.length === 0, name: 'sword hand clears the torso', detail: nearTorso.length ? `hand within 14 cm of the torso axis on ${nearTorso.length} frame(s) (t=${nearTorso.map((f) => f.t).join(', ')})` : `closest ${Math.min(...swing.map((f) => f.handTorso ?? 9)).toFixed(2)} m` });
  const elbows = swing.map((f) => f.elbowDeg).filter((x) => x !== undefined);
  if (elbows.length) checks.push({ ok: Math.max(...elbows) <= 178, name: 'elbow never locks flat', detail: `elbow angle ${Math.min(...elbows).toFixed(0)}°–${Math.max(...elbows).toFixed(0)}°` });
  if (active.length) {
    const trailed = active.filter((f) => f.trailSamples > 0).length;
    checks.push({ ok: trailed >= active.length - 1, name: 'trail samples through the active window', detail: `${trailed}/${active.length} active frames have trail samples` });
    const last = trace[trace.length - 1];
    if (last.root) checks.push({ ok: true, name: 'root motion', detail: `subject moved ${Math.hypot(last.root[0], last.root[1]).toFixed(2)} m over the capture` });
  }
} else {
  const last = trace[trace.length - 1], d = last.root ? Math.hypot(last.root[0], last.root[1]) : 0;
  checks.push({ ok: true, name: 'no attack phases in this capture', detail: `locomotion/roll: root moved ${d.toFixed(2)} m in ${last.t.toFixed(2)} s (${(d / last.t).toFixed(2)} m/s)` });
}
const phases = [];
for (const f of trace) { const p = f.phase + (f.state === 'roll' ? '/roll' : ''); if (!phases.length || phases[phases.length - 1].p !== p) phases.push({ p, t0: f.t, t1: f.t }); else phases[phases.length - 1].t1 = f.t; }

// ---------------------------------------------------------------------------------------------------- sheets (composited in a blank page with canvas)
const sheetPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await sheetPage.setContent('<canvas id=c></canvas>');
const toDataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
async function renderCanvas(w, h, fn, args, outFile) {
  await sheetPage.setViewportSize({ width: w, height: h });
  await sheetPage.evaluate(async ([w, h, src, args]) => {
    const c = document.getElementById('c'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    const load = (u) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = u; });
    const imgs = await Promise.all(args.urls.map(load));
    await (new Function('ctx', 'imgs', 'a', 'W', 'H', src))(ctx, imgs, args, w, h);
  }, [w, h, fn, args]);
  await sheetPage.screenshot({ path: outFile, clip: { x: 0, y: 0, width: w, height: h } });
}
const SHEET_FN = `
  const cols = a.cols, tw = a.tw, th = a.th; ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
  imgs.forEach((im, i) => { const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 16); ctx.drawImage(im, x, y, tw, th);
    const f = a.traces[i]; ctx.fillStyle = f.phase === 'active' ? '#ff5a3c' : f.phase === 'windup' ? '#cfcfcf' : f.phase === 'recover' ? '#6aa0ff' : '#888';
    ctx.font = '12px monospace'; ctx.fillText((f.t.toFixed(2)) + 's  ' + (f.phase !== 'none' ? f.phase : f.state) + (f.u !== undefined ? '  u=' + f.u.toFixed(2) : '') + (f.tipSpeed !== undefined ? '  ' + f.tipSpeed.toFixed(0) + ' m/s' : ''), x + 4, y + th + 12); });
  ctx.fillStyle = '#eee'; ctx.font = '13px monospace'; ctx.fillText(a.title, 6, H - 6);`;
const ONION_FN = `
  const n = imgs.length / 2; // [frame..., mask...]
  ctx.drawImage(imgs[0], 0, 0, W, H); // full background from the first frame
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const x2 = c2.getContext('2d');
  const c3 = document.createElement('canvas'); c3.width = W; c3.height = H; const x3 = c3.getContext('2d');
  for (let i = 0; i < n; i++) {
    x3.drawImage(imgs[n + i], 0, 0, W, H); const m = x3.getImageData(0, 0, W, H).data;
    x2.drawImage(imgs[i], 0, 0, W, H); const d = x2.getImageData(0, 0, W, H);
    for (let k = 0; k < m.length; k += 4) { const key = m[k] > 200 && m[k + 1] < 60 && m[k + 2] > 200; if (key) d.data[k + 3] = 0; }
    x2.putImageData(d, 0, 0);
    ctx.globalAlpha = n > 1 ? 0.3 + 0.7 * (i / (n - 1)) : 1; ctx.drawImage(c2, 0, 0);
  }
  ctx.globalAlpha = 1;
  const pts = a.traces.filter((f) => f.tipScreen); if (pts.length) {
    const col = (f, al) => (f.phase === 'active' ? 'rgba(255,90,60,' : f.phase === 'windup' ? 'rgba(230,230,230,' : f.phase === 'recover' ? 'rgba(106,160,255,' : 'rgba(150,150,150,') + al + ')';
    for (let i = 1; i < pts.length; i++) { const f = pts[i], act = f.phase === 'active'; ctx.lineWidth = act ? 3 : 1.5; ctx.strokeStyle = col(f, act ? 0.95 : 0.4);
      ctx.beginPath(); ctx.moveTo(pts[i - 1].tipScreen[0], pts[i - 1].tipScreen[1]); ctx.lineTo(f.tipScreen[0], f.tipScreen[1]); ctx.stroke(); }
    for (const f of pts) { const [x, y] = f.tipScreen, act = f.phase === 'active'; ctx.fillStyle = col(f, act ? 1 : 0.7); ctx.beginPath(); ctx.arc(x, y, act ? 4 : 2.5, 0, 6.283); ctx.fill(); }
  }
  ctx.fillStyle = '#eee'; ctx.font = '13px monospace'; ctx.fillText(a.title + '   tip path: grey windup / red active / blue recover', 6, H - 6);`;
for (const view of VIEWS) {
  const list = frames[view]; if (!list) continue;
  const traces = list.map((f) => f.trace);
  const cols = Math.min(6, list.length), tw = 400, th = 300, rows = Math.ceil(list.length / cols);
  await renderCanvas(cols * tw, rows * (th + 16) + 28, SHEET_FN, { urls: list.map((f) => toDataUrl(f.file)), traces, cols, tw, th, title: `${action} — ${view} — ${info.name}/${info.weapon} — ${60 / STEP} fps` }, path.join(OUT, `sheet_${view}.png`));
  // onion: every frame while a swing is live, every other frame otherwise, capped at 24 layers
  const live = list.map((f, i) => ({ f, i })).filter(({ f }) => f.trace.phase !== 'none' || action === 'roll' || action === 'run');
  const pick = (live.length ? live : list.map((f, i) => ({ f, i }))).filter((_, k, arr) => k % Math.max(1, Math.ceil(arr.length / 24)) === 0);
  await renderCanvas(W, H, ONION_FN, { urls: [...pick.map(({ f }) => toDataUrl(f.file)), ...pick.map(({ f }) => toDataUrl(f.mask))], traces: pick.map(({ f }) => f.trace), title: `${action} — ${view}` }, path.join(OUT, `onion_${view}.png`));
  // gif
  const ff = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(60 / STEP), '-i', path.join(OUT, `${view}_%03d.png`), '-vf', 'scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer', path.join(OUT, `motion_${view}.gif`)]);
  if (ff.status !== 0) fs.rmSync(path.join(OUT, `motion_${view}.gif`), { force: true });
}
await sheetPage.close();
for (const view of VIEWS) for (const f of frames[view] || []) { fs.rmSync(f.file, { force: true }); fs.rmSync(f.mask, { force: true }); } // raw frames are transient

// ---------------------------------------------------------------------------------------------------- report
const lines = [`# Motion review — ${action} (${info.name}, ${info.weapon})`, '', `Captured ${nFrames} frames at ${60 / STEP} fps from: ${VIEWS.join(', ')}.`, '',
  '## Phases', ...phases.map((p) => `- ${p.p}: ${p.t0.toFixed(2)}–${p.t1.toFixed(2)} s`), '', '## Checks',
  ...checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`), '',
  '## Files', ...VIEWS.flatMap((v) => [`- sheet_${v}.png — contact sheet`, `- onion_${v}.png — onion skin + tip path`, `- motion_${v}.gif`]), '- trace.json — per-frame numbers', '',
  errors.length ? `## Console errors\n${errors.map((e) => '- ' + e).join('\n')}` : 'No console errors.'];
fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
console.log(lines.slice(4).join('\n'));
console.log(`\nwrote ${path.relative(ROOT, OUT)}/`);
await browser.close();
process.exit(errors.length ? 1 : 0);
