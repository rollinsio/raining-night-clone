/**
 * Boss base (extends the Enemy FSM): own weapon/moveset (no Weapons.js entry needed), logical gameplay
 * scale for full-size meshes, an intro roar state, two phases (boss:phase at half health: resting ember
 * heat, faster attacks, a second roar), a ground telegraph ring for slams, an ember point light that
 * heats with the wind-up, slam impact FX (dust, sparks, light pulse, shake), arena dressing hookup.
 */
import * as THREE from 'three';
import { Enemy } from '../Enemy.js';
import { PALETTE } from '../../render/Style.js';
import { TelegraphRing } from './Telegraph.js';
import { BossArena } from './BossArena.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3();
let shared = null;

/** One telegraph ring + one ember light per game (added once so no shader recompiles mid-fight). */
export function bossFx(game) {
  if (shared && shared.game === game) return shared;
  const light = new THREE.PointLight(PALETTE.ember, 0, 18, 1.7);
  light.position.set(0, -50, 0);
  game.scene.add(light);
  shared = { game, ring: new TelegraphRing(game), light };
  return shared;
}

export class Boss extends Enemy {
  /**
   * o: { name, subtitle, x, z, arena:{x,z,r,name}, seed, hp, poise, radius, height, runes, walk, run, dmg,
   *      logicalScale, weapon, moveset, attackRange, introDur, glowScale, lightHeight, blobW, blobD }
   */
  constructor(game, o) {
    super(game, {
      name: o.name, x: o.x, z: o.z, home: o.arena || { x: o.x, z: o.z }, patrolR: 5, seed: o.seed,
      hp: o.hp, poise: o.poise, radius: o.radius, height: o.height, runes: o.runes,
      aggro: o.aggro ?? 75, leash: 1e9, walk: o.walk, run: o.run, boss: true, glowScale: o.glowScale ?? 1,
      blobW: o.blobW ?? 4.4, blobD: o.blobD ?? 4.0,
    });
    this.weapon = o.weapon; this.moveset = o.moveset; this.attackRange = o.attackRange;
    /** Logical scale: Combat multiplies reach / radius / step / hit heights by it (meshes are full size). */
    this.scale = o.logicalScale ?? 1;
    this.damageMult = o.dmg ?? 1;
    this.subtitle = o.subtitle || 'FIELD BOSS';
    this.arena = o.arena || null;
    this.phase = 1; this.phaseAt = o.phaseAt ?? 0.5;
    this.introDur = o.introDur ?? 2.2; this.introDone = false; this._roared = false;
    this.emberBase = o.emberBase ?? 0;
    this.lightHeight = o.lightHeight ?? 3;
    /** Ember light strength multiplier and telegraph-ring alpha (dark silhouettes want these low). */
    this.heatScale = o.heatScale ?? 1; this.ringAlpha = o.ringAlpha ?? 0.5;
    this.fx = bossFx(game);
    this._ringOn = false; this._ringT = 0; this._impacted = false;
    this.dressing = this.arena ? BossArena.get(game, this.arena) : null;
    this.yaw = this.arena ? Math.atan2(this.arena.x - o.x, this.arena.z - o.z) : this.yaw;
  }

  setAggro() {
    if (this.aggro) return;
    super.setAggro();
    if (!this.introDone) this.beginRoar(this.introDur);
  }

  /** Intro / phase roar: the FSM parks in 'intro' while the clip plays, then chases. */
  beginRoar(dur) {
    this.introDur = dur; this._roared = false;
    this.attack.phase = 'none'; this.stop();
    this.setState('intro');
    this.anim.play('roar', { restart: true, rate: 10 });
  }

  startAttack(def) {
    super.startAttack(def);
    this._impacted = false;
    if (def.ring) { this.ringAt(def); this.fx.ring.show(_p.x, _p.z, def.ring.radius, this.glowColor.getHex(), this.ringAlpha); this._ringOn = true; this._ringT = 0; }
  }

  /** Impact point of a slam (ahead of the feet) into _p. */
  ringAt(def) {
    const ahead = def.ring ? def.ring.ahead : 1.5;
    _p.set(this.pos.x + Math.sin(this.yaw) * ahead, this.pos.y, this.pos.z + Math.cos(this.yaw) * ahead);
    return _p;
  }

  /** Resting ember heat in phase 2 on top of the wind-up heat. */
  updateBlade(dt) {
    super.updateBlade(dt);
    const m = this.bladeMat;
    if (m && this.emberBase > 0) {
      const e = this.emberBase * (0.85 + 0.15 * Math.sin(this.stateT * 5.0));
      m.emissive.r += this.glowColor.r * e; m.emissive.g += this.glowColor.g * e; m.emissive.b += this.glowColor.b * e;
      this._bladeLit = true;
    }
  }

  update(dt) {
    if (this.alive && !this.frozen && this.state === 'intro') { this.updateIntro(dt); return; }
    super.update(dt);
    if (!this.alive) { if (this._ringOn) { this.fx.ring.hide(); this._ringOn = false; } this.fx.light.intensity *= Math.exp(-4 * dt); return; }
    if (this.frozen) return;
    if (this.phase === 1 && this.hp <= this.maxHp * this.phaseAt) this.enterPhase(2);
    const a = this.attack;
    if (a.phase === 'active' && !this._impacted) { this._impacted = true; this.onImpact(a.def); }
    if (this.phase > 1 && this.state === 'chase') this.cooldown -= dt * 0.45;
    this.updateFx(dt);
  }

  updateIntro(dt) {
    this.stateT += dt;
    this.updateCommon(dt); this.updateBlade(dt);
    this.stop();
    const p = this.game.player;
    if (p) this.faceToward(p.pos.x, p.pos.z, dt, 5);
    const k = Math.min(1, this.stateT / this.introDur), s = Math.sin(k * Math.PI);
    this.glow = 0.55 * s * this.glowScale; this._glowDirty = true;
    this.telegraph = 0.9 * s;
    if (!this._roared && this.stateT > 0.35) { this._roared = true; this.game.cameraCtl.addShake(0.5); }
    if (this.stateT >= this.introDur) { this.introDone = true; this.glow = 0; this.telegraph = 0; this._glowDirty = true; this.cooldown = 0.3; this.setState('chase'); }
    this.applyPhysics(dt); this.groundShadow(); this.rig.update(dt);
    this.updateFx(dt);
  }

  enterPhase(n) {
    this.phase = n;
    this.emberBase = Math.max(this.emberBase, 0.5); this.glowScale *= 1.3;
    this.game.events.emit('boss:phase', { boss: this, phase: n });
    this.beginRoar(1.5);
  }

  /** First active frame of an attack: slams shake the ground. */
  onImpact(def) {
    if (!def.slam) return;
    const c = this.game.combat, T = this.game.terrain;
    this.ringAt(def);
    const x = _p.x, z = _p.z, y = T.getHeight(x, z);
    _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    c.dust(x, y, z, 30, 0, 0, 3.6, 0.8);
    c.dust(x, y, z, 10, _d.x * 2, _d.z * 2, 1.5, 0.5);
    c.impact(_p.set(x, y + 0.35, z), _d, 'metal', 1.9);
    c.flashLight(_p.set(x, y + 1.4, z), this.glowColor.getHex(), 48);
    this.game.cameraCtl.addShake(0.85);
    this.game.requestHitStop(0.03);
  }

  /** Telegraph ring + ember light (also used by the screenshot pose with dt = 0). */
  updateFx(dt) {
    const f = this.fx, a = this.attack;
    if (this._ringOn) {
      if (a.phase === 'windup' && this.alive) { this.ringAt(a.def); f.ring.place(_p.x, _p.z); f.ring.set(this.telegraph); }
      else { this._ringT += dt; f.ring.set(1 + Math.max(0, 0.35 - this._ringT * 2.5)); if (this._ringT > 0.22 || !this.alive) { f.ring.hide(); this._ringOn = false; } }
    }
    f.ring.update(dt);
    const heat = (this.telegraph * this.telegraph * 52 + this.emberBase * 9 + this.bladeFlash * 24 + this.glow * 18) * this.heatScale;
    f.light.intensity = heat;
    if (heat > 0) { f.light.color.copy(this.glowColor); f.light.position.set(this.pos.x + Math.sin(this.yaw) * 0.9, this.pos.y + this.lightHeight, this.pos.z + Math.cos(this.yaw) * 0.9); }
    if (this.dressing) this.dressing.update(dt);
  }

  onDeath(hit) {
    super.onDeath(hit);
    if (this._ringOn) { this.fx.ring.hide(); this._ringOn = false; }
    this.game.combat.dust(this.pos.x, this.pos.y, this.pos.z, 36, 0, 0, 4.5, 0.9);
    this.game.cameraCtl.addShake(0.7);
  }
}
