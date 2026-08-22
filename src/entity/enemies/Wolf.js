/**
 * Wolf: low-poly quadruped (skinned rig built with RigBuilder) that circles and lunges. Spawned in packs of 3.
 * Silhouette: high hunched shoulders, spine ridge of fur spikes, heavy mane, low wedge head with an open jaw,
 * thin lower legs and big paws, bushy tail. Emissive eyes.
 */
import * as THREE from 'three';
import { Enemy } from '../Enemy.js';
import { RigBuilder, Animator } from '../Humanoid.js';
import { PALETTE, charMats } from '../../render/Style.js';
import { enemyRimHook } from './EnemyRig.js';

const TAU = Math.PI * 2;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const PH = { p: 0, k: 0 };
function phase(t, ctx) {
  if (t < ctx.windup) { PH.p = 0; PH.k = t / ctx.windup; return PH; }
  t -= ctx.windup; if (t < ctx.active) { PH.p = 1; PH.k = t / ctx.active; return PH; }
  t -= ctx.active; if (t < ctx.recover) { PH.p = 2; PH.k = t / ctx.recover; return PH; }
  PH.p = 3; PH.k = 1; return PH;
}
const LEGS = ['legFL', 'legFR', 'legBL', 'legBR'];

const WOLF_CLIPS = {
  idle(t, P) {
    const b = Math.sin(t * 1.8);
    P.extra(0, 0.008 * b);
    P.set('tail', -0.3, 0.35 * Math.sin(t * 3), 0); P.set('tail2', 0, 0.3 * Math.sin(t * 3 + 1), 0);
    P.set('neck', -0.05 + 0.02 * b, 0, 0); P.set('head', 0.05, 0.1 * Math.sin(t * 0.7), 0);
  },
  run(t, P, ctx) {
    const sp = clamp01(ctx.speed);
    const ph = t * TAU * (1.6 + sp * 1.0), amp = 0.45 + sp * 0.4;
    const s = Math.sin(ph);
    P.set('legFL', amp * s, 0, 0); P.set('legFR', amp * Math.sin(ph + 0.5), 0, 0);
    P.set('legBL', amp * Math.sin(ph + Math.PI + 0.2), 0, 0); P.set('legBR', amp * Math.sin(ph + Math.PI + 0.7), 0, 0);
    P.set('legFL2', 0.5 * Math.max(0, -Math.cos(ph)), 0, 0); P.set('legFR2', 0.5 * Math.max(0, -Math.cos(ph + 0.5)), 0, 0);
    P.set('legBL2', 0.6 * Math.max(0, -Math.cos(ph + Math.PI + 0.2)), 0, 0); P.set('legBR2', 0.6 * Math.max(0, -Math.cos(ph + Math.PI + 0.7)), 0, 0);
    P.extra(0, 0.05 * Math.sin(2 * ph) * (0.5 + sp)); P.extra(1, 0.08 * s * sp);
    P.set('neck', -0.1 - 0.05 * s, 0, 0); P.set('head', 0.1 + 0.05 * s, 0, 0);
    P.set('tail', 0.3, 0.15 * Math.sin(ph), 0); P.set('tail2', 0.2, 0.1 * Math.sin(ph + 1), 0);
  },
  lunge(t, P, ctx) {
    const f = phase(t, ctx);
    if (f.p === 0) {
      const k = sm(f.k);
      P.extra(0, -0.24 * k); P.extra(1, 0.14 * k);
      for (const l of LEGS) { P.set(l, (l[3] === 'F' ? -0.35 : 0.55) * k, 0, 0); P.set(l + '2', 0.65 * k, 0, 0); }
      P.set('neck', 0.35 * k, 0, 0); P.set('head', 0.05 * k, 0, 0); P.set('tail', 0.7 * k, 0, 0);
    } else if (f.p === 1) {
      const k = f.k, arc = Math.sin(k * Math.PI);
      P.extra(0, 0.3 * arc); P.extra(1, -0.3 + 0.5 * k);
      P.set('legFL', -1.2, 0, 0.1); P.set('legFR', -1.2, 0, -0.1); P.set('legBL', 1.0, 0, 0.1); P.set('legBR', 1.0, 0, -0.1);
      P.set('legFL2', 0.2, 0, 0); P.set('legFR2', 0.2, 0, 0); P.set('legBL2', 0.3, 0, 0); P.set('legBR2', 0.3, 0, 0);
      P.set('neck', -0.4, 0, 0); P.set('head', 0.3, 0, 0); P.set('tail', 0.5, 0, 0);
    } else {
      const k = 1 - sm(f.k);
      P.extra(0, -0.12 * k);
      for (const l of LEGS) { P.set(l, 0.2 * k, 0, 0); P.set(l + '2', 0.5 * k, 0, 0); }
      P.set('neck', 0.15 * k, 0, 0); P.set('tail', 0.2 * k, 0, 0);
    }
  },
  alert(t, P) {
    const b = Math.sin(t * 2.4);
    P.extra(0, -0.06); P.set('neck', -0.15, 0.1 * b, 0); P.set('head', 0.05, 0.15 * b, 0);
    P.set('tail', 0.5, 0.2 * Math.sin(t * 4), 0);
    for (const l of LEGS) P.set(l + '2', 0.25, 0, 0);
  },
  hit(t, P, ctx) {
    const k = 1 - sm(t / (ctx.dur || 0.32));
    P.extra(1, -0.2 * k); P.extra(0, -0.08 * k); P.set('neck', -0.4 * k, 0.2 * k, 0); P.set('head', -0.2 * k, 0, 0);
  },
  stagger(t, P, ctx) {
    const k = 1 - sm(t / (ctx.dur || 0.9));
    P.extra(2, 0.35 * k * Math.sin(t * 6)); P.extra(0, -0.15 * k); P.set('neck', -0.3 * k, 0, 0.2 * k);
    for (const l of LEGS) P.set(l + '2', 0.5 * k, 0, 0);
  },
  death(t, P) {
    const k = sm(t / 0.8), kk = k * k;
    P.extra(2, 1.5 * kk); P.extra(0, -0.42 * kk);
    P.set('legFL', -0.4 * k, 0, 0.3 * k); P.set('legFR', -0.2 * k, 0, -0.2 * k); P.set('legBL', 0.3 * k, 0, 0.3 * k); P.set('legBR', 0.5 * k, 0, -0.2 * k);
    P.set('neck', 0.3 * k, 0.4 * k, 0); P.set('head', 0.2 * k, 0, 0); P.set('tail', 0.1, 0.3 * k, 0);
  },
};
WOLF_CLIPS.guard = WOLF_CLIPS.alert;
WOLF_CLIPS.light1 = WOLF_CLIPS.lunge; WOLF_CLIPS.light2 = WOLF_CLIPS.lunge; WOLF_CLIPS.heavy = WOLF_CLIPS.lunge;

function createWolfRig() {
  const rb = new RigBuilder();
  const BY = 0.66;
  const body = rb.bone('body', null, 0, BY, 0);
  const neck = rb.bone('neck', body, 0, 0.12, 0.42);
  rb.bone('head', neck, 0, 0.04, 0.22);
  const tail = rb.bone('tail', body, 0, 0.04, -0.46);
  rb.bone('tail2', tail, 0, 0, -0.26);
  for (const [n, x, z] of [['legFL', 0.16, 0.3], ['legFR', -0.16, 0.3], ['legBL', 0.15, -0.3], ['legBR', -0.15, -0.3]]) {
    const up = rb.bone(n, body, x, -0.06, z);
    rb.bone(n + '2', up, 0, -0.3, 0);
  }
  const p = (n) => rb.pos(n);
  const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
  const F = PALETTE.wolfFur, FD = PALETTE.wolfFurDark;
  const part = (g, bone, color, shade = 1, mat = 0) => rb.part(g, bone, color, mat, shade);

  // body: tilted torso (front high), shoulder hump, haunches, pale chest
  const torso = new THREE.CylinderGeometry(0.22, 0.15, 0.96, 6); torso.rotateX(Math.PI / 2); torso.rotateX(-0.14);
  part(at(torso, 0, BY, 0), 'body', F, 1.25);
  const hump = new THREE.SphereGeometry(0.27, 7, 5); hump.scale(1, 0.85, 1.15);
  part(at(hump, 0, BY + 0.16, 0.2), 'body', F, 1.2);
  for (const s of [1, -1]) part(at(new THREE.SphereGeometry(0.17, 6, 4), s * 0.1, BY - 0.02, -0.32), 'body', F, 1.1);
  part(at(new THREE.SphereGeometry(0.17, 6, 5), 0, BY - 0.08, 0.34), 'body', F, 1.45);
  // spine ridge + mane
  for (let i = 0; i < 6; i++) {
    const z = 0.3 - i * 0.13, h = 0.2 - i * 0.018;
    const spike = new THREE.ConeGeometry(0.055, h, 4); spike.rotateX(-0.6);
    part(at(spike, (i % 2) * 0.03 - 0.015, BY + 0.36 - i * 0.045, z), 'body', FD, 0.9);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU, r = 0.2;
    const tuft = new THREE.ConeGeometry(0.065, 0.24, 4); tuft.rotateX(-Math.PI / 2 - 0.5); tuft.rotateZ(a);
    part(at(tuft, Math.sin(a) * r, BY + 0.16 + Math.cos(a) * r * 0.8, 0.34), 'body', FD, 0.85 + 0.25 * Math.max(0, Math.cos(a)));
  }
  // neck + head (wedge skull, brow, snout, open jaw, ears, eyes)
  const n = p('neck'), h = p('head');
  part(at(new THREE.BoxGeometry(0.2, 0.22, 0.34), 0, n.y + 0.02, n.z + 0.1), 'neck', F, 1.1);
  part(at(new THREE.BoxGeometry(0.22, 0.2, 0.26), 0, h.y, h.z + 0.05), 'head', F, 1.2);
  part(at(new THREE.BoxGeometry(0.25, 0.06, 0.12), 0, h.y + 0.1, h.z + 0.1), 'head', FD, 0.9);
  part(at(new THREE.BoxGeometry(0.13, 0.11, 0.24), 0, h.y - 0.02, h.z + 0.28), 'head', F, 0.85);
  part(at(new THREE.BoxGeometry(0.06, 0.04, 0.05), 0, h.y + 0.02, h.z + 0.4), 'head', FD, 0.5);
  const jaw = new THREE.BoxGeometry(0.11, 0.05, 0.24); jaw.translate(0, 0, 0.12); jaw.rotateX(0.32);
  part(at(jaw, 0, h.y - 0.09, h.z + 0.14), 'head', FD, 0.8);
  for (let i = 0; i < 3; i++) part(at(new THREE.ConeGeometry(0.012, 0.04, 3), (i - 1) * 0.04, h.y - 0.07, h.z + 0.36), 'head', PALETTE.skin, 1.1);
  for (const s of [1, -1]) {
    const ear = new THREE.ConeGeometry(0.045, 0.16, 4); ear.rotateX(-0.4); ear.rotateZ(-s * 0.25);
    part(at(ear, s * 0.09, h.y + 0.17, h.z - 0.02), 'head', FD);
    part(at(new THREE.BoxGeometry(0.035, 0.022, 0.02), s * 0.075, h.y + 0.04, h.z + 0.18), 'head', PALETTE.wolfEye, 2.6);
  }
  // tail: bushy
  const t1 = new THREE.CylinderGeometry(0.05, 0.075, 0.28, 4); t1.rotateX(-Math.PI / 2);
  part(at(t1, 0, p('tail').y, p('tail').z - 0.14), 'tail', FD);
  const t2 = new THREE.CylinderGeometry(0.02, 0.065, 0.3, 4); t2.rotateX(-Math.PI / 2);
  part(at(t2, 0, p('tail2').y, p('tail2').z - 0.15), 'tail2', FD, 0.9);
  // legs: thick upper with a tuft, thin lower, big paw
  for (const nm of LEGS) {
    const u = p(nm), l = p(nm + '2'), front = nm[3] === 'F';
    part(at(new THREE.CylinderGeometry(front ? 0.075 : 0.085, 0.05, 0.32, 5), u.x, u.y - 0.15, u.z), nm, F, 1.1);
    const tuft = new THREE.ConeGeometry(0.05, 0.16, 4); tuft.rotateX(Math.PI * 0.75);
    part(at(tuft, u.x, u.y - 0.2, u.z - 0.06), nm, FD, 0.85);
    part(at(new THREE.CylinderGeometry(0.04, 0.032, 0.3, 5), l.x, l.y - 0.15, l.z), nm + '2', FD);
    part(at(new THREE.BoxGeometry(0.1, 0.06, 0.15), l.x, l.y - 0.3, l.z + 0.04), nm + '2', FD, 0.75);
  }
  const materials = charMats();
  for (const m of materials) m.onBeforeCompile = enemyRimHook; // cool rim so the dark fur separates from dark ground
  const rig = rb.build(materials);
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = BY; rig.mesh.position.y = -BY; pivot.add(rig.mesh); root.add(pivot);
  const animator = new Animator(rig, WOLF_CLIPS, pivot);
  return { root, mesh: rig.mesh, bones: rig.bones, animator, materials, update(dt) { animator.update(dt); } };
}

export class Wolf extends Enemy {
  constructor(game, o) {
    super(game, {
      name: 'Wolf', x: o.x, z: o.z, home: o.home, patrolR: o.patrolR ?? 12, seed: o.seed,
      hp: 62, poise: 18, radius: 0.5, height: 1.0, runes: 45, aggro: 30, leash: 70,
      walk: 2.8, run: 8.6, weapon: 'claws', pack: o.pack, glowScale: 0.25, blobW: 0.8, blobD: 1.5,
    });
    this.attackRange = 5.2;
    this.rig = createWolfRig();
    this.object3d.add(this.rig.root);
    this.materials = this.rig.materials;
    this.anim = this.rig.animator;
    this.glowColor.setHex(0xff4020);
  }

  pickAttack() {
    this.comboNext = false;
    return this.rng.chance(0.3) ? this.moveset.heavy : this.moveset.light[0];
  }
}
