/**
 * Hit registration (swept arc sectors during active frames), damage/poise application, hit-stop,
 * and all combat FX: weapon trails, stylized spark/flash/ring impacts with a short impact light,
 * ground dust on steps / knockback, and rune payout (gold motes homing to the player).
 */
import * as THREE from 'three';
import { ParticleSystem } from '../render/Particles.js';
import { PALETTE } from '../render/Style.js';
import { FxPool } from './Fx.js';
import { WeaponTrail } from './Trail.js';
import { bladePoints } from './Weapons.js';
import { Arena } from './Arena.js';
import { HIT_RIM } from '../entity/enemies/EnemyRig.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const IMPACT_LIGHT_T = 0.24;

export class Combat {
  constructor(game) {
    this.game = game;
    this.sparks = new FxPool({ max: 1024, gravity: -16 });
    this.dustFx = new FxPool({ max: 320, gravity: -0.4, blending: THREE.NormalBlending, renderOrder: 8 });
    this.runes = new ParticleSystem({ max: 384, mode: 'home', gravity: 0 });
    game.scene.add(this.sparks.mesh, this.dustFx.mesh, this.runes.mesh);
    // one impact light, always in the scene (no shader recompiles), intensity pulses on hits
    this.light = new THREE.PointLight(0xffc890, 0, 6.5, 2);
    game.scene.add(this.light);
    this.lightT = 0; this.lightPeak = 0; this.rimPeak = 0;
    this.trails = [new WeaponTrail(game.scene), new WeaponTrail(game.scene), new WeaponTrail(game.scene)];
    this.pending = [];
    _c.setHex(PALETTE.terrain.dirt); _c2.setHex(PALETTE.fog);
    this.dustColor = _c.clone().lerp(_c2, 0.5).multiplyScalar(1.0); // unlit billboard: dry-earth haze a step paler than the trodden dirt so puffs read on it
    this.arena = new Arena(game); // trampled ground, camp clutter (contact blobs come from here too)
    this.emberAcc = 0;
    this.afterPose = null; // restore closure set by combat/Pose.js
  }

  reset() {
    this.pending.length = 0;
    for (const t of this.trails) t.clear();
    this.sparks.clear(); this.dustFx.clear();
    this.light.intensity = 0; this.lightT = 0; HIT_RIM.value.w = 0;
  }

  update(dt) {
    if (this.afterPose) { this.afterPose(); this.afterPose = null; } // undo screenshot-pose camera tweaks on resume
    const ents = this.game.entities, player = this.game.player, time = this.game.time;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive || e.frozen || !e.attack || e.attack.phase !== 'active') continue;
      this.sweep(e);
      this.sampleTrail(e, time);
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        if (player) { player.runes += p.amount; this.game.events.emit('runes:changed', player.runes); }
        this.pending.splice(i, 1);
      }
    }
    if (this.lightT > 0) {
      this.lightT -= dt;
      const k = clamp01(this.lightT / IMPACT_LIGHT_T);
      this.light.intensity = this.lightPeak * k ** 1.5;
      HIT_RIM.value.w = this.rimPeak * k * k; // warm impact rim on enemy materials (EnemyRig hook)
    }
    // rising embers from the nearest camp fire / brazier
    if (player && this.game.limveld) {
      const fire = this.game.limveld.nearestFire(player.pos, 30);
      if (fire) { this.emberAcc += dt * 16; while (this.emberAcc >= 1) { this.emberAcc -= 1; this.ember(fire); } }
    }
    this.updateFx(dt);
    if (player) this.runes.setTarget(player.chest());
  }

  /** Advance clocks / upload buffers (also used by screenshot poses while the sim is frozen). */
  updateFx(dt) {
    const time = this.game.time;
    for (const t of this.trails) t.update(time, dt);
    this.sparks.update(time); this.dustFx.update(time); this.runes.update(time);
    this.arena.update(time);
  }

  /** One glowing ember drifting up out of a flame at f. */
  ember(f) {
    const a = Math.random() * TAU, r = Math.random() * 0.28, g = 0.45 + Math.random() * 0.55;
    _c.setHex(PALETTE.ember).lerp(_c2.setHex(PALETTE.torch), g).multiplyScalar(1.8 + g);
    this.sparks.spawn(f.x + Math.cos(a) * r, f.y - 0.35 + Math.random() * 0.4, f.z + Math.sin(a) * r,
      (Math.random() - 0.5) * 0.9, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 0.9,
      1.1 + Math.random() * 1.5, 0.02 + Math.random() * 0.03, _c.r, _c.g, _c.b, 1, 0, 0.55, -0.6);
  }

  /** Pre-roll n embers with staggered ages so a frozen frame shows a full column (screenshot poses). */
  emberBurst(f, n = 40, span = 2.2) {
    const t = this.sparks.time;
    for (let i = 0; i < n; i++) { this.sparks.time = t - Math.random() * span; this.ember(f); }
    this.sparks.time = t;
  }

  // ------------------------------------------------------------------------------------------ trails

  /** Bind a free trail to an attacker's blade (null if the weapon has no blade or none is free). */
  acquireTrail(e) {
    if (e._trail && e._trail.owner === e) return e._trail;
    const rig = e.rig;
    if (!rig || !rig.bones || !rig.bones.elbowR || !rig.handRLocal) return null;
    const span = bladePoints(e.weapon.visual, rig.handRLocal, e._blade || (e._blade = { base: new THREE.Vector3(), tip: new THREE.Vector3() }));
    if (!span) return null;
    let trail = null;
    for (const t of this.trails) if (!t.busy) { trail = t; break; }
    if (!trail) return null;
    trail.attach(e, rig.mesh, rig.bones.elbowR, span.base, span.tip, e.team === 'player' ? 0xbcd0ff : 0xffb070);
    e._trail = trail;
    return trail;
  }

  sampleTrail(e, time) {
    const trail = this.acquireTrail(e);
    if (!trail) return;
    e.object3d.updateMatrixWorld(true);
    trail.sample(time);
  }

  // ------------------------------------------------------------------------------------------ hits

  /** Sweep the attack arc from its previous angle to the current one; each target is hit once per attack. */
  sweep(att) {
    const a = att.attack, def = a.def;
    const k = clamp01((a.t - def.windup) / def.active);
    const cur = (def.arcFrom + (def.arcTo - def.arcFrom) * k) * DEG;
    const prev = a.lastAngle; a.lastAngle = cur;
    const lo = Math.min(prev, cur) - 0.42, hi = Math.max(prev, cur) + 0.42;
    const reach = a.reach * att.scale;
    const ents = this.game.entities;
    for (let i = 0; i < ents.length; i++) {
      const t = ents[i];
      if (t === att || !t.alive || t.team === att.team || a.hitSet.has(t)) continue;
      const dx = t.pos.x - att.pos.x, dz = t.pos.z - att.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + t.radius * t.scale) continue;
      if (Math.abs(t.pos.y - att.pos.y) > 2.5 * att.scale) continue;
      let rel = Math.atan2(dx, dz) - att.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (dist > 1.3 * att.scale && (rel < lo || rel > hi)) continue;
      a.hitSet.add(t);
      this.applyHit(att, t, def);
    }
  }

  /** Damage + FX for one confirmed hit. */
  applyHit(att, target, def, motionMul = 1) {
    const weapon = att.weapon;
    const dmg = weapon.dmg * def.motion * motionMul * att.damageMult;
    _d.set(target.pos.x - att.pos.x, 0, target.pos.z - att.pos.z);
    const len = _d.length() || 1; _d.divideScalar(len);
    const wasGuarding = target.guarding;
    const applied = target.takeHit({ damage: dmg, poise: weapon.poiseDmg * (def.poiseMul || 1), dir: _d, knock: def.knock || 2, source: att });
    if (applied <= 0 && !wasGuarding) return;
    const game = this.game;
    const heavy = (def.poiseMul || 1) > 1.5;
    _p.set(target.pos.x - _d.x * target.radius * 0.6, target.pos.y + (target.height > 1.4 ? 1.15 : 0.6) * target.scale, target.pos.z - _d.z * target.radius * 0.6);
    this.impact(_p, _d, wasGuarding ? 'guard' : (target.team === 'player' ? 'blood' : 'metal'), heavy ? 1.35 : 1);
    if (att === game.player || target === game.player) game.requestHitStop(heavy ? 0.09 : 0.05);
    if (att === game.player) game.cameraCtl.addShake(heavy ? 0.35 : 0.16);
    if (target.team === 'player') game.events.emit('player:hit', { damage: applied, source: att });
    else {
      game.events.emit('enemy:hit', { target, damage: applied });
      if (!target.alive && att === game.player) att.kills++;
    }
  }

  // ------------------------------------------------------------------------------------------ FX

  /**
   * Stylized impact at p travelling along dir (attacker → target): a fan of small hot spark shards thrown
   * off the blow (yellow-white cores cooling to orange), a few heavier chips that fall, a tight hot core,
   * a small warm halo, a crisp ring and two crossing slash streaks, plus a short warm light pulse placed
   * back toward the attacker so the struck body keeps its silhouette. kind: 'metal' | 'blood' | 'guard'.
   */
  impact(p, dir, kind = 'metal', scale = 1) {
    const s = this.sparks;
    const blood = kind === 'blood', guard = kind === 'guard';
    const hot = guard ? _c.setHex(0xd8e6ff) : blood ? _c.setHex(0xff6a4a) : _c.setHex(0xffe9b8);
    const warm = guard ? _c2.setHex(0x7f9cff) : blood ? _c2.setHex(0x8a1414) : _c2.setHex(0xff7a22);
    const sx = -dir.z, sz = dir.x; // swing axis (horizontal, across the blow)
    const n = Math.round((guard ? 14 : 34) * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, cone = 0.3 + Math.random() * 1.2; // 17°..86° off the knock direction
      const ca = Math.cos(a), sa = Math.sin(a), sc = Math.sin(cone), cc = Math.cos(cone);
      const sp = (4 + Math.random() * 10) * scale;
      const vx = (dir.x * cc + sx * ca * sc) * sp, vy = (Math.abs(sa) * sc * 0.9 + 0.2) * sp, vz = (dir.z * cc + sz * ca * sc) * sp;
      const m = Math.random() * Math.random(); // most shards stay hot, a few are already orange
      s.spawn(p.x, p.y, p.z, vx, vy, vz, 0.12 + Math.random() * 0.2, (0.007 + Math.random() * 0.009) * scale,
        (hot.r * (1 - m) + warm.r * m) * 1.9, (hot.g * (1 - m) + warm.g * m) * 1.9, (hot.b * (1 - m) + warm.b * m) * 1.9, 0, 0.7, 2.6, 0);
    }
    for (let i = 0; i < 12; i++) { // tiny hot motes that hang in the air around the contact
      const a = Math.random() * TAU, b = Math.random() * Math.PI, sp = 0.4 + Math.random() * 1.6;
      s.spawn(p.x, p.y, p.z, Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp, 0.25 + Math.random() * 0.25, 0.014 * scale,
        hot.r * 1.6, hot.g * 1.6, hot.b * 1.6, 1, 0, 1.5, -0.5);
    }
    if (!guard) for (let i = 0; i < 8; i++) { // heavier chips / droplets that arc and fall
      const a = Math.random() * TAU, sp = 1.2 + Math.random() * 3.2;
      s.spawn(p.x, p.y, p.z, Math.cos(a) * sp - dir.x * 1.8, 1.6 + Math.random() * 2.4, Math.sin(a) * sp - dir.z * 1.8, 0.4 + Math.random() * 0.3, 0.014,
        warm.r * 1.3, warm.g * 1.3, warm.b * 1.3, 0, 0.1, 0.9, 0);
    }
    s.spawn(p.x, p.y, p.z, 0, 0, 0, 0.07, 0.05 * scale, hot.r * 1.8, hot.g * 1.8, hot.b * 1.8, 1, 0, 0, 0.5);
    s.spawn(p.x, p.y, p.z, 0, 0, 0, 0.13, 0.17 * scale, warm.r * 0.5, warm.g * 0.5, warm.b * 0.5, 1, 0, 0, 0.6);
    s.spawn(p.x, p.y, p.z, 0, 0, 0, 0.11, 0.2 * scale, warm.r * 0.7, warm.g * 0.7, warm.b * 0.7, 2, 0, 0, 1.2);
    for (const sg of [1, -1]) { // slash streaks: slow + heavy drag so they hold in place, stretched along the swing
      s.spawn(p.x, p.y, p.z, sx * 1.0 * sg, 0.7 * sg, sz * 1.0 * sg, 0.08, 0.02 * scale, hot.r * 1.8, hot.g * 1.8, hot.b * 1.8, 0, 8, 9, 0);
    }
    // light sits back toward the attacker and above the contact: it rims the target's front and the
    // attacker's weapon arm instead of bleaching the struck body; the enemy shader adds a warm edge rim
    // from the contact point itself (HIT_RIM) so the burst visibly wraps the struck silhouette
    _p.set(p.x - dir.x * 0.9, p.y + 0.6, p.z - dir.z * 0.9);
    this.flashLight(_p, guard ? 0x9fb8ff : blood ? 0xff6040 : 0xffb070, (guard ? 2.2 : 3.2) * scale);
    HIT_RIM.value.set(p.x, p.y, p.z, 0);
    this.rimPeak = blood ? 0 : (guard ? 0.5 : 1.0) * scale;
    HIT_RIM.value.w = this.rimPeak;
  }

  /** Warm point-light pulse at p (decays over IMPACT_LIGHT_T). */
  flashLight(p, hex, intensity) {
    this.light.position.copy(p);
    this.light.color.setHex(hex);
    this.light.intensity = this.lightPeak = intensity;
    this.lightT = IMPACT_LIGHT_T;
  }

  /** Ground dust: n low soft puffs at (x,y,z) drifting along (dx,dz) with lateral spread. */
  dust(x, y, z, n, dx = 0, dz = 0, spread = 1.2, size = 0.3) {
    const c = this.dustColor;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = Math.random() * spread;
      const vx = Math.cos(a) * r + dx * (0.6 + Math.random() * 0.6), vz = Math.sin(a) * r + dz * (0.6 + Math.random() * 0.6);
      this.dustFx.spawn(x + Math.cos(a) * 0.3, y + 0.04 + Math.random() * 0.1, z + Math.sin(a) * 0.3, vx, 0.15 + Math.random() * 0.3, vz,
        0.5 + Math.random() * 0.45, size * (0.5 + Math.random() * 0.7), c.r, c.g, c.b, 3, 0, 2.6, 1.2);
    }
  }

  /** Dust kicked up by an attack step / lunge. */
  stepDust(e, step = 1) {
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), k = Math.min(2, 0.5 + step * 0.3) * e.scale;
    this.dust(e.pos.x - fx * 0.3 * e.scale, e.pos.y, e.pos.z - fz * 0.3 * e.scale, Math.round(4 + 2 * k), -fx * 0.8 * k, -fz * 0.8 * k, 0.8 * k, 0.22 * Math.sqrt(e.scale));
  }

  /** Dust as an entity is knocked back (hit / stagger / death). */
  hurtDust(e, hit, strength = 1) {
    const dx = hit && hit.dir ? hit.dir.x : 0, dz = hit && hit.dir ? hit.dir.z : 0;
    this.dust(e.pos.x, e.pos.y, e.pos.z, Math.round(4 + 3 * strength), dx * 1.4 * strength, dz * 1.4 * strength, 0.9 * strength, 0.22 * Math.sqrt(e.scale));
  }

  /** Low dust smear dragged from a skidding foot at (x,y,z) along dir (world), plus a couple of lifted puffs. */
  skidDust(x, y, z, dir, strength = 1) {
    const c = this.dustColor, n = Math.round(5 + 4 * strength);
    for (let i = 0; i < n; i++) {
      const k = i / n, side = (Math.random() - 0.5) * 0.35;
      this.dustFx.spawn(x + dir.x * k * 0.5 * strength - dir.z * side, y + 0.03 + k * 0.08, z + dir.z * k * 0.5 * strength + dir.x * side,
        dir.x * (0.9 + k) * strength, 0.12 + 0.35 * k, dir.z * (0.9 + k) * strength,
        0.45 + Math.random() * 0.4, (0.14 + 0.16 * k) * strength, c.r, c.g, c.b, 3, 0, 2.2, 1.4);
    }
    for (let i = 0; i < 3; i++) {
      this.dustFx.spawn(x + dir.x * 0.3, y + 0.12, z + dir.z * 0.3, dir.x * 0.6 + (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.4, dir.z * 0.6 + (Math.random() - 0.5) * 0.5,
        0.6 + Math.random() * 0.3, 0.2 * strength, c.r, c.g, c.b, 3, 0, 1.8, 1.6);
    }
  }

  /** Legacy helper (older poses): warm sparks at p. */
  spawnSparks(p, dir, count, hex, scale = 1) { void count; void hex; this.impact(p, dir, 'metal', scale); }

  /** Ultimate: radial burst that hits every enemy in range. */
  burstFx(att) {
    _c.setHex(PALETTE.graceGlow);
    const s = this.sparks, x = att.pos.x, y = att.pos.y + 1.0, z = att.pos.z;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * TAU, sp = 6 + Math.random() * 9;
      s.spawn(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 4, Math.sin(a) * sp, 0.4 + Math.random() * 0.4, 0.05 + Math.random() * 0.05, _c.r * 2, _c.g * 2, _c.b * 2, 0, 0.05, 2.5, 0);
    }
    s.spawn(x, y, z, 0, 0, 0, 0.45, 2.2, _c.r * 1.6, _c.g * 1.6, _c.b * 1.6, 2, 0, 0, 3.5);
    s.spawn(x, y, z, 0, 0, 0, 0.2, 1.6, _c.r * 1.8, _c.g * 1.8, _c.b * 1.8, 1, 0, 0, 0.5);
    this.dust(x, att.pos.y, z, 14, 0, 0, 3.2, 0.45);
    this.flashLight(_p.set(x, y, z), PALETTE.graceGlow, 60);
    this.game.requestHitStop(0.1);
    this.game.cameraCtl.addShake(0.9);
  }

  /** Spawn rune motes that fly to the player; the amount is credited when they arrive. */
  dropRunes(pos, amount) {
    if (!this.game.player) return;
    _c.setHex(PALETTE.rune);
    const n = 6 + Math.min(14, (amount / 25) | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 1.5 + Math.random() * 2.5;
      this.runes.spawn(pos.x, pos.y + 1.0, pos.z, Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp, 1.25, 0.12 + Math.random() * 0.1, _c.r * 2.5, _c.g * 2.2, _c.b * 1.4);
    }
    this.pending.push({ t: 1.25, amount });
  }
}
