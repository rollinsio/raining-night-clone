/**
 * Nightlord (night 3): "Vaelgrim, Beast of Night" — a tri-headed, golden-maned beast the size of a house
 * (~8 m at the hump, ~13 m reared, ~16 m nose to tail) modelled at full size on the shared RigBuilder /
 * Animator. Silhouette: a massive hunched chest and shoulder hump over a lower, leaner hindquarters, three
 * faceless wolf skulls on their own necks (the centre one wears the great golden mane), long forelegs with
 * clawed paws, digitigrade hind legs, a long bushy tail, an iron collar with two taut chains rising out of
 * frame, three greatswords left embedded in its back, a broken shackle on one foreleg and pale glowing eyes.
 * Slots: 0 fur (flat, double-sided), 1 skulls (smooth), 2 ember (eye slits + mane cores, heats on wind-ups),
 * 3 plate (chains, swords), 4 eyes (constant glow).
 * Phase 2 (55 % hp): the beast rears, ignites — a golden flame aura sheathes its body (FlameAura: billboard
 * tongues anchored to the bones, one additive draw call), embers stream off it, the arena's horizon glow
 * heats and the scorched ground cracks open. The NightlordArena (own realm: ash plain, black sky, red
 * horizon) comes in with it. Attacks: centre-head bite lunge, foreleg swipe (lights), pounce slam (heavy,
 * ring telegraph). Also exports the deterministic `nightlord` screenshot composition.
 */
import * as THREE from 'three';
import { RigBuilder, Animator } from '../Humanoid.js';
import { PALETTE, mixHex, emissive } from '../../render/Style.js';
import { Boss } from './Boss.js';
import { TAU, clamp01, sm, lerp, at, scaled, cyl, sph, box, cone, phase, rough, chainGeo, tuftRing, armourMats, contactShadow } from './BossRig.js';
import { NightlordArena } from './NightlordArena.js';

const E_HIPSY = 0, E_PITCH = 1, E_ROLL = 2;
const HY = 4.3; // hip height (whole-body pivot)
const _d = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color(), _p = new THREE.Vector3();
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const hex = (c) => c.getHex();
const dim = (h, k) => hex(_c.setHex(h).multiplyScalar(k));
const hash = (i, s = 0) => { const t = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return t - Math.floor(t); };

/** Palette-derived tints: dark desaturated fur, gold mane, bone claws, black iron and old steel. */
const C = {
  fur: dim(hex(mixHex(PALETTE.wolfFurDark, PALETTE.leather, 0.45)), 0.9), furDark: dim(hex(mixHex(PALETTE.wolfFurDark, PALETTE.leather, 0.4)), 0.58),
  furLight: dim(hex(mixHex(PALETTE.wolfFur, PALETTE.leather, 0.35)), 1.05), belly: dim(hex(mixHex(PALETTE.wolfFur, PALETTE.stone, 0.45)), 0.95),
  mane: PALETTE.gold, maneDark: hex(mixHex(PALETTE.gold, PALETTE.leather, 0.5)), maneLight: hex(mixHex(PALETTE.gold, PALETTE.spark, 0.4)),
  bone: hex(mixHex(PALETTE.skin, PALETTE.moon, 0.3)), boneDark: hex(mixHex(PALETTE.skinDark, PALETTE.skin, 0.4)),
  iron: dim(PALETTE.iron, 0.8), ironLight: dim(PALETTE.steelDark, 0.85), steel: PALETTE.steel, steelDark: PALETTE.steelDark, brass: hex(mixHex(PALETTE.gold, PALETTE.iron, 0.35)),
  leather: PALETTE.leather, eye: PALETTE.moon, emberDim: dim(PALETTE.gold, 0.35),
};
/** Tints routed to the specular plate slot. */
const PLATE = new Set([C.iron, C.ironLight, C.steel, C.steelDark, C.brass]);

// ------------------------------------------------------------------------------------------------- clips

/** Quadruped stance every clip builds on: braced forelegs, crouched hind legs, heads up, side heads splayed, tail arched. */
function base(P, k = 1) {
  P.set('fShL', -0.08, 0, 0.06); P.set('fShR', -0.08, 0, -0.06); P.set('fElL', 0.06, 0, 0); P.set('fElR', 0.06, 0, 0);
  P.set('hipL', 0, 0, 0.05); P.set('hipR', 0, 0, -0.05);
  P.set('neckBase', -0.1 * k, 0, 0); P.set('neckC', -0.18 * k, 0, 0); P.set('neckC2', 0.08, 0, 0); P.set('headC', 0.2, 0, 0);
  P.set('neckL', -0.02, 0.4, 0.12); P.set('neckL2', 0.12, 0.12, 0); P.set('headL', 0.22, 0.06, -0.05);
  P.set('neckR', -0.02, -0.4, -0.12); P.set('neckR2', 0.12, -0.12, 0); P.set('headR', 0.22, -0.06, 0.05);
  P.set('jawC', 0.14, 0, 0); P.set('jawL', 0.1, 0, 0); P.set('jawR', 0.1, 0, 0);
  P.set('tail1', 0.4, 0, 0); P.set('tail2', 0.22, 0, 0); P.set('tail3', 0.05, 0, 0); P.set('tail4', -0.18, 0, 0); P.set('tail5', -0.22, 0, 0);
}

const CLIPS = {
  idle(t, P) {
    base(P);
    const b = Math.sin(t * 1.1), b2 = Math.sin(t * 0.6 + 1.3), b3 = Math.sin(t * 0.8 + 2.6);
    P.add('chest', 0.02 * b, 0, 0); P.add('neckBase', 0.03 * b, 0.04 * b2, 0);
    P.add('headC', -0.04 * b, 0.18 * b2, 0); P.add('headL', 0.05 * b3, 0.15 * b3, 0); P.add('headR', -0.05 * b2, -0.15 * b, 0);
    P.add('jawC', 0.05 * Math.max(0, b3), 0, 0);
    P.add('tail1', 0, 0.3 * Math.sin(t * 0.9), 0); P.add('tail2', 0, 0.25 * Math.sin(t * 0.9 + 1), 0); P.add('tail3', 0, 0.25 * Math.sin(t * 0.9 + 2), 0); P.add('tail4', 0, 0.2 * Math.sin(t * 0.9 + 3), 0);
    P.extra(E_HIPSY, 0.03 * b);
  },
  /** Gallop (ctx.speed 0..1): fore and hind pairs alternate, the back flexes, heads drive forward, tail streams. */
  run(t, P, ctx) {
    base(P, 1.1);
    const sp = clamp01(ctx.speed), ph = t * TAU * (1.15 + 0.55 * sp), s = Math.sin(ph), c = Math.cos(ph);
    const leg = 0.5 + 0.35 * sp;
    P.add('fShL', -leg * s - 0.15, 0, 0); P.add('fShR', -leg * Math.sin(ph + 0.45) - 0.15, 0, 0);
    P.add('fElL', 0.7 * Math.max(0, -c), 0, 0); P.add('fElR', 0.7 * Math.max(0, -Math.cos(ph + 0.45)), 0, 0);
    P.add('fPawL', 0.3 * Math.max(0, -s), 0, 0); P.add('fPawR', 0.3 * Math.max(0, -Math.sin(ph + 0.45)), 0, 0);
    P.add('hipL', leg * 0.9 * s, 0, 0); P.add('hipR', leg * 0.9 * Math.sin(ph + 0.4), 0, 0);
    P.add('kneeL', 0.5 * Math.max(0, c), 0, 0); P.add('kneeR', 0.5 * Math.max(0, Math.cos(ph + 0.4)), 0, 0);
    P.add('hockL', -0.3 * Math.max(0, s), 0, 0); P.add('hockR', -0.3 * Math.max(0, Math.sin(ph + 0.4)), 0, 0);
    P.add('spine', 0.12 * s, 0, 0); P.add('chest', -0.1 * s, 0, 0.04 * c);
    P.add('neckBase', 0.1 * s - 0.15 * sp, 0, 0); P.add('neckC', 0.08 * s, 0, 0); P.add('headC', -0.05 * s, 0, 0);
    P.add('tail1', -0.3 * sp + 0.15 * s, 0.2 * c, 0); P.add('tail2', 0.1 * Math.sin(ph - 0.8), 0.15 * Math.cos(ph - 0.8), 0); P.add('tail3', 0.1 * Math.sin(ph - 1.6), 0.15 * Math.cos(ph - 1.6), 0);
    P.extra(E_HIPSY, 0.12 * Math.abs(c) * (0.5 + sp) - 0.05); P.extra(E_PITCH, 0.06 * s * sp + 0.04 * sp);
  },
  /** Intro / phase roar: rears onto its hind legs, forelegs clawing at the sky, all three heads thrown back, jaws wide; holds (ctx.param = duration), then drops. */
  roar(t, P, ctx) {
    const dur = ctx.param || 2.6;
    const k = sm(t / 0.75) * (1 - sm((t - dur + 0.8) / 0.75));
    const tr = (Math.sin(t * 31) * 0.02 + Math.sin(t * 17) * 0.015) * k;
    base(P, 1 - k);
    P.extra(E_PITCH, -0.64 * k); P.extra(E_HIPSY, 0.62 * k);
    P.add('hipL', 0.72 * k, 0, 0.1 * k); P.add('hipR', 0.72 * k, 0, -0.1 * k); P.add('kneeL', -0.38 * k, 0, 0); P.add('kneeR', -0.38 * k, 0, 0); P.add('hockL', 0.3 * k, 0, 0); P.add('hockR', 0.3 * k, 0, 0);
    P.add('fShL', -1.5 * k, 0.1 * k, 0.42 * k); P.add('fShR', -1.28 * k, -0.1 * k, -0.5 * k); P.add('fElL', 1.05 * k, 0, 0); P.add('fElR', 0.82 * k, 0, 0); P.add('fPawL', 0.6 * k, 0, 0); P.add('fPawR', 0.55 * k, 0, 0);
    P.add('spine', -0.12 * k, 0, 0); P.add('chest', -0.1 * k, tr, 0);
    P.add('neckBase', -0.18 * k, tr, 0); P.add('neckC', -0.32 * k, 0, tr); P.add('neckC2', -0.22 * k, 0, 0); P.add('headC', -0.18 * k, tr * 2, 0); P.add('jawC', 0.58 * k, 0, 0);
    P.add('neckL', -0.28 * k, 0.38 * k, 0.18 * k); P.add('neckL2', -0.1 * k, 0, 0); P.add('headL', -0.22 * k, 0.12 * k, 0); P.add('jawL', 0.52 * k, 0, 0);
    P.add('neckR', -0.28 * k, -0.38 * k, -0.18 * k); P.add('neckR2', -0.1 * k, 0, 0); P.add('headR', -0.22 * k, -0.12 * k, 0); P.add('jawR', 0.52 * k, 0, 0);
    P.add('tail1', 0.35 * k, 0.3 * Math.sin(t * 3) * k, 0); P.add('tail2', 0.25 * k, 0.25 * Math.sin(t * 3 + 1) * k, 0); P.add('tail3', 0.15 * k, 0.25 * Math.sin(t * 3 + 2) * k, 0); P.add('tail4', 0, 0.2 * Math.sin(t * 3 + 3) * k, 0);
  },
  alert(t, P) {
    base(P);
    const b = Math.sin(t * 2.4);
    P.add('neckBase', 0.15, 0.06 * b, 0); P.add('neckC', 0.1, 0, 0); P.add('headC', -0.05, 0.1 * b, 0);
    P.add('headL', 0, 0.12 * b, 0); P.add('headR', 0, 0.12 * b, 0);
    P.add('fShL', -0.05, 0, 0.05); P.add('fShR', -0.05, 0, -0.05); P.add('hipL', 0.08, 0, 0); P.add('hipR', 0.08, 0, 0); P.add('kneeL', 0.12, 0, 0); P.add('kneeR', 0.12, 0, 0);
    P.add('tail1', -0.1, 0.35 * Math.sin(t * 3.5), 0); P.add('tail2', 0, 0.3 * Math.sin(t * 3.5 + 1), 0); P.add('tail3', 0, 0.3 * Math.sin(t * 3.5 + 2), 0);
    P.extra(E_HIPSY, -0.25); P.extra(E_PITCH, 0.05);
  },
  /** Centre-head bite: the neck coils back, then the whole front lunges and the jaws snap shut. */
  light1(t, P, ctx) {
    const f = phase(t, ctx); let coil, strike, rec;
    if (f.p === 0) { coil = sm(f.k); strike = 0; rec = 0; }
    else if (f.p === 1) { coil = 1 - f.k; strike = Math.pow(f.k, 0.6); rec = 0; }
    else { coil = 0; strike = 1 - sm(f.k); rec = sm(f.k); }
    base(P, 1 - 0.3 * coil);
    P.add('neckBase', -0.32 * coil + 0.35 * strike, 0, 0); P.add('neckC', -0.45 * coil + 0.55 * strike, 0, 0); P.add('neckC2', -0.2 * coil + 0.3 * strike, 0, 0); P.add('headC', 0.1 * coil - 0.2 * strike, 0, 0);
    P.add('jawC', 0.6 * coil + 0.05 * strike, 0, 0);
    P.add('neckL', -0.1 * coil, 0.2 * coil, 0); P.add('neckR', -0.1 * coil, -0.2 * coil, 0); P.add('jawL', 0.3 * coil, 0, 0); P.add('jawR', 0.3 * coil, 0, 0);
    P.add('spine', -0.1 * coil + 0.15 * strike, 0, 0); P.add('chest', -0.12 * coil + 0.12 * strike, 0, 0);
    P.add('fShL', 0.2 * coil - 0.35 * strike, 0, 0); P.add('fShR', 0.2 * coil - 0.35 * strike, 0, 0); P.add('fElL', 0.15 * coil, 0, 0); P.add('fElR', 0.15 * coil, 0, 0);
    P.add('hipL', 0.15 * coil, 0, 0); P.add('hipR', 0.15 * coil, 0, 0); P.add('kneeL', 0.25 * coil, 0, 0); P.add('kneeR', 0.25 * coil, 0, 0);
    P.add('tail1', 0.2 * coil, 0, 0);
    P.extra(E_HIPSY, -0.35 * coil - 0.1 * strike); P.extra(E_PITCH, -0.08 * coil + 0.16 * strike);
    void rec;
  },
  /** Right foreleg swipe: the paw is cocked out wide, then rakes across the front as the body rolls through. */
  light2(t, P, ctx) {
    const f = phase(t, ctx); let cock, sweep, rec;
    if (f.p === 0) { cock = sm(f.k); sweep = 0; rec = 0; }
    else if (f.p === 1) { cock = 1; sweep = Math.pow(f.k, 0.7); rec = 0; }
    else { cock = 1 - sm(f.k); sweep = 1 - sm(f.k); rec = sm(f.k); }
    base(P, 1 - 0.2 * cock);
    P.set('fShR', -1.35 * cock, (0.5 - 1.4 * sweep) * cock, (-0.95 + 1.5 * sweep) * cock); P.set('fElR', 0.55 * cock, 0, 0); P.set('fPawR', 0.45 * cock, 0, 0);
    P.add('fShL', 0.25 * cock, 0, 0.15 * cock); P.add('fElL', 0.1 * cock, 0, 0);
    const tw = (0.35 - 0.8 * sweep) * cock;
    P.add('spine', 0.05 * cock, tw * 0.5, -tw * 0.15); P.add('chest', 0.05 * cock, tw * 0.6, -tw * 0.2); P.add('neckBase', 0, -tw * 0.5, 0); P.add('headC', 0, -tw * 0.4, 0);
    P.add('hipL', 0.1 * cock, 0, 0); P.add('hipR', 0.1 * cock, 0, 0); P.add('kneeL', 0.15 * cock, 0, 0); P.add('kneeR', 0.15 * cock, 0, 0);
    P.add('tail1', 0.2 * cock, -tw * 0.8, 0); P.add('tail2', 0, -tw * 0.6, 0);
    P.extra(E_HIPSY, -0.22 * cock - 0.1 * sweep); P.extra(E_ROLL, tw * 0.12); P.extra(E_PITCH, -0.06 * cock + 0.08 * sweep);
    void rec;
  },
  /** Pounce: crouches low, springs forward and up, crashes down onto its forepaws (ground ring + slam). */
  heavy(t, P, ctx) {
    const f = phase(t, ctx); let crouch, leap, land;
    if (f.p === 0) { crouch = sm(f.k); leap = 0; land = 0; }
    else if (f.p === 1) { crouch = 1 - f.k; leap = Math.sin(f.k * Math.PI); land = Math.pow(f.k, 3); }
    else { crouch = 0; leap = 0; land = 1 - sm(f.k); }
    base(P, 1 - 0.4 * crouch);
    P.add('fShL', 0.35 * crouch - 1.1 * leap + 0.1 * land, 0, 0.12 * leap); P.add('fShR', 0.35 * crouch - 1.1 * leap + 0.1 * land, 0, -0.12 * leap);
    P.add('fElL', 0.5 * crouch + 0.3 * leap - 0.1 * land, 0, 0); P.add('fElR', 0.5 * crouch + 0.3 * leap - 0.1 * land, 0, 0); P.add('fPawL', 0.3 * leap, 0, 0); P.add('fPawR', 0.3 * leap, 0, 0);
    P.add('hipL', 0.35 * crouch + 0.9 * leap - 0.2 * land, 0, 0); P.add('hipR', 0.35 * crouch + 0.9 * leap - 0.2 * land, 0, 0);
    P.add('kneeL', 0.55 * crouch - 0.3 * leap + 0.3 * land, 0, 0); P.add('kneeR', 0.55 * crouch - 0.3 * leap + 0.3 * land, 0, 0); P.add('hockL', -0.2 * crouch, 0, 0); P.add('hockR', -0.2 * crouch, 0, 0);
    P.add('spine', 0.15 * crouch - 0.15 * leap + 0.25 * land, 0, 0); P.add('chest', 0.1 * crouch - 0.1 * leap + 0.2 * land, 0, 0);
    P.add('neckBase', 0.2 * crouch - 0.2 * leap + 0.15 * land, 0, 0); P.add('neckC', 0.15 * crouch - 0.2 * leap, 0, 0); P.add('headC', -0.1 * crouch, 0, 0);
    P.add('jawC', 0.3 * crouch + 0.5 * leap, 0, 0); P.add('jawL', 0.3 * leap, 0, 0); P.add('jawR', 0.3 * leap, 0, 0);
    P.add('neckL', 0, 0.15 * leap, 0); P.add('neckR', 0, -0.15 * leap, 0);
    P.add('tail1', 0.3 * crouch - 0.3 * leap, 0, 0); P.add('tail2', 0.15 * crouch, 0, 0);
    P.extra(E_HIPSY, -0.95 * crouch + 1.6 * leap - 0.85 * land); P.extra(E_PITCH, 0.12 * crouch - 0.35 * leap + 0.18 * land);
  },
  hit(t, P, ctx) {
    base(P);
    const k = 1 - sm(t / (ctx.dur || 0.32));
    P.add('neckBase', -0.12 * k, 0, 0); P.add('neckC', -0.15 * k, 0.1 * k, 0); P.add('headC', -0.1 * k, 0, 0); P.add('jawC', 0.25 * k, 0, 0);
    P.add('headL', -0.1 * k, 0.1 * k, 0); P.add('headR', -0.1 * k, -0.1 * k, 0);
    P.add('chest', -0.06 * k, 0, 0); P.add('fShL', 0.1 * k, 0, 0); P.add('fShR', 0.1 * k, 0, 0);
    P.extra(E_HIPSY, -0.08 * k);
  },
  stagger(t, P, ctx) {
    base(P, 0.7);
    const k = 1 - sm(t / (ctx.dur || 0.9)), w = Math.sin(t * 6.5) * 0.12 * k;
    P.add('spine', -0.15 * k, w, 0); P.add('chest', -0.12 * k, 0, w); P.add('neckBase', -0.3 * k, 0, 0); P.add('neckC', -0.2 * k, w, 0); P.add('headC', -0.25 * k, 0, -w); P.add('jawC', 0.4 * k, 0, 0);
    P.add('neckL', -0.2 * k, 0.2 * k, 0); P.add('neckR', -0.2 * k, -0.2 * k, 0);
    P.add('fShL', -0.3 * k, 0, 0.35 * k); P.add('fShR', -0.3 * k, 0, -0.35 * k); P.add('fElL', 0.3 * k, 0, 0); P.add('fElR', 0.3 * k, 0, 0);
    P.add('hipL', 0.2 * k, 0, 0.12 * k); P.add('hipR', 0.2 * k, 0, -0.12 * k); P.add('kneeL', 0.3 * k, 0, 0); P.add('kneeR', 0.3 * k, 0, 0);
    P.extra(E_HIPSY, -0.3 * k); P.extra(E_PITCH, -0.1 * k); P.extra(E_ROLL, w);
  },
  /** Collapses onto its side: legs fold, the body rolls over, the heads drop, the tail falls. */
  death(t, P) {
    const k = sm(t / 1.3), kk = k * k;
    base(P, 1 - 0.8 * k);
    P.extra(E_ROLL, 1.35 * kk); P.extra(E_HIPSY, -3.35 * kk); P.extra(E_PITCH, 0.12 * kk);
    P.add('fShL', -0.9 * k, 0, 0.5 * k); P.add('fShR', -0.5 * k, 0, -0.9 * k); P.add('fElL', 0.8 * k, 0, 0); P.add('fElR', 1.1 * k, 0, 0);
    P.add('hipL', -0.5 * k, 0, 0.4 * k); P.add('hipR', 0.3 * k, 0, -0.7 * k); P.add('kneeL', 0.6 * k, 0, 0); P.add('kneeR', 0.9 * k, 0, 0);
    P.add('neckBase', 0.35 * k, 0.2 * k, 0); P.add('neckC', 0.3 * k, 0, 0.3 * k); P.add('headC', 0.1 * k, 0, 0); P.add('jawC', 0.35 * k, 0, 0);
    P.add('neckL', 0.3 * k, 0.3 * k, 0); P.add('neckR', 0.3 * k, -0.2 * k, 0);
    P.add('tail1', -0.6 * k, 0.5 * k, 0); P.add('tail2', -0.3 * k, 0.2 * k, 0); P.add('tail3', -0.2 * k, 0, 0);
  },
};
CLIPS.guard = CLIPS.alert;

// ------------------------------------------------------------------------------------------------- rig

/** Tapered tube from a to b (radius r0 at a, r1 at b). */
function tube(a, b, r0, r1, seg = 8) {
  _d.subVectors(b, a); const len = _d.length(); _d.normalize();
  const g = chainGeo([{ len, r0, r1, dir: _d.clone() }], seg);
  g.translate(a.x, a.y, a.z);
  return g;
}
/** Vertical gradient shade: lo at y0 → hi at y1. */
const sf = (y0, y1, lo, hi) => (x, y) => lerp(lo, hi, sm((y - y0) / (y1 - y0)));
/** Per-tuft value jitter (every vertex of a tuft shares its bearing from the ring centre). */
const tuftShade = (cx, cz, lo, hi, seed = 0) => (x, y, z) => lerp(lo, hi, hash(Math.round(Math.atan2(x - cx, z - cz) * 6), seed));

/** Chain of torus links along dir from p (alternating link planes). */
function chainLinks(p, dir, n, spacing, r, tubeR, seed = 0) {
  const parts = [], q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(r, tubeR, 3, 7);
    if (i % 2) g.rotateY(Math.PI / 2);
    g.rotateY((hash(i, seed) - 0.5) * 0.2);
    g.applyQuaternion(q);
    g.translate(p.x + dir.x * i * spacing, p.y + dir.y * i * spacing, p.z + dir.z * i * spacing);
    parts.push(g.toNonIndexed());
  }
  return parts;
}

/** Greatsword: diamond-section tapered blade, crossguard, wrapped grip, pommel. Origin at the guard, blade up +Y. */
function swordParts(part, bone, len, w, m, seed) {
  const blade = cyl(0.035, w * 0.5, len, 4); blade.scale(1, 1, 0.28); blade.translate(0, len / 2 + 0.22, 0);
  const fuller = box(0.05, len * 0.55, w * 0.3); fuller.translate(0, len * 0.42, 0);
  const guard = box(w * 2.7, 0.13, 0.2); guard.translate(0, 0.2, 0);
  const grip = cyl(0.075, 0.085, 0.62, 6); grip.translate(0, -0.18, 0);
  const pommel = sph(0.13, 6, 5); pommel.translate(0, -0.55, 0);
  for (const g of [blade, fuller, guard, grip, pommel]) { g.applyMatrix4(m); }
  part(rough(blade, 0.012, seed), bone, C.steel, 1.0, { shadeFn: (x, y) => 0.92 + 0.16 * hash(Math.round(y * 3), seed) });
  part(fuller, bone, C.steelDark, 0.9);
  part(guard, bone, C.brass, 1.0); part(pommel, bone, C.brass, 0.95);
  part(grip, bone, C.leather, 0.8);
}

/**
 * Build the beast rig. Returns { root, mesh, bones, animator, materials:[fur, skull, plate], emberMat,
 * mats (the armour set for warm-rim control), anchors (flame aura anchors), shadow, update(dt) }.
 */
export function createNightlordRig() {
  const rb = new RigBuilder();
  rb.parts.push([], [], []); // slots 2 ember, 3 plate, 4 eyes
  const hips = rb.bone('hips', null, 0, HY, 0);
  const spine = rb.bone('spine', hips, 0, 0.45, 1.4);
  const chest = rb.bone('chest', spine, 0, 0.75, 1.6);
  const neckBase = rb.bone('neckBase', chest, 0, 0.55, 1.1);
  const nC = rb.bone('neckC', neckBase, 0, 0.35, 0.7); const nC2 = rb.bone('neckC2', nC, 0, 0.3, 0.95); const hC = rb.bone('headC', nC2, 0, 0.25, 0.8); rb.bone('jawC', hC, 0, -0.22, 0.3);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const n1 = rb.bone('neck' + side, neckBase, s * 0.95, 0.05, 0.5); const n2 = rb.bone('neck' + side + '2', n1, s * 0.5, 0.12, 0.85); const h = rb.bone('head' + side, n2, s * 0.32, 0.1, 0.72); rb.bone('jaw' + side, h, 0, -0.2, 0.28);
    const sh = rb.bone('fSh' + side, chest, s * 1.45, -0.15, 0.55); const el = rb.bone('fEl' + side, sh, 0, -2.1, 0.15); rb.bone('fPaw' + side, el, 0, -2.2, -0.05);
    const hp = rb.bone('hip' + side, hips, s * 1.15, -0.15, -0.75); const kn = rb.bone('knee' + side, hp, 0, -1.7, 0.8); rb.bone('hock' + side, kn, 0, -1.45, -0.85);
  }
  const t1 = rb.bone('tail1', hips, 0, 0.45, -1.7); const t2 = rb.bone('tail2', t1, 0, 0.55, -1.5); const t3 = rb.bone('tail3', t2, 0, 0.6, -1.4); const t4 = rb.bone('tail4', t3, 0, 0.45, -1.3); rb.bone('tail5', t4, 0, 0.25, -1.2);
  void spine; void chest; void neckBase;
  const p = (n) => rb.pos(n);
  const part = (geo, bone, color, shade = 1, o = null, mat = 0) => rb.part(geo, bone, color, mat === 0 && PLATE.has(color) ? 3 : mat, shade, o);
  const plate = []; // chain links etc. collected then pushed as one part each (kept separate for clarity)

  // ---- hindquarters: pelvis mass, belly, hanging fur, spine ridge toward the tail
  const hp0 = p('hips');
  part(at(rough(scaled(sph(1.45, 9, 7), 1.3, 1.0, 1.3), 0.07, 2), 0, hp0.y + 0.1, -0.35), 'hips', C.fur, 1.0, { shadeFn: sf(hp0.y - 1.2, hp0.y + 1.2, 0.7, 1.05) });
  part(tuftRing(0, hp0.y - 0.6, -0.3, 1.35, 12, 1.1, 0.22, -1.25, 3), 'hips', C.furDark, 0.9); // belly fringe hanging down
  // ---- torso: rising from the pelvis to the chest, lighter belly underneath
  const sp0 = p('spine'), ch0 = p('chest');
  part(rough(tube(v3(0, hp0.y + 0.2, -0.2), v3(0, ch0.y + 0.15, 0.4), 1.35, 1.75, 9), 0.06, 3), 'spine', C.fur, 1.0,
    { blend: { bone: 'chest', y: ch0.y - 0.3, width: 1.0 }, shadeFn: (x, y) => lerp(0.72, 1.05, sm((y - sp0.y + 1.4) / 2.4)) });
  part(at(rough(scaled(sph(1.05, 8, 6), 1.15, 0.7, 1.3), 0.05, 4), 0, sp0.y - 0.75, 0.5), 'spine', C.belly, 0.9, { shadeFn: sf(sp0.y - 1.5, sp0.y, 0.78, 1.0) });
  // ---- chest + shoulder hump: the mass of the silhouette
  part(at(rough(scaled(sph(2.05, 11, 8), 1.15, 0.95, 1.0), 0.08, 5), 0, ch0.y + 0.35, 0.25), 'chest', C.fur, 1.02, { shadeFn: sf(ch0.y - 1.8, ch0.y + 2.0, 0.72, 1.08) });
  part(at(rough(scaled(sph(1.55, 10, 7), 1.4, 0.85, 1.2), 0.09, 6), 0, ch0.y + 1.25, -0.5), 'chest', C.fur, 0.98, { shadeFn: sf(ch0.y, ch0.y + 2.6, 0.8, 1.1) });
  part(at(rough(scaled(sph(1.05, 8, 6), 1.1, 0.75, 1.1), 0.05, 7), 0, ch0.y - 1.1, 0.9), 'chest', C.belly, 0.92, { shadeFn: sf(ch0.y - 2, ch0.y - 0.5, 0.75, 1.0) }); // chest underside
  for (let i = 0; i < 9; i++) { // spine ridge of fur spikes from the hump back to the tail
    const k = i / 8, g = cone(0.2 - 0.08 * k, 0.95 - 0.35 * k, 4); g.rotateX(-0.55 - 0.5 * k);
    part(at(g, (i % 2) * 0.12 - 0.06, lerp(ch0.y + 2.45, hp0.y + 1.35, k), lerp(-0.7, -1.7, k)), i < 4 ? 'chest' : i < 6 ? 'spine' : 'hips', C.furDark, 0.9);
  }
  // golden mane: three rings round the neck base, a crest over the hump and tufts spilling down the chest
  const nb0 = p('neckBase');
  part(tuftRing(0, nb0.y - 0.1, nb0.z - 0.2, 1.55, 17, 2.5, 0.34, 0.62, 1), 'neckBase', C.mane, 1.0, { shadeFn: tuftShade(0, nb0.z - 0.2, 0.78, 1.12, 1) });
  part(tuftRing(0, nb0.y + 0.15, nb0.z - 0.1, 1.2, 13, 2.0, 0.28, 0.42, 2.2), 'neckBase', C.maneLight, 0.95, { shadeFn: tuftShade(0, nb0.z - 0.1, 0.8, 1.1, 2) });
  part(tuftRing(0, nb0.y + 0.35, nb0.z + 0.1, 0.85, 10, 1.5, 0.22, 0.25, 0.7), 'neckBase', C.mane, 0.9, { shadeFn: tuftShade(0, nb0.z + 0.1, 0.8, 1.08, 3) });
  part(tuftRing(0, ch0.y + 2.2, -0.4, 1.05, 12, 2.2, 0.3, 0.2, 1.9), 'chest', C.maneDark, 0.95, { shadeFn: tuftShade(0, -0.4, 0.8, 1.1, 4) }); // crest over the hump
  for (let i = 0; i < 9; i++) { // mane spilling down the front of the chest
    const a = (i / 9 - 0.5) * 2.4, g = cone(0.26, 1.9 - 0.4 * Math.abs(a), 4); g.rotateX(Math.PI * 0.68); g.rotateY(a * 0.6);
    part(at(g, Math.sin(a) * 1.9, ch0.y + 0.9 - Math.abs(a) * 0.3, Math.cos(a) * 1.9 + 0.3), 'chest', i % 3 ? C.mane : C.maneDark, 0.85 + 0.25 * hash(i, 9));
  }
  for (const s of [1, -1]) { const g = box(0.12, 1.1, 0.14); g.rotateZ(s * 0.5); g.rotateX(-0.4); part(at(g, s * 0.5, ch0.y + 1.3, 1.65), 'chest', C.emberDim, 1.0, null, 2); } // ember seams in the mane roots

  // ---- iron collar and the two chains rising out of frame; a broken shackle on the right foreleg
  { const col = new THREE.TorusGeometry(1.15, 0.15, 4, 12); col.rotateX(Math.PI / 2 - 0.45); part(at(col, 0, nb0.y + 0.25, nb0.z + 0.2), 'neckBase', C.iron, 1.0); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const g = cone(0.08, 0.34, 4); g.rotateX(Math.PI / 2); g.rotateY(a); g.rotateX(-0.45); part(at(g, Math.sin(a) * 1.28, nb0.y + 0.25 + Math.cos(a) * 0.55, nb0.z + 0.2 + Math.cos(a) * 1.2), 'neckBase', C.ironLight, 0.9); }
  for (const s of [1, -1]) {
    const ring = new THREE.TorusGeometry(0.26, 0.06, 3, 8); ring.rotateX(Math.PI / 2); part(at(ring, s * 0.95, nb0.y + 0.75, nb0.z + 0.05), 'neckBase', C.ironLight, 0.95);
    const dir = v3(s * 0.2, 1, -0.12).normalize();
    for (const g of chainLinks(v3(s * 0.95, nb0.y + 0.95, nb0.z + 0.05), dir, 44, 0.42, 0.2, 0.045, s + 3)) part(g, 'neckBase', C.iron, 1.0, { shadeFn: (x, y) => 0.85 + 0.3 * hash(Math.round(y * 2), 5) });
  }
  {
    const el = p('fElR'), cuff = new THREE.TorusGeometry(0.62, 0.11, 4, 9); cuff.rotateX(Math.PI / 2); part(at(cuff, el.x, el.y - 1.35, el.z), 'fElR', C.iron, 1.0);
    for (const g of chainLinks(v3(el.x - 0.6, el.y - 1.45, el.z + 0.1), v3(-0.15, -1, 0.08).normalize(), 6, 0.36, 0.17, 0.04, 9)) part(g, 'fElR', C.ironLight, 0.95);
  }
  // ---- greatswords embedded in the back
  {
    const m = new THREE.Matrix4(), e = new THREE.Euler();
    m.makeRotationFromEuler(e.set(-0.3, 0, 0.62)); m.setPosition(-1.1, ch0.y + 1.7, -0.6); swordParts(part, 'chest', 3.6, 0.34, m, 1);
    m.makeRotationFromEuler(e.set(0.42, 0.3, -0.78)); m.setPosition(1.25, ch0.y + 1.55, 0.2); swordParts(part, 'chest', 3.2, 0.3, m, 2);
    m.makeRotationFromEuler(e.set(0.95, 0.1, -0.2)); m.setPosition(0.45, sp0.y + 1.25, -0.4); swordParts(part, 'spine', 2.9, 0.28, m, 3);
  }

  // ---- necks and skulls (centre head larger, side heads leaner)
  const head = (side, scale, maned) => {
    const s = side === 'C' ? 0 : side === 'L' ? 1 : -1;
    const n1 = 'neck' + side, n2 = 'neck' + side + '2', hb = 'head' + side, jb = 'jaw' + side;
    const a = p(n1), b = p(n2), c = p(hb), j = p(jb);
    part(rough(tube(a, b, 0.78 * scale, 0.64 * scale, 8), 0.04, 11 + s), n1, C.fur, 0.98, { blend: { bone: n2, y: b.y, width: 0.5 }, shadeFn: sf(a.y - 0.9, a.y + 0.9, 0.78, 1.05) });
    part(rough(tube(b, c, 0.62 * scale, 0.5 * scale, 8), 0.04, 14 + s), n2, C.fur, 1.0, { blend: { bone: hb, y: c.y, width: 0.4 } });
    if (maned) { part(tuftRing(b.x, b.y, b.z, 0.7 * scale, 9, 1.3 * scale, 0.2, 0.3, 4 + s), n2, C.mane, 0.92, { shadeFn: tuftShade(b.x, b.z, 0.8, 1.1, 6) }); }
    else part(tuftRing(b.x, b.y + 0.1, b.z, 0.6 * scale, 7, 0.9 * scale, 0.16, 0.4, 4 + s), n2, C.furDark, 0.9);
    // skull: smooth faceless wedge, heavy brow, long muzzle, ears
    part(at(scaled(sph(0.66 * scale, 11, 8), 1.0, 0.86, 1.15), c.x, c.y + 0.1, c.z + 0.1), hb, C.fur, 1.04, { shadeFn: sf(c.y - 0.5, c.y + 0.6, 0.82, 1.06) }, 1);
    part(tube(v3(c.x, c.y - 0.02, c.z + 0.45), v3(c.x, c.y - 0.14, c.z + 1.3 * scale), 0.46 * scale, 0.3 * scale, 8), hb, C.fur, 1.0, { shadeFn: sf(c.y - 0.5, c.y + 0.3, 0.82, 1.04) }, 1);
    part(at(box(0.95 * scale, 0.2, 0.55), c.x, c.y + 0.42 * scale, c.z + 0.35), hb, C.furDark, 0.9);
    for (const e of [1, -1]) { const g = cone(0.15 * scale, 0.6 * scale, 4); g.rotateX(-0.6); g.rotateZ(e * 0.35); part(at(g, c.x + e * 0.4 * scale, c.y + 0.58 * scale, c.z - 0.15), hb, C.furDark, 0.95); }
    // upper fangs, lower jaw with teeth
    for (const e of [1, -1]) { const g = cone(0.06, 0.36 * scale, 4); g.rotateX(Math.PI); part(at(g, c.x + e * 0.26 * scale, c.y - 0.38, c.z + 1.0 * scale), hb, C.bone, 1.0); }
    part(at(box(0.56 * scale, 0.2, 1.05 * scale), j.x, j.y - 0.06, j.z + 0.45 * scale), jb, C.furDark, 0.9);
    for (let i = 0; i < 4; i++) { const g = cone(0.05, 0.24, 4); part(at(g, j.x + (i - 1.5) * 0.13 * scale, j.y + 0.12, j.z + 0.85 * scale), jb, C.bone, 0.95); }
    // eyes: pale slits that always glow
    for (const e of [1, -1]) part(at(box(0.19 * scale, 0.06, 0.1), c.x + e * 0.25 * scale, c.y + 0.16, c.z + 0.66 * scale), hb, C.eye, 1.0, null, 4);
  };
  head('C', 1.15, true); head('L', 0.95, false); head('R', 0.95, false);

  // ---- forelegs: heavy shoulders, long upper arm with elbow feathering, forearm, clawed paw
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, sh = p('fSh' + side), el = p('fEl' + side), pw = p('fPaw' + side);
    const sb = 'fSh' + side, eb = 'fEl' + side, pb = 'fPaw' + side;
    part(at(rough(scaled(sph(1.0, 8, 6), 1.0, 1.15, 1.0), 0.05, 20 + s), sh.x + s * 0.15, sh.y + 0.25, sh.z), sb, C.fur, 1.04, { shadeFn: sf(sh.y - 0.8, sh.y + 1.0, 0.8, 1.08) });
    part(rough(tube(sh, el, 0.78, 0.56, 8), 0.04, 22 + s), sb, C.fur, 1.0, { blend: { bone: eb, y: el.y, width: 0.5 }, shadeFn: sf(el.y, sh.y, 0.82, 1.0) });
    part(tuftRing(el.x, el.y + 0.2, el.z, 0.5, 7, 1.1, 0.17, -1.1, 7 + s), eb, C.furDark, 0.88);
    part(rough(tube(el, v3(pw.x, pw.y + 0.1, pw.z), 0.56, 0.44, 8), 0.03, 24 + s), eb, C.fur, 1.02, { blend: { bone: pb, y: pw.y + 0.2, width: 0.4 }, shadeFn: sf(pw.y, el.y, 0.8, 1.0) });
    part(at(rough(box(1.05, 0.7, 1.35), 0.03, 26 + s), pw.x, pw.y - 0.6, pw.z + 0.35), pb, C.furDark, 0.95, { shadeFn: sf(pw.y - 1.0, pw.y, 0.75, 1.0) });
    part(at(cyl(0.44, 0.5, 0.6, 7), pw.x, pw.y - 0.2, pw.z), pb, C.fur, 0.95);
    for (let i = 0; i < 4; i++) { const g = cone(0.1, 0.55, 4); g.rotateX(1.3); part(at(g, pw.x + (i - 1.5) * 0.27, pw.y - 0.78, pw.z + 1.05), pb, C.bone, 0.95 + 0.1 * (i % 2)); }
  }
  // ---- hind legs: thigh, stifle, shin, hock, paw
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, hp = p('hip' + side), kn = p('knee' + side), hk = p('hock' + side);
    const hb = 'hip' + side, kb = 'knee' + side, ab = 'hock' + side;
    part(at(rough(scaled(sph(1.0, 8, 6), 0.85, 1.25, 1.15), 0.05, 30 + s), hp.x + s * 0.05, hp.y - 0.55, hp.z + 0.25), hb, C.fur, 0.98, { shadeFn: sf(hp.y - 1.8, hp.y + 0.5, 0.74, 1.02) });
    part(rough(tube(v3(hp.x, hp.y - 0.3, hp.z), kn, 0.7, 0.48, 8), 0.04, 32 + s), hb, C.fur, 0.96, { blend: { bone: kb, y: kn.y, width: 0.45 } });
    part(rough(tube(kn, hk, 0.48, 0.32, 7), 0.03, 34 + s), kb, C.fur, 0.98, { blend: { bone: ab, y: hk.y + 0.1, width: 0.35 }, shadeFn: sf(hk.y, kn.y, 0.78, 1.0) });
    part(tuftRing(kn.x, kn.y - 0.2, kn.z - 0.2, 0.4, 6, 0.9, 0.14, -1.2, 12 + s), kb, C.furDark, 0.88);
    part(at(rough(box(0.85, 0.55, 1.25), 0.03, 36 + s), hk.x, hk.y - 0.72, hk.z + 0.45), ab, C.furDark, 0.95, { shadeFn: sf(hk.y - 1.0, hk.y, 0.75, 1.0) });
    part(at(cyl(0.3, 0.36, 0.7, 6), hk.x, hk.y - 0.35, hk.z + 0.1), ab, C.fur, 0.95);
    for (let i = 0; i < 3; i++) { const g = cone(0.09, 0.48, 4); g.rotateX(1.3); part(at(g, hk.x + (i - 1) * 0.28, hk.y - 0.9, hk.z + 1.1), ab, C.bone, 0.95); }
  }
  // ---- tail: five tapering segments with fur, a big tuft at the tip
  const TAILS = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
  for (let i = 0; i < TAILS.length; i++) {
    const a = p(TAILS[i]), b = i < 4 ? p(TAILS[i + 1]) : v3(a.x, a.y + 0.1, a.z - 1.3);
    const r0 = 0.46 - i * 0.07, r1 = 0.4 - i * 0.07;
    part(rough(tube(a, b, r0, Math.max(0.12, r1), 6), 0.04, 40 + i), TAILS[i], i % 2 ? C.furDark : C.fur, 0.95, i < 4 ? { blend: { bone: TAILS[i + 1], y: b.y, width: 0.3 } } : null);
    part(tuftRing(a.x, a.y, a.z, 0.32 - i * 0.03, 7, 1.3 - i * 0.08, 0.16, -1.35 + i * 0.1, 15 + i), TAILS[i], C.furDark, 0.9, { shadeFn: tuftShade(a.x, a.z, 0.8, 1.05, 20 + i) });
  }
  { const a = p('tail5'); part(tuftRing(a.x, a.y + 0.2, a.z - 1.0, 0.22, 9, 1.7, 0.2, -1.05, 19), 'tail5', C.fur, 0.95, { shadeFn: tuftShade(a.x, a.z - 1.0, 0.8, 1.05, 31) }); }

  const mats = armourMats({ warm: 1.3 }), [fur, skull, emberMat, plateMat] = mats;
  fur.roughness = 0.94; skull.roughness = 0.88;
  const eyeMat = emissive(PALETTE.moon, 1.6, { vertexColors: true });
  const rig = rb.build([fur, skull, emberMat, plateMat, eyeMat], { ao: { strength: 0.55, radius: 0.95, gain: 1.1, groundY: 0, groundH: 1.4, groundK: 0.3 } });
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = HY; rig.mesh.position.y = -HY; pivot.add(rig.mesh); root.add(pivot);
  const shadow = contactShadow(7.5); shadow.scale.z *= 1.35; root.add(shadow);
  const animator = new Animator(rig, CLIPS, pivot);
  // flame anchors: points on the body surface, each remembered relative to its bone so the aura follows the pose
  const anchors = [];
  const cloud = (bone, cx, cy, cz, r, n, size, seed, kind = 0) => {
    const o = p(bone);
    for (let i = 0; i < n; i++) {
      const u = hash(i, seed) * TAU, w = hash(i, seed + 1) * 2 - 1, rr = r * (0.75 + 0.35 * hash(i, seed + 2));
      const sq = Math.sqrt(1 - w * w);
      anchors.push({ bone: rig.bones[bone], off: v3(cx + Math.cos(u) * sq * rr - o.x, cy + w * rr * 0.85 - o.y, cz + Math.sin(u) * sq * rr - o.z), size: size * (0.75 + 0.5 * hash(i, seed + 3)), seed: hash(i, seed + 4), kind });
    }
  };
  cloud('chest', 0, ch0.y + 0.6, 0.1, 2.4, 30, 2.0, 1); cloud('chest', 0, ch0.y + 1.8, -0.5, 1.9, 16, 2.2, 2);
  cloud('neckBase', 0, nb0.y + 0.2, nb0.z, 1.7, 16, 1.7, 3);
  cloud('headC', p('headC').x, p('headC').y, p('headC').z + 0.4, 0.9, 8, 1.1, 4); cloud('headL', p('headL').x, p('headL').y, p('headL').z + 0.3, 0.75, 6, 1.0, 5); cloud('headR', p('headR').x, p('headR').y, p('headR').z + 0.3, 0.75, 6, 1.0, 6);
  for (const s of ['L', 'R']) { cloud('fSh' + s, p('fSh' + s).x, p('fSh' + s).y - 0.6, p('fSh' + s).z, 1.0, 8, 1.3, 7); cloud('fEl' + s, p('fEl' + s).x, p('fEl' + s).y - 1.0, p('fEl' + s).z, 0.7, 6, 1.0, 8); cloud('hip' + s, p('hip' + s).x, p('hip' + s).y - 0.6, p('hip' + s).z + 0.2, 1.1, 8, 1.3, 9); }
  cloud('hips', 0, hp0.y + 0.3, -0.4, 1.7, 14, 1.7, 10); cloud('spine', 0, sp0.y + 0.5, 0.2, 1.6, 10, 1.6, 11);
  cloud('tail1', p('tail1').x, p('tail1').y + 0.3, p('tail1').z - 0.7, 0.7, 6, 1.0, 12); cloud('tail3', p('tail3').x, p('tail3').y + 0.3, p('tail3').z - 0.7, 0.6, 6, 0.9, 13);
  cloud('chest', 0, ch0.y + 0.9, 0, 1.2, 6, 5.5, 14, 1); // wide soft halos
  return { root, mesh: rig.mesh, bones: rig.bones, animator, materials: [fur, skull, plateMat], emberMat, mats, anchors, shadow, update(dt) { animator.update(dt); } };
}

// ------------------------------------------------------------------------------------------------- flame aura

const AURA_VERT = `
  attribute vec2 corner; attribute float seed; attribute float size; attribute float kind;
  uniform float uTime; uniform float uStrength;
  varying vec2 vUv; varying float vA; varying float vK; varying float vSeed; varying float vKind;
  void main(){
    float sp = 0.5 + 0.55 * fract(seed * 7.31);
    float k = fract(uTime * sp * 0.75 + seed);
    float sway = sin(uTime * 2.3 + seed * 20.0) * 0.28 + sin(uTime * 4.1 + seed * 9.0) * 0.14;
    float rise = mix(2.2, 0.6, kind);
    vec3 p = position + vec3(sway * (0.3 + k), k * rise * (0.6 + 0.6 * fract(seed * 3.7)), sway * 0.5 * k);
    float flick = 1.0 + 0.22 * sin(uTime * 9.0 + seed * 30.0);
    float s = size * flick * (1.0 - 0.5 * k * k) * (0.3 + 0.7 * smoothstep(0.0, 0.12, k));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += corner * s * mix(vec2(0.55, 1.0), vec2(1.0, 1.0), kind) + vec2(0.0, s * 0.45 * (1.0 - kind));
    gl_Position = projectionMatrix * mv;
    vUv = corner; vK = k; vSeed = seed; vKind = kind;
    vA = uStrength * sin(k * 3.14159) * mix(1.0, 0.16, kind);
  }`;
const AURA_FRAG = `
  uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC; uniform float uTime;
  varying vec2 vUv; varying float vA; varying float vK; varying float vSeed; varying float vKind;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){
    vec2 q = vUv;
    if (vKind > 0.5) { float d = length(q); float a = pow(max(1.0 - d, 0.0), 2.4); gl_FragColor = vec4(uColB * a * vA, 1.0); return; }
    float w = mix(1.0, 0.22, smoothstep(-0.4, 1.0, q.y));
    float d = length(vec2(q.x / w, (q.y + 0.2) * 0.8));
    float n = vn(q * 3.2 + vec2(vSeed * 50.0, -uTime * 3.5 + vSeed * 10.0)) * 0.6 + vn(q * 7.0 + vec2(vSeed * 20.0, -uTime * 6.0)) * 0.4;
    d += (n - 0.5) * 0.7;
    float a = smoothstep(1.0, 0.3, d);
    float core = smoothstep(0.55, 0.0, d);
    vec3 col = mix(uColB, uColA, core);
    col = mix(col, uColC, smoothstep(0.25, 1.0, vK) * 0.65);
    gl_FragColor = vec4(col * a * vA * (1.0 + core * 0.9), 1.0);
  }`;

/** Golden flame sheath: one additive draw call of billboard tongues anchored to the beast's bones. */
class FlameAura {
  constructor(rig) {
    this.anchors = rig.anchors; const n = this.anchors.length;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 4 * 3);
    const corner = new Float32Array(n * 4 * 2), seed = new Float32Array(n * 4), size = new Float32Array(n * 4), kind = new Float32Array(n * 4), index = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      const a = this.anchors[i];
      for (let v = 0; v < 4; v++) { seed[i * 4 + v] = a.seed; size[i * 4 + v] = a.size; kind[i * 4 + v] = a.kind; }
      const b = i * 4; index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.uniforms = {
      uTime: { value: 0 }, uStrength: { value: 0 },
      uColA: { value: new THREE.Color(PALETTE.graceGlow).multiplyScalar(1.6) }, uColB: { value: new THREE.Color(PALETTE.torch).multiplyScalar(1.1) }, uColC: { value: new THREE.Color(PALETTE.ember).multiplyScalar(0.55) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: AURA_VERT, fragmentShader: AURA_FRAG, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 9; this.mesh.visible = false;
    this.time = 0;
  }

  /** Move every tongue to its bone (world space) and advance the clock. strength 0 hides the sheath. */
  update(dt, strength) {
    this.time += dt;
    this.uniforms.uTime.value = this.time; this.uniforms.uStrength.value = strength;
    this.mesh.visible = strength > 0.004;
    if (!this.mesh.visible) return;
    const pos = this.pos, A = this.anchors;
    for (let i = 0; i < A.length; i++) {
      const a = A[i]; _v.copy(a.off).applyMatrix4(a.bone.matrixWorld);
      for (let v = 0; v < 4; v++) { const o = (i * 4 + v) * 3; pos[o] = _v.x; pos[o + 1] = _v.y; pos[o + 2] = _v.z; }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  /** World position of anchor i into out (for ember spawns). */
  at(i, out) { const o = i * 12; return out.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]); }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ------------------------------------------------------------------------------------------------- entity

/** Reach / step are divided by the logical scale (Combat multiplies them back). */
const S = 3.0;
const NIGHTLORD_WEAPON = { name: 'Fangs and Claws', visual: 'none', dmg: 46, reach: 5.4 / S, moveset: 'nightlord', poiseDmg: 60, staminaMul: 1, rarity: 'legendary' };
const NIGHTLORD_MOVESET = {
  light: [
    { clip: 'light1', windup: 0.75, active: 0.2, recover: 0.9, motion: 1.0, arcFrom: -45, arcTo: 45, stamina: 0, knock: 7, step: 2.6 / S },
    { clip: 'light2', windup: 0.6, active: 0.22, recover: 1.0, motion: 1.15, arcFrom: -125, arcTo: 100, stamina: 0, knock: 8.5, step: 1.8 / S },
  ],
  heavy: { clip: 'heavy', windup: 1.15, active: 0.34, recover: 1.35, motion: 2.5, arcFrom: -65, arcTo: 65, stamina: 0, knock: 14, step: 7.5 / S, poiseMul: 3, ring: { radius: 5.6, ahead: 5.8 }, slam: true },
};

export class Nightlord extends Boss {
  /** o: { x, z, arena, seed, name?, hp?, dmg?, runes?, subtitle? } */
  constructor(game, o) {
    // the field-boss dressing (paving, columns, braziers) is not built here: the Nightlord brings its own realm
    super(game, {
      name: o.name || 'Vaelgrim, Beast of Night', subtitle: o.subtitle || 'NIGHTLORD', x: o.x, z: o.z, arena: null, seed: o.seed ?? 23,
      hp: o.hp ?? 3000, poise: 460, radius: 2.3 / S, height: 8.0, runes: o.runes ?? 9000,
      walk: 3.0, run: 7.5, dmg: o.dmg ?? 1.3, logicalScale: S,
      weapon: NIGHTLORD_WEAPON, moveset: NIGHTLORD_MOVESET, attackRange: 5.6, introDur: 3.2, phaseAt: 0.55,
      glowScale: 0.05, heatScale: 2.4, ringAlpha: 0.45, emberBase: 0, lightHeight: 4.6, blobW: 5.5, blobD: 7.5,
    });
    this.arena = o.arena || null;
    if (this.arena) { this.home.set(this.arena.x, 0, this.arena.z); this.yaw = Math.atan2(this.arena.x - o.x, this.arena.z - o.z); }
    this.rig = createNightlordRig();
    this.object3d.add(this.rig.root);
    this.materials = this.rig.materials;
    this.bladeMat = this.rig.emberMat; // Enemy.updateBlade heats it during wind-ups, flashes on release
    this.anim = this.rig.animator;
    this.glowColor.setHex(PALETTE.grace);
    this.aura = new FlameAura(this.rig);
    game.scene.add(this.aura.mesh);
    this.auraK = 0; this.auraTarget = 0; this._emberAcc = 0;
    this._warm = this.rig.mats.map((m) => (m.userData.u ? m.userData.u.uWarm.value : 0));
    this.realm = this.arena ? NightlordArena.get(game, this.arena) : null;
    if (this.realm) this.realm.enter();
  }

  beginRoar(dur) { super.beginRoar(dur); this.anim.ctx.param = dur; }

  /** Phase 2: the beast rears and ignites; the realm heats with it. */
  enterPhase(n) {
    super.enterPhase(n);
    this.emberBase = 0.9; this.auraTarget = 1;
    this.beginRoar(2.8);
    if (this.realm) this.realm.setPhase(n);
    this.game.cameraCtl.addShake(0.6);
  }

  /** Far: pounce. Near: bite / swipe, combos more in phase 2. */
  pickAttack() {
    const p = this.game.player, dist = p ? this.distanceTo(p) : 0;
    const ms = this.moveset, far = dist > 5.5;
    if (this.rng.chance((far ? 0.65 : 0.22) + (this.phase > 1 ? 0.12 : 0))) { this.comboNext = false; return ms.heavy; }
    this.comboNext = this.rng.chance(this.phase > 1 ? 0.75 : 0.45);
    return ms.light[this.rng.chance(0.6) ? 0 : 1];
  }

  update(dt) {
    super.update(dt);
    if (this.frozen) return;
    this.updateAura(dt);
  }

  /** Aura strength eases toward its phase target, flares on wind-ups and the roar; embers stream off the body in phase 2. */
  updateAura(dt) {
    const tgt = this.alive ? this.auraTarget : 0;
    this.auraK += (tgt - this.auraK) * (1 - Math.exp(-(tgt ? 1.6 : 0.9) * dt));
    const flare = this.telegraph * 0.5 + (this.state === 'intro' && this.phase > 1 ? 0.35 : 0);
    const strength = this.auraK * (0.85 + 0.15 * Math.sin(this.stateT * 5.3)) * (1 + flare);
    this.object3d.updateMatrixWorld(true);
    this.aura.update(dt, strength);
    for (let i = 0; i < this.rig.mats.length; i++) { const u = this.rig.mats[i].userData.u; if (u) u.uWarm.value = this._warm[i] * (0.15 + 0.85 * this.auraK); }
    if (strength > 0.2 && dt > 0) {
      this._emberAcc += dt * 38 * strength;
      const c = this.game.combat, n = this.aura.anchors.length;
      while (this._emberAcc >= 1) { this._emberAcc -= 1; this.aura.at((Math.random() * n) | 0, _p); c.ember(_p); }
    }
  }

  updateFx(dt) {
    super.updateFx(dt);
    // the warm rim comes from the beast's own fire: below and ahead of it
    _d.set(Math.sin(this.yaw) * 0.6, -0.55, Math.cos(this.yaw) * 0.6);
    for (const m of this.rig.mats) if (m.userData.u) m.userData.u.uWarmDir.value.copy(_d).normalize();
    if (this.realm) this.realm.update(dt);
  }

  onDeath(hit) {
    super.onDeath(hit);
    this.auraTarget = 0;
    if (this.realm) this.realm.exit();
  }

  dispose() {
    this.game.scene.remove(this.aura.mesh); this.aura.dispose();
    if (this.realm && this.realm.active) this.realm.exit();
    super.dispose();
  }
}

// ------------------------------------------------------------------------------------------------- pose

/**
 * Deterministic `nightlord` screenshot: the player braced low in the foreground of the ash plain, the beast
 * reared at the height of its phase-2 roar eleven metres out — chains rising out of the top of the frame,
 * three heads thrown back, the golden flame sheath and ember stream lit, the black sky and the red horizon
 * glow behind it — with the NIGHTLORD reveal and boss bar on the HUD.
 */
export function composeNightlordPose(game, { place, finish }) {
  const a = game.limveld.arenas[1]; // Southern Field: the flattest plain toward the moon, a far ridge for the glow to sit behind
  for (let i = game.entities.length - 1; i >= 0; i--) {
    const e = game.entities[i];
    if (e.isBoss) { e.dispose(); game.entities.splice(i, 1); if (game.run.boss === e) game.run.boss = null; }
  }
  const realm = NightlordArena.get(game, a);
  const dx = Math.sin(realm.bearing), dz = Math.cos(realm.bearing); // toward the moon / horizon glow: the beast is backlit
  const px = a.x - dx * 2.0, pz = a.z - dz * 2.0;
  const bx = a.x + dx * 9.5, bz = a.z + dz * 9.5;
  place(px, pz, bx, bz, { pitch: -0.05, dist: 5.4, yawOffset: 0.0, clip: 'guard' });

  const b = new Nightlord(game, { x: bx, z: bz, arena: a, seed: 23 });
  game.addEntity(b);
  if (game.run.ring && game.run.ring.hookObject) game.run.ring.hookObject(b.object3d);
  const cp = game.camera.position;
  b.yaw = Math.atan2(cp.x - bx, cp.z - bz) + 0.22; // faces the camera, turned a touch so the tail sweeps across the right
  b.aggro = true; b.introDone = true; b.setState('chase');
  b.phase = 2; b.emberBase = 0.9; b.auraTarget = 1; b.auraK = 1;
  realm.setPhase(2); realm.settle();
  b.beginRoar(3.0);
  b.updateCommon(0); b.updateBlade(0);
  game.run.boss = b; game.run.bossActive = true;
  game.events.emit('boss:start', b);
  game.hud.showTitle(b.name, b.subtitle, 30);
  game.player.lockTarget = b; // reticle only; the camera keeps the composed framing

  finish();
  // lock-on style framing: player right of centre, the beast filling the middle; the pose-only side / lift are
  // reset by the next setOrbit (any pose / teleport)
  const cam = game.cameraCtl;
  cam.setOrbit(cam.yaw, cam.pitch, cam.dist, -0.75, 0.35); cam.snap();
  // freezeAll settled the clip 40 steps ahead; snap the animator onto the height of the rear
  b.anim.t = 1.25 - 1 / 60; b.anim.settle(1);
  b.glow = 0; b.telegraph = 0; b._glowDirty = true; b.updateCommon(0);
  b.updateFx(0);
  b.object3d.updateMatrixWorld(true);
  b.aura.time = 2.35; b.aura.update(0, 1.15);
  // life in the frozen frame: a pre-aged ember stream off the body, ash kicked up by the hind paws
  const c = game.combat, n = b.aura.anchors.length;
  if (c.sparks) {
    const t0 = c.sparks.time;
    for (let i = 0; i < 140; i++) { c.sparks.time = t0 - Math.random() * 2.4; b.aura.at((Math.random() * n) | 0, _p); c.ember(_p); }
    c.sparks.time = t0;
  }
  if (c.dustFx) {
    const t0 = c.dustFx.time, by = game.terrain.getHeight(bx, bz);
    for (let i = 0; i < 12; i++) { c.dustFx.time = t0 - Math.random() * 0.8; c.dust(bx - dx * 1.5 + (Math.random() - 0.5) * 3, by, bz - dz * 1.5 + (Math.random() - 0.5) * 3, 2, dx * 0.5, dz * 0.5, 2.2, 0.7); }
    c.dustFx.time = t0;
  }
  c.updateFx(0);
  if (game.graces && game.graces.update) game.graces.update(0);
}
