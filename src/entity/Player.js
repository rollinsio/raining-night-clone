/**
 * Player controller: camera-relative movement with accel/decel, sprint, dodge roll with i-frames,
 * 3-hit light combo + heavy, skill/ultimate placeholders, stamina/FP, lock-on, hit/stagger/death/respawn.
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { createNightfarerRig } from '../nightfarers/Rig.js';
import { WEAPONS, MOVESETS, SKILLS } from '../combat/Weapons.js';

const _move = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _chest = new THREE.Vector3(), _n = new THREE.Vector3(), _org = new THREE.Vector3(), _aim = new THREE.Vector3();
const FLASK_HEAL = 0.4;           // fraction of max HP restored per crimson flask
const COMBAT_R = 45, COMBAT_LINGER = 4; // an aggro'd enemy this close, or a hit this recent, counts as combat
const UP = new THREE.Vector3(0, 1, 0);
const WALK = 5.8, SPRINT = 9.3, ROLL_DUR = 0.55, ROLL_SPEED = 8.6, DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export class Player extends Entity {
  constructor(game, nf) {
    super(game, { name: nf.name, team: 'player', hp: nf.hp, stamina: nf.stamina, poise: 45, radius: 0.42 });
    this.nf = nf;
    this.baseHp = nf.hp; this.baseStamina = nf.stamina; this.baseFp = nf.fp;
    this.fp = nf.fp; this.maxFp = nf.fp;
    this.level = 1; this.runes = 0; this.kills = 0; this.deaths = 0;
    this.flasks = 3; this.maxFlasks = 3; // crimson flasks (refilled at a grace; `flask` action drinks one)
    this.weapon = WEAPONS[nf.weapon] || WEAPONS.sword;
    this.moveset = MOVESETS[this.weapon.moveset];
    const T = game.terrain;
    const ground = (x, z, n) => { T.getNormal(x, z, n); return T.getHeight(x, z); }; // per-foot contact shadows
    // the class costume (nightfarers/Rig.js): Ironeye's bow sits in the left fist, casters carry the staff
    this.rig = createNightfarerRig(nf, { ground });
    this.object3d.add(this.rig.root);
    // yaw writes straight through to the transform so a pose that sets it without stepping physics still renders facing that way
    let yaw = this.yaw;
    Object.defineProperty(this, 'yaw', { get: () => yaw, set: (v) => { yaw = v; this.object3d.rotation.y = v; } });
    this.materials = this.rig.materials;
    this.anim = this.rig.animator;
    this.state = 'idle'; this.stateT = 0; this.hitDur = 0.35;
    this.speed = 0; this.sprinting = false;
    this.moveDir = new THREE.Vector3(0, 0, 1); this.rollDir = new THREE.Vector3(0, 0, 1);
    this.lockTarget = null; this.comboIndex = 0;
    this.bufferAction = null; this.bufferT = 0;
    this.staminaDelay = 0; this.skillCd = 0; this.ultCd = 0; this.combatT = 0;
    this.respawnPoint = new THREE.Vector3(); this.respawnName = 'Limveld';
    this.attack = { def: null, t: 0, phase: 'none', hitSet: new Set(), lastAngle: 0, heavy: false, reach: 0, fired: false };
    this.outsideRing = false;
  }

  /** Recompute stats from level (keeps hp ratio). */
  applyLevel() {
    const l = this.level - 1, ratio = this.maxHp ? this.hp / this.maxHp : 1;
    this.maxHp = Math.round(this.baseHp * (1 + 0.065 * l));
    this.hp = Math.min(this.maxHp, Math.round(this.maxHp * ratio));
    this.maxStamina = this.baseStamina + 3 * l;
    this.maxFp = this.baseFp + 4 * l;
    this.damageMult = 1 + 0.055 * l;
  }

  /** Chest position (particle target). */
  chest() { return _chest.set(this.pos.x, this.pos.y + 1.3, this.pos.z); }

  setState(s) { this.state = s; this.stateT = 0; }
  buffer(a) { this.bufferAction = a; this.bufferT = 0.3; }
  takeBuffer(a) { if (this.bufferAction === a) { this.bufferAction = null; return true; } return false; }

  update(dt) {
    this.stateT += dt;
    this.updateCommon(dt);
    const anim = this.anim;
    if (!this.alive) {
      this.deadT += dt; anim.play('death', { rate: 10 });
      this.vel.x = this.vel.z = 0; this.applyPhysics(dt); this.groundShadow(); this.rig.update(dt);
      return;
    }
    if (this.frozen) { this.groundShadow(); this.rig.update(dt); return; }
    const input = this.game.input, camCtl = this.game.cameraCtl;
    if (this.skillCd > 0) this.skillCd -= dt;
    if (this.ultCd > 0) this.ultCd -= dt;
    if (this.combatT > 0) this.combatT -= dt;
    if (this.bufferT > 0) { this.bufferT -= dt; if (this.bufferT <= 0) this.bufferAction = null; }
    this.fp = Math.min(this.maxFp, this.fp + 0.7 * dt);

    for (const a of ['light', 'heavy', 'roll', 'skill', 'ult', 'flask']) if (input.wasPressed(a)) this.buffer(a);
    if (input.wasPressed('lockOn')) this.toggleLock();
    if (this.lockTarget && (!this.lockTarget.alive || this.distanceTo(this.lockTarget) > 42)) this.setLock(null);

    // camera-relative move vector
    camCtl.cameraForward(_f); _r.set(-_f.z, 0, _f.x);
    _move.set(0, 0, 0).addScaledVector(_f, input.move.y).addScaledVector(_r, input.move.x);
    let len = _move.length();
    if (len > 1) { _move.divideScalar(len); len = 1; } else if (len > 0.001) _move.divideScalar(len);

    switch (this.state) {
      case 'idle': case 'move': this.updateLocomotion(dt, _move, len); break;
      case 'roll': this.updateRoll(dt); break;
      case 'attack': this.updateAttack(dt, _move, len); break;
      case 'hit': this.decel(dt); if (this.stateT > this.hitDur) { this.setState('idle'); anim.play('idle'); } break;
      case 'rest': this.decel(dt); anim.play('rest', { rate: 8 }); if (this.stateT > 0.6 && (len > 0.001 || this.bufferAction)) { this.setState('idle'); anim.play('idle'); } break;
    }
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.stamina < this.maxStamina) this.stamina = Math.min(this.maxStamina, this.stamina + (26 + this.level * 0.6) * dt);
    this.applyPhysics(dt);
    this.groundShadow();
    this.rig.update(dt);
  }

  teleport(x, z) { super.teleport(x, z); this.groundShadow(); }

  /** Lay the contact shadow onto the terrain slope (normal rotated into the player's yaw frame). */
  groundShadow() {
    this.game.terrain.getNormal(this.pos.x, this.pos.z, _n).applyAxisAngle(UP, -this.yaw);
    this.rig.setGroundNormal(_n);
  }

  updateLocomotion(dt, move, len) {
    const input = this.game.input, anim = this.anim;
    const wantSprint = input.isHeld('sprint') && len > 0.001 && this.stamina > 0;
    this.sprinting = wantSprint;
    const target = len * (wantSprint ? SPRINT : WALK);
    const accel = target > this.speed ? 30 : 24;
    this.speed += clamp(target - this.speed, -accel * dt, accel * dt);
    if (len > 0.001) this.moveDir.copy(move);
    this.vel.x = this.moveDir.x * this.speed; this.vel.z = this.moveDir.z * this.speed;
    if (wantSprint && this.inCombat()) { this.stamina -= 11 * dt; this.staminaDelay = 0.5; } // Nightreign: sprinting is free out of combat
    if (this.lockTarget && !wantSprint) this.faceToward(this.lockTarget.pos.x, this.lockTarget.pos.z, dt, 14);
    else if (len > 0.001) this.faceToward(this.pos.x + move.x, this.pos.z + move.z, dt, 13);
    if (this.speed > 0.4) { anim.play('run'); anim.ctx.speed = clamp((this.speed - 3) / (SPRINT - 3), 0, 1); this.state = 'move'; }
    else { anim.play('idle'); this.state = 'idle'; }
    // actions
    if (this.bufferAction === 'flask') { this.takeBuffer('flask'); this.drinkFlask(); return; }
    if (this.bufferAction === 'roll' && this.stamina > 0) { this.takeBuffer('roll'); this.startRoll(len > 0.001 ? move : this.forward()); return; }
    if (this.bufferAction === 'light' && this.stamina > 0) { this.takeBuffer('light'); this.comboIndex = 0; this.startAttack(this.moveset.light[0], false, move, len); return; }
    if (this.bufferAction === 'heavy' && this.stamina > 0) { this.takeBuffer('heavy'); this.startAttack(this.moveset.heavy, true, move, len); return; }
    if (this.bufferAction === 'skill') {
      this.takeBuffer('skill');
      if (this.skillCd <= 0 && this.fp >= SKILLS.skill.fp) { this.fp -= SKILLS.skill.fp; this.skillCd = SKILLS.skill.cooldown; this.startAttack(SKILLS.skill.def, true, move, len); }
      return;
    }
    if (this.bufferAction === 'ult') {
      this.takeBuffer('ult');
      if (this.ultCd <= 0 && this.fp >= SKILLS.ult.fp) {
        this.fp -= SKILLS.ult.fp; this.ultCd = SKILLS.ult.cooldown;
        this.startAttack({ clip: 'heavy', windup: 0.32, active: 0.14, recover: 0.6, motion: SKILLS.ult.motion, arcFrom: -180, arcTo: 180, stamina: 0, knock: SKILLS.ult.knock, step: 0, poiseMul: 3, reachOverride: SKILLS.ult.radius, burst: true }, true, move, len);
      }
    }
  }

  /** Drink a crimson flask: heals a fixed fraction of max HP. Only from idle/move (buffered like attacks). */
  drinkFlask() {
    if (this.flasks <= 0) return false;
    this.flasks--;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * FLASK_HEAL));
    return true;
  }

  /**
   * Ranged release from the chest: at the lock target's body, else at the nearest enemy close to the aim line
   * (a soft assist — precise aiming on a touch pad is hopeless), else level along the facing.
   */
  fireRanged(def) {
    _org.set(this.pos.x + Math.sin(this.yaw) * 0.45, this.pos.y + 1.35, this.pos.z + Math.cos(this.yaw) * 0.45);
    let t = this.lockTarget, bestA = 0.22;
    if (!t) for (const e of this.game.entities) {
      if (e === this || !e.alive || e.team === 'player') continue;
      const d = this.distanceTo(e); if (d > 36) continue;
      let rel = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z) - this.yaw; rel = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));
      if (rel < bestA) { bestA = rel; t = e; }
    }
    if (t) _aim.set(t.pos.x, t.pos.y + t.height * t.scale * 0.55, t.pos.z).sub(_org).normalize();
    else _aim.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.game.combat.projectiles.fire(this, def, _org, _aim);
  }

  startRoll(dir) {
    this.rollDir.copy(dir).normalize();
    this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
    this.stamina -= 18; this.staminaDelay = 1.0;
    this.iframes = 0.42; this.sprinting = false;
    this.attack.phase = 'none';
    this.setState('roll');
    this.anim.ctx.dur = ROLL_DUR;
    this.anim.play('roll', { restart: true, rate: 30 });
  }

  updateRoll(dt) {
    const k = this.stateT / ROLL_DUR;
    const sp = ROLL_SPEED * (1 - sm(k) * 0.75);
    this.vel.x = this.rollDir.x * sp; this.vel.z = this.rollDir.z * sp;
    this.speed = sp * 0.5; this.moveDir.copy(this.rollDir);
    if (this.stateT >= ROLL_DUR) { this.setState('idle'); this.anim.play('idle'); }
  }

  startAttack(def, heavy, move, len) {
    if (def.fp) { if (this.fp < def.fp) def = this.moveset.light[0]; else this.fp -= def.fp; } // casts cost FP; short of it, a plain bolt
    const a = this.attack;
    a.def = def; a.t = 0; a.phase = 'windup'; a.hitSet.clear(); a.heavy = heavy; a.fired = false;
    a.lastAngle = def.arcFrom * DEG; a.reach = def.reachOverride || this.weapon.reach;
    this.stamina -= (def.stamina || 0) * (this.weapon.staminaMul || 1); this.staminaDelay = 1.2;
    this.sprinting = false;
    this.setState('attack');
    if (this.lockTarget) this.yaw = Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
    else if (def.ranged) { this.game.cameraCtl.cameraForward(_f); this.yaw = Math.atan2(_f.x, _f.z); } // unlocked shots go where the camera looks
    else if (move && len > 0.001) this.yaw = Math.atan2(move.x, move.z);
    const ctx = this.anim.ctx; ctx.windup = def.windup; ctx.active = def.active; ctx.recover = def.recover;
    this.anim.play(def.clip, { restart: true, blend: 0.07 });
    if (def.burst) this.game.combat.burstFx(this);
  }

  updateAttack(dt, move, len) {
    const a = this.attack, def = a.def;
    a.t += dt;
    const tw = def.windup, ta = tw + def.active, tr = ta + def.recover;
    if (a.t < tw) {
      a.phase = 'windup'; this.decel(dt);
      if (this.lockTarget) this.faceToward(this.lockTarget.pos.x, this.lockTarget.pos.z, dt, 7);
    } else if (a.t < ta) {
      a.phase = 'active';
      if (def.ranged && !a.fired) { a.fired = true; this.fireRanged(def); }
      // root motion: the step lands as a bell-shaped lunge (same distance, peak velocity into contact) so the
      // body drives the cut instead of gliding through it
      const k = (a.t - tw) / def.active, sp = (def.step / def.active) * (Math.PI / 2) * Math.sin(Math.PI * k);
      this.vel.x = Math.sin(this.yaw) * sp; this.vel.z = Math.cos(this.yaw) * sp; this.speed = 0;
    } else {
      a.phase = 'recover'; this.decel(dt);
      const rk = (a.t - ta) / def.recover;
      if (rk > 0.35) {
        if (this.bufferAction === 'light' && this.stamina > 0 && !a.heavy && this.comboIndex < this.moveset.light.length - 1) {
          this.takeBuffer('light'); this.comboIndex++; this.startAttack(this.moveset.light[this.comboIndex], false, move, len); return;
        }
        if (this.bufferAction === 'heavy' && this.stamina > 0) { this.takeBuffer('heavy'); this.startAttack(this.moveset.heavy, true, move, len); return; }
        if (this.bufferAction === 'roll' && this.stamina > 0 && rk > 0.45) { this.takeBuffer('roll'); this.startRoll(len > 0.001 ? move : this.forward()); return; }
      }
    }
    if (a.t >= tr) { a.phase = 'none'; this.setState('idle'); this.anim.play('idle'); }
  }

  decel(dt) {
    this.speed = Math.max(0, this.speed - 32 * dt);
    this.vel.x = this.moveDir.x * this.speed; this.vel.z = this.moveDir.z * this.speed;
  }

  toggleLock() {
    if (this.lockTarget) { this.setLock(null); return; }
    this.game.cameraCtl.cameraForward(_f);
    let best = null, bestScore = Infinity;
    for (const e of this.game.entities) {
      if (e === this || !e.alive || e.team === 'player') continue;
      const d = this.distanceTo(e);
      if (d > 32) continue;
      const dx = (e.pos.x - this.pos.x) / d, dz = (e.pos.z - this.pos.z) / d;
      const ang = Math.acos(clamp(dx * _f.x + dz * _f.z, -1, 1));
      if (ang > 1.25) continue;
      const score = ang * 8 + d * 0.3;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    this.setLock(best);
  }
  setLock(e) { this.lockTarget = e; this.game.cameraCtl.lockTarget = e; }

  /** Locked on, hit in the last few seconds, or an aggro'd enemy nearby — the sprint-cost gate. */
  inCombat() {
    if (this.combatT > 0 || this.lockTarget) return true;
    for (const e of this.game.entities) {
      if (e === this || !e.alive || e.team !== 'enemy' || !e.aggro) continue;
      if (this.distanceTo(e) < COMBAT_R) return true;
    }
    return false;
  }

  onHurt(hit) {
    this.combatT = COMBAT_LINGER;
    if (this.state !== 'roll') {
      this.setState('hit'); this.hitDur = 0.35; this.anim.ctx.dur = 0.35;
      this.anim.play('hit', { restart: true, rate: 22 }); this.attack.phase = 'none';
    }
    this.game.cameraCtl.addShake(0.45); this.game.postfx.flashDamage(0.55);
  }
  onStagger(hit) {
    this.setState('hit'); this.hitDur = 0.8; this.anim.ctx.dur = 0.8;
    this.anim.play('stagger', { restart: true, rate: 18 }); this.attack.phase = 'none';
    this.game.cameraCtl.addShake(0.8); this.game.postfx.flashDamage(0.8);
  }
  onDeath() {
    this.deaths++;
    this.attack.phase = 'none'; this.setLock(null); this.sprinting = false;
    this.anim.play('death', { restart: true, rate: 10 });
    this.game.cameraCtl.addShake(0.9); this.game.postfx.flashDamage(1);
    this.game.events.emit('player:died', this);
  }

  /** Return to the last grace with full bars and brief i-frames. */
  respawn() {
    this.alive = true; this.hp = this.maxHp; this.stamina = this.maxStamina; this.fp = this.maxFp; this.flasks = this.maxFlasks;
    this.teleport(this.respawnPoint.x, this.respawnPoint.z);
    this.setState('idle'); this.anim.play('idle', { restart: true });
    this.iframes = 1.5; this.flash = 0; this.outsideRing = false; this.attack.phase = 'none';
    this.game.cameraCtl.snap();
  }

  /** Rest at a Site of Grace. */
  rest(grace) {
    this.hp = this.maxHp; this.fp = this.maxFp; this.stamina = this.maxStamina; this.flasks = this.maxFlasks;
    this.respawnPoint.set(grace.x, 0, grace.z); this.respawnName = grace.name;
    this.setState('rest'); this.anim.play('rest', { restart: true, rate: 8 });
    this.speed = 0; this.vel.x = this.vel.z = 0;
  }
}
