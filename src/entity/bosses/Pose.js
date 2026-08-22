/**
 * Deterministic `boss` screenshot composition: the player braced low in the foreground, the day-1 Gate
 * Sentinel seen in three-quarter view mid wind-up of its overhead chop — the black horse a long horizontal
 * mass with its head swung toward the player, the pale rider a vertical over it with the halberd straight
 * up against the sky, the moon just up-right of the rider so its rim carves both outlines, gold telegraph
 * ring and eye slits lit — inside the dressed Central Plain arena with the night's last ring closed around
 * it, the brazier nearest the boss carrying the world's warm point light, the boss reveal + health bar.
 */
import * as THREE from 'three';
import { PALETTE } from '../../render/Style.js';
import { createBoss } from './index.js';
import { BossArena } from './BossArena.js';

const BOSS_RING_R = 115; // the day's final circle (Expedition RING_R[3]) — boss fights happen inside it
const MOON_A = Math.atan2(-0.5, -0.6); // horizontal bearing of the moon (BossArena MOON / Atmosphere MOON_DIR)
const _v = new THREE.Vector3();

/** Tunable composition (a capture script may edit these through the page's module instance). */
export const BOSS_POSE = {
  axis: 0.34,      // fight axis swung left of the moon bearing so the moon sits up-right of the rider
  playerBack: 2.0, // player distance behind the arena centre (m)
  bossAhead: 3.1,  // boss distance past the centre (m)
  turn: -0.95,     // boss yaw relative to "facing the camera": negative swings the horse's head to the camera's left
  pitch: -0.24, dist: 4.6, yawOffset: -0.16, shoulder: 1.75,
  k: 0.9,          // wind-up fraction
};

export function composeBossPose(game, { place, finish }) {
  const a = game.limveld.arenas[0], O = BOSS_POSE;
  BossArena.get(game, a);
  // remove any boss from an earlier pose (the sim is frozen while posing, so do it by hand)
  for (let i = game.entities.length - 1; i >= 0; i--) {
    const e = game.entities[i];
    if (e.isBoss) { e.dispose(); game.entities.splice(i, 1); if (game.run.boss === e) game.run.boss = null; }
  }
  const axisA = MOON_A + O.axis, dx = Math.sin(axisA), dz = Math.cos(axisA);
  const px = a.x - dx * O.playerBack, pz = a.z - dz * O.playerBack;
  const bx = a.x + dx * O.bossAhead, bz = a.z + dz * O.bossAhead;
  place(px, pz, bx, bz, { pitch: O.pitch, dist: O.dist, yawOffset: O.yawOffset, clip: 'guard' });
  if (game.run.ring && game.run.ring.setImmediate) { game.run.ring.setImmediate({ x: a.x, z: a.z }, BOSS_RING_R); game.run.ring.update(0.5); }

  const b = createBoss(game, 1, { x: bx, z: bz, arena: a, seed: 11 });
  game.addEntity(b);
  if (game.run.ring && game.run.ring.hookObject) game.run.ring.hookObject(b.object3d);
  // three-quarter view: the horse's length reads as a horizontal, the head swings toward the player
  const cp = game.camera.position;
  b.yaw = Math.atan2(cp.x - bx, cp.z - bz) + O.turn;
  b.aggro = true; b.introDone = true; b.setState('chase');
  const def = b.moveset.heavy, k = O.k;
  b.startAttack(def);
  b.attack.t = def.windup * k; b.telegraph = k; b.glow = 0.35 * k * k * b.glowScale; b._glowDirty = true;
  b.updateCommon(0); b.updateBlade(0);
  game.run.boss = b; game.run.bossActive = true;
  game.events.emit('boss:start', b);
  game.hud.showTitle(b.name, b.subtitle, 30);
  game.player.lockTarget = b; // reticle only; the camera keeps the composed framing

  finish();
  if (game.graces && game.graces.update) game.graces.update(0);
  // the arena's own light: park the world's warm point light on the brazier nearest the BOSS (Grace.update
  // would pick the player's), so the rider's near side takes the torch against the cool moon rim
  if (b.dressing && game.atmosphere && game.atmosphere.setWarmLight) {
    const f = b.dressing.nearestFire(bx, bz);
    if (f) game.atmosphere.setWarmLight(_v.set(f.x, f.y - 0.3, f.z), 34, PALETTE.torch);
  }
  // lock-on style framing: slide the pivot to the camera's right so the player sits left of centre and the
  // boss fills the middle; the next snap() (any pose / teleport) restores the default shoulder.
  const cam = game.cameraCtl, shoulder0 = cam.shoulder, snap0 = cam.snap;
  cam.shoulder = O.shoulder;
  cam.snap = function () { cam.shoulder = shoulder0; cam.snap = snap0; return snap0.call(cam); };
  snap0.call(cam);
  // freezeAll settled the clip 40 steps ahead; snap the animator back onto the wind-up moment
  b.anim.t = def.windup * k - 1 / 60; b.anim.settle(1);
  b.updateFx(0);
  // life in the frozen frame: pre-aged dust under the pawing near foreleg, ember columns over the two nearest braziers
  const c = game.combat, by = game.terrain.getHeight(bx, bz);
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), lx = Math.cos(b.yaw), lz = -Math.sin(b.yaw);
  if (c.dustFx) {
    const t0 = c.dustFx.time, hx = bx + fx * 1.3 + lx * 0.5, hz = bz + fz * 1.3 + lz * 0.5;
    for (let i = 0; i < 10; i++) { c.dustFx.time = t0 - Math.random() * 0.7; c.dust(hx, by, hz, 2, lx * 0.6, lz * 0.6, 1.4, 0.45); }
    c.dustFx.time = t0;
  }
  if (c.emberBurst && b.dressing) {
    const fires = b.dressing.fires.slice().sort((p, q) => ((p.x - bx) ** 2 + (p.z - bz) ** 2) - ((q.x - bx) ** 2 + (q.z - bz) ** 2));
    for (const f of fires.slice(0, 2)) c.emberBurst(f, 28, 2.0);
  }
  c.updateFx(0);
}
