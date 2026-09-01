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
check('hub: nightfarer preview rig shown', await ev(() => !!window.__game.game.hubPreview.rig && window.__game.game.hubPreview.id === 'Wylder'));

await ev(() => window.__game.startExpedition('Wylder'));
await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player);
await ev(() => window.__game.setManual(true));
check('expedition started', true);

// movement via keyboard (no pointer lock needed)
const p0 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
await page.keyboard.down('KeyW'); await step(1.5); await page.keyboard.up('KeyW');
const p1 = await ev(() => { const p = window.__game.game.player.pos; return [p.x, p.z]; });
check('WASD movement moves the player', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 2, `moved ${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1)} m`);

// sprint is free out of combat (Nightreign rule) and drains stamina in combat; roll gives i-frames
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await step(1.0);
const stFree = await ev(() => window.__game.game.player.stamina);
check('sprint out of combat is free', stFree >= 110, `stamina ${stFree.toFixed(0)}`);
await ev(() => { window.__game.game.player.combatT = 10; }); await step(1.0);
const st = await ev(() => window.__game.game.player.stamina);
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await ev(() => { window.__game.game.player.combatT = 0; });
check('sprint in combat drains stamina', st < 110, `stamina ${st.toFixed(0)}`);
await page.keyboard.press('Space'); await step(0.1);
check('roll state + i-frames', await ev(() => window.__game.game.player.state === 'roll' && window.__game.game.player.iframes > 0));
await step(0.8);

// jump: V leaves the ground and lands again
await ev(() => { const g = window.__game.game; g.player.teleport(10, 40); g.player.yaw = 0; });
await page.keyboard.press('KeyV'); await step(0.3);
const jump1 = await ev(() => { const g = window.__game.game, p = g.player; return { st: p.state, h: p.pos.y - g.terrain.getHeight(p.pos.x, p.pos.z) }; });
check('jump leaves the ground', jump1.st === 'jump' && jump1.h > 0.5, `h ${jump1.h.toFixed(2)} m at 0.3 s`);
await step(1.2);
const jump2 = await ev(() => { const g = window.__game.game, p = g.player; return { st: p.state, on: p.onGround, h: p.pos.y - g.terrain.getHeight(p.pos.x, p.pos.z) }; });
check('jump lands again', jump2.st !== 'jump' && jump2.on && Math.abs(jump2.h) < 0.06, JSON.stringify(jump2));

// church floors are walkable platforms: a teleport lands ON the plinth and walking around the nave stays on it
const nave = await ev(() => {
  const g = window.__game.game, P = g.limveld.pois.find((q) => q.type === 'church' && !q.ruined);
  const sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
  const x = P.x + -8 * sn, z = P.z + -8 * cs; // kit (0, -8): the nave centre
  g.player.teleport(x, z);
  g.cameraCtl.setOrbit(Math.PI, 0.3, 5.6); g.cameraCtl.snap();
  window.__nave = { x, z };
  return { walkCount: g.colliders.kinds.walk || 0, h: g.player.pos.y - g.terrain.getHeight(x, z) };
});
check('church nave floor holds the player up', nave.h > 0.4 && nave.h < 1.6, `${nave.h.toFixed(2)} m above the heightfield, ${nave.walkCount} platforms`);
await page.keyboard.down('KeyW'); await step(1.0); await page.keyboard.up('KeyW');
const nave2 = await ev(() => { const g = window.__game.game, p = g.player; return { h: p.pos.y - g.terrain.getHeight(p.pos.x, p.pos.z), moved: Math.hypot(p.pos.x - window.__nave.x, p.pos.z - window.__nave.z) }; });
check('walking the nave stays on the floor', nave2.h > 0.3, `${nave2.h.toFixed(2)} m up after ${nave2.moved.toFixed(1)} m`);

// the plinth edge is a wall to feet on the turf; a jump clears it onto the floor
await ev(() => {
  const g = window.__game.game, P = g.limveld.pois.find((q) => q.type === 'church' && !q.ruined);
  const sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
  const kx = 13, kz = 10, tx = 6, tz = 10; // approach the forecourt plinth side (edge x 9.5) on the POI's flat disc
  const x = P.x + kx * cs + kz * sn, z = P.z - kx * sn + kz * cs;
  const wx = P.x + tx * cs + tz * sn, wz = P.z - tx * sn + tz * cs;
  g.player.teleport(x, z);
  const th = Math.atan2(wx - x, wz - z);
  g.player.yaw = th;
  g.cameraCtl.setOrbit(Math.PI + th, 0.3, 5.6); g.cameraCtl.snap();
  window.__edge = { x, z };
});
await page.keyboard.down('KeyW'); await step(1.4);
const edge1 = await ev(() => { const g = window.__game.game, p = g.player; return { h: p.pos.y - g.terrain.getHeight(p.pos.x, p.pos.z), moved: Math.hypot(p.pos.x - window.__edge.x, p.pos.z - window.__edge.z) }; });
check('plinth edge blocks from below', edge1.h < 0.25 && edge1.moved < 5.2, `${edge1.moved.toFixed(1)} m in, ${edge1.h.toFixed(2)} m up`);
await page.keyboard.press('KeyV'); await step(1.1); await page.keyboard.up('KeyW');
const edge2 = await ev(() => { const g = window.__game.game, p = g.player; return p.pos.y - g.terrain.getHeight(p.pos.x, p.pos.z); });
check('a jump clears the plinth edge onto the floor', edge2 > 0.4, `${edge2.toFixed(2)} m up after the jump`);
await step(0.5);

// tree collision: walk straight at a landmark dead tree (valley floor, (128,186) s=1.6) and get stopped by the trunk
await ev(() => { const g = window.__game.game; g.player.teleport(128, 180); g.player.yaw = 0; g.cameraCtl.setOrbit(Math.PI, 0.3, 5.6); g.cameraCtl.snap(); });
await page.keyboard.down('KeyW'); await step(2.0); await page.keyboard.up('KeyW');
const treeD = await ev(() => { const p = window.__game.game.player; return Math.hypot(p.pos.x - 128, p.pos.z - 186); });
check('tree trunks block the player', treeD >= 0.5 * 1.6 + 0.4 && treeD < 3, `stopped ${treeD.toFixed(2)} m from the trunk`);
check('collider grid has trunks', await ev(() => window.__game.game.colliders.count > 500), await ev(() => window.__game.game.colliders.count + ' solids'));
console.log('  solids by kind:', await ev(() => JSON.stringify(window.__game.game.colliders.kinds)));

// boulder collision: the landmark boulder at (106,184) s=2.4 stops the player short of its centre
await ev(() => { const g = window.__game.game; g.player.teleport(106, 177); g.player.yaw = 0; g.cameraCtl.setOrbit(Math.PI, 0.3, 5.6); g.cameraCtl.snap(); });
await page.keyboard.down('KeyW'); await step(2.5); await page.keyboard.up('KeyW');
const bD = await ev(() => { const p = window.__game.game.player; return Math.hypot(p.pos.x - 106, p.pos.z - 184); });
check('boulders block the player', bD >= 1.6 && bD < 5, `stopped ${bD.toFixed(2)} m from the boulder centre`);

// structure collision: walk at the church nave's +x side wall from outside (kit x 11 -> wall face at 5.25) and get stopped
const churchLocal = () => { const g = window.__game.game, p = g.limveld.poi('church'), q = g.player.pos, cs = Math.cos(p.yaw), sn = Math.sin(p.yaw), dx = q.x - p.x, dz = q.z - p.z; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
await ev(() => {
  const g = window.__game.game, p = g.limveld.poi('church'), cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  const L = (lx, lz) => ({ x: p.x + lx * cs + lz * sn, z: p.z - lx * sn + lz * cs });
  const s = L(11, -12), d = L(10, -12);
  g.player.teleport(s.x, s.z); g.player.yaw = Math.atan2(d.x - s.x, d.z - s.z); g.cameraCtl.setOrbit(g.player.yaw + Math.PI, 0.3, 5.6); g.cameraCtl.snap();
});
await page.keyboard.down('KeyW'); await step(3.0); await page.keyboard.up('KeyW');
const wallX = (await ev(churchLocal))[0];
check('church walls block the player', wallX > 5.8 && wallX < 10.5, `kit x ${wallX.toFixed(2)} (wall face at 5.25)`);

// reachability: flood-fill (0.5 m cells, body radius 0.42, climb limit) from the nearest grace / POI approach to every loot item
const unreachable = await ev(() => {
  const g = window.__game.game, T = g.terrain, C = g.colliders, R = 0.42, cell = 0.5, MAX = 0.9;
  const reach = (sx, sz, tx, tz) => {
    const half = 45, n = Math.floor(2 * half / cell) + 1, ox = tx - half, oz = tz - half;
    const seen = new Uint8Array(n * n), gnd = new Float32Array(n * n), q = [];
    const si = Math.round((sx - ox) / cell), sj = Math.round((sz - oz) / cell), ti = Math.round((tx - ox) / cell), tj = Math.round((tz - oz) / cell);
    if (si < 0 || sj < 0 || si >= n || sj >= n) return false;
    const st = T.getHeight(sx, sz), sp = C.groundAt(sx, sz, st, 0.56);
    seen[sj * n + si] = 1; gnd[sj * n + si] = sp > st ? sp : st; q.push(si, sj);
    for (let head = 0; head < q.length;) {
      const i = q[head++], j = q[head++];
      if (Math.abs(i - ti) <= 2 && Math.abs(j - tj) <= 2) return true;
      const h = gnd[j * n + i];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const k = jj * n + ii; if (seen[k]) continue;
        const xx = ox + ii * cell, zz = oz + jj * cell;
        const tt = T.getHeight(xx, zz), pp = C.groundAt(xx, zz, h, 0.56), hh = pp > tt ? pp : tt;
        // stepping onto a platform is a knee step; plain terrain keeps the climb limit; descents are free.
        // seen is only marked on acceptance: a cell rejected from low ground can still be entered from a stair step.
        const ok = pp > tt + 0.01 ? hh - h <= 0.56 : hh - h <= MAX * cell * Math.hypot(di, dj);
        if (!ok || C.overlaps(xx, zz, R, hh, 1.8)) continue;
        seen[k] = 1; gnd[k] = hh; q.push(ii, jj);
      }
    }
    return false;
  };
  const starts = g.graces.sites.map((s) => ({ x: s.x, z: s.z }));
  for (const p of g.limveld.pois) starts.push({ x: p.x + Math.sin(p.yaw) * (p.r + 6), z: p.z + Math.cos(p.yaw) * (p.r + 6) });
  for (const d of g.limveld.dens) starts.push({ x: d.x, z: d.z + 8 });
  const bad = [];
  for (const it of g.loot.items) {
    let s = null, bd = Infinity;
    for (const c of starts) { const d = Math.hypot(c.x - it.x, c.z - it.z); if (d < bd) { bd = d; s = c; } }
    if (!reach(s.x, s.z, it.x, it.z)) bad.push(`${it.kind}@${it.x.toFixed(0)},${it.z.toFixed(0)}`);
  }
  return { bad, n: g.loot.items.length };
});
check('every chest / weapon is reachable on foot', unreachable.bad.length === 0, unreachable.bad.length ? 'unreachable: ' + unreachable.bad.join(' ') : `${unreachable.n} items`);

// steep terrain: the rim face at (-120, ~522) rises faster than 0.9 for 8 m; walking into it must not climb it
await ev(() => { const g = window.__game.game; g.player.teleport(-120, 515); g.player.yaw = 0; g.cameraCtl.setOrbit(Math.PI, 0.3, 5.6); g.cameraCtl.snap(); });
await page.keyboard.down('KeyW'); await step(6.0); await page.keyboard.up('KeyW');
const rim = await ev(() => { const p = window.__game.game.player; return { x: p.pos.x, z: p.pos.z, blocked: !!p.blocked }; });
check('steep terrain blocks the climb', rim.z > 515.5 && rim.z < 523.5 && Math.abs(rim.x + 120) < 8, `at (${rim.x.toFixed(1)}, ${rim.z.toFixed(1)}) blocked=${rim.blocked}`);

// weapons + inventory: pickups stow or equip, X cycles, the held weapon's skill is what 1 casts
await ev(() => { const g = window.__game.game; g.player.teleport(10, 40); g.player.yaw = 0; });
const inv0 = await ev(() => { const p = window.__game.game.player; return { n: p.inventory.count, id: p.weapon.id, vis: p.rig.weaponVisual, mesh: !!p.rig.weaponMesh }; });
check('starts with the class weapon in hand', inv0.n === 1 && inv0.id === 'greatsword' && inv0.vis === 'greatsword' && inv0.mesh, JSON.stringify(inv0));
await ev(() => window.__game.giveWeapon('katana', 'rare'));
const inv1 = await ev(() => { const p = window.__game.game.player; return { n: p.inventory.count, id: p.weapon.id, vis: p.rig.weaponVisual, skill: p.skill.name }; });
check('upgrade pickup is held (rare katana > common greatsword)', inv1.n === 2 && inv1.id === 'katana' && inv1.vis === 'katana' && inv1.skill === 'Unsheathe', JSON.stringify(inv1));
await ev(() => window.__game.giveWeapon('daggers', 'common'));
const inv2 = await ev(() => { const p = window.__game.game.player; return { n: p.inventory.count, id: p.weapon.id }; });
check('weaker pickup is stowed', inv2.n === 3 && inv2.id === 'katana', JSON.stringify(inv2));
await page.keyboard.press('KeyX'); await step(0.1);
const inv3 = await ev(() => { const p = window.__game.game.player; return { id: p.weapon.id, vis: p.rig.weaponVisual, combo: p.moveset.light.length }; });
check('X swaps to the next carried weapon (daggers, dual mesh)', inv3.id === 'daggers' && inv3.vis === 'dagger', JSON.stringify(inv3));
await ev(() => window.__game.equip(0));
await page.keyboard.press('Digit1'); await step(0.1);
const sk1 = await ev(() => { const p = window.__game.game.player; return { st: p.state, step: p.attack.def && p.attack.def.step, cd: p.skillCd }; });
check("skill casts the held weapon's art (greatsword: Lion's Claw), cooldown armed, no FP", sk1.st === 'attack' && sk1.step === 3.4 && sk1.cd > 0, JSON.stringify(sk1));
await step(1.5);
await ev(() => { const p = window.__game.game.player; window.__game.giveWeapon('halberd', 'legendary'); p.skillCd = 0; p.fp = p.maxFp; });
const yaw0 = await ev(() => window.__game.game.player.yaw);
await page.keyboard.press('Digit1'); await step(1.6);
const yaw1 = await ev(() => window.__game.game.player.yaw);
check('halberd Spinning Slash turns the body a full circle', Math.abs((yaw1 - yaw0) - Math.PI * 2) < 0.25, `Δyaw ${(yaw1 - yaw0).toFixed(2)} rad`);
await ev(() => {
  const p = window.__game.game.player, pr = window.__game.game.combat.projectiles;
  window.__game.giveWeapon('bow', 'common'); window.__game.equip(p.inventory.count - 1); p.skillCd = 0; p.fp = p.maxFp;
  window.__fired = 0; const fire = pr.fire.bind(pr); pr.fire = (...a) => { window.__fired++; return fire(...a); };
});
await page.keyboard.press('Digit1'); await step(0.5);
const arrows = await ev(() => window.__fired);
check('bow Barrage looses a fan of five arrows (bow in the left fist)', arrows === 5 && await ev(() => window.__game.game.player.rig.weaponVisual === 'bow'), `${arrows} arrows`);
await step(2.0);
await ev(() => window.__game.giveWeapon('sword', 'common')); // 6 of 6 — an upgrade over the bow, so it is held
await ev(() => window.__game.giveWeapon('axe', 'legendary'));
const inv4 = await ev(() => { const p = window.__game.game.player; return { n: p.inventory.count, id: p.weapon.id, ids: p.inventory.weapons.map((w) => w.id).join(',') }; });
check('a full inventory trades the held weapon for the pickup', inv4.n === 6 && inv4.id === 'axe' && !inv4.ids.split(',').includes('sword'), JSON.stringify(inv4));
await page.keyboard.press('KeyI'); await step(0.1);
const menu1 = await ev(() => ({ open: window.__game.game.menus.open, paused: window.__game.game.paused, cards: document.querySelectorAll('.m-card').length }));
check('I opens the inventory menu (paused, one card per weapon)', menu1.open === 'inventory' && menu1.paused && menu1.cards === 6, JSON.stringify(menu1));
await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await step(0.1);
const menu2 = await ev(() => ({ id: window.__game.game.player.weapon.id, held: document.querySelectorAll('.m-card.eq').length }));
check('Enter equips the selected card', menu2.id !== 'axe' && menu2.held === 1, JSON.stringify(menu2));
await page.keyboard.press('Escape'); await step(0.1);
check('Esc closes the inventory', await ev(() => window.__game.game.menus.open === null && !window.__game.game.paused));
await ev(() => window.__game.equip(0));
await step(0.5);

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
await ev(() => {
  const g = window.__game.game, e = window.__game.spawn('wolf');
  e.teleport(10, 66);
  // face the camera at the wolf: an earlier hit may have auto-locked and swung the camera elsewhere
  g.cameraCtl.yaw = Math.atan2(-(e.pos.x - g.player.pos.x), -(e.pos.z - g.player.pos.z));
  g.cameraCtl.snap();
});
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

// ranged classes release a projectile on light attack
await ev(() => window.__game.startExpedition('Ironeye'));
await page.waitForFunction(() => window.__game.state === 'EXPEDITION' && window.__game.game.player);
await ev(() => window.__game.setManual(true));
await page.keyboard.press('KeyF'); await step(0.36);
check('Ironeye fires an arrow', await ev(() => window.__game.game.combat.projectiles.list.some((p) => p.kind === 'arrow')));

// touch: a double-tap on an enemy (either pad) locks onto that enemy
await ev(() => {
  const g = window.__game.game, p = g.player; g.touch.activate();
  const e = g.entities.find((x) => x !== p && x.alive && x.team === 'enemy');
  e.teleport(p.pos.x + Math.sin(p.yaw) * 8, p.pos.z + Math.cos(p.yaw) * 8); window.__tgt = e;
});
await step(0.3);
check('touch: double-tap an enemy locks on', await ev(() => {
  const g = window.__game.game, e = window.__tgt, v = e.pos.clone(); v.y += e.height * 0.5; v.project(g.camera);
  const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight, pad = document.querySelector('.t-pad.r');
  for (let i = 0; i < 2; i++) pad.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 7 + i, bubbles: true }));
  return g.player.lockTarget === e;
}));

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
