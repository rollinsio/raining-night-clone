/**
 * Deterministic "combat" screenshot composition (GAUNTLET combat piece), driven by Debug.screenshotPose.
 * Player mid greatsword cut with the swing so far baked into one trail crescent; the struck Soldier is planted
 * *on the blade* (contact point found from the hero's blade bones after the swing is snapped, so the sparks, the
 * held hit-stop recoil and the skid dust line up; the burst is the frame's key light + a warm rim on the body);
 * a Knight winding up a heavy as a backlit silhouette between the hero and the camp fire; a Wolf crouched to lunge.
 * POSE.side picks the layout: +1 (default) camera over the hero's left shoulder, light2 cut left → right so the
 * struck soldier lands on the open dark ground right of centre, fire + knight left; -1 is the mirrored original.
 */
import * as THREE from 'three';
import { Soldier } from '../entity/enemies/Soldier.js';
import { Knight } from '../entity/enemies/Knight.js';
import { Wolf } from '../entity/enemies/Wolf.js';
import { boneToWorld } from './Trail.js';
import { bladePoints } from './Weapons.js';
import { HIT_RIM } from '../entity/enemies/EnemyRig.js';

const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _base = new THREE.Vector3(), _tip = new THREE.Vector3(), _hit = new THREE.Vector3();
const _span = { base: new THREE.Vector3(), tip: new THREE.Vector3() };
/**
 * Tunable composition (exported so tools can probe framing without re-editing). Lateral values are given for
 * side = +1 and mirrored automatically: camera yaw offset / shoulder, where the player faces relative to the fire,
 * enemy offsets (forward, right), the swing fraction and the pose-only FX strengths.
 */
export const POSE = {
  side: 1,
  standR: 8.5, faceRight: 3.0, pitch: 0.22, dist: 5.5, yawOffset: 0.45, swingK: 0.78, contactK: 0.68, shoulder: 1.0,
  knight: [5.8, -0.6], wolf: [2.6, -3.6], camLock: null,
  trailLife: 0.11,   // pose-only ribbon life so the swing so far reads as one fading crescent (gameplay keeps Trail's default)
  trailSpan: 0.08,   // seconds of swing baked into the ribbon
  swingRoll: 0.42,   // chest roll baked through the swing: the flat light sweep becomes a high → low diagonal cut
  recoilPush: 0.5,   // struck soldier root distance past the contact along the blow (its chest bends back onto the blade)
  impactLight: 3.4,  // pose impact light (cd) — gameplay pulses are weaker and decay in a frame
  rim: 0.8,          // HIT_RIM strength for the frame
};

/** Snap an animator exactly onto clip time t (large-dt update collapses the easing). */
function snapAnim(anim, t) { anim.t = t - 10; anim.update(10); }

/** Place an enemy: position, facing, aggro, and world rotation applied immediately. */
function plant(game, e, x, z, faceX, faceZ) {
  game.addEntity(e);
  moveTo(e, x, z, faceX, faceZ);
  e.setAggro(); e.setState('chase');
  return e;
}
function moveTo(e, x, z, faceX, faceZ) {
  e.teleport(x, z);
  e.yaw = Math.atan2(faceX - x, faceZ - z);
  e.object3d.rotation.y = e.yaw;
  e.groundShadow();
}

/**
 * @param game
 * @param helpers {place(x,z,tx,tz,opts), finish()} from Debug.js
 */
export function composeCombatPose(game, { place, finish }) {
  const S = POSE.side < 0 ? -1 : 1;
  const c = game.limveld.poi('camp', 0);
  // tents sit at a0 + {0, 2.1, 4.2}; the first camp spawn is at a0 + 0.6 — stand in the gap at a0 + 5.25
  const sp = game.limveld.enemySpawns.find((s) => s.home && s.home.x === c.x && s.home.z === c.z);
  const a0 = sp ? Math.atan2(sp.z - c.z, sp.x - c.x) - 0.6 : 0;
  const th = a0 + 5.25, r = POSE.standR;
  const px = c.x + Math.cos(th) * r, pz = c.z + Math.sin(th) * r;
  // face a point beside the fire so the fire sits ahead-left of the hero (ahead-right when mirrored)
  const ux = (c.x - px) / r, uz = (c.z - pz) / r, rgx = -uz, rgz = ux;
  const tx = c.x + rgx * POSE.faceRight * S, tz = c.z + rgz * POSE.faceRight * S;
  // the camera's shoulder offset is the only lateral framing control of the orbit camera: slide the pivot so the
  // hero sits off centre on the fire's side (restored by the first live Combat.update after resume)
  const cam = game.cameraCtl, shoulder0 = cam.shoulder;
  cam.shoulder = POSE.shoulder * S;
  const combat0 = game.combat, life0 = combat0.trails.map((t) => t.material.uniforms.uLife.value);
  game.combat.afterPose = () => { cam.shoulder = shoulder0; combat0.trails.forEach((t, i) => { t.material.uniforms.uLife.value = life0[i]; }); };
  const clip = S > 0 ? 'light2' : 'light1';
  place(px, pz, tx, tz, { pitch: POSE.pitch, dist: POSE.dist, yawOffset: POSE.yawOffset * S, clip });

  const p = game.player;
  p.object3d.rotation.y = p.yaw;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), rx = -fz, rz = fx; // forward / right (forward x up) in world
  const at = (f, s) => [px + fx * f + rx * s * S, pz + fz * f + rz * s * S];
  // camp extras would stand stiffly in frame: move them well behind the camera
  for (const e of game.entities) if (e !== p && e.distanceTo(p) < 16) { e.teleport(px - fx * 34, pz - fz * 34); e.object3d.rotation.y = e.yaw; }

  const [s1x, s1z] = at(2.0, 0.5); // provisional; re-planted on the blade below
  const soldier = plant(game, new Soldier(game, { x: s1x, z: s1z, home: { x: c.x, z: c.z }, patrolR: 6, tier: 1, seed: 11 }), s1x, s1z, px, pz);
  const [knx, knz] = at(POSE.knight[0], POSE.knight[1]);
  const knight = plant(game, new Knight(game, { x: knx, z: knz, home: { x: c.x, z: c.z }, patrolR: 6, seed: 23 }), knx, knz, px, pz);
  const [wx, wz] = at(POSE.wolf[0], POSE.wolf[1]);
  const wolf = plant(game, new Wolf(game, { x: wx, z: wz, home: { x: c.x, z: c.z }, patrolR: 8, seed: 37, pack: { alert: true } }), wx, wz, px, pz);

  p.lockTarget = soldier; game.cameraCtl.lockTarget = { soldier, knight, wolf }[POSE.camLock] || null;
  if (game.graces && game.graces.update) game.graces.update(0); // warm light onto the camp fire
  finish();

  // --- player: mid active frames of the cut, the swing so far baked into the trail as one crescent
  const def = p.moveset.light[S > 0 ? 1 : 0];
  p.attack.def = def; p.attack.phase = 'active'; p.attack.t = def.windup + def.active * POSE.swingK;
  const ctx = p.anim.ctx; ctx.windup = def.windup; ctx.active = def.active; ctx.recover = def.recover;
  p.anim.play(clip, { restart: true });
  const combat = game.combat, now = game.time;
  const trail = combat.acquireTrail(p);
  if (trail) trail.material.uniforms.uLife.value = POSE.trailLife;
  const T = p.attack.t, t0 = Math.max(def.windup - 0.015, T - POSE.trailSpan), N = trail ? trail.n - 1 : 20;
  const roll = () => { if (p.rig && p.rig.bones && p.rig.bones.chest) p.rig.bones.chest.rotation.z += POSE.swingRoll * S; };
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    snapAnim(p.anim, t0 + (T - t0) * k); roll();
    p.object3d.updateMatrixWorld(true);
    if (trail) combat.sampleTrail(p, now - (T - t0) * (1 - k));
  }
  snapAnim(p.anim, T); roll(); p.object3d.updateMatrixWorld(true);
  combat.dustFx.time = now - 0.2;
  combat.stepDust(p, 1.4);
  combat.dustFx.time = now;

  // --- contact: the outer third of the blade, in world space, after the swing is snapped
  const span = p.rig && p.rig.handRLocal && p.rig.bones && p.rig.bones.wristR ? bladePoints(p.weapon.visual, p.rig.handRLocal, _span) : null;
  if (span) {
    boneToWorld(p.rig.mesh, p.rig.bones.wristR, span.base, _base);
    boneToWorld(p.rig.mesh, p.rig.bones.wristR, span.tip, _tip);
    _hit.lerpVectors(_base, _tip, POSE.contactK);
  } else _hit.set(px + fx * 1.9 + rx * 0.4 * S, p.pos.y + 1.05, pz + fz * 1.9 + rz * 0.4 * S);
  _dir.set(_hit.x - px, 0, _hit.z - pz).normalize();
  // a blade below the knee or above the head would be a miss: fall back to a chest-height contact ahead
  const groundY = game.terrain.getHeight(_hit.x, _hit.z);
  if (_hit.y - groundY < 0.55 || _hit.y - groundY > 1.75 || _hit.distanceTo(p.pos) < 1.2) {
    _hit.set(px + fx * 1.9 + rx * 0.45 * S, 0, pz + fz * 1.9 + rz * 0.45 * S); _hit.y = game.terrain.getHeight(_hit.x, _hit.z) + 1.1;
    _dir.set(_hit.x - px, 0, _hit.z - pz).normalize();
  }

  // --- soldier: chest on the blade in a held hit-stop recoil (torso bent away, near arm flung, rear foot skidding)
  moveTo(soldier, _hit.x + _dir.x * POSE.recoilPush, _hit.z + _dir.z * POSE.recoilPush, px, pz);
  soldier.setState('hit'); soldier.anim.ctx.dur = 0.45; soldier.anim.ctx.param = -S; soldier.anim.play('recoil', { restart: true });
  snapAnim(soldier.anim, 0.03);
  soldier.object3d.updateMatrixWorld(true);
  soldier.flash = 0.45; soldier.flashColor.setHex(0xc89a70).multiplyScalar(0.32); soldier.updateCommon(0); soldier.updateBlade(0); // warm struck tint (see Enemy.takeHit)
  combat.sparks.time = now - 0.06;
  combat.impact(_hit, _dir, 'metal', 1.0);
  combat.sparks.time = now;
  // the burst is the key light of the frame: a hotter pulse just off the contact, warm rim from the contact itself
  combat.flashLight(_v.set(_hit.x - _dir.x * 0.55, _hit.y + 0.45, _hit.z - _dir.z * 0.55), 0xffb070, POSE.impactLight);
  combat.rimPeak = POSE.rim; HIT_RIM.value.set(_hit.x, _hit.y, _hit.z, POSE.rim);
  // dust: knock-back puff under the body, a long skid smear dragged from the rear foot
  combat.dustFx.time = now - 0.12;
  combat.hurtDust(soldier, { dir: _dir }, 1.0);
  _v.setFromMatrixPosition(soldier.rig.bones[S > 0 ? 'ankleL' : 'ankleR'].matrixWorld);
  combat.skidDust(_v.x, game.terrain.getHeight(_v.x, _v.z), _v.z, _dir, 1.0);
  combat.dustFx.time = now;

  // --- knight: heavy windup nearly released, blade heated
  const kdef = knight.moveset.heavy;
  knight.startAttack(kdef);
  knight.attack.t = kdef.windup * 0.86;
  snapAnim(knight.anim, knight.attack.t);
  knight.telegraph = 0.9; knight.glow = 0.06; knight._glowDirty = true; knight.updateCommon(0); knight.updateBlade(0);

  // --- wolf: crouched at the end of its lunge windup
  const wdef = wolf.moveset.light[0];
  wolf.startAttack(wdef);
  wolf.attack.t = wdef.windup * 0.92;
  snapAnim(wolf.anim, wolf.attack.t);
  wolf.telegraph = 0.9; wolf.glow = 0; wolf._glowDirty = true; wolf.updateCommon(0);

  // --- embers rising from the camp fire
  const fire = game.limveld.nearestFire(_v.set(c.x, c.y, c.z), 6);
  if (fire) combat.emberBurst(fire, 36, 2.4);

  for (const e of [soldier, knight, wolf]) { e.frozen = true; e.object3d.updateMatrixWorld(true); }
  game.cameraCtl.snap();
  combat.updateFx(0);
  game.render(); // warm up the new shader programs synchronously so the first capture is not black
  return { soldier, knight, wolf, hit: _hit.clone(), fire: fire || null };
}
