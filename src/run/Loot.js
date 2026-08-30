/**
 * Loot: wooden chests at every POI (plus two field chests) and weapons planted at the wolf dens.
 * Each pickup has a rarity (common / uncommon / rare / legendary) that drives a coloured light pillar,
 * base flare, ground glow and a few motes. Unopened loot re-rolls its rarity on each day change with
 * that day's weights, so later days glow richer. Opening a chest / taking a weapon equips a weapon from
 * the table scaled by rarity, pays runes, emits `loot:pickup` and shows a title card.
 *
 * Draw calls: chest bodies (1 merged) + lids (1 instanced) + planted weapons (1 instanced) +
 * ground glows (1) + pillars & flares (1) + motes (1).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat, writeColor } from '../render/Style.js';
import { ParticleSystem } from '../render/Particles.js';
import { WEAPONS } from '../combat/Weapons.js';
import { LightPillars, softDisc, glowMaterial } from './Grace.js';

/** Rarity table: glow colour (derived from the palette), damage multiplier, rune payout multiplier. */
export const RARITIES = {
  common:    { label: 'COMMON',    color: PALETTE.moon,      dmg: 1.0,  runes: 1,   glow: 0.55 },
  uncommon:  { label: 'UNCOMMON',  color: PALETTE.ring,      dmg: 1.15, runes: 1.6, glow: 0.9 },
  rare:      { label: 'RARE',      color: PALETTE.ringGlow,  dmg: 1.32, runes: 2.4, glow: 1.0 },
  legendary: { label: 'LEGENDARY', color: PALETTE.graceGlow, dmg: 1.55, runes: 4,   glow: 1.1 },
};
const ORDER = ['common', 'uncommon', 'rare', 'legendary'];
/** Rarity weights per day (index 1..3). */
export const RARITY_WEIGHTS = { 1: [0.58, 0.3, 0.1, 0.02], 2: [0.3, 0.42, 0.22, 0.06], 3: [0.12, 0.38, 0.34, 0.16] };
const POOL = ['greatsword', 'sword', 'katana', 'halberd', 'axe', 'daggers', 'staff', 'bow'];

/** A weapon instance for the player's inventory: the table entry scaled by rarity. */
export function makeWeapon(id, rarity = 'common') {
  if (!WEAPONS[id]) id = 'sword';
  if (!RARITIES[rarity]) rarity = 'common';
  const base = WEAPONS[id], R = RARITIES[rarity];
  return { ...base, id, dmg: Math.round(base.dmg * R.dmg), rarity };
}
const MOTES_PER = 14;
const OPEN_ANGLE = -1.85;
const PILLAR_W = 0.55, PILLAR_H = 3.2, FLARE_R = 0.8;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _hinge = new THREE.Matrix4(), _c = new THREE.Color();

/** Give a geometry a flat vertex colour, darkening toward its lowest vertices (cheap baked AO). */
function tint(geo, hex, shade = 0.35) {
  const g = geo.toNonIndexed(); const n = g.attributes.position.count, pos = g.attributes.position.array, col = new Float32Array(n * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const span = Math.max(1e-3, maxY - minY);
  for (let i = 0; i < n; i++) writeColor(col, i * 3, hex, 1 - shade * (1 - (pos[i * 3 + 1] - minY) / span));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Chest base in a local frame (origin at the ground centre, front toward +z). */
function chestBody() {
  const parts = [tint(new THREE.BoxGeometry(0.92, 0.46, 0.56).translate(0, 0.23, 0), PALETTE.wood, 0.45)];
  for (const x of [-0.3, 0.3]) parts.push(tint(new THREE.BoxGeometry(0.07, 0.48, 0.6).translate(x, 0.24, 0), PALETTE.iron, 0.3));
  parts.push(tint(new THREE.BoxGeometry(0.96, 0.05, 0.6).translate(0, 0.025, 0), PALETTE.woodDark, 0.2));
  for (const [x, z] of [[-0.46, -0.28], [0.46, -0.28], [-0.46, 0.28], [0.46, 0.28]]) parts.push(tint(new THREE.BoxGeometry(0.06, 0.48, 0.06).translate(x, 0.24, z), PALETTE.iron, 0.3));
  return mergeGeometries(parts, false);
}

/** Chest lid with the hinge on the back edge (local origin at the hinge line: y 0.46, z -0.28). */
function chestLid() {
  const parts = [];
  const dome = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 8, 1, false, 0, Math.PI); dome.rotateZ(Math.PI / 2); dome.translate(0, 0, 0.28);
  parts.push(tint(dome, PALETTE.wood, 0.2));
  for (const x of [-0.3, 0.3]) { const band = new THREE.CylinderGeometry(0.29, 0.29, 0.08, 8, 1, false, 0, Math.PI); band.rotateZ(Math.PI / 2); band.translate(x, 0, 0.28); parts.push(tint(band, PALETTE.iron, 0.15)); }
  parts.push(tint(new THREE.BoxGeometry(0.92, 0.03, 0.56).translate(0, -0.015, 0.28), PALETTE.woodDark, 0));
  parts.push(tint(new THREE.BoxGeometry(0.11, 0.13, 0.03).translate(0, -0.05, 0.57), PALETTE.gold, 0.1));
  return mergeGeometries(parts, false);
}

/** A plain planted sword (steel) for field weapon pickups. */
function plantedWeapon() {
  const parts = [];
  const blade = new THREE.CylinderGeometry(0.03, 0.006, 1.15, 4, 1); blade.scale(1.6, 1, 0.45); blade.translate(0, 0.2, 0); parts.push(tint(blade, PALETTE.steel, 0.5));
  parts.push(tint(new THREE.BoxGeometry(0.3, 0.045, 0.06).translate(0, 0.8, 0), PALETTE.steelDark, 0));
  parts.push(tint(new THREE.CylinderGeometry(0.024, 0.028, 0.26, 6).translate(0, 0.95, 0), PALETTE.leather, 0));
  parts.push(tint(new THREE.SphereGeometry(0.04, 6, 5).translate(0, 1.1, 0), PALETTE.steelDark, 0));
  const g = mergeGeometries(parts, false); g.rotateZ(0.12); g.rotateX(0.08);
  return g;
}

export class LootSystem {
  constructor(game, limveld) {
    this.game = game; this.limveld = limveld;
    const T = game.terrain, rng = game.rng.fork(91);
    this.rng = rng;
    this.items = []; // {kind:'chest'|'weapon', x,y,z,yaw, rarity, opened, pillar, flare, moteStart, instance}
    this.group = new THREE.Group(); this.group.name = 'loot';
    this.day = 1; this.promptShown = false; this.near = null;

    // --- placement -------------------------------------------------------------------------------
    const local = (p, lx, lz) => { const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw); return { x: p.x + lx * cs + lz * sn, z: p.z - lx * sn + lz * cs }; };
    const chest = (pt, yaw, forceRarity) => this.items.push({ kind: 'chest', x: pt.x, z: pt.z, y: T.getHeight(pt.x, pt.z), yaw, rarity: forceRarity || this.rollRarity(1), opened: false });
    const weapon = (pt, yaw) => this.items.push({ kind: 'weapon', x: pt.x, z: pt.z, y: T.getHeight(pt.x, pt.z), yaw, rarity: this.rollRarity(1), opened: false, weaponId: rng.pick(POOL) });
    for (const p of limveld.pois) {
      switch (p.type) {
        case 'church': chest(local(p, 2.8, 11.6), p.yaw + Math.PI + 0.3); break;
        case 'fort': chest(local(p, -5.5, 16.5), p.yaw + 0.4); chest(local(p, 0, -0.9), p.yaw + Math.PI, 'legendary'); break; // (collision builder) in the keep's door recess, now that the keep is solid
        case 'ruin': chest(local(p, 0, -3.6), p.yaw + 0.2); break;
        case 'catacomb': chest(local(p, 3.0, 4.8), p.yaw + Math.PI - 0.5); break;
        case 'camp': chest(local(p, -2.2, -2.4), p.yaw + 2.2); break;
      }
    }
    // field chests beside the spawn grace and the central grace (rare: the one the grace pose frames)
    const g0 = limveld.graces[0], g7 = limveld.graces[7] || limveld.graces[limveld.graces.length - 1];
    if (g0) chest({ x: g0.x + 3.4, z: g0.z + 1.8 }, -0.6);
    if (g7) chest({ x: g7.x + 3.1, z: g7.z + 2.6 }, 2.6, 'rare');
    for (const d of limveld.dens || []) weapon({ x: d.x + 2.2, z: d.z - 1.4 }, rng.float() * 6.28);

    // --- meshes ----------------------------------------------------------------------------------
    const bodyGeo = chestBody(), bodies = [];
    const chests = this.items.filter((i) => i.kind === 'chest'), weapons = this.items.filter((i) => i.kind === 'weapon');
    for (const it of chests) { const g = bodyGeo.clone(); g.rotateY(it.yaw); g.translate(it.x, it.y, it.z); bodies.push(g); }
    const mat = vertexMat({ roughness: 0.8 });
    if (bodies.length) { this.bodyMesh = new THREE.Mesh(mergeGeometries(bodies, false), mat); this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true; this.group.add(this.bodyMesh); }
    this.lids = new THREE.InstancedMesh(chestLid(), mat, Math.max(1, chests.length)); this.lids.count = chests.length; this.lids.castShadow = true;
    chests.forEach((it, i) => { it.instance = i; this.setLid(it, 0); });
    this.weaponsMesh = new THREE.InstancedMesh(plantedWeapon(), mat, Math.max(1, weapons.length)); this.weaponsMesh.count = weapons.length; this.weaponsMesh.castShadow = true;
    weapons.forEach((it, i) => { it.instance = i; _q.setFromAxisAngle(_p.set(0, 1, 0), it.yaw); _m.compose(_p.set(it.x, it.y, it.z), _q, _s); this.weaponsMesh.setMatrixAt(i, _m); });
    this.weaponsMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.lids, this.weaponsMesh);

    // glows: pillar + flare per item, soft ground disc, motes
    this.pillars = new LightPillars(this.items.length * 2);
    this.particles = new ParticleSystem({ max: Math.max(1, this.items.length) * MOTES_PER, mode: 'orbit' });
    const discs = [];
    for (const it of this.items) {
      const R = RARITIES[it.rarity], top = it.kind === 'chest' ? 0.55 : 0.9;
      it.pillar = this.pillars.add(it.x, it.y + top - 0.1, it.z, { halfWidth: PILLAR_W, height: PILLAR_H, color: R.color, seed: rng.float(), kind: 0, intensity: 0.5 * R.glow });
      it.flare = this.pillars.add(it.x, it.y + top + 0.25, it.z, { halfWidth: FLARE_R, color: R.color, seed: rng.float(), kind: 1, intensity: 0.35 * R.glow });
      discs.push(softDisc(T, it.x, it.z, 2.2, R.color, 0.16 * R.glow, (r) => Math.pow(1 - r, 2.4)));
      it.moteStart = this.particles.cursor;
      _c.setHex(R.color);
      for (let i = 0; i < MOTES_PER; i++) {
        this.particles.spawn(it.x, it.y + top - 0.2 + rng.float() * 0.5, it.z, 0.15 + rng.float() * 0.6, 1.2 + rng.float() * 1.8, 0.6 + rng.float() * 1.6, 2.5 + rng.float() * 2.5, 0.02 + rng.float() * 0.03, _c.r * 1.6, _c.g * 1.5, _c.b * 1.4, rng.float());
      }
    }
    for (let i = 0; i < this.particles.max; i++) { const birth = -rng.float() * 6; for (let v = 0; v < 4; v++) this.particles.info[(i * 4 + v) * 4] = birth; }
    if (discs.length) { this.discMesh = new THREE.Mesh(mergeGeometries(discs, false), glowMaterial()); this.discMesh.renderOrder = 2; this.group.add(this.discMesh); }
    this.group.add(this.pillars.mesh, this.particles.mesh);
    game.scene.add(this.group);

    game.events.on('day:changed', ({ day }) => this.onDay(day));
    game.events.on('run:start', () => this.reset());
  }

  rollRarity(day) {
    const w = RARITY_WEIGHTS[Math.min(3, Math.max(1, day))]; let r = this.rng.float();
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return ORDER[i]; }
    return ORDER[w.length - 1];
  }

  /** Lid instance matrix: world placement × hinge rotation. angle 0 closed, OPEN_ANGLE open. */
  setLid(it, angle) {
    _q.setFromAxisAngle(_p.set(0, 1, 0), it.yaw);
    _m.compose(_p.set(it.x, it.y, it.z), _q, _s);
    _hinge.makeTranslation(0, 0.46, -0.28);
    _m.multiply(_hinge);
    _hinge.makeRotationX(angle);
    _m.multiply(_hinge);
    this.lids.setMatrixAt(it.instance, _m);
    this.lids.instanceMatrix.needsUpdate = true;
  }

  /** Recolour an item's glow after a rarity change. */
  applyRarity(it) {
    const R = RARITIES[it.rarity];
    this.pillars.setColor(it.pillar, R.color, 0.5 * R.glow);
    this.pillars.setColor(it.flare, R.color, 0.35 * R.glow);
    _c.setHex(R.color);
    for (let k = 0; k < MOTES_PER; k++) {
      const idx = (it.moteStart + k) % this.particles.max;
      for (let v = 0; v < 4; v++) { const o3 = (idx * 4 + v) * 3; this.particles.color[o3] = _c.r * 1.6; this.particles.color[o3 + 1] = _c.g * 1.5; this.particles.color[o3 + 2] = _c.b * 1.4; }
    }
    this.particles.dirty = true;
    // ground disc colour: rebuild that item's 6-ring fan in place (24 segs × (3 + 5×6) verts)
    if (this.discMesh) {
      const i = this.items.indexOf(it), per = 24 * (3 + 5 * 6), col = this.discMesh.geometry.attributes.color, arr = col.array, pos = this.discMesh.geometry.attributes.position.array;
      for (let v = i * per; v < (i + 1) * per; v++) {
        const r = Math.min(1, Math.hypot(pos[v * 3] - it.x, pos[v * 3 + 2] - it.z) / 2.2), k = 0.16 * R.glow * Math.pow(1 - r, 2.4);
        arr[v * 3] = _c.r * k; arr[v * 3 + 1] = _c.g * k; arr[v * 3 + 2] = _c.b * k;
      }
      col.needsUpdate = true;
    }
  }

  /** Hide an item's glow after pickup. */
  extinguish(it) {
    this.pillars.setSize(it.pillar, 0, 0); this.pillars.setSize(it.flare, 0, 0);
    for (let k = 0; k < MOTES_PER; k++) { const idx = (it.moteStart + k) % this.particles.max; for (let v = 0; v < 4; v++) this.particles.info[(idx * 4 + v) * 4 + 2] = 0; }
    this.particles.dirty = true;
    if (this.discMesh) {
      const i = this.items.indexOf(it), per = 24 * (3 + 5 * 6), col = this.discMesh.geometry.attributes.color;
      col.array.fill(0, i * per * 3, (i + 1) * per * 3); col.needsUpdate = true;
    }
  }

  /** New day: unopened loot re-rolls with richer weights (never downgrades). */
  onDay(day) {
    this.day = day;
    for (const it of this.items) {
      if (it.opened) continue;
      const r = this.rollRarity(day);
      if (ORDER.indexOf(r) > ORDER.indexOf(it.rarity)) { it.rarity = r; this.applyRarity(it); }
    }
  }

  /** New run: everything closed and glowing again. */
  reset() {
    this.day = 1;
    for (const it of this.items) {
      if (!it.opened) continue;
      it.opened = false;
      if (it.kind === 'chest') this.setLid(it, 0);
      else { _q.setFromAxisAngle(_p.set(0, 1, 0), it.yaw); _m.compose(_p.set(it.x, it.y, it.z), _q, _s); this.weaponsMesh.setMatrixAt(it.instance, _m); this.weaponsMesh.instanceMatrix.needsUpdate = true; }
      this.pillars.setSize(it.pillar, PILLAR_W, PILLAR_H); this.pillars.setSize(it.flare, FLARE_R, 0);
      for (let k = 0; k < MOTES_PER; k++) { const idx = (it.moteStart + k) % this.particles.max; for (let v = 0; v < 4; v++) this.particles.info[(idx * 4 + v) * 4 + 2] = 0.02 + this.rng.float() * 0.03; }
      this.particles.dirty = true;
      this.applyRarity(it);
    }
  }

  /** Nearest unopened item within maxDist of p (squared-distance scan, no allocation). */
  nearest(p, maxDist = 2.4) {
    let best = null, bd = maxDist * maxDist;
    for (const it of this.items) { if (it.opened) continue; const d = (it.x - p.x) ** 2 + (it.z - p.z) ** 2; if (d < bd) { bd = d; best = it; } }
    return best;
  }

  update(dt) {
    const game = this.game, p = game.player;
    this.pillars.update(game.time);
    this.particles.update(game.time);
    // lids animate open
    for (const it of this.items) {
      if (it.kind === 'chest' && it.opened && it.lidT < 1) { it.lidT = Math.min(1, it.lidT + dt * 2.2); const e = 1 - Math.pow(1 - it.lidT, 3); this.setLid(it, OPEN_ANGLE * e); }
    }
    if (!p || !p.alive) { if (this.promptShown) { game.hud.setPrompt(null); this.promptShown = false; } return; }
    const it = game.graces.current ? null : this.nearest(p.pos);
    this.near = it;
    const can = it && p.state !== 'attack' && p.state !== 'roll' && p.state !== 'rest';
    if (can) {
      game.hud.setPrompt(it.kind === 'chest' ? 'Open Chest' : 'Take ' + WEAPONS[it.weaponId].name, 'E'); this.promptShown = true;
      if (game.input.wasPressed('interact')) this.pickup(it);
    } else if (this.promptShown) { game.hud.setPrompt(null); this.promptShown = false; }
  }

  /**
   * Open / take: a rarity-scaled weapon goes to the player's inventory (held if it is an upgrade, stowed
   * otherwise; a full inventory trades the held one away), pay runes, emit loot:pickup, show a title card.
   */
  pickup(it) {
    const game = this.game, p = game.player, R = RARITIES[it.rarity];
    it.opened = true; it.lidT = 0;
    if (it.kind === 'weapon') { _m.makeScale(0, 0, 0); this.weaponsMesh.setMatrixAt(it.instance, _m); this.weaponsMesh.instanceMatrix.needsUpdate = true; }
    this.extinguish(it);
    const weapon = makeWeapon(it.weaponId || this.rng.pick(POOL), it.rarity);
    const got = p.pickupWeapon(weapon);
    const runes = Math.round((40 + 35 * this.day) * R.runes);
    p.runes = (p.runes || 0) + runes;
    game.events.emit('runes:changed', p.runes);
    game.events.emit('loot:pickup', { item: it, weapon, runes, equipped: got.equipped, replaced: got.replaced });
    const note = got.replaced ? ' · REPLACES ' + got.replaced.name.toUpperCase() : got.equipped ? '' : ' · STOWED';
    game.hud.showTitle(weapon.name, R.label + ' · +' + runes + ' RUNES' + note, 2.6);
    game.hud.setPrompt(null); this.promptShown = false;
  }
}
