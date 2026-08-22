/**
 * Enemy base AI FSM: idle / patrol / alert / chase / attack / recover / stagger / hit / guard / dead.
 * Attacks are telegraphed: the body glows faintly and the blade (own emissive material group) heats up
 * during the windup, flashes white on the first active frame, and the step kicks up ground dust.
 * Drops runes on death. Subclasses build the rig, set stats and may override considerGuard / pickAttack.
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { WEAPONS, MOVESETS } from '../combat/Weapons.js';
import { makeContactBlob } from '../combat/Arena.js';

const DEG = Math.PI / 180;
const _f = new THREE.Vector3(), _n = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class Enemy extends Entity {
  constructor(game, o) {
    super(game, { name: o.name || 'Enemy', team: 'enemy', hp: o.hp || 100, stamina: 100, poise: o.poise || 30, radius: o.radius || 0.45, height: o.height || 1.8 });
    this.rng = game.rng.fork((o.seed || 0) + 97);
    this.home = new THREE.Vector3(o.home ? o.home.x : o.x, 0, o.home ? o.home.z : o.z);
    this.patrolR = o.patrolR ?? 8;
    this.aggroRange = o.aggro ?? 24; this.leashRange = o.leash ?? 60;
    this.walkSpeed = o.walk ?? 2.2; this.runSpeed = o.run ?? 4.6;
    this.runes = o.runes ?? 60; this.tier = o.tier ?? 1;
    this.isBoss = !!o.boss; this.pack = o.pack || null;
    this.weapon = WEAPONS[o.weapon || 'soldierSword'];
    this.moveset = MOVESETS[this.weapon.moveset];
    this.attackRange = o.attackRange ?? this.weapon.reach * 0.95;
    this.state = 'idle'; this.stateT = 0; this.waitT = this.rng.range(0.5, 3);
    this.dest = new THREE.Vector3();
    this.cooldown = this.rng.range(0.5, 1.5); this.strafeDir = this.rng.chance(0.5) ? 1 : -1; this.strafeT = 0;
    this.attack = { def: null, t: 0, phase: 'none', hitSet: new Set(), lastAngle: 0, reach: 0, stepped: false };
    this.aggro = false; this.comboNext = false; this.speed = 0;
    this.bladeMat = null; this.bladeFlash = 0; this.telegraph = 0; this._bladeLit = false;
    this.glowScale = o.glowScale ?? 1; // body telegraph glow strength (dark-furred beasts use less)
    // soft contact-AO disc under the feet (laid onto the terrain slope each frame)
    this.blob = makeContactBlob(o.blobW ?? 1.0, o.blobD ?? 0.95);
    this.object3d.add(this.blob);
    this.teleport(o.x, o.z);
    this.yaw = this.rng.float() * Math.PI * 2;
  }

  setState(s) { this.state = s; this.stateT = 0; }

  /**
   * Struck tint: the base Entity white-out (emissive = flash * 0.35) would bleach a 30 %-value figure into a
   * pale blob; enemies instead get a brief warm spark-lit tint (or a cool one when the blow hits a guard)
   * so the silhouette and the recoil stay legible against fire and hit FX.
   */
  takeHit(hit) {
    const applied = super.takeHit(hit);
    if (this.flash > 0) this.flashColor.setHex(this.guarding ? 0x6a7a99 : 0xc89a70).multiplyScalar(0.32);
    return applied;
  }

  teleport(x, z) { super.teleport(x, z); this.groundShadow(); }

  /** Tilt the contact blob onto the terrain (normal rotated into the enemy's yaw frame). */
  groundShadow() {
    this.game.terrain.getNormal(this.pos.x, this.pos.z, _n).applyAxisAngle(UP, -this.yaw);
    this.blob.quaternion.setFromUnitVectors(UP, _n);
  }

  setAggro() {
    if (this.aggro) return;
    this.aggro = true;
    if (this.pack) this.pack.alert = true;
    this.setState('alert');
  }

  canSee(p) {
    const d = this.distanceTo(p);
    if (d < 7) return true;
    this.forward(_f);
    const dx = (p.pos.x - this.pos.x) / d, dz = (p.pos.z - this.pos.z) / d;
    return dx * _f.x + dz * _f.z > -0.1;
  }

  /** Move horizontally toward (x,z) at speed; returns remaining distance. */
  moveToward(x, z, speed, dt, face = true) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { this.vel.x = this.vel.z = 0; return d; }
    this.vel.x = (dx / d) * speed; this.vel.z = (dz / d) * speed;
    if (face) this.faceToward(x, z, dt, 8);
    this.speed = speed;
    return d;
  }
  stop() { this.vel.x = this.vel.z = 0; this.speed = 0; }

  /** Subclass hook: return true to enter guard this frame. */
  considerGuard() { return false; }
  /** Subclass hook: choose an attack definition. */
  pickAttack() {
    const ms = this.moveset;
    if (ms.heavy && this.rng.chance(0.25)) { this.comboNext = false; return ms.heavy; }
    this.comboNext = ms.light.length > 1 && this.rng.chance(0.6);
    return ms.light[0];
  }

  startAttack(def) {
    const a = this.attack;
    a.def = def; a.t = 0; a.phase = 'windup'; a.hitSet.clear(); a.lastAngle = def.arcFrom * DEG; a.reach = this.weapon.reach; a.stepped = false;
    this.setState('attack'); this.stop();
    const ctx = this.anim.ctx; ctx.windup = def.windup; ctx.active = def.active; ctx.recover = def.recover;
    this.anim.play(def.clip, { restart: true, rate: 22 });
    this.glow = 0; this.telegraph = 0; this._glowDirty = true;
  }

  /** Blade emissive: telegraph heat during windup, white flash on release, a touch of the hit flash. */
  updateBlade(dt) {
    const m = this.bladeMat;
    if (!m) return;
    if (this.bladeFlash > 0) this.bladeFlash = Math.max(0, this.bladeFlash - dt * 9);
    const g = this.telegraph, f = this.bladeFlash, hf = this.flash;
    if (g <= 0 && f <= 0 && hf <= 0) { if (this._bladeLit) { m.emissive.setScalar(0); this._bladeLit = false; } return; }
    m.emissive.copy(this.glowColor).multiplyScalar(0.015 * g + 0.11 * g * g);
    m.emissive.addScalar(f * f * 1.2 + hf * 0.2);
    this._bladeLit = true;
  }

  update(dt) {
    this.stateT += dt;
    this.updateCommon(dt);
    this.updateBlade(dt);
    const anim = this.anim;
    if (!this.alive) {
      this.deadT += dt;
      anim.play('death', { rate: 9 });
      this.stop();
      if (this.deadT < 4) { this.applyPhysics(dt); this.groundShadow(); }
      else { this.pos.y -= dt * 0.35; if (this.deadT > 6.5) this.remove = true; }
      this.rig.update(dt);
      return;
    }
    if (this.frozen) { this.rig.update(dt); return; }
    const player = this.game.player;
    const pAlive = !!(player && player.alive);
    const dist = pAlive ? this.distanceTo(player) : Infinity;
    if (!this.aggro && pAlive && (dist < this.aggroRange && this.canSee(player))) this.setAggro();
    if (!this.aggro && this.pack && this.pack.alert && pAlive && dist < 60) this.setAggro();
    if (this.aggro && (!pAlive || (dist > this.leashRange && !this.isBoss))) { this.aggro = false; this.guarding = false; if (this.state !== 'attack') this.setState('idle'); }
    if (this.pack && !this.aggro) this.pack.alert = false;

    switch (this.state) {
      case 'idle':
        this.stop(); anim.play('idle');
        if (this.aggro) { this.setState('alert'); break; }
        this.waitT -= dt;
        if (this.waitT <= 0) {
          const a = this.rng.float() * Math.PI * 2, r = this.rng.range(2, this.patrolR);
          this.dest.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
          this.setState('patrol');
        }
        break;
      case 'patrol': {
        if (this.aggro) { this.setState('alert'); break; }
        const d = this.moveToward(this.dest.x, this.dest.z, this.walkSpeed, dt);
        anim.play('run'); anim.ctx.speed = 0;
        if (d < 0.8 || this.stateT > 12) { this.waitT = this.rng.range(1.5, 5); this.setState('idle'); }
        break;
      }
      case 'alert':
        this.stop(); anim.play('alert');
        if (pAlive) this.faceToward(player.pos.x, player.pos.z, dt, 6);
        if (this.stateT > 0.45) this.setState('chase');
        break;
      case 'chase': {
        if (!this.aggro || !pAlive) { this.setState('idle'); break; }
        this.cooldown -= dt;
        if (dist > this.attackRange * 0.9 + 0.2) {
          this.moveToward(player.pos.x, player.pos.z, this.runSpeed, dt);
          anim.play('run'); anim.ctx.speed = 0.75;
        } else {
          if (this.cooldown <= 0) { this.startAttack(this.pickAttack()); break; }
          if (this.considerGuard(player, dist)) { this.setState('guard'); this.guarding = true; anim.play('guard', { restart: true }); break; }
          // circle the player while waiting
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeDir = -this.strafeDir; this.strafeT = this.rng.range(1, 2.5); }
          const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
          const sp = this.walkSpeed * 0.8;
          this.vel.x = (-dz / d) * this.strafeDir * sp; this.vel.z = (dx / d) * this.strafeDir * sp;
          if (dist < this.attackRange * 0.5) { this.vel.x -= (dx / d) * sp; this.vel.z -= (dz / d) * sp; }
          this.faceToward(player.pos.x, player.pos.z, dt, 8);
          anim.play('alert');
        }
        break;
      }
      case 'guard':
        this.stop();
        if (pAlive) this.faceToward(player.pos.x, player.pos.z, dt, 8);
        if (this.stateT > 1.4 || !this.aggro) { this.guarding = false; this.cooldown = 0.2; this.setState('chase'); }
        break;
      case 'attack': {
        const a = this.attack, def = a.def;
        a.t += dt;
        const tw = def.windup, ta = tw + def.active, tr = ta + def.recover;
        if (a.t < tw) {
          a.phase = 'windup'; this.stop();
          if (pAlive) this.faceToward(player.pos.x, player.pos.z, dt, a.t < tw * 0.7 ? 4 : 0.5);
          const k = a.t / tw;
          this.telegraph = k;
          this.glow = 0.35 * k * k * this.glowScale; this._glowDirty = true;
        } else if (a.t < ta) {
          a.phase = 'active'; this.glow = 0; this.telegraph = 0; this._glowDirty = true;
          if (!a.stepped) { a.stepped = true; this.bladeFlash = 1; this.game.combat.stepDust(this, def.step); }
          const sp = def.step * this.scale / def.active;
          this.vel.x = Math.sin(this.yaw) * sp; this.vel.z = Math.cos(this.yaw) * sp;
        } else {
          a.phase = 'recover'; this.stop();
          if (this.comboNext && a.t > ta + def.recover * 0.45 && this.moveset.light[1]) {
            this.comboNext = false; this.startAttack(this.moveset.light[1]); break;
          }
        }
        if (a.t >= tr) { a.phase = 'none'; this.cooldown = this.rng.range(0.9, 2.2) * (this.isBoss ? 0.7 : 1); this.setState('chase'); }
        break;
      }
      case 'hit':
        this.stop();
        if (this.stateT > this.anim.ctx.dur) this.setState(this.aggro ? 'chase' : 'idle');
        break;
      case 'stagger':
        this.stop();
        if (this.stateT > 0.9) { this.cooldown = 0.4; this.setState(this.aggro ? 'chase' : 'idle'); }
        break;
    }
    this.separate();
    this.applyPhysics(dt);
    this.groundShadow();
    this.rig.update(dt);
  }

  /** Push out of other entities (and the player). */
  separate() {
    const ents = this.game.entities;
    for (let i = 0; i < ents.length; i++) {
      const o = ents[i];
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const min = this.radius * this.scale + o.radius * o.scale;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
        if (o.team === 'player') { o.pos.x -= (dx / d) * push * 0.6; o.pos.z -= (dz / d) * push * 0.6; }
      }
    }
  }

  onHurt(hit) {
    if (!this.aggro) this.setAggro();
    if (this.state !== 'attack' && this.state !== 'stagger') {
      // heavy blows (greatsword / charged) get the held hit-stop recoil if the rig has one, light hits the flinch
      const heavy = (hit && hit.poise > 28) && this.anim.clips.recoil;
      this.setState('hit'); this.anim.ctx.dur = heavy ? 0.42 : 0.32; this.anim.play(heavy ? 'recoil' : 'hit', { restart: true, rate: 26 });
    }
    this.game.combat.hurtDust(this, hit, 0.6);
  }
  onStagger(hit) {
    if (!this.aggro) this.setAggro();
    this.attack.phase = 'none'; this.glow = 0; this.telegraph = 0; this._glowDirty = true; this.guarding = false;
    this.setState('stagger'); this.anim.ctx.dur = 0.9; this.anim.play('stagger', { restart: true, rate: 16 });
    this.game.combat.hurtDust(this, hit, 1.2);
  }
  dispose() { super.dispose(); if (this.bladeMat) this.bladeMat.dispose(); }

  onDeath(hit) {
    this.attack.phase = 'none'; this.glow = 0; this.telegraph = 0; this._glowDirty = true;
    this.anim.play('death', { restart: true, rate: 9 });
    this.game.combat.dropRunes(this.pos, this.runes);
    this.game.combat.hurtDust(this, hit, 1.6);
    this.game.events.emit('enemy:died', this);
    if (this.isBoss) this.game.events.emit('boss:died', this);
  }
}
