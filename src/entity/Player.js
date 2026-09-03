/**
 * Player controller: camera-relative movement with accel/decel, sprint, dodge roll with i-frames,
 * 3-hit light combo + heavy, the held weapon's skill + the ultimate placeholder, stamina/FP, lock-on,
 * hit/stagger/death/respawn. Weapons live in an Inventory (entity/Inventory.js): pickupWeapon() stows or
 * equips, swapWeapon() cycles, equipWeapon() rebinds moveset / skill / the rig's weapon mesh.
 */
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { setHitCtx } from './Humanoid.js';
import { createNightfarerRig, signatureVisual } from '../nightfarers/Rig.js';
import { Inventory } from './Inventory.js';
import { WEAPONS, MOVESETS, SKILLS, WEAPON_SKILLS } from '../combat/Weapons.js';

const _move = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _chest = new THREE.Vector3(), _n = new THREE.Vector3(), _org = new THREE.Vector3(), _aim = new THREE.Vector3(), _fan = new THREE.Vector3();
const FLASK_HEAL = 0.4;           // fraction of max HP restored per crimson flask
const COMBAT_R = 45, COMBAT_LINGER = 4; // an aggro'd enemy this close, or a hit this recent, counts as combat
const UP = new THREE.Vector3(0, 1, 0);
const WALK = 5.8, SPRINT = 9.3, ROLL_DUR = 0.55, ROLL_SPEED = 8.6, DEG = Math.PI / 180;
const JUMP_V = 8.2;               // upward impulse; apex = v^2 / 2g ~ 1.4 m, clears a church plinth (0.9 m)
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
    this.inventory = new Inventory();
    this.weapon = null; this.moveset = null;
    this.baseDamageMult = 1; this.buffT = 0; this.buffMul = 1; // damageMult = base × the active skill buff
    const T = game.terrain;
    const ground = (x, z, n) => { T.getNormal(x, z, n); return T.getHeight(x, z); }; // per-foot contact shadows
    // the class costume (nightfarers/Rig.js); the weapon is a separate mesh the rig swaps on equipWeapon()
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
    const startId = WEAPONS[nf.weapon] ? nf.weapon : 'sword';
    this.inventory.add({ ...WEAPONS[startId], id: startId, rarity: 'common' });
    this.equipWeapon(this.inventory.equip(0), { quiet: true });
  }

  /** The held weapon's skill (WEAPON_SKILLS), or the shared fallback. */
  get skill() { return (this.weapon && WEAPON_SKILLS[this.weapon.skill]) || SKILLS.skill; }

  /**
   * Hold `w` (an inventory entry): moveset, skill and the rig's weapon mesh follow. Cuts any attack in progress
   * (the inventory menu can equip mid-swing) and drops the cached blade trail, which was bound to the old blade.
   */
  equipWeapon(w, { quiet = false } = {}) {
    if (!w) return;
    this.weapon = w;
    this.moveset = MOVESETS[w.moveset] || MOVESETS.sword;
    this.rig.setWeapon(signatureVisual(this.nf.id, w.visual));
    this._trail = null; this.comboIndex = 0;
    if (this.state === 'attack') { this.attack.phase = 'none'; this.setState('idle'); this.anim.play('idle'); }
    if (!quiet) { this.game.events.emit('weapon:changed', w); if (this.game.hud) this.game.hud.showWeapon(w); }
  }

  /**
   * Loot: stow the weapon, and hold it when it is at least as strong as the one in hand (or when a full
   * inventory made it replace the held one). Returns { equipped, replaced }.
   */
  pickupWeapon(w) {
    const cur = this.weapon;
    const r = this.inventory.add(w);
    const equipped = !!r.replaced || !cur || w.dmg >= cur.dmg;
    if (equipped) { this.inventory.equip(r.index); this.equipWeapon(w); }
    else if (this.game.hud) this.game.hud.showWeapon(w, true);
    return { equipped, replaced: r.replaced };
  }

  /** Cycle to the next carried weapon (the swap action; idle / moving only). */
  swapWeapon(dir = 1) {
    const w = this.inventory.cycle(dir);
    if (w) this.equipWeapon(w);
    return w;
  }

  /** Recompute stats from level (keeps hp ratio). */
  applyLevel() {
    const l = this.level - 1, ratio = this.maxHp ? this.hp / this.maxHp : 1;
    this.maxHp = Math.round(this.baseHp * (1 + 0.065 * l));
    this.hp = Math.min(this.maxHp, Math.round(this.maxHp * ratio));
    this.maxStamina = this.baseStamina + 3 * l;
    this.maxFp = this.baseFp + 4 * l;
    this.baseDamageMult = 1 + 0.055 * l;
    this.damageMult = this.baseDamageMult * (this.buffT > 0 ? this.buffMul : 1);
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
    if (this.buffT > 0) this.buffT -= dt;
    this.damageMult = this.baseDamageMult * (this.buffT > 0 ? this.buffMul : 1);
    if (this.bufferT > 0) { this.bufferT -= dt; if (this.bufferT <= 0) this.bufferAction = null; }
    this.fp = Math.min(this.maxFp, this.fp + 0.7 * dt);

    for (const a of ['light', 'heavy', 'roll', 'jump', 'skill', 'ult', 'flask', 'swapWeapon']) if (input.wasPressed(a)) this.buffer(a);
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
      case 'jump': this.updateJump(dt, _move, len); break;
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
    // the gait follows the speed physics actually delivered (a climb slows the legs with the body; a wall stops
    // them) and plays exactly after a short crossfade so the stride is not smeared by the pose low-pass
    const moving = this.speed > 0.4 && (this.groundSpeed > 0.4 || !this.blocked);
    if (moving) { anim.play('run', { blend: 0.12 }); anim.ctx.speed = clamp((this.speed - 3) / (SPRINT - 3), 0, 1); anim.ctx.mps = Math.max(0.6, this.groundSpeed); anim.ctx.slope = this.slope; this.state = 'move'; }
    else { anim.play('idle'); this.state = 'idle'; }
    // actions
    if (this.bufferAction === 'flask') { this.takeBuffer('flask'); this.drinkFlask(); return; }
    if (this.bufferAction === 'swapWeapon') { this.takeBuffer('swapWeapon'); this.swapWeapon(1); return; }
    if (this.bufferAction === 'roll' && this.stamina > 0) { this.takeBuffer('roll'); this.startRoll(len > 0.001 ? move : this.forward()); return; }
    if (this.bufferAction === 'jump' && this.stamina > 0 && this.onGround) { this.takeBuffer('jump'); this.startJump(); return; }
    if (this.bufferAction === 'light' && this.stamina > 0) { this.takeBuffer('light'); this.comboIndex = 0; this.startAttack(this.moveset.light[0], false, move, len); return; }
    if (this.bufferAction === 'heavy' && this.stamina > 0) { this.takeBuffer('heavy'); this.startAttack(this.moveset.heavy, true, move, len); return; }
    if (this.bufferAction === 'skill') {
      this.takeBuffer('skill');
      const sk = this.skill;
      if (this.skillCd <= 0) { this.skillCd = sk.cooldown; this.startAttack(sk.def, true, move, len); } // cooldown-gated, no FP
      return;
    }
    if (this.bufferAction === 'ult') {
      this.takeBuffer('ult');
      if (this.ultCd <= 0 && this.fp >= SKILLS.ult.fp) {
        this.fp -= SKILLS.ult.fp; this.ultCd = SKILLS.ult.cooldown;
        this.startAttack({ clip: 'heavy', windup: 0.32, active: 0.14, recover: 0.6, motion: SKILLS.ult.motion, arcFrom: -180, arcTo: 180, stamina: 0, knock: SKILLS.ult.knock, step: 0, poiseMul: 3, reachOverride: SKILLS.ult.radius, burst: true, radial: true }, true, move, len);
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
   * (a soft assist — precise aiming on a touch pad is hopeless), else along the camera's pitch so shots go
   * where the player is looking (uphill, downhill) instead of skimming level into the nearest slope.
   */
  fireRanged(def) {
    _org.set(this.pos.x + Math.sin(this.yaw) * 0.45, this.pos.y + 1.35, this.pos.z + Math.cos(this.yaw) * 0.45);
    let t = this.lockTarget, bestA = 0.35;
    if (!t) for (const e of this.game.entities) {
      if (e === this || !e.alive || e.team === 'player') continue;
      const d = this.distanceTo(e); if (d > 48) continue;
      let rel = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z) - this.yaw; rel = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));
      if (rel < bestA) { bestA = rel; t = e; }
    }
    if (t) _aim.set(t.pos.x, t.pos.y + t.height * t.scale * 0.55, t.pos.z).sub(_org).normalize();
    else {
      const pitch = this.game.cameraCtl.pitch, cp = Math.cos(pitch);
      _aim.set(Math.sin(this.yaw) * cp, -Math.sin(pitch) + 0.05, Math.cos(this.yaw) * cp).normalize(); // +0.05: a hair of arc against arrow drop
    }
    const n = def.ranged.count || 1, spread = def.ranged.spread || 0;
    if (n <= 1) { this.game.combat.projectiles.fire(this, def, _org, _aim); return; }
    for (let i = 0; i < n; i++) { // a fan around the aim line (skills: Barrage, Glintstone Arc)
      _fan.copy(_aim).applyAxisAngle(UP, (i - (n - 1) / 2) * spread);
      this.game.combat.projectiles.fire(this, def, _org, _fan);
    }
  }

  /** Jump from locomotion: full upward impulse, the run speed carried into the air, small stamina cost. */
  startJump() {
    this.stamina -= 8; this.staminaDelay = 0.6;
    this.vel.y = JUMP_V;
    this.sprinting = false;
    this.setState('jump');
    this.anim.ctx.param = 0;
    this.anim.play('jump', { restart: true, blend: 0.06 });
  }

  /** Airborne: gravity does the work; the stick steers at reduced authority without adding speed. */
  updateJump(dt, move, len) {
    if (len > 0.001) {
      this.vel.x += move.x * 10 * dt; this.vel.z += move.z * 10 * dt;
      const sp = Math.hypot(this.vel.x, this.vel.z), max = Math.max(this.speed, WALK);
      if (sp > max) { this.vel.x *= max / sp; this.vel.z *= max / sp; }
      this.moveDir.copy(move);
      this.faceToward(this.pos.x + move.x, this.pos.z + move.z, dt, 6);
    }
    this.anim.ctx.param = clamp(0.5 - this.vel.y / (2 * JUMP_V), 0, 1); // 0 rising -> 0.5 apex -> 1 falling
    if (this.onGround && this.stateT > 0.08) { // landed (applyPhysics grounded us last step)
      this.speed = Math.hypot(this.vel.x, this.vel.z);
      this.setState('idle');
      this.anim.play(this.speed > 0.4 ? 'run' : 'idle', { blend: 0.1 });
    }
  }

  startRoll(dir) {
    this.rollDir.copy(dir).normalize();
    this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
    this.stamina -= 18; this.staminaDelay = 1.0;
    this.iframes = 0.42; this.sprinting = false;
    this.attack.phase = 'none';
    this.setState('roll');
    this.anim.ctx.dur = ROLL_DUR;
    this.anim.play('roll', { restart: true, blend: 0.06 });
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
    if (def.iframes) this.iframes = Math.max(this.iframes, def.iframes);          // skill: a dash through danger
    if (def.buff) { this.buffT = def.buff.dur; this.buffMul = def.buff.mul; }      // skill: attack-up for a while
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
      if (a.phase !== 'active') this.game.cameraCtl.addLunge(a.heavy ? 0.22 : 0.12); // first active frame
      a.phase = 'active';
      if (def.ranged && !a.fired) { a.fired = true; this.fireRanged(def); }
      if (def.spin) this.yaw += def.spin * (dt / def.active); // whirl: the blade sweep follows the body round
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

  /** Getting hit while unlocked snaps the lock onto the attacker (within lock-on range). */
  lockOnAttacker(hit) {
    const s = hit && hit.source;
    if (!this.lockTarget && s && s.alive && s.team !== 'player' && this.distanceTo(s) <= 32) this.setLock(s);
  }

  onHurt(hit) {
    this.combatT = COMBAT_LINGER;
    this.lockOnAttacker(hit);
    if (this.state !== 'roll') {
      this.setState('hit'); this.hitDur = 0.35; this.anim.ctx.dur = 0.35; setHitCtx(this.anim.ctx, hit, this.yaw);
      this.anim.play('hit', { restart: true, blend: 0.03 }); this.attack.phase = 'none'; // snaps: the clip itself relaxes
    }
    this.game.cameraCtl.addShake(0.45); this.game.postfx.flashDamage(0.55);
  }
  onStagger(hit) {
    this.combatT = COMBAT_LINGER;
    this.lockOnAttacker(hit);
    this.setState('hit'); this.hitDur = 0.8; this.anim.ctx.dur = 0.8; setHitCtx(this.anim.ctx, hit, this.yaw);
    this.anim.play('stagger', { restart: true, blend: 0.04 }); this.attack.phase = 'none';
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
