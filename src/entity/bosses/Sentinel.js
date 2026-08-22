/**
 * Gate Sentinel (day-1 field boss): a giant armoured knight on a barded black warhorse, modelled at full
 * size (~4.9 m to the helm crest, ~8 m with the halberd raised) on the shared RigBuilder / Animator.
 * Silhouette is built as two opposed shapes with a hard value split: the MOUNT is one long, low, near-black
 * horizontal mass (extended neck, head with ears and muzzle projecting well past the rider, four legs in a
 * wide stance, dark iron neck plates and peytral so nothing on it goes pale); the RIDER is a pale steel
 * vertical form edged in brass with a tall crested helm, the shield hanging on the flank and a 4.4 m
 * halberd. Slots: 0 cloth / leather / wood, 1 hide (smooth), 2 ember (halberd head, eye slits, visor —
 * heats gold during wind-ups), 3 plate (specular steel / brass / iron, picked automatically by tint).
 * The cool moon rim (BossRig LIT_BODY) carves the outline against the sky; a warm torch rim points at the
 * nearest brazier. Attacks: lunging overhead chop (heavy, ground ring telegraph + slam), right / backhand
 * sweeps (lights), trampling charge from range. Horse and rider share one skeleton.
 */
import * as THREE from 'three';
import { RigBuilder, Animator } from '../Humanoid.js';
import { PALETTE, mixHex } from '../../render/Style.js';
import { Boss } from './Boss.js';
import { TAU, clamp01, sm, lerp, at, rot, scaled, cyl, sph, box, cone, phase, rough, chainGeo, armourMats } from './BossRig.js';

const E_HIPSY = 0, E_PITCH = 1, E_ROLL = 2;
const HY = 2.25; // horse pelvis height (whole-body pivot)
const _d = new THREE.Vector3(), _c = new THREE.Color();
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const hex = (c) => c.getHex();
const dim = (h, k) => hex(_c.setHex(h).multiplyScalar(k));

/** Palette-derived tints. Mount: near-black hide, dark iron, charcoal-crimson cloth. Rider: pale steel + brass. */
const C = {
  hide: dim(PALETTE.wolfFurDark, 0.5), hideDark: dim(PALETTE.wolfFurDark, 0.34), mane: dim(PALETTE.wolfFurDark, 0.28),
  iron: dim(PALETTE.iron, 0.8), ironDark: dim(PALETTE.iron, 0.55),
  steel: dim(PALETTE.steel, 0.94), steelLight: hex(mixHex(PALETTE.steel, PALETTE.moon, 0.3)), steelDark: dim(PALETTE.steel, 0.66),
  brass: hex(mixHex(PALETTE.gold, PALETTE.iron, 0.3)), brassDark: hex(mixHex(PALETTE.gold, PALETTE.iron, 0.58)), brassLight: hex(mixHex(PALETTE.gold, PALETTE.spark, 0.2)),
  cloth: dim(hex(mixHex(PALETTE.sparkBlood, PALETTE.clothDark, 0.55)), 0.62), clothDark: dim(hex(mixHex(PALETTE.sparkBlood, PALETTE.clothDark, 0.75)), 0.55),
  cape: dim(hex(mixHex(PALETTE.sparkBlood, PALETTE.clothDark, 0.4)), 0.8),
  leather: dim(PALETTE.leather, 0.85), leatherDark: dim(PALETTE.leather, 0.6), wood: PALETTE.woodDark, blade: PALETTE.steel, bladeDark: PALETTE.steelDark, glow: PALETTE.grace,
};
/** Tints that live on the specular plate slot. */
const PLATE = new Set([C.steel, C.steelDark, C.steelLight, C.brass, C.brassDark, C.brassLight, C.iron, C.ironDark]);

// ------------------------------------------------------------------------------------------------- clips

/** Extras accumulator (pivot height / pitch / roll) so helpers can compose. */
const X = { hipsy: 0, pitch: 0, roll: 0 };
const resetX = () => { X.hipsy = 0; X.pitch = 0; X.roll = 0; };
const applyX = (P) => { P.extra(E_HIPSY, X.hipsy); P.extra(E_PITCH, X.pitch); P.extra(E_ROLL, X.roll); };

/** Halberd arm in the sagittal plane: shaft stays vertical for tilt 0 (wrist cancels the arm pitch), + tilts the tip forward. */
function arm(P, sh, el, tilt, ry = 0, rz = -0.2) {
  P.set('rshoulderR', sh, ry, rz); P.set('relbowR', el, 0, 0); P.set('rhandR', -(sh + el) + tilt, 0, 0);
}

/** Standing horse with the neck stretched forward, rider upright, halberd carried upright, shield hanging on the flank. */
function base(P) {
  // +X tips a bone's tip forward / down: the neck leans out ahead of the withers, the muzzle hangs forward-down
  P.set('neck', 0.18, 0, 0); P.set('neck2', 0.1, 0, 0); P.set('head', 0.15, 0, 0);
  P.set('tail', 0.3, 0, 0); P.set('tail2', 0.25, 0, 0);
  arm(P, -0.5, -1.25, 0.05);
  P.set('rshoulderL', -0.18, 0.1, 0.32); P.set('relbowL', -0.55, 0, 0);
  P.set('rspine', 0.04, 0, 0); P.set('rchest', 0.03, 0, 0); P.set('rhead', 0.05, 0, 0);
  P.set('rhipL', 0, 0, 0); P.set('rhipR', 0, 0, 0);
}

/**
 * Rear up by th radians (nose up) with the hind hooves planted: the pivot pitches about the pelvis, the hind legs
 * counter-rotate, the pivot lifts by the pelvis drop, the forelegs tuck and the rider leans into it.
 */
function rear(P, th, k) {
  X.pitch -= th; X.hipsy += 0.2 * (1 - Math.cos(th)) + 1.05 * Math.sin(th);
  P.add('hipL', th * 1.05, 0, 0); P.add('hipR', th * 1.05, 0, 0); P.add('kneeL', -0.2 * k, 0, 0); P.add('kneeR', -0.2 * k, 0, 0);
  P.add('fshoulderL', -1.15 * k, 0, 0.05 * k); P.add('fshoulderR', -0.95 * k, 0, -0.05 * k); P.add('fkneeL', 1.5 * k, 0, 0); P.add('fkneeR', 1.3 * k, 0, 0);
  // the body pitches nose-up already: keep the head level-ish so the chanfron reads as a horse's face, not a spike into the sky
  P.add('neck', 0.55 * k, 0, 0); P.add('neck2', 0.3 * k, 0, 0); P.add('head', 0.25 * k, 0, 0);
  P.add('rspine', 0.3 * k, 0, 0); P.add('rchest', 0.15 * k, 0, 0); P.add('rhead', -0.2 * k, 0, 0);
  P.add('rhipL', -0.25 * k, 0, 0); P.add('rhipR', -0.25 * k, 0, 0);
  P.add('tail', -0.5 * k, 0, 0);
}

/** Trot / canter gait at phase ph with leg amplitude A (diagonal pairs), plus body bob and rider sway. */
function gait(P, ph, A, sp) {
  const s = Math.sin(ph), s2 = Math.sin(2 * ph);
  P.add('fshoulderL', -A * s, 0, 0); P.add('fshoulderR', A * s, 0, 0);
  P.add('hipL', A * 0.85 * s, 0, 0); P.add('hipR', -A * 0.85 * s, 0, 0);
  P.add('fkneeL', 1.2 * A * Math.max(0, Math.sin(ph + 1.1)), 0, 0); P.add('fkneeR', 1.2 * A * Math.max(0, Math.sin(ph + Math.PI + 1.1)), 0, 0);
  P.add('kneeL', 0.9 * A * Math.max(0, -Math.sin(ph - 0.6)), 0, 0); P.add('kneeR', 0.9 * A * Math.max(0, Math.sin(ph - 0.6)), 0, 0);
  P.add('fankleL', 0.3 * A * Math.max(0, Math.sin(ph + 0.5)), 0, 0); P.add('fankleR', 0.3 * A * Math.max(0, -Math.sin(ph + 0.5)), 0, 0);
  P.add('neck', 0.1 * s2, 0.04 * s, 0); P.add('head', -0.12 * s2, 0, 0);
  P.add('tail', -0.35 * sp - 0.1 * s2, 0.15 * s, 0); P.add('tail2', -0.1 * sp, 0.25 * Math.sin(ph - 1), 0);
  P.add('rspine', 0.05 * s2 + 0.12 * sp, 0, 0.03 * s); P.add('rchest', 0.04 * s2, 0.05 * s, 0); P.add('rhead', -0.06 * s2, 0, 0);
  P.add('rshoulderL', 0.05 * s2, 0, 0);
  X.hipsy += 0.08 * s2 - 0.03 * sp; X.pitch += 0.05 * Math.sin(2 * ph + 0.6) + 0.03 * sp; X.roll += 0.025 * s;
}

const CLIPS = {
  idle(t, P) {
    resetX(); base(P);
    const b = Math.sin(t * 0.9), b2 = Math.sin(t * 0.55 + 1), paw = Math.max(0, Math.sin(t * 0.45) - 0.7) / 0.3;
    P.add('neck', 0.06 * b, 0.1 * b2, 0); P.add('neck2', 0.02 * b, 0.05 * b2, 0); P.add('head', 0.05 * b, 0.12 * b2, 0);
    P.add('tail', 0, 0.35 * Math.sin(t * 1.3), 0); P.add('tail2', 0, 0.3 * Math.sin(t * 1.3 + 1), 0);
    P.add('fshoulderL', -0.35 * paw, 0, 0); P.add('fkneeL', 0.8 * paw, 0, 0);
    P.add('rchest', 0.02 * b, 0, 0); P.add('rhead', 0, 0.18 * b2, 0); P.add('rshoulderR', 0.03 * b, 0, 0);
    X.hipsy = 0.015 * b - 0.02 * paw;
    applyX(P);
  },
  /** Trot → canter with ctx.speed; the halberd levels forward a little as the pace rises. */
  run(t, P, ctx) {
    resetX(); base(P);
    const sp = clamp01(ctx.speed), ph = t * TAU * (1.3 + 0.6 * sp);
    gait(P, ph, 0.42 + 0.22 * sp, sp);
    arm(P, -0.6 - 0.45 * sp, -1.2 + 0.25 * sp, 0.1 + 0.4 * sp);
    applyX(P);
  },
  /** Intro: the horse rears high, paws the air and tosses its head while the rider raises halberd and shield. */
  roar(t, P) {
    resetX(); base(P);
    const k = sm(t / 0.55) * (1 - sm((t - 1.45) / 0.6)), tr = Math.sin(t * 26) * 0.015 * k;
    rear(P, 0.68 * k, k);
    P.add('fshoulderL', -0.25 * Math.sin(t * 7) * k, 0, 0); P.add('fshoulderR', 0.25 * Math.sin(t * 7 + 1) * k, 0, 0);
    P.add('head', -0.15 * k + 0.2 * Math.sin(t * 5) * k, tr * 4, 0); P.add('neck2', tr, 0, 0);
    arm(P, lerp(-0.5, -2.5, k), lerp(-1.25, -0.35, k), -0.45 * k, 0, -0.2 - 0.3 * k);
    P.add('rshoulderL', -0.6 * k, 0.1 * k, 0.7 * k); P.add('relbowL', -0.6 * k, 0, 0);
    P.add('rchest', -0.1 * k, tr, 0);
    applyX(P);
  },
  alert(t, P) {
    resetX(); base(P);
    const b = Math.sin(t * 2.4), paw = Math.max(0, Math.sin(t * 2.4));
    P.add('neck', -0.1, 0.12 * b, 0); P.add('head', -0.15 + 0.08 * b, 0.15 * b, 0);
    P.add('fshoulderR', -0.45 * paw, 0, 0); P.add('fkneeR', 0.95 * paw, 0, 0);
    arm(P, -0.95, -0.95, 0.55, 0.15, -0.3);
    P.add('rshoulderL', -0.3, 0, 0.25); P.add('rchest', 0.08, 0.1 * b, 0);
    P.add('tail', 0.15, 0.25 * Math.sin(t * 3), 0);
    X.hipsy = -0.05 * paw;
    applyX(P);
  },
  /**
   * Lunging overhead chop. Wind-up: the horse gathers on its haunches with a mild lift, the near foreleg pawing
   * high and the far one planted forward, neck stretched up and forward with the head turned on the target; the
   * rider stands in the stirrups with the halberd straight up and cocked back, shield swung out on the flank.
   * Active: the forehooves crash down and the halberd is hurled forward-down.
   */
  heavy(t, P, ctx) {
    const f = phase(t, ctx); let up, down;
    if (f.p === 0) { up = sm(f.k); down = 0; }
    else if (f.p === 1) { up = 1 - f.k * f.k; down = Math.pow(f.k, 0.6); }
    else { up = 0; down = 1 - sm(f.k); }
    resetX(); base(P);
    // slight lift of the forehand (the body stays a horizontal mass), haunches gathered under it
    X.pitch -= 0.1 * up; X.hipsy -= 0.04 * up;
    P.add('hipL', 0.38 * up, 0, 0); P.add('hipR', -0.08 * up, 0, 0); P.add('kneeL', -0.1 * up, 0, 0); P.add('kneeR', 0.12 * up, 0, 0);
    P.add('fshoulderL', -1.3 * up, 0, 0.08 * up); P.add('fkneeL', 1.8 * up, 0, 0); P.add('fankleL', 0.4 * up, 0, 0); // near leg pawing
    P.add('fshoulderR', -0.22 * up, 0, -0.06 * up); P.add('fkneeR', 0.04 * up, 0, 0); // far leg planted ahead
    // neck reaches up and out, head swung round to glare down at the target (eye slits toward the camera)
    P.add('neck', -0.06 * up, 0.3 * up, 0); P.add('neck2', -0.06 * up, 0.28 * up, 0); P.add('head', 0.02 * up, 0.34 * up, 0);
    P.add('tail', -0.35 * up, 0, 0);
    // rider stands tall and twists toward the target; the halberd is raised vertical ahead of the helm (arm leaning
    // forward, shaft a touch back) so the whole shaft stands clear of the crest against the sky
    P.add('rspine', -0.08 * up, 0.12 * up, 0); P.add('rchest', -0.06 * up, 0.22 * up, 0); P.add('rhead', 0.1 * up, 0.15 * up, 0);
    P.add('rhipL', -0.2 * up, 0, 0); P.add('rhipR', -0.2 * up, 0, 0);
    const sh = lerp(-0.5, -2.45, up) + 1.3 * down, el = lerp(-1.25, -0.1, up) + 0.1 * down;
    P.set('rshoulderR', sh, 0, -0.2 - 0.05 * up + 0.05 * down); P.set('relbowR', el, 0, 0);
    P.set('rhandR', -(sh + el) - 0.15 * up + 1.55 * down, 0, 0);
    // shield slung back on the flank behind the rider's leg (arm swung back, straight) so the torso reads clear,
    // then brought forward to brace on the slam
    P.add('rshoulderL', 0.75 * up - 0.5 * down, 0.1 * up, 0.08 * up + 0.25 * down); P.add('relbowL', 0.45 * up - 0.6 * down, 0, 0);
    // the slam: forehooves crash down, rider and horse pitch into it
    P.add('rspine', 0.55 * down, 0, 0); P.add('rchest', 0.35 * down, 0, 0); P.add('rhead', 0.1 * down, 0, 0);
    P.add('neck', 0.35 * down, 0, 0); P.add('head', 0.25 * down, 0, 0);
    P.add('fshoulderL', 0.2 * down, 0, 0); P.add('fshoulderR', 0.2 * down, 0, 0);
    P.add('hipL', -0.15 * down, 0, 0); P.add('hipR', -0.15 * down, 0, 0); P.add('kneeL', 0.25 * down, 0, 0); P.add('kneeR', 0.25 * down, 0, 0);
    X.pitch += 0.14 * down; X.hipsy -= 0.2 * down;
    applyX(P);
  },
  /** Right-to-left halberd sweep. */
  light1(t, P, ctx) { sweep(t, P, ctx, -1); },
  /** Backhand (mirror). */
  light2(t, P, ctx) { sweep(t, P, ctx, 1); },
  /** Trampling charge: gathers low with the halberd levelled like a lance, gallops, then skids to a stop. */
  charge(t, P, ctx) {
    const f = phase(t, ctx); let set, go, stop;
    if (f.p === 0) { set = sm(f.k); go = 0; stop = 0; }
    else if (f.p === 1) { set = 1; go = 1; stop = 0; }
    else { set = 1 - sm(f.k); go = 1 - sm(f.k * 1.6); stop = Math.sin(Math.min(1, f.k * 1.4) * Math.PI); }
    resetX(); base(P);
    if (go > 0) gait(P, t * TAU * 2.4, 0.72 * go, go);
    arm(P, -1.35 * set, -1.2 + 0.9 * set, 1.45 * set, 0.1 * set, -0.25);
    P.add('rspine', 0.3 * set, 0, 0); P.add('rchest', 0.15 * set, 0, 0);
    P.add('neck', 0.35 * set * (1 - go) + 0.15 * go, 0, 0); P.add('head', 0.2 * set, 0, 0);
    P.add('hipL', 0.3 * set * (1 - go), 0, 0); P.add('hipR', 0.3 * set * (1 - go), 0, 0); P.add('kneeL', 0.45 * set * (1 - go), 0, 0); P.add('kneeR', 0.45 * set * (1 - go), 0, 0);
    // skid: haunches drop, forelegs brace forward, head up
    P.add('fshoulderL', -0.5 * stop, 0, 0); P.add('fshoulderR', -0.5 * stop, 0, 0); P.add('hipL', 0.5 * stop, 0, 0); P.add('hipR', 0.5 * stop, 0, 0);
    P.add('neck', -0.35 * stop, 0, 0); P.add('head', -0.3 * stop, 0, 0);
    X.hipsy += -0.18 * set * (1 - go) - 0.3 * stop; X.pitch += 0.06 * set * (1 - go) - 0.22 * stop;
    applyX(P);
  },
  hit(t, P, ctx) {
    resetX(); base(P);
    const k = 1 - sm(t / (ctx.dur || 0.32));
    P.add('neck', -0.2 * k, 0.1 * k, 0); P.add('head', -0.25 * k, 0, 0); P.add('rspine', -0.15 * k, 0, 0); P.add('rchest', -0.1 * k, 0.05 * k, 0);
    P.add('fshoulderL', -0.2 * k, 0, 0); P.add('fkneeL', 0.3 * k, 0, 0);
    X.hipsy = -0.05 * k; X.pitch = -0.04 * k;
    applyX(P);
  },
  /** Stumble: forelegs buckle, head drops, rider lurches forward over the neck. */
  stagger(t, P, ctx) {
    resetX(); base(P);
    const k = 1 - sm(t / (ctx.dur || 0.9)), w = Math.sin(t * 7) * 0.08 * k;
    P.add('fkneeL', 0.9 * k, 0, 0); P.add('fkneeR', 0.7 * k, 0, 0); P.add('fshoulderL', -0.3 * k, 0, 0); P.add('fshoulderR', -0.1 * k, 0, 0);
    P.add('neck', 0.45 * k, w * 2, 0); P.add('neck2', 0.2 * k, 0, 0); P.add('head', 0.1 * k, 0, w);
    P.add('rspine', 0.5 * k, w, 0); P.add('rchest', 0.3 * k, 0, w); P.add('rhead', 0.2 * k, 0, 0);
    P.add('rshoulderR', -0.6 * k, 0, 0); P.add('rhandR', 0.5 * k, 0, 0); P.add('rshoulderL', -0.5 * k, 0, 0.3 * k);
    X.hipsy = -0.32 * k; X.pitch = 0.24 * k; X.roll = w;
    applyX(P);
  },
  /** The horse's forelegs fold, it pitches onto its knees and topples onto its side; the rider slumps. */
  death(t, P) {
    resetX(); base(P);
    const k = sm(t / 1.3), kk = k * k;
    P.add('fkneeL', 1.7 * k, 0, 0); P.add('fkneeR', 1.6 * k, 0, 0); P.add('fshoulderL', -0.5 * k, 0, 0); P.add('fshoulderR', -0.4 * k, 0, 0);
    P.add('hipL', -0.6 * kk, 0, 0.3 * kk); P.add('hipR', -0.2 * kk, 0, -0.2 * kk); P.add('kneeL', 0.5 * kk, 0, 0);
    P.add('neck', 0.55 * k, 0.3 * kk, 0); P.add('neck2', 0.3 * k, 0, 0); P.add('head', 0.2 * k, 0.2 * kk, 0);
    P.add('rspine', 0.75 * k, 0.2 * kk, 0); P.add('rchest', 0.45 * k, 0, 0); P.add('rhead', 0.5 * k, 0, 0.3 * kk);
    P.set('rshoulderR', -0.9 * k, 0, -0.5 * k); P.set('relbowR', -0.2 * k, 0, 0); P.set('rhandR', 0.9 * k, 0, 0);
    P.add('rshoulderL', -0.5 * k, 0, 0.8 * k); P.add('relbowL', 0.9 * k, 0, 0);
    P.add('tail', -0.3 * k, 0.5 * kk, 0);
    X.pitch = 0.5 * k - 0.1 * kk; X.hipsy = -0.45 * k - 0.95 * kk; X.roll = 1.05 * kk;
    applyX(P);
  },
};
CLIPS.guard = CLIPS.alert;

function sweep(t, P, ctx, s) {
  // s = -1: cock the halberd out to the rider's right and behind, sweep across the front to the left
  const f = phase(t, ctx); let cock, sw;
  if (f.p === 0) { cock = sm(f.k); sw = 0; }
  else if (f.p === 1) { cock = 1; sw = Math.pow(f.k, 0.8); }
  else { cock = 1 - sm(f.k); sw = 1 - sm(f.k); }
  resetX(); base(P);
  const ry = -s * (1.15 - 2.5 * sw) * cock;
  P.set('rshoulderR', lerp(-0.5, -1.3, cock), ry, lerp(-0.2, -0.45, cock));
  P.set('relbowR', lerp(-1.25, -0.15, cock), 0, 0);
  P.set('rhandR', lerp(1.7, 0.05, cock), 0, -s * 2.0 * cock); // wrist rolls the shaft flat across, tip dipping toward the ground
  const tw = -s * (0.5 - 1.15 * sw) * cock; // torso winds with the arm, then whips through
  P.add('rspine', 0.1 * cock, tw * 0.7, -tw * 0.1); P.add('rchest', 0.05 * cock, tw * 0.5, 0); P.add('rhead', 0, -tw * 0.7, 0);
  P.add('rshoulderL', -0.2 * cock, 0, 0.2 * cock);
  P.add('neck', 0.12 * cock, -tw * 0.35, 0); P.add('head', 0, -tw * 0.35, 0);
  P.add('hipL', 0.15 * cock, 0, 0); P.add('hipR', 0.15 * cock, 0, 0); P.add('kneeL', 0.2 * cock, 0, 0); P.add('kneeR', 0.2 * cock, 0, 0);
  X.hipsy = -0.1 * cock; X.roll = tw * 0.06;
  applyX(P);
}

// ------------------------------------------------------------------------------------------------- rig

/** Tapered tube from a to b (radius r0 at a, r1 at b). */
function tube(a, b, r0, r1, seg = 7) {
  _d.subVectors(b, a); const len = _d.length(); _d.normalize();
  const g = chainGeo([{ len, r0, r1, dir: _d.clone() }], seg);
  g.translate(a.x, a.y, a.z);
  return g;
}
const cap = (r, theta, seg = 8) => new THREE.SphereGeometry(r, seg, 4, 0, TAU, 0, theta);
/** Vertical gradient shade: lo at y0 → hi at y1. */
const sf = (y0, y1, lo, hi) => (x, y) => lerp(lo, hi, sm((y - y0) / (y1 - y0)));
const hash = (i, s = 0) => { const t = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return t - Math.floor(t); };

/** Cloth panel hanging from (cx, top, cz), w wide along the given axis, h tall, with a ragged hem; faces ±X or ±Z. */
function drape(w, h, cols, sideX, flare, seed) {
  const g = new THREE.PlaneGeometry(w, h, cols, 3);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), hang = clamp01((h * 0.5 - y) / h);
    let yy = y;
    if (y < -h * 0.49) yy -= (0.05 + 0.16 * hash(i, seed)) * (i % 2 ? 1 : 0.35);
    pos.setXYZ(i, x + (hash(i, seed + 3) - 0.5) * 0.04 * hang, yy, flare * hang * hang);
  }
  g.computeVertexNormals();
  if (sideX) g.rotateY(sideX * Math.PI / 2);
  return g;
}

/** Swept fin (helm crest / shield boss): a thin box whose upper half narrows and sweeps back (−Z). */
function fin(th, h, d, sweep = 0.5, back = 0.2) {
  const g = box(th, h, d, 1, 2, 1).toNonIndexed(); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) * sweep - back);
  g.computeVertexNormals();
  return g;
}

/** Build the sentinel rig. Returns { root, mesh, bones, animator, materials:[cloth, hide, plate], emberMat, setWarmDir(v), update(dt) }. */
export function createSentinelRig() {
  const rb = new RigBuilder();
  rb.parts.push([]); // slot 2: ember (halberd head, eye slits, visor)
  // ---- horse skeleton: a long, low body (pelvis → chest ≈ 2.05 m) with a wide stance
  const hips = rb.bone('hips', null, 0, HY, -1.0);
  const spine = rb.bone('spine', hips, 0, 0.08, 1.0);
  const chest = rb.bone('chest', spine, 0, 0.14, 1.05);
  const neck = rb.bone('neck', chest, 0, 0.32, 0.42);
  const neck2 = rb.bone('neck2', neck, 0, 0.5, 0.5);
  rb.bone('head', neck2, 0, 0.4, 0.42);
  const tail = rb.bone('tail', hips, 0, 0.28, -0.62);
  rb.bone('tail2', tail, 0, -0.6, -0.28);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const hp = rb.bone('hip' + side, hips, s * 0.5, -0.22, -0.18);
    const kn = rb.bone('knee' + side, hp, 0, -1.03, -0.14);
    rb.bone('ankle' + side, kn, 0, -0.76, 0.14);
    const fs = rb.bone('fshoulder' + side, chest, s * 0.52, -0.28, 0.2);
    const fk = rb.bone('fknee' + side, fs, 0, -1.0, 0.02);
    rb.bone('fankle' + side, fk, 0, -0.96, 0);
  }
  // ---- rider skeleton (sits on the spine)
  const rhips = rb.bone('rhips', spine, 0, 0.64, 0.42);
  const rspine = rb.bone('rspine', rhips, 0, 0.25, 0);
  const rchest = rb.bone('rchest', rspine, 0, 0.32, 0);
  const rneck = rb.bone('rneck', rchest, 0, 0.3, 0);
  rb.bone('rhead', rneck, 0, 0.12, 0);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const sh = rb.bone('rshoulder' + side, rchest, s * 0.44, 0.22, 0);
    const el = rb.bone('relbow' + side, sh, 0, -0.52, 0);
    rb.bone('rhand' + side, el, 0, -0.5, 0);
    const hp = rb.bone('rhip' + side, rhips, s * 0.38, -0.08, 0.05);
    const kn = rb.bone('rknee' + side, hp, s * 0.42, -0.5, 0.45);
    rb.bone('rankle' + side, kn, s * 0.04, -0.72, -0.12);
  }
  const p = (n) => rb.pos(n);
  rb.parts.push([]); // slot 3: plate (specular steel / brass / iron)
  const part = (geo, bone, color, shade = 1, o = null, mat = 0) => rb.part(geo, bone, color, mat === 0 && PLATE.has(color) ? 3 : mat, shade, o);
  const ember = (geo, bone, color, shade = 1) => rb.part(geo, bone, color, 2, shade);
  const bodyShade = sf(HY - 0.9, HY + 0.6, 0.55, 1.0);

  // ---- horse body: rump, long barrel, chest, withers (smooth slot so the big forms read soft against flat armour)
  part(at(rough(scaled(sph(0.66, 9, 7), 1.0, 0.95, 1.3), 0.03, 1), 0, HY - 0.02, -1.0), 'hips', C.hide, 1, { shadeFn: bodyShade }, 1);
  { const g = cyl(0.64, 0.68, 2.2, 10); g.rotateX(Math.PI / 2); part(at(rough(g, 0.025, 2), 0, HY - 0.04, 0.05), 'spine', C.hide, 1, { shadeFn: bodyShade }, 1); }
  part(at(rough(scaled(sph(0.62, 9, 7), 1.05, 1.1, 1.15), 0.03, 3), 0, HY, 1.1), 'chest', C.hide, 1, { shadeFn: bodyShade }, 1);
  part(at(scaled(sph(0.44, 8, 6), 1.0, 0.8, 1.3), 0, HY + 0.45, 0.8), 'chest', C.hide, 0.98, null, 1);

  // ---- neck (two segments), dark crinet plates along the crest with brass rivets, mane
  const n1 = p('neck'), n2 = p('neck2'), hd = p('head');
  part(tube(n1, n2, 0.48, 0.4, 9), 'neck', C.hide, 1, { blend: { bone: 'neck2', y: n2.y, width: 0.35 }, shadeFn: sf(n1.y - 0.6, n2.y + 0.2, 0.72, 1.0) }, 1);
  part(tube(n2, hd, 0.4, 0.28, 9), 'neck2', C.hide, 1, { blend: { bone: 'head', y: hd.y, width: 0.3 }, shadeFn: sf(n2.y - 0.5, hd.y, 0.85, 1.0) }, 1);
  {
    const dir = v(0, 0.9, 0.92).normalize(), nrm = v(0, 0.715, -0.7);
    for (let i = 0; i < 6; i++) {
      const f = i / 5, along = n1.clone().addScaledVector(dir, -0.1 + f * 1.5), r = lerp(0.46, 0.31, f);
      const g = rot(box(lerp(0.64, 0.44, f), 0.09, 0.36), -0.8, 0, 0); g.translate(along.x + nrm.x * r, along.y + nrm.y * r, along.z + nrm.z * r);
      part(g, i < 3 ? 'neck' : 'neck2', i % 2 ? C.iron : C.ironDark, 0.95);
      const rv = sph(0.04, 5, 4); rv.translate(along.x + nrm.x * (r + 0.05), along.y + nrm.y * (r + 0.05), along.z + nrm.z * (r + 0.05)); part(rv, i < 3 ? 'neck' : 'neck2', C.brassLight, 1.0); // rivet
      const m = rot(cone(0.075, 0.38, 4), -1.5 - 0.15 * f, 0, 0); m.translate(along.x + nrm.x * (r + 0.12), along.y + nrm.y * (r + 0.12) + 0.06, along.z + nrm.z * (r + 0.12) - 0.06);
      part(m, i < 3 ? 'neck' : 'neck2', C.mane, 0.9);
    }
  }

  // ---- head: skull, long muzzle, jaw, tall ears, dark chanfron with a brass brow spike, glowing eye slits, cheek plates
  part(at(scaled(sph(0.34, 9, 7), 0.95, 1.0, 1.25), hd.x, hd.y, hd.z + 0.18), 'head', C.hide, 1, null, 1);
  part(tube(v(0, hd.y - 0.02, hd.z + 0.3), v(0, hd.y - 0.66, hd.z + 1.1), 0.31, 0.2, 8), 'head', C.hide, 0.95, { shadeFn: sf(hd.y - 0.8, hd.y, 0.8, 1.0) }, 1);
  part(at(scaled(sph(0.22, 8, 6), 1.0, 0.85, 1.0), 0, hd.y - 0.68, hd.z + 1.12), 'head', C.hideDark, 0.9, null, 1);
  part(at(rot(box(0.3, 0.18, 0.66), 0.55, 0, 0), 0, hd.y - 0.52, hd.z + 0.66), 'head', C.hideDark, 0.8);
  for (const s of [1, -1]) part(at(rot(cone(0.08, 0.44, 4), -0.2, 0, s * 0.22), s * 0.17, hd.y + 0.42, hd.z - 0.02), 'head', C.hideDark, 0.9);
  part(at(rot(box(0.42, 0.08, 1.1), 0.7, 0, 0), 0, hd.y - 0.12, hd.z + 0.88), 'head', C.ironDark, 0.95, { shadeFn: (x, y, z) => (z > hd.z + 1.0 ? 0.8 : 1.0) });
  part(at(rot(cone(0.065, 0.7, 5), -0.45, 0, 0), 0, hd.y + 0.36, hd.z + 0.4), 'head', C.brassLight, 1.0);
  for (const s of [1, -1]) ember(at(box(0.1, 0.045, 0.22), s * 0.25, hd.y - 0.02, hd.z + 0.54), 'head', C.glow, 2.2);
  for (const s of [1, -1]) part(at(rot(box(0.05, 0.36, 0.4), 0.5, 0, 0), s * 0.32, hd.y - 0.18, hd.z + 0.45), 'head', C.ironDark, 0.85);

  // ---- legs: haunches, thighs, hocks, cannons, hooves (+ dark knee cops on the forelegs)
  for (const side of ['L', 'R']) {
    const hp = p('hip' + side), kn = p('knee' + side), an = p('ankle' + side), fs = p('fshoulder' + side), fk = p('fknee' + side), fa = p('fankle' + side);
    part(at(scaled(sph(0.38, 8, 6), 1.0, 1.15, 1.0), hp.x, hp.y - 0.1, hp.z + 0.02), 'hip' + side, C.hide, 0.9, { shadeFn: sf(hp.y - 0.5, hp.y + 0.3, 0.7, 1.0) }, 1);
    part(tube(hp, kn, 0.29, 0.16, 7), 'hip' + side, C.hide, 0.95, { blend: { bone: 'knee' + side, y: kn.y, width: 0.3 }, shadeFn: sf(kn.y, hp.y, 0.8, 1.0) }, 1);
    part(at(sph(0.17, 6, 5), kn.x, kn.y, kn.z), 'knee' + side, C.hide, 0.9);
    part(tube(kn, an, 0.18, 0.13, 6), 'knee' + side, C.hideDark, 0.95, { blend: { bone: 'ankle' + side, y: an.y + 0.06, width: 0.2 } });
    part(at(box(0.32, 0.28, 0.36), an.x, an.y - 0.1, an.z + 0.05), 'ankle' + side, C.hideDark, 0.7);
    part(at(scaled(sph(0.37, 8, 6), 1.0, 1.1, 1.0), fs.x, fs.y + 0.05, fs.z), 'fshoulder' + side, C.hide, 0.95, { shadeFn: sf(fs.y - 0.4, fs.y + 0.4, 0.76, 1.0) }, 1);
    part(tube(fs, fk, 0.31, 0.19, 7), 'fshoulder' + side, C.hide, 0.95, { blend: { bone: 'fknee' + side, y: fk.y, width: 0.28 }, shadeFn: sf(fk.y, fs.y, 0.8, 1.0) }, 1);
    part(at(sph(0.2, 6, 5), fk.x, fk.y, fk.z), 'fknee' + side, C.hide, 0.9);
    part(at(cap(0.24, Math.PI * 0.55), fk.x, fk.y + 0.02, fk.z + 0.05), 'fknee' + side, C.ironDark, 0.9);
    part(tube(fk, fa, 0.18, 0.14, 6), 'fknee' + side, C.hideDark, 0.95, { blend: { bone: 'fankle' + side, y: fa.y + 0.06, width: 0.2 } });
    { const g = cyl(0.2, 0.17, 0.6, 6, true); g.translate(fk.x, fk.y - 0.45, fk.z + 0.06); part(g, 'fknee' + side, C.ironDark, 0.85); } // greave
    part(at(box(0.32, 0.28, 0.36), fa.x, fa.y - 0.1, fa.z + 0.05), 'fankle' + side, C.hideDark, 0.7);
  }

  // ---- tail
  { const t1 = p('tail'), t2 = p('tail2'); part(tube(t1, t2, 0.16, 0.1, 6), 'tail', C.mane, 0.9); part(tube(t2, v(t2.x, t2.y - 0.85, t2.z - 0.3), 0.11, 0.03, 5), 'tail2', C.mane, 0.85); }

  // ---- barding: short caparison on both flanks (legs show beneath), crupper over the rump, dark peytral, saddle + stirrups
  for (const s of [1, -1]) {
    const g = drape(2.7, 1.15, 9, s, 0.14 * s, s + 3); g.translate(s * 0.72, HY - 0.5, 0.05);
    part(g, 'spine', C.cloth, 1.0, { shadeFn: sf(HY - 1.1, HY + 0.1, 0.5, 1.0) });
    part(at(box(0.04, 0.07, 2.6), s * 0.75, HY - 1.06, 0.05), 'spine', C.brassDark, 0.85);
    part(at(box(0.035, 0.4, 0.3), s * 0.76, HY - 0.52, 0.35), 'spine', C.brassLight, 0.9);
  }
  part(at(rot(box(1.46, 0.06, 1.25), 0.28, 0, 0), 0, HY + 0.5, -1.1), 'hips', C.cloth, 0.9);
  part(at(rot(box(1.5, 0.05, 0.1), 0.28, 0, 0), 0, HY + 0.34, -1.68), 'hips', C.brassDark, 0.9);
  part(at(rot(box(1.08, 0.62, 0.14), 0.35, 0, 0), 0, HY - 0.12, 1.68), 'chest', C.ironDark, 1.0, { shadeFn: sf(HY - 0.45, HY + 0.2, 0.8, 1.05) });
  for (const s of [1, -1]) part(at(sph(0.05, 5, 4), s * 0.4, HY - 0.05, 1.75), 'chest', C.brassLight, 1.0);
  part(at(rot(box(1.02, 0.06, 0.04), 0.35, 0, 0), 0, HY + 0.17, 1.76), 'chest', C.brass, 1.0); // peytral edge
  part(at(box(0.76, 0.22, 1.0), 0, HY + 0.6, 0.45), 'spine', C.leather, 0.9);
  part(at(box(1.52, 0.04, 1.3), 0, HY + 0.49, 0.45), 'spine', C.clothDark, 0.8);
  part(at(box(0.5, 0.26, 0.15), 0, HY + 0.8, 0.92), 'spine', C.leather, 0.85);
  part(at(box(0.62, 0.3, 0.14), 0, HY + 0.82, -0.02), 'spine', C.leather, 0.85);
  for (const s of [1, -1]) { part(at(box(0.07, 0.95, 0.04), s * 0.8, HY - 0.1, 0.78), 'spine', C.leatherDark, 0.8); part(at(box(0.22, 0.06, 0.26), s * 0.86, HY - 0.66, 0.83), 'spine', C.ironDark, 0.9); }

  // ---- rider (pale steel): fauld + skirt + tassets, cuirass with ridge and gorget, layered pauldrons, cape
  const rh = p('rhips'), rs = p('rspine'), rc = p('rchest'), rhd = p('rhead');
  part(at(box(0.66, 0.3, 0.52), 0, rh.y + 0.04, rh.z), 'rhips', C.steel, 0.92);
  part(at(cyl(0.34, 0.44, 0.3, 7, true), 0, rh.y - 0.14, rh.z), 'rhips', C.clothDark, 0.9);
  for (const a of [-0.5, 0.5, 1.5, -1.5, 2.6, -2.6]) { const g = box(0.26, 0.36, 0.04); g.translate(0, -0.14, 0.38); g.rotateX(-0.2); g.rotateY(a); g.translate(0, rh.y, rh.z); part(g, 'rhips', C.steel, 0.88 + 0.1 * Math.cos(a)); }
  part(at(cyl(0.37, 0.42, 0.4, 7), 0, rs.y + 0.15, rs.z), 'rspine', C.steelDark, 0.95, { blend: { bone: 'rchest', y: rc.y, width: 0.2 } });
  part(at(cyl(0.47, 0.38, 0.54, 7), 0, rc.y + 0.08, rc.z), 'rchest', C.steel, 1.0, { shadeFn: (x, y, z) => (z > rc.z + 0.1 ? 1.05 : 0.84) });
  part(at(rot(box(0.13, 0.52, 0.13), 0, Math.PI / 4, 0), 0, rc.y + 0.1, rc.z + 0.43), 'rchest', C.brass, 1.0);
  part(at(cyl(0.21, 0.32, 0.18, 7), 0, rc.y + 0.38, rc.z), 'rchest', C.brassDark, 0.85);
  part(at(box(0.3, 0.34, 0.03), 0, rc.y, rc.z + 0.47), 'rchest', C.cloth, 0.8);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, sh = p('rshoulder' + side), el = p('relbow' + side), hn = p('rhand' + side), b = 'rshoulder' + side;
    part(at(cap(0.36, Math.PI * 0.55), sh.x + s * 0.04, sh.y + 0.07, sh.z), b, C.steelLight, 0.95);
    { const g = cap(0.3, Math.PI * 0.5); g.rotateZ(-s * 0.55); part(at(g, sh.x + s * 0.15, sh.y - 0.12, sh.z), b, C.steel, 0.9); }
    { const g = cap(0.26, Math.PI * 0.5); g.rotateZ(-s * 0.85); part(at(g, sh.x + s * 0.25, sh.y - 0.3, sh.z), b, C.steelDark, 0.85); }
    { const g = new THREE.TorusGeometry(0.35, 0.025, 4, 10, Math.PI * 1.1); g.rotateX(Math.PI / 2); g.rotateY(-s * 0.5); part(at(g, sh.x + s * 0.04, sh.y + 0.11, sh.z), b, C.brass, 1.0); } // brass edging
    for (let i = 0; i < 2; i++) { const g = rot(cone(0.05, 0.32, 4), 0, 0, s * (0.5 + i * 0.45)); part(at(g, sh.x + s * (0.12 + i * 0.16), sh.y + 0.34 - i * 0.1, sh.z - 0.1 + i * 0.18), b, C.brassLight, 0.95); }
    part(tube(sh, el, 0.17, 0.14, 7), b, C.steel, 0.92, { blend: { bone: 'relbow' + side, y: el.y, width: 0.16 } });
    part(at(sph(0.15, 6, 5), el.x, el.y, el.z), 'relbow' + side, C.brass, 0.9);
    part(tube(el, hn, 0.15, 0.12, 7), 'relbow' + side, C.steel, 0.95, { blend: { bone: 'rhand' + side, y: hn.y, width: 0.14 } });
    part(at(scaled(sph(0.14, 6, 5), 1, 0.9, 1.1), hn.x, hn.y - 0.04, hn.z), 'rhand' + side, C.steelDark, 0.9);
    // legs: cuisse, knee cop, greave, sabaton
    const hp = p('rhip' + side), kn = p('rknee' + side), an = p('rankle' + side);
    part(tube(hp, kn, 0.19, 0.16, 7), 'rhip' + side, C.steel, 0.95, { blend: { bone: 'rknee' + side, y: kn.y, width: 0.2 } });
    part(at(sph(0.16, 6, 5), kn.x, kn.y, kn.z), 'rknee' + side, C.brass, 0.9);
    part(tube(kn, an, 0.15, 0.12, 7), 'rknee' + side, C.steel, 0.9, { blend: { bone: 'rankle' + side, y: an.y, width: 0.16 } });
    part(at(box(0.22, 0.18, 0.44), an.x, an.y - 0.08, an.z + 0.1), 'rankle' + side, C.steelDark, 0.85);
    part(at(rot(cone(0.035, 0.16, 4), -Math.PI / 2, 0, 0), an.x, an.y - 0.05, an.z - 0.2), 'rankle' + side, C.brassLight, 0.9);
  }
  { const g = drape(1.15, 1.55, 4, 0, -0.4, 9); g.translate(0, rc.y + 0.25 - 0.775, rc.z - 0.46); part(g, 'rchest', C.cape, 1.0, { shadeFn: sf(rc.y - 1.4, rc.y + 0.3, 0.95, 0.55) }); }

  // ---- great helm: tall barrel, peaked top, brass bands, glowing visor slit, TALL swept crest fin, wings, plume
  const hc = v(0, rhd.y + 0.27, rhd.z);
  part(at(cyl(0.17, 0.21, 0.16, 7), 0, rhd.y - 0.02, rhd.z), 'rneck', C.steelDark, 0.8);
  part(at(cyl(0.26, 0.28, 0.56, 8), 0, hc.y, hc.z), 'rhead', C.steel, 0.95, { shadeFn: (x, y, z) => (z > hc.z ? 1.04 : 0.86) });
  part(at(cone(0.27, 0.26, 8), 0, hc.y + 0.41, hc.z), 'rhead', C.steelLight, 1.0);
  part(at(cyl(0.285, 0.285, 0.04, 8), 0, hc.y - 0.12, hc.z), 'rhead', C.brass, 0.95);
  part(at(cyl(0.285, 0.285, 0.035, 8), 0, hc.y + 0.18, hc.z), 'rhead', C.brass, 0.95);
  ember(at(box(0.36, 0.045, 0.06), 0, hc.y + 0.08, hc.z + 0.27), 'rhead', C.glow, 2.2);
  part(at(fin(0.05, 0.9, 0.52, 0.45, 0.22), 0, hc.y + 0.84, hc.z - 0.08), 'rhead', C.steelLight, 0.98); // crest: a tall swept fin over the helm
  part(at(fin(0.075, 0.78, 0.1, 0.8, 0.3), 0, hc.y + 0.9, hc.z + 0.12), 'rhead', C.brass, 1.0); // brass leading edge
  for (const s of [1, -1]) part(at(rot(box(0.03, 0.4, 0.54), 0, s * 0.35, s * 0.5), s * 0.35, hc.y + 0.38, hc.z - 0.08), 'rhead', C.brassDark, 0.9);
  part(at(rot(cone(0.085, 0.95, 5), -2.3, 0, 0), 0, hc.y + 0.55, hc.z - 0.6), 'rhead', C.cape, 0.8);

  // ---- shield on the left forearm (face outward +X; hangs on the flank in the base pose), halberd in the right hand
  {
    const el = p('relbowL'), sx = el.x + 0.2, sy = el.y - 0.38, sz = el.z + 0.02;
    const face = (g) => { g.rotateX(Math.PI / 2); g.rotateY(Math.PI / 2); return g; };
    part(at(face(cyl(0.74, 0.74, 0.07, 10)), sx, sy, sz), 'relbowL', C.steel, 0.9, { shadeFn: (x) => (x > sx ? 1.0 : 0.7) });
    part(at(face(cyl(0.78, 0.78, 0.04, 10)), sx - 0.02, sy, sz), 'relbowL', C.brass, 0.9);
    part(at(sph(0.16, 7, 5), sx + 0.06, sy, sz), 'relbowL', C.brass, 1.0);
    part(at(box(0.03, 1.05, 0.14), sx + 0.05, sy, sz), 'relbowL', C.brassLight, 0.9);
    part(at(box(0.03, 0.14, 1.05), sx + 0.05, sy, sz), 'relbowL', C.brassLight, 0.9);
  }
  {
    const hn = p('rhandR');
    const H = (g, color, shade = 1, mat = 0) => part(at(g, hn.x, hn.y, hn.z), 'rhandR', color, shade, null, mat);
    // thick banded shaft: butt at -1.0, head at ~2.4, spike to 3.6 (hand-local, shaft along +Y)
    H(at(cyl(0.065, 0.075, 3.6, 7), 0, 0.8, 0.1), C.wood, 0.95);
    H(at(cyl(0.1, 0.1, 0.36, 7), 0, 0, 0.1), C.leather, 0.85);
    for (const y of [-0.7, 0.55, 1.3]) H(at(cyl(0.085, 0.085, 0.12, 7), 0, y, 0.1), C.brass, 1.0);
    H(at(cyl(0.1, 0.085, 0.26, 7), 0, 1.95, 0.1), C.brass, 1.0);
    for (const s of [1, -1]) H(at(box(0.03, 1.1, 0.16), s * 0.075, 1.55, 0.1), C.steelDark, 0.8);
    // axe head turned ~30° about the shaft so its face reads from the player's side, not edge-on
    const spin = (g) => { g.translate(0, 0, -0.1); g.rotateY(0.55); g.translate(0, 0, 0.1); return g; };
    {
      const g = box(0.07, 1.25, 0.9, 1, 2, 1).toNonIndexed(); const gp = g.attributes.position;
      for (let i = 0; i < gp.count; i++) { const z = gp.getZ(i), y = gp.getY(i); if (z > 0.2) gp.setY(i, y * 1.4); else if (z < -0.2) gp.setY(i, y * 0.55); }
      g.computeVertexNormals();
      H(spin(at(g, 0, 2.45, 0.64)), C.blade, 1.05, 2);
    }
    H(spin(at(rot(cone(0.09, 0.75, 5), -Math.PI / 2, 0, 0), 0, 2.5, -0.3)), C.blade, 0.95, 2);
    H(at(cyl(0.09, 0.07, 0.3, 7), 0, 2.9, 0.1), C.brass, 1.0);
    H(at(cone(0.07, 1.1, 5), 0, 3.55, 0.1), C.blade, 1.0, 2);
    { const g = drape(0.55, 1.1, 2, 0, 0.06, 21); g.rotateY(0.55); g.translate(0.06, 1.4, 0.16); H(g, C.cape, 0.95); } // pennant below the head
    H(at(rot(cone(0.05, 0.3, 5), Math.PI, 0, 0), 0, -1.0, 0.1), C.bladeDark, 0.9);
  }

  const mats = armourMats({ warm: 1.5 }), [cloth, hide, emberMat, plate] = mats;
  const rig = rb.build(mats);
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = HY; rig.mesh.position.y = -HY; pivot.add(rig.mesh); root.add(pivot);
  const animator = new Animator(rig, CLIPS, pivot);
  return { root, mesh: rig.mesh, bones: rig.bones, animator, materials: [cloth, hide, plate], emberMat, setWarmDir: mats.setWarmDir, update(dt) { animator.update(dt); } };
}

// ------------------------------------------------------------------------------------------------- entity

/** Reach / step are divided by the logical scale (Combat multiplies them back). */
const S = 2.2;
const SENTINEL_WEAPON = { name: 'Sentinel Halberd', visual: 'sentinelHalberd', dmg: 36, reach: 5.2 / S, moveset: 'sentinel', poiseDmg: 42, staminaMul: 1, rarity: 'common' };
const SENTINEL_MOVESET = {
  light: [
    { clip: 'light1', windup: 0.95, active: 0.26, recover: 0.9, motion: 1.0, arcFrom: -125, arcTo: 110, stamina: 0, knock: 7, step: 2.2 / S },
    { clip: 'light2', windup: 0.6, active: 0.24, recover: 1.0, motion: 1.1, arcFrom: 110, arcTo: -125, stamina: 0, knock: 7.5, step: 1.8 / S },
  ],
  heavy: { clip: 'heavy', windup: 1.35, active: 0.22, recover: 1.3, motion: 2.3, arcFrom: -40, arcTo: 40, stamina: 0, knock: 12, step: 3.2 / S, poiseMul: 3, ring: { radius: 4.6, ahead: 3.6 }, slam: true },
  charge: { clip: 'charge', windup: 1.0, active: 0.7, recover: 1.15, motion: 1.7, arcFrom: -70, arcTo: 70, stamina: 0, knock: 14, step: 13 / S, poiseMul: 2, charge: true },
};

export class Sentinel extends Boss {
  /** o: { x, z, arena, seed, name?, hp?, dmg?, runes?, subtitle? } */
  constructor(game, o) {
    super(game, {
      name: o.name || 'Gate Sentinel', subtitle: o.subtitle, x: o.x, z: o.z, arena: o.arena, seed: o.seed ?? 5,
      hp: o.hp ?? 1250, poise: 320, radius: 1.5 / S, height: 4.9, runes: o.runes ?? 1800,
      walk: 2.6, run: 6.0, dmg: o.dmg ?? 1.0, logicalScale: S,
      weapon: SENTINEL_WEAPON, moveset: SENTINEL_MOVESET, attackRange: 4.6, introDur: 2.2,
      glowScale: 0.02, heatScale: 0.005, ringAlpha: 0.4, emberBase: 0.14, lightHeight: 6.8, blobW: 3.0, blobD: 5.2,
    });
    this.rig = createSentinelRig();
    this.object3d.add(this.rig.root);
    this.materials = this.rig.materials;
    this.bladeMat = this.rig.emberMat; // Enemy.updateBlade heats it during wind-ups, flashes on release
    this.anim = this.rig.animator;
    this.glowColor.setHex(PALETTE.grace);
    this._trampleT = 0;
  }

  /** The halberd heat: this pipeline's emissive runs hot, so the gold blade is kept to a heated edge, not a lamp. */
  updateBlade(dt) {
    super.updateBlade(dt);
    const m = this.bladeMat;
    if (m && this._bladeLit) m.emissive.multiplyScalar(0.42);
  }

  /** Point the warm torch rim at the nearest brazier (falls back to the moon-opposite side). */
  updateFx(dt) {
    super.updateFx(dt);
    const f = this.dressing ? this.dressing.nearestFire(this.pos.x, this.pos.z) : null;
    if (f) _d.set(f.x - this.pos.x, f.y - this.pos.y - 1.5, f.z - this.pos.z);
    else _d.set(Math.sin(this.yaw + 1.2), 0.35, Math.cos(this.yaw + 1.2));
    this.rig.setWarmDir(_d);
  }

  /** Mid range: lunging chop. Near: sweeps (combo more often in phase 2). Charges are started from update(). */
  pickAttack() {
    const ms = this.moveset, p = this.game.player, dist = p ? this.distanceTo(p) : 0;
    if (dist > 3.2 && this.rng.chance(this.phase > 1 ? 0.65 : 0.5)) { this.comboNext = false; return ms.heavy; }
    this.comboNext = this.rng.chance(this.phase > 1 ? 0.75 : 0.5);
    return ms.light[0];
  }

  update(dt) {
    const p = this.game.player;
    if (this.alive && !this.frozen && this.aggro && p && p.alive && this.state === 'chase' && this.cooldown <= 0) {
      const d = this.distanceTo(p);
      if (d > 6.5 && d < 24 && this.rng.chance(dt * (this.phase > 1 ? 3.0 : 2.0))) this.startAttack(this.moveset.charge);
    }
    super.update(dt);
    if (!this.alive || this.frozen) return;
    const a = this.attack;
    if (a.phase === 'active' && a.def && a.def.charge) { // hoof dust while trampling
      this._trampleT -= dt;
      if (this._trampleT <= 0) { this._trampleT = 0.09; this.game.combat.stepDust(this, 1.4); }
    }
  }
}
