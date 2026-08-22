/**
 * Horned Demon: a hulking, hunched, knuckle-dragging brute ~5 m tall (modelled at full size) built on the
 * shared RigBuilder / Animator. Silhouette: massive hump-backed torso with a pale segmented belly, spiked mane,
 * long arms ending in clawed fists, short thick legs, a low faceless skull with two great ram horns, a loincloth
 * with hanging skulls, iron manacles, a spiked tail. Ember cracks (material slot 2) heat up during wind-ups.
 * Attacks: overhead double-fist slam (heavy, ground ring telegraph), right swipe / left backhand (lights).
 */
import * as THREE from 'three';
import { RigBuilder, Animator } from '../Humanoid.js';
import { PALETTE } from '../../render/Style.js';
import { Boss } from './Boss.js';
import { TAU, clamp01, sm, lerp, at, scaled, cyl, sph, box, cone, phase, rough, hornGeo, tuftRing, bossMats, contactShadow } from './BossRig.js';

const E_HIPSY = 0, E_PITCH = 1, E_ROLL = 2;
const HY = 2.55; // hip height (pivot)

/** Colours (no demon entries in PALETTE yet; metals / bone derive from it). */
const C = {
  hide: 0x3a363f, hideDark: 0x2a272e, hideLight: 0x6d6862, belly: 0x7a746a, mane: 0x1c1a1f,
  horn: 0xb9ae98, hornDark: 0x8a8070, bone: 0xcfc5ad, ember: PALETTE.ember, emberDim: 0x3a1a12,
  cloth: 0x4b2626, clothDark: 0x2e1717, iron: PALETTE.iron, ironLight: PALETTE.steelDark,
};

// ------------------------------------------------------------------------------------------------- clips

/** Hunched brute posture every clip builds on (k scales the hunch). */
function base(P, k = 1) {
  P.set('spine', 0.3 * k, 0, 0); P.set('chest', 0.3 * k, 0, 0); P.set('neck', -0.32 * k, 0, 0); P.set('head', -0.12 * k, 0, 0);
  P.set('shoulderL', -0.3, 0.05, 0.24); P.set('shoulderR', -0.3, -0.05, -0.24);
  P.set('elbowL', -0.35, 0, 0); P.set('elbowR', -0.35, 0, 0); P.set('handL', -0.25, 0, 0); P.set('handR', -0.25, 0, 0);
  P.set('hipL', -0.28, 0.1, 0.12); P.set('hipR', -0.28, -0.1, -0.12);
  P.set('kneeL', 0.62, 0, 0); P.set('kneeR', 0.62, 0, 0); P.set('ankleL', -0.32, 0, 0); P.set('ankleR', -0.32, 0, 0);
  P.set('tail', 0.25, 0, 0); P.set('tail2', 0.15, 0, 0); P.set('tail3', 0.1, 0, 0);
  P.extra(E_HIPSY, -0.14);
}

const DEMON_CLIPS = {
  idle(t, P) {
    base(P);
    const b = Math.sin(t * 1.3), b2 = Math.sin(t * 0.7 + 1);
    P.add('chest', 0.035 * b, 0, 0); P.add('spine', 0.02 * b, 0, 0); P.add('head', -0.03 * b, 0.12 * b2, 0);
    P.add('shoulderL', 0.03 * b, 0, 0.03 * b); P.add('shoulderR', 0.03 * b, 0, -0.03 * b);
    P.add('tail', 0, 0.3 * Math.sin(t * 1.1), 0); P.add('tail2', 0, 0.25 * Math.sin(t * 1.1 + 1), 0); P.add('tail3', 0, 0.25 * Math.sin(t * 1.1 + 2), 0);
    P.extra(E_HIPSY, -0.14 + 0.02 * b);
  },
  /** Lumbering stomp (ctx.speed 0..1): heavy bob, shoulders rolling, arms swinging, tail lashing. */
  run(t, P, ctx) {
    base(P, 1.1);
    const sp = clamp01(ctx.speed), ph = t * TAU * (1.05 + 0.45 * sp), s = Math.sin(ph), c = Math.cos(ph);
    const leg = 0.55 + 0.25 * sp;
    P.add('hipL', -leg * s, 0, 0); P.add('hipR', leg * s, 0, 0);
    P.add('kneeL', 0.7 * Math.max(0, -c), 0, 0); P.add('kneeR', 0.7 * Math.max(0, c), 0, 0);
    P.add('ankleL', 0.3 * Math.max(0, -s), 0, 0); P.add('ankleR', 0.3 * Math.max(0, s), 0, 0);
    P.add('shoulderL', 0.55 * s - 0.2, 0, 0); P.add('shoulderR', -0.55 * s - 0.2, 0, 0);
    P.add('elbowL', -0.3 - 0.25 * Math.max(0, s), 0, 0); P.add('elbowR', -0.3 - 0.25 * Math.max(0, -s), 0, 0);
    P.add('hips', 0, 0.1 * s, 0.06 * s); P.add('chest', 0.1, -0.12 * s, 0); P.add('head', 0, 0.08 * s, 0);
    P.add('tail', 0, 0.35 * s, 0); P.add('tail2', 0, 0.3 * Math.sin(ph - 0.8), 0); P.add('tail3', 0, 0.3 * Math.sin(ph - 1.6), 0);
    P.extra(E_HIPSY, -0.2 + 0.1 * Math.abs(c)); P.extra(E_PITCH, 0.08 + 0.06 * sp); P.extra(E_ROLL, 0.05 * s);
  },
  /** Intro roar: rears back, arms spread wide, head up, then settles into the stance. */
  roar(t, P) {
    const k = sm(t / 0.45) * (1 - sm((t - 1.6) / 0.5)), tr = Math.sin(t * 28) * 0.02 * k;
    base(P, 1 - 0.9 * k);
    P.add('spine', -0.25 * k, 0, 0); P.add('chest', -0.2 * k, tr, 0); P.add('neck', 0.35 * k, 0, 0); P.add('head', 0.25 * k, 0, tr);
    P.add('shoulderL', 0.55 * k, 0, 1.25 * k); P.add('shoulderR', 0.55 * k, 0, -1.25 * k);
    P.add('elbowL', -0.5 * k, 0, 0); P.add('elbowR', -0.5 * k, 0, 0); P.add('handL', 0.4 * k, 0, 0); P.add('handR', 0.4 * k, 0, 0);
    P.add('kneeL', -0.2 * k, 0, 0); P.add('kneeR', -0.2 * k, 0, 0); P.add('hipL', 0.1 * k, 0, 0.1 * k); P.add('hipR', 0.1 * k, 0, -0.1 * k);
    P.add('tail', 0.5 * k, 0, 0); P.add('tail2', 0.3 * k, 0, 0);
    P.extra(E_HIPSY, -0.14 + 0.18 * k);
  },
  alert(t, P) {
    base(P);
    const b = Math.sin(t * 2.2);
    P.add('chest', 0, 0.08 * b, 0); P.add('head', 0.05, 0.2 * b, 0);
    P.add('shoulderL', -0.2, 0, 0.25); P.add('shoulderR', -0.2, 0, -0.25); P.add('elbowL', -0.25, 0, 0); P.add('elbowR', -0.25, 0, 0);
    P.add('tail', 0.2, 0.3 * Math.sin(t * 3), 0); P.add('tail2', 0, 0.3 * Math.sin(t * 3 + 1), 0);
    P.extra(E_HIPSY, -0.22);
  },
  /** Overhead double-fist slam. Windup rears up tall with both fists behind the head; active crashes into a crouch. */
  heavy(t, P, ctx) {
    const f = phase(t, ctx); let up, down, rec;
    if (f.p === 0) { up = sm(f.k); down = 0; rec = 0; }
    else if (f.p === 1) { up = 1 - f.k * f.k; down = Math.pow(f.k, 0.6); rec = 0; }
    else { up = 0; down = 1 - sm(f.k); rec = sm(f.k); }
    base(P, 1 - 0.8 * up + 0.2 * down);
    // arms: overhead behind the head, then crashing forward-down
    const shx = lerp(-0.3, -2.95, up) + lerp(0, 1.25, down) * (1 - up) + 0.3 * down * up;
    P.set('shoulderL', shx, 0.1 * down, 0.42 * up + 0.3 * down + 0.2); P.set('shoulderR', shx, -0.1 * down, -0.42 * up - 0.3 * down - 0.2);
    P.set('elbowL', lerp(-0.35, -0.75, up) + 0.25 * down, 0, 0); P.set('elbowR', lerp(-0.35, -0.75, up) + 0.25 * down, 0, 0);
    P.set('handL', lerp(-0.25, 0.35, up) - 0.45 * down, 0, 0); P.set('handR', lerp(-0.25, 0.35, up) - 0.45 * down, 0, 0);
    // torso: rear back, then hurl forward into the crouch
    P.add('spine', -0.42 * up + 0.62 * down, 0, 0); P.add('chest', -0.3 * up + 0.45 * down, 0, 0);
    P.add('neck', 0.45 * up - 0.1 * down, 0, 0); P.add('head', 0.25 * up - 0.15 * down, 0, 0);
    // legs: rise tall on the windup, drop deep on impact
    P.add('hipL', 0.15 * up - 0.7 * down, 0, 0.08 * down); P.add('hipR', 0.15 * up - 0.7 * down, 0, -0.08 * down);
    P.add('kneeL', -0.3 * up + 0.8 * down, 0, 0); P.add('kneeR', -0.3 * up + 0.8 * down, 0, 0);
    P.add('ankleL', 0.1 * up + 0.1 * down, 0, 0); P.add('ankleR', 0.1 * up + 0.1 * down, 0, 0);
    P.add('tail', 0.5 * up - 0.3 * down, 0, 0); P.add('tail2', 0.3 * up, 0, 0);
    P.extra(E_HIPSY, -0.14 + 0.2 * up - 0.78 * down);
    P.extra(E_PITCH, -0.06 * up + 0.1 * down);
    void rec;
  },
  /** Right-arm swipe: arm cocked out and back, then a wide horizontal sweep across the front. */
  light1(t, P, ctx) { swipe(t, P, ctx, -1); },
  /** Left-arm backhand (mirror). */
  light2(t, P, ctx) { swipe(t, P, ctx, 1); },
  hit(t, P, ctx) {
    base(P);
    const k = 1 - sm(t / (ctx.dur || 0.32));
    P.add('spine', -0.12 * k, 0, 0); P.add('chest', -0.1 * k, 0.08 * k, 0); P.add('neck', -0.2 * k, 0, 0); P.add('head', -0.15 * k, 0, 0);
    P.add('shoulderL', -0.2 * k, 0, 0.15 * k); P.add('shoulderR', -0.2 * k, 0, -0.15 * k);
    P.extra(E_HIPSY, -0.14 - 0.05 * k);
  },
  stagger(t, P, ctx) {
    base(P, 0.6);
    const k = 1 - sm(t / (ctx.dur || 0.9)), w = Math.sin(t * 7) * 0.1 * k;
    P.add('spine', -0.4 * k, w, 0); P.add('chest', -0.3 * k, 0, w); P.add('neck', 0.2 * k, 0, 0); P.add('head', -0.2 * k, 0, -w);
    P.add('shoulderL', -0.6 * k, 0, 0.9 * k); P.add('shoulderR', -0.6 * k, 0, -0.9 * k); P.add('elbowL', -0.8 * k, 0, 0); P.add('elbowR', -0.8 * k, 0, 0);
    P.add('hipL', 0.3 * k, 0, 0.15 * k); P.add('hipR', -0.2 * k, 0, -0.15 * k); P.add('kneeL', 0.3 * k, 0, 0); P.add('kneeR', 0.5 * k, 0, 0);
    P.extra(E_HIPSY, -0.14 - 0.22 * k); P.extra(E_PITCH, -0.12 * k); P.extra(E_ROLL, w);
  },
  /** Topples forward onto the hump, arms splayed, legs collapsing. */
  death(t, P) {
    const k = sm(t / 1.1), kk = k * k;
    base(P, 1 - 0.6 * k);
    P.extra(E_PITCH, 1.35 * kk); P.extra(E_HIPSY, -0.14 - 1.55 * kk); P.extra(E_ROLL, 0.22 * kk);
    P.add('shoulderL', -1.3 * k, 0, 0.9 * k); P.add('shoulderR', -1.1 * k, 0, -1.1 * k); P.add('elbowL', -0.3 * k, 0, 0); P.add('elbowR', -0.5 * k, 0, 0);
    P.add('hipL', -0.4 * k, 0, 0.3 * k); P.add('hipR', -0.2 * k, 0, -0.25 * k); P.add('kneeL', 0.9 * k, 0, 0); P.add('kneeR', 0.6 * k, 0, 0);
    P.add('neck', 0.4 * k, 0.3 * k, 0); P.add('head', 0.3 * k, 0, 0.2 * k); P.add('tail', -0.3 * k, 0.4 * k, 0);
  },
};
DEMON_CLIPS.guard = DEMON_CLIPS.alert;

function swipe(t, P, ctx, s) {
  // s = -1 right arm (swing from the demon's right across to its left), +1 left arm
  const f = phase(t, ctx); let cock, sweep, rec;
  if (f.p === 0) { cock = sm(f.k); sweep = 0; rec = 0; }
  else if (f.p === 1) { cock = 1; sweep = Math.pow(f.k, 0.75); rec = 0; }
  else { cock = 1 - sm(f.k); sweep = 1 - sm(f.k); rec = sm(f.k); }
  base(P, 1 - 0.25 * cock);
  const arm = s < 0 ? 'R' : 'L', other = s < 0 ? 'L' : 'R';
  // cocked: arm horizontal out to its side and pulled back; sweep: yaw it across the front
  const ry = s * (1.15 - 2.6 * sweep) * cock, rz = -s * (1.35 * cock), rx = -0.3 - 0.25 * cock;
  P.set('shoulder' + arm, rx, ry, rz); P.set('elbow' + arm, -0.45 - 0.25 * cock, 0, 0); P.set('hand' + arm, -0.3, 0, s * 0.35 * cock);
  P.set('shoulder' + other, -0.45 - 0.3 * cock, 0, -s * 0.35); P.set('elbow' + other, -0.6, 0, 0);
  const tw = s * (0.45 - 0.95 * sweep) * cock; // torso winds up with the arm, then whips through
  P.add('spine', 0.05 * cock, tw * 0.6, -tw * 0.15); P.add('chest', 0.08 * cock, tw * 0.6, -tw * 0.1); P.add('neck', 0, -tw * 0.5, 0); P.add('head', 0, -tw * 0.4, 0);
  P.add('hipL', 0.1 * cock, 0, 0); P.add('hipR', 0.1 * cock, 0, 0); P.add('kneeL', 0.15 * cock, 0, 0); P.add('kneeR', 0.15 * cock, 0, 0);
  P.add('tail', 0.2 * cock, -tw * 0.8, 0); P.add('tail2', 0, -tw * 0.6, 0);
  P.extra(E_HIPSY, -0.14 - 0.12 * cock - 0.08 * sweep); P.extra(E_ROLL, tw * 0.08);
  void rec;
}

// ------------------------------------------------------------------------------------------------- rig

/** Build the demon rig. Returns { root, mesh, bones, animator, materials:[body, head], emberMat, shadow, update(dt) }. */
export function createDemonRig() {
  const rb = new RigBuilder();
  rb.parts.push([]); // material slot 2: ember cracks + eyes
  const hips = rb.bone('hips', null, 0, HY, 0);
  const spine = rb.bone('spine', hips, 0, 0.5, 0);
  const chest = rb.bone('chest', spine, 0, 0.7, 0);
  const neck = rb.bone('neck', chest, 0, 0.5, 0.2);
  rb.bone('head', neck, 0, 0.32, 0.22);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const sh = rb.bone('shoulder' + side, chest, s * 1.22, 0.42, 0.05);
    const el = rb.bone('elbow' + side, sh, 0, -1.5, 0);
    rb.bone('hand' + side, el, 0, -1.4, 0);
    const hp = rb.bone('hip' + side, hips, s * 0.48, -0.3, 0);
    const kn = rb.bone('knee' + side, hp, 0, -1.1, 0);
    rb.bone('ankle' + side, kn, 0, -1.02, 0);
  }
  const tail = rb.bone('tail', hips, 0, -0.15, -0.55);
  const tail2 = rb.bone('tail2', tail, 0, -0.1, -0.8);
  rb.bone('tail3', tail2, 0, -0.05, -0.7);
  const p = (n) => rb.pos(n);
  const part = (geo, bone, color, shade = 1, o = null, mat = 0) => rb.part(geo, bone, color, mat, shade, o);
  const ember = (geo, bone, shade = 1) => rb.part(geo, bone, C.emberDim, 2, shade);

  // ---- hips: pelvis, belt with an iron buckle, loincloth front/back, hanging skulls
  part(at(rough(scaled(sph(0.74, 8, 6), 1.18, 0.78, 0.98), 0.05, 2), 0, HY - 0.08, 0), 'hips', C.hide, 0.95, { shadeFn: (x, y) => lerp(0.78, 1.02, sm((y - HY + 0.7) / 0.9)) });
  part(at(cyl(0.92, 0.9, 0.18, 8, true), 0, HY + 0.06, 0), 'hips', C.cloth, 0.85);
  part(at(box(0.34, 0.24, 0.12), 0, HY + 0.06, 0.9), 'hips', C.iron, 1.1);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.5; part(at(box(0.12, 0.12, 0.1), Math.sin(a) * 0.92, HY + 0.06, Math.cos(a) * 0.92), 'hips', C.ironLight, 0.9); }
  {
    const front = box(0.9, 1.35, 0.06); front.rotateX(-0.12); part(at(front, 0, HY - 0.72, 0.72), 'hips', C.cloth, 0.9, { shadeFn: (x, y) => lerp(1.0, 0.62, sm((y - HY + 1.4) / 1.3)) });
    const back = box(1.0, 1.15, 0.06); back.rotateX(0.14); part(at(back, 0, HY - 0.62, -0.7), 'hips', C.clothDark, 0.9, { shadeFn: (x, y) => lerp(1.0, 0.7, sm((y - HY + 1.2) / 1.1)) });
    for (const s of [1, -1]) { // skull trophies on the belt
      part(at(scaled(sph(0.17, 8, 6), 1, 1.1, 1.05), s * 0.82, HY - 0.25, 0.42), 'hips', C.bone, 0.9, null, 1);
      part(at(box(0.12, 0.1, 0.14), s * 0.82, HY - 0.4, 0.5), 'hips', C.bone, 0.75);
      part(at(cyl(0.02, 0.02, 0.2, 4), s * 0.82, HY - 0.02, 0.42), 'hips', C.iron, 0.8);
    }
  }

  // ---- spine: belly with pale segmented plates
  const sy = p('spine').y;
  part(at(rough(scaled(cyl(0.95, 0.82, 0.95, 8), 1.18, 1, 0.92), 0.05, 3), 0, sy + 0.38, 0.04), 'spine', C.hide, 0.98,
    { blend: { bone: 'chest', y: p('chest').y, width: 0.3 }, shadeFn: (x, y, z) => lerp(0.8, 1.0, sm((y - sy) / 0.9)) * (z < -0.2 ? 0.85 : 1) });
  for (let i = 0; i < 3; i++) {
    const g = box(1.2 - i * 0.12, 0.24, 0.22); g.rotateX(-0.08);
    part(at(g, 0, sy + 0.12 + i * 0.3, 0.84 - i * 0.02), 'spine', C.belly, 0.92 + i * 0.04, { shadeFn: (x, y, z) => (z > 0.9 ? 1.08 : 0.85) });
  }

  // ---- chest: ribcage, hump, pectoral plates, spine ridge, mane, ember cracks
  const cy = p('chest').y;
  part(at(rough(scaled(cyl(1.22, 1.0, 1.3, 8), 1.38, 1, 0.98), 0.06, 4), 0, cy + 0.4, 0), 'chest', C.hide, 1.0,
    { shadeFn: (x, y, z) => lerp(0.86, 1.06, sm((y - cy) / 1.2)) * (z < -0.3 ? 0.88 : 1) });
  part(at(rough(scaled(sph(1.05, 9, 7), 1.32, 0.82, 1.05), 0.07, 5), 0, cy + 0.92, -0.4), 'chest', C.hide, 0.94, { shadeFn: (x, y) => lerp(0.82, 1.08, sm((y - cy - 0.3) / 1.3)) });
  for (const s of [1, -1]) part(at(rough(scaled(sph(0.55, 7, 5), 1.2, 0.78, 0.62), 0.04, 6 + s), s * 0.58, cy + 0.42, 0.82), 'chest', C.belly, 0.95, { shadeFn: (x, y) => lerp(0.8, 1.05, sm((y - cy) / 0.8)) });
  part(at(box(0.32, 0.2, 0.24), 0, cy + 0.85, 0.9), 'chest', C.hideLight, 0.9); // sternum knob
  for (let i = 0; i < 6; i++) { // spine ridge down the hump
    const g = cone(0.16 - i * 0.012, 0.55 - i * 0.05, 4); g.rotateX(-0.75 - i * 0.12);
    part(at(g, (i % 2) * 0.08 - 0.04, cy + 1.55 - i * 0.18, -0.55 - i * 0.3), 'chest', C.mane, 0.9);
  }
  part(tuftRing(0, cy + 1.18, 0.12, 0.98, 15, 0.95, 0.17, 0.95, 0.2), 'chest', C.mane, 0.95); // mane around the neck base
  part(tuftRing(0, cy + 1.3, 0.15, 0.72, 11, 0.7, 0.13, 1.1, 0.5), 'chest', C.mane, 0.8);
  for (const s of [1, -1]) { // ember cracks radiating from the sternum over the shoulders
    const g1 = box(0.06, 0.72, 0.08); g1.rotateZ(s * 0.9); ember(at(g1, s * 0.42, cy + 1.02, 0.95), 'chest', 1.0);
    const g2 = box(0.05, 0.5, 0.08); g2.rotateZ(s * 0.35); ember(at(g2, s * 0.2, cy + 0.45, 1.0), 'chest', 0.9);
    const g3 = box(0.05, 0.55, 0.08); g3.rotateZ(s * 1.25); g3.rotateX(-0.5); ember(at(g3, s * 0.9, cy + 1.25, 0.35), 'chest', 0.9);
  }

  // ---- arms: deltoid with bone spurs, upper arm, elbow, forearm with a spiked manacle, clawed fist
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, sh = p('shoulder' + side), el = p('elbow' + side), hd = p('hand' + side);
    const sb = 'shoulder' + side, eb = 'elbow' + side, hb = 'hand' + side;
    part(at(rough(sph(0.66, 8, 6), 0.05, 7 + s), sh.x + s * 0.06, sh.y + 0.08, 0), sb, C.hide, 1.06, { shadeFn: (x, y) => lerp(0.84, 1.08, sm((y - sh.y + 0.5) / 1.0)) });
    for (let i = 0; i < 3; i++) { const g = cone(0.13, 0.55 - i * 0.1, 4); g.rotateZ(s * (0.35 + i * 0.3)); g.rotateX(-0.2); part(at(g, sh.x + s * (0.2 + i * 0.2), sh.y + 0.55 - i * 0.12, -0.1 + i * 0.12), sb, C.horn, 0.95 - i * 0.05); }
    part(at(cyl(0.44, 0.35, 1.52, 7), sh.x, sh.y - 0.76, 0), sb, C.hide, 1.0, { blend: { bone: eb, y: el.y, width: 0.34 }, shadeFn: (x, y) => lerp(0.8, 1.0, sm((sh.y - y) / 1.2)) });
    part(at(sph(0.37, 7, 5), el.x, el.y, 0), eb, C.hide, 0.95);
    part(at(cyl(0.37, 0.3, 1.42, 7), el.x, el.y - 0.7, 0), eb, C.hide, 1.04, { blend: { bone: hb, y: hd.y, width: 0.26 } });
    part(at(cyl(0.41, 0.41, 0.24, 8, true), el.x, el.y - 1.08, 0), eb, C.iron, 1.0);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; const g = cone(0.06, 0.22, 4); g.rotateX(Math.PI / 2); g.rotateY(a); part(at(g, el.x + Math.sin(a) * 0.48, el.y - 1.08, Math.cos(a) * 0.48), eb, C.ironLight, 0.9); }
    const cr = box(0.05, 0.6, 0.07); cr.rotateZ(s * 0.15); ember(at(cr, el.x + s * 0.3, el.y - 0.55, -0.18), eb, 0.9);
    // fist: knuckles forward, claws
    part(at(rough(scaled(sph(0.44, 7, 5), 1.0, 0.84, 1.15), 0.04, 9 + s), hd.x, hd.y - 0.22, 0.08), hb, C.hide, 1.1, { shadeFn: (x, y) => lerp(0.85, 1.05, sm((y - hd.y + 0.6) / 0.7)) });
    for (let i = 0; i < 3; i++) {
      const kx = hd.x + (i - 1) * 0.24;
      part(at(box(0.2, 0.18, 0.22), kx, hd.y - 0.1, 0.42), hb, C.hideLight, 0.95);
      const claw = cone(0.07, 0.34, 4); claw.rotateX(1.35); part(at(claw, kx, hd.y - 0.26, 0.62), hb, C.horn, 1.0);
    }
  }

  // ---- legs: thigh, knee with a spur, shin, foot with claws
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, hp = p('hip' + side), kn = p('knee' + side), an = p('ankle' + side);
    const hb = 'hip' + side, kb = 'knee' + side, ab = 'ankle' + side;
    part(at(cyl(0.47, 0.37, 1.12, 7), hp.x, hp.y - 0.55, 0), hb, C.hide, 0.96, { blend: { bone: kb, y: kn.y, width: 0.3 }, shadeFn: (x, y) => lerp(0.82, 1.0, sm((hp.y - y) / 1.0)) });
    part(at(sph(0.37, 7, 5), kn.x, kn.y, 0), kb, C.hide, 0.94);
    { const g = cone(0.1, 0.36, 4); g.rotateX(-1.2); part(at(g, kn.x, kn.y + 0.05, 0.4), kb, C.horn, 0.95); }
    part(at(cyl(0.35, 0.27, 1.02, 7), kn.x, kn.y - 0.5, 0), kb, C.hide, 1.0, { blend: { bone: ab, y: an.y + 0.05, width: 0.22 }, shadeFn: (x, y) => lerp(0.78, 1.0, sm((kn.y - y) / 1.0)) });
    part(at(box(0.6, 0.28, 0.88), an.x, an.y - 0.02, 0.2), ab, C.hideDark, 0.95);
    for (let i = 0; i < 3; i++) { const g = cone(0.09, 0.34, 4); g.rotateX(1.45); part(at(g, an.x + (i - 1) * 0.2 * s, an.y - 0.08, 0.74), ab, C.horn, 0.95); }
  }

  // ---- tail: three tapered segments and a bone spike
  for (const [n, len, r0, r1] of [['tail', 0.8, 0.24, 0.17], ['tail2', 0.72, 0.17, 0.1], ['tail3', 0.7, 0.1, 0.035]]) {
    const tp = p(n), g = cyl(r1, r0, len, 5); g.rotateX(-Math.PI / 2);
    part(at(g, tp.x, tp.y, tp.z - len / 2), n, n === 'tail' ? C.hide : C.hideDark, 0.9);
  }
  { const tp = p('tail3'), g = cone(0.09, 0.45, 4); g.rotateX(-Math.PI / 2); part(at(g, tp.x, tp.y, tp.z - 0.9), 'tail3', C.horn, 0.95); }

  // ---- neck + head: thick neck, smooth faceless skull, brow, heavy jaw, tusks, ember eyes, ram horns
  const np = p('neck'), hp = p('head');
  { const g = cyl(0.4, 0.52, 0.7, 7); g.rotateX(-0.35); part(at(g, 0, np.y + 0.12, np.z + 0.08), 'neck', C.hide, 0.95); }
  part(at(scaled(sph(0.47, 11, 9), 0.96, 0.86, 1.16), hp.x, hp.y + 0.04, hp.z + 0.08), 'head', C.hide, 1.0, { shadeFn: (x, y) => lerp(0.82, 1.04, sm((y - hp.y + 0.3) / 0.7)) }, 1);
  part(at(box(0.84, 0.17, 0.4), 0, hp.y + 0.25, hp.z + 0.25), 'head', C.hideDark, 0.9);
  { const g = box(0.52, 0.24, 0.6); g.rotateX(0.18); part(at(g, 0, hp.y - 0.24, hp.z + 0.3), 'head', C.hide, 0.92); }
  for (const s of [1, -1]) { const g = cone(0.06, 0.3, 4); g.rotateX(-0.25); part(at(g, s * 0.24, hp.y - 0.08, hp.z + 0.55), 'head', C.horn, 1.0); }
  for (const s of [1, -1]) rb.part(at(box(0.16, 0.05, 0.07), s * 0.2, hp.y + 0.13, hp.z + 0.5), 'head', C.ember, 2, 2.6);
  for (const s of [1, -1]) {
    const horn = hornGeo(new THREE.Vector3(s * 0.92, 0.38, -0.3), 7, 0.34, 0.19, s * 0.4, 0.11, 5);
    part(at(horn, s * 0.3, hp.y + 0.32, hp.z - 0.02), 'head', C.horn, 1.0, { shadeFn: (x, y) => lerp(0.78, 1.05, sm((y - hp.y) / 1.4)) });
  }

  const [body, head, emberMat] = bossMats();
  const rig = rb.build([body, head, emberMat]);
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = HY; rig.mesh.position.y = -HY; pivot.add(rig.mesh); root.add(pivot);
  const shadow = contactShadow(4.2); root.add(shadow);
  const animator = new Animator(rig, DEMON_CLIPS, pivot);
  return { root, mesh: rig.mesh, bones: rig.bones, animator, materials: [body, head], emberMat, shadow, update(dt) { animator.update(dt); } };
}

// ------------------------------------------------------------------------------------------------- entity

/** Reach / step are divided by the logical scale (Combat multiplies them back). */
const S = 2.4;
const DEMON_WEAPON = { name: 'Fists', visual: 'none', dmg: 34, reach: 4.6 / S, moveset: 'demon', poiseDmg: 45, staminaMul: 1, rarity: 'common' };
const DEMON_MOVESET = {
  light: [
    { clip: 'light1', windup: 0.85, active: 0.24, recover: 0.95, motion: 1.0, arcFrom: -110, arcTo: 95, stamina: 0, knock: 6, step: 1.6 / S },
    { clip: 'light2', windup: 0.55, active: 0.22, recover: 1.0, motion: 1.1, arcFrom: 110, arcTo: -95, stamina: 0, knock: 6.5, step: 1.4 / S },
  ],
  heavy: { clip: 'heavy', windup: 1.25, active: 0.22, recover: 1.25, motion: 2.4, arcFrom: -55, arcTo: 55, stamina: 0, knock: 11, step: 2.6 / S, poiseMul: 3, ring: { radius: 4.2, ahead: 2.6 }, slam: true },
};

export class HornedDemon extends Boss {
  /** o: { x, z, arena, seed, name?, hp?, dmg?, runes?, subtitle? } */
  constructor(game, o) {
    super(game, {
      name: o.name || 'Gravehorn Demon', subtitle: o.subtitle, x: o.x, z: o.z, arena: o.arena, seed: o.seed ?? 3,
      hp: o.hp ?? 1600, poise: 260, radius: 1.55 / S, height: 5.0, runes: o.runes ?? 2600,
      walk: 2.4, run: 5.2, dmg: o.dmg ?? 1.0, logicalScale: S,
      weapon: DEMON_WEAPON, moveset: DEMON_MOVESET, attackRange: 4.2, introDur: 2.3, glowScale: 0.55, heatScale: 0.55, ringAlpha: 0.45,
    });
    this.rig = createDemonRig();
    this.object3d.add(this.rig.root);
    this.materials = this.rig.materials;
    this.bladeMat = this.rig.emberMat; // Enemy.updateBlade heats it during wind-ups, flashes on release
    this.anim = this.rig.animator;
    this.glowColor.setHex(PALETTE.ember);
    this.lightHeight = 3.4;
  }

  /** Far: slam (steps in). Near: mostly swipes, occasional slam. Phase 2 slams more. */
  pickAttack() {
    const p = this.game.player, dist = p ? this.distanceTo(p) : 0;
    const ms = this.moveset, far = dist > 3.6;
    const slamP = (far ? 0.6 : 0.28) + (this.phase > 1 ? 0.15 : 0);
    if (this.rng.chance(slamP)) { this.comboNext = false; return ms.heavy; }
    this.comboNext = this.rng.chance(this.phase > 1 ? 0.7 : 0.45);
    return ms.light[0];
  }
}
