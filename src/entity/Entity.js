/**
 * Entity base: transform, hp/stamina/poise, terrain physics, hit intake (i-frames, knockback,
 * poise -> stagger, death) and the emissive hit-flash / telegraph glow on per-entity materials.
 */
import * as THREE from 'three';
import { makeContact } from '../render/Contact.js';

const _tmp = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 24;
const MAX_CLIMB = 1.0;   // rise over run (45 deg) at which a climb eases to a standstill
const CLIMB_EASE = 0.5;  // rise over run (~27 deg) up to which a hill costs no speed
const HARD_CLIMB = 1.15; // a single step rising steeper than this is a wall whatever the stride-scale slope says
const STRIDE = 0.8;      // metres ahead the slope under the heading is sampled over (a stride, not a frame's step)
const STEP_DOWN = 0.45;  // a grounded body follows the ground down this far per step instead of hopping off crests

export class Entity {
  constructor(game, { name = 'entity', team = 'enemy', hp = 100, stamina = 100, poise = 30, radius = 0.45, height = 1.8 } = {}) {
    this.game = game;
    this.name = name; this.team = team;
    this.object3d = new THREE.Group();
    this.object3d.name = name;
    this.pos = this.object3d.position;
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.yaw = 0;
    this.hp = hp; this.maxHp = hp;
    this.stamina = stamina; this.maxStamina = stamina;
    this.poise = poise; this.maxPoise = poise;
    this.radius = radius; this.height = height;
    this.scale = 1;
    this.alive = true; this.remove = false; this.frozen = false;
    this.onGround = false;
    this.groundSpeed = 0; // measured horizontal speed (m/s, smoothed) — what the legs should actually be covering
    this.slope = 0;       // rise over run under the heading (+ uphill, smoothed) for the gait's lean
    this.iframes = 0; this.staggerT = 0; this.poiseRegenT = 0;
    this.flash = 0; this.flashColor = new THREE.Color(0xffffff);
    this.glow = 0; this.glowColor = new THREE.Color(0xff8030);
    this.materials = [];
    this.attack = null;
    this.damageMult = 1;
    this.guarding = false;
    this.deadT = 0;
    this.hitstun = 0;
    // contact shadow: a soft dark blob sized to the footprint, laid onto the terrain slope every physics step so
    // every figure visibly sits on the ground (subclasses that built their own `blob` get it swapped for this one)
    this.contact = makeContact(radius * 2.7, radius * 2.5);
    this.object3d.add(this.contact);
  }

  /** Lay the contact blob onto the terrain under the entity (normal rotated into the yaw frame). */
  groundContact() {
    if (this.blob && this.blob !== this.contact) {
      // a subclass installed its own disc (Enemy / bosses): keep its footprint size, replace it with the shared blob
      this.contact.scale.set(Math.max(this.contact.scale.x, this.blob.scale.x * 1.15), 1, Math.max(this.contact.scale.z, this.blob.scale.z * 1.1));
      this.object3d.remove(this.blob);
      this.blob = this.contact;
    }
    // on a built floor (feet above the heightfield) the blob lies flat; on turf it follows the slope
    if (this.pos.y - this.game.terrain.getHeight(this.pos.x, this.pos.z) > 0.08) _n.set(0, 1, 0);
    else this.game.terrain.getNormal(this.pos.x, this.pos.z, _n).applyAxisAngle(UP, -this.yaw);
    this.contact.quaternion.setFromUnitVectors(UP, _n);
    const a = this.alive ? 1 : Math.max(0.25, 1 - this.deadT * 0.4);
    this.contact.visible = a > 0.05;
  }

  /** Unit forward vector (model +Z rotated by yaw) written into out. */
  forward(out = _fwd) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  distanceTo(e) { return Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); }

  /** Rotate yaw toward a world point at `rate` rad/s. */
  faceToward(x, z, dt, rate = 10) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = rate * dt;
    this.yaw += Math.abs(d) < step ? d : Math.sign(d) * step;
  }

  /**
   * Gravity + terrain collision + static solids + map bounds. Knockback decays here.
   * Hills: the slope under the heading is sampled a stride ahead (so the heightfield's cell edges do not flicker
   * it). Up to CLIMB_EASE it costs nothing; from there the uphill part of the step eases smoothly to nothing at
   * MAX_CLIMB, the along-contour part is kept, so a body slows into a steep face and slides along it instead of
   * hitting the old on/off wall. A single step rising steeper than HARD_CLIMB is still refused outright (a cliff
   * inside the stride sample). Descents are never blocked, and a grounded body is kept on the ground over crests
   * and down slopes (STEP_DOWN) rather than lofted off them by its own momentum.
   * Writes groundSpeed / slope (smoothed) for the locomotion clip.
   */
  applyPhysics(dt) {
    const T = this.game.terrain;
    const wasGround = this.onGround;
    this.vel.y -= GRAVITY * dt;
    const kx = this.knock.x, kz = this.knock.z;
    const x0 = this.pos.x, z0 = this.pos.z;
    let mx = (this.vel.x + kx) * dt, mz = (this.vel.z + kz) * dt;
    this.pos.y += this.vel.y * dt;
    const kd = Math.exp(-9 * dt);
    this.knock.x *= kd; this.knock.z *= kd;
    const md = Math.hypot(mx, mz);
    let slope = 0;
    this.blocked = false;
    if (md > 1e-5) {
      const h0 = T.getHeight(x0, z0), dx = mx / md, dz = mz / md;
      slope = (T.getHeight(x0 + dx * STRIDE, z0 + dz * STRIDE) - h0) / STRIDE;
      if (slope > CLIMB_EASE) {
        // ease the uphill component out (the terrain normal's XZ points downhill)
        const t = Math.min(1, (slope - CLIMB_EASE) / (MAX_CLIMB - CLIMB_EASE)), cut = t * t; // gentle at first, a crawl near the limit
        T.getNormal(x0 + mx * 0.5, z0 + mz * 0.5, _n);
        const gl = Math.hypot(_n.x, _n.z);
        if (gl > 1e-5) {
          const ux = -_n.x / gl, uz = -_n.z / gl, up = mx * ux + mz * uz;
          if (up > 0) { mx -= ux * up * cut; mz -= uz * up * cut; }
        }
        if (cut >= 1) this.blocked = true;
      }
      const md2 = Math.hypot(mx, mz);
      if (md2 > 1e-5 && T.getHeight(x0 + mx, z0 + mz) - h0 > HARD_CLIMB * md2) { mx = 0; mz = 0; this.blocked = true; }
    }
    this.pos.x = x0 + mx; this.pos.z = z0 + mz;
    const lim = T.half - 14;
    if (this.pos.x > lim) this.pos.x = lim; else if (this.pos.x < -lim) this.pos.x = -lim;
    if (this.pos.z > lim) this.pos.z = lim; else if (this.pos.z < -lim) this.pos.z = -lim;
    // static solids (trunks, rocks, walls): slide out of any we overlap before sampling the ground under the final spot
    if (this.game.colliders) this.game.colliders.resolve(this.pos, this.radius, this.height, Math.max(this.pos.y, T.getHeight(this.pos.x, this.pos.z)));
    const th = T.getHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= th) { this.pos.y = th; if (this.vel.y < 0) this.vel.y = 0; } // the heightfield is always solid
    let h = th;
    if (this.game.colliders) { // walkable platform tops (church floors, plinths, steps) within a knee-step of the feet
      const g = this.game.colliders.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, th), 0.55);
      if (g > h) h = g;
    }
    if (this.pos.y <= h && this.vel.y <= 0) { this.pos.y = h; this.vel.y = 0; this.onGround = true; } // vel.y > 0: rising past a floor lip, do not snap
    else if (wasGround && this.vel.y <= 0 && this.pos.y - h < STEP_DOWN) { this.pos.y = h; this.vel.y = 0; this.onGround = true; } // follow the ground down
    else this.onGround = this.pos.y - h < 0.05;
    if (dt > 0) { // measured motion for the gait: displacement physics actually produced, and the slope under it
      const f = 1 - Math.exp(-24 * dt), fs = 1 - Math.exp(-8 * dt);
      this.groundSpeed += (Math.hypot(this.pos.x - x0, this.pos.z - z0) / dt - this.groundSpeed) * f;
      this.slope += (slope - this.slope) * fs;
    }
    this.object3d.rotation.y = this.yaw;
    this.groundContact();
  }

  /** Shared per-frame bookkeeping: timers, poise regen, flash decay. */
  updateCommon(dt) {
    if (this.iframes > 0) this.iframes -= dt;
    if (this.staggerT > 0) this.staggerT -= dt;
    if (this.hitstun > 0) this.hitstun -= dt;
    if (this.poiseRegenT > 0) this.poiseRegenT -= dt;
    else if (this.poise < this.maxPoise) this.poise = Math.min(this.maxPoise, this.poise + this.maxPoise * dt * 0.5);
    if (this.flash > 0 || this.glow > 0 || this._glowDirty) {
      this.flash = Math.max(0, this.flash - dt * 7);
      for (let i = 0; i < this.materials.length; i++) {
        const m = this.materials[i];
        m.emissive.copy(this.flashColor).multiplyScalar(this.flash * 0.35);
        if (this.glow > 0) { _tmp.set(this.glowColor.r, this.glowColor.g, this.glowColor.b).multiplyScalar(this.glow * 0.4); m.emissive.r += _tmp.x; m.emissive.g += _tmp.y; m.emissive.b += _tmp.z; }
      }
      this._glowDirty = this.glow > 0 || this.flash > 0;
    }
  }

  /**
   * Apply a hit. hit = { damage, poise, dir (Vector3 from attacker to target), knock, source }.
   * Returns the damage actually applied (0 if ignored by i-frames).
   */
  takeHit(hit) {
    if (!this.alive || this.iframes > 0) return 0;
    let dmg = hit.damage;
    if (this.guarding) dmg *= 0.2;
    this.hp -= dmg;
    this.flash = 1; this.flashColor.setHex(this.guarding ? 0x8899bb : 0xffffff);
    if (hit.dir && hit.knock) { const k = this.guarding ? hit.knock * 0.5 : hit.knock; this.knock.x += hit.dir.x * k; this.knock.z += hit.dir.z * k; }
    this.poiseRegenT = 3;
    if (!this.guarding) {
      this.poise -= hit.poise || 0;
      if (this.poise <= 0) { this.poise = this.maxPoise; this.onStagger(hit); }
      else this.onHurt(hit);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(hit); }
    return dmg;
  }

  /** Damage that ignores i-frames / guard (ring tick). */
  takeRawDamage(dmg) {
    if (!this.alive) return;
    this.hp -= dmg;
    if (this.hp <= 0) { this.hp = 0; this.die(null); }
  }

  die(hit) {
    if (!this.alive) return;
    this.alive = false; this.deadT = 0; this.guarding = false; this.glow = 0;
    this.onDeath(hit);
  }

  onHurt(hit) {}
  onStagger(hit) {}
  onDeath(hit) {}

  /** Place on the ground at (x,z): the terrain, or a built floor above it (teleports land on top of plinths). */
  teleport(x, z) {
    let y = this.game.terrain.getHeight(x, z);
    if (this.game.colliders) { const g = this.game.colliders.groundAt(x, z, Infinity); if (g > y) y = g; }
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0); this.knock.set(0, 0, 0); this.groundSpeed = 0; this.slope = 0;
    this.object3d.rotation.y = this.yaw;
    this.groundContact();
  }

  dispose() {
    this.game.scene.remove(this.object3d);
    this.object3d.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
  }
}
