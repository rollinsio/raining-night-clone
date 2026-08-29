/**
 * Armoured enemy humanoids built on the shared RigBuilder / Animator with the same bone layout as
 * createHumanoid (so HUMANOID_CLIPS drive them), but with designed silhouettes that read at a glance:
 *  - soldier: crested kettle helm with a wide brim over a mail aventail, ONE big three-lame pauldron on
 *    the shield shoulder (the sword arm stays light), charcoal tabard with bone-white trim over a quilted
 *    gambeson, greaves, round shield with a bone cross, arming sword;
 *  - knight: great helm with fin crest and plume, full plate, layered pauldrons both sides, cape, greatsword.
 * Heads stay faceless. One SkinnedMesh = 3 draw calls (flat body, smooth head, blade). The blade lives in
 * its own emissive material group (telegraph heat). ENEMY_CLIPS extends the humanoid clips with a held
 * hit-stop `recoil` (screenshot poses / heavy hits) and a harder `hit`.
 */
import * as THREE from 'three';
import { RigBuilder, Animator, HUMANOID_CLIPS } from '../Humanoid.js';
import { PALETTE, charMats, mixHex } from '../../render/Style.js';

const TAU = Math.PI * 2;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const hex = (c) => c.getHex();
/** Bone-white trim / crest tone (palette-derived: skin lifted toward the moon). */
const BONE = hex(mixHex(PALETTE.skin, PALETTE.moon, 0.55));
const BONE_DARK = hex(mixHex(PALETTE.skin, PALETTE.steelDark, 0.35));

/**
 * Enemy tints. The soldier is built around VALUE separation rather than hue: charcoal cloth (~12 %) against
 * pale steel (~45 %) and bone trim (~75 %) so the silhouette separates from mid-brown tents and dirt in a
 * backlit frame; the knight stays darker, wine-and-gold. `bone` is the trim / crest colour.
 */
export const ENEMY_COLORS = {
  soldier: { cloth: 0x3a2f26, clothDark: 0x23242a, plate: 0x4a5160, plateLight: 0x7c8594, trim: PALETTE.leather, accent: 0x6a2220, bone: BONE, skin: PALETTE.skinDark },
  guard:   { cloth: 0x2f2c33, clothDark: 0x1e1f24, plate: 0x4a4f5a, plateLight: 0x767d8a, trim: PALETTE.leather, accent: 0x8c7e50, bone: BONE_DARK, skin: PALETTE.skinDark },
  knight:  { cloth: 0x26232a, clothDark: 0x18161c, plate: 0x2d323b, plateLight: 0x4c545f, trim: PALETTE.gold, accent: 0x33161a, bone: PALETTE.gold, skin: 0x2a2228 },
  boss:    { cloth: 0x1a1418, clothDark: 0x110e12, plate: 0x3a1c22, plateLight: 0x5a2c30, trim: PALETTE.gold, accent: 0xc8a45a, bone: PALETTE.gold, skin: 0x2a2228 },
};

// Shared lighting hook for enemy materials (module-level uniforms → one program per material type):
// a thin cool fresnel rim, strongest on upward-facing plates, plus a small sky fill so dark armour
// still separates from dark ground, and a warm rim driven by the nearest impact (Combat sets uHit) so a
// spark burst visibly wraps the struck body's edges. No specular shine (matte, like the hero).
const RIM = { value: 0.95 }, RIM_COLOR = { value: new THREE.Color(PALETTE.moonLight) }, FILL = { value: 0.22 }, FILL_COLOR = { value: new THREE.Color(PALETTE.hemiSky) };
/** Impact rim: xyz = world position of the latest hit, w = strength (0 = off). Written by Combat. */
export const HIT_RIM = { value: new THREE.Vector4(0, 0, 0, 0) };
const HIT_COLOR = { value: new THREE.Color(PALETTE.spark) };
export function enemyRimHook(sh) {
  if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return; // depth / distance materials
  sh.uniforms.uRim = RIM; sh.uniforms.uRimColor = RIM_COLOR; sh.uniforms.uFill = FILL; sh.uniforms.uFillColor = FILL_COLOR;
  sh.uniforms.uHit = HIT_RIM; sh.uniforms.uHitColor = HIT_COLOR;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vEWPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvEWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uRim; uniform vec3 uRimColor; uniform float uFill; uniform vec3 uFillColor; uniform vec4 uHit; uniform vec3 uHitColor; varying vec3 vEWPos;')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        vec3 V = normalize( vViewPosition );
        float rimF = pow( 1.0 - saturate( dot( normal, V ) ), 3.2 );
        rimF *= 0.35 + 0.65 * saturate( normal.y * 0.5 + 0.7 );
        reflectedLight.indirectDiffuse += uFill * uFillColor * diffuseColor.rgb;
        reflectedLight.indirectDiffuse += uRim * rimF * uRimColor * ( 0.5 + 0.5 * diffuseColor.rgb );
        if ( uHit.w > 0.0 ) {
          // warm impact rim: a thin fresnel edge on the side facing the contact (the burst wraps the silhouette),
          // plus a faint wrap fill so the lit side warms without bleaching the cloth's value
          vec3 toHit = uHit.xyz - vEWPos;
          float d = length( toHit );
          float wrap = saturate( dot( normal, toHit / max( d, 1e-3 ) ) * 0.7 + 0.45 );
          float fall = uHit.w * exp( -d * d * 1.1 );
          float edge = pow( 1.0 - saturate( dot( normal, V ) ), 2.6 );
          reflectedLight.indirectDiffuse += uHitColor * fall * wrap * ( 0.06 + 0.55 * edge ) * ( 0.3 + 0.7 * diffuseColor.rgb );
        }
      }`);
}

const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
const rot = (g, rx, ry, rz) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); return g; };
const cap = (r, theta, seg = 8) => new THREE.SphereGeometry(r, seg, 4, 0, TAU, 0, theta);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 6, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
/** Open cylinder sector (aventail, tabard wrap): thetaStart / thetaLength around +Y, angle 0 = +Z... three's 0 = +X. */
const sector = (rt, rb, h, seg, start, len) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, true, start, len);

/** Weapon in hand-local space (origin at the palm, blade along -Y tilted forward). Blade parts flagged `blade`. */
function weapon(visual, C) {
  const P = [];
  const add = (geo, color, y, x = 0, z = 0, blade = false, shade = 1) => { geo.translate(x, y, z); P.push({ geo, color, blade, shade }); };
  if (visual === 'greatsword') {
    add(box(0.11, 1.4, 0.024), PALETTE.steel, -0.9, 0, 0, true);
    add(box(0.03, 1.1, 0.03), PALETTE.steelDark, -0.78, 0, 0, true, 0.7);          // fuller
    add(box(0.38, 0.05, 0.08), C.plate, -0.18); add(box(0.07, 0.1, 0.1), C.trim, -0.13);
    add(cyl(0.026, 0.03, 0.36, 5), PALETTE.leather, 0.02); add(new THREE.SphereGeometry(0.045, 6, 4), C.trim, 0.2);
  } else if (visual === 'spear') {
    add(cyl(0.022, 0.026, 2.3, 5), PALETTE.woodDark, -0.7);
    add(new THREE.ConeGeometry(0.06, 0.42, 4), PALETTE.steel, -2.05, 0, 0, true);
    add(cyl(0.035, 0.045, 0.12, 5), C.plate, -1.82);
  } else {
    add(box(0.065, 0.94, 0.016), PALETTE.steel, -0.59, 0, 0, true);
    add(box(0.018, 0.7, 0.02), PALETTE.steelDark, -0.5, 0, 0, true, 0.7);
    add(box(0.3, 0.04, 0.05), C.plate, -0.11); add(cyl(0.02, 0.024, 0.2, 5), PALETTE.leather, 0);
    add(new THREE.SphereGeometry(0.034, 6, 4), C.bone || C.trim, 0.11);
  }
  for (const p of P) p.geo.rotateX(-0.35);
  return P;
}

/** Round shield: charcoal face, steel rim and boss, bone cross; face points +X (outward from the left forearm). */
function shield(C) {
  const face = (g) => { g.rotateX(Math.PI / 2); g.rotateY(Math.PI / 2); return g; };
  const bone = C.bone || C.accent;
  return [
    { geo: at(face(cyl(0.34, 0.34, 0.035, 10)), 0.1, -0.14, 0.02), color: C.clothDark, shade: 0.95 },
    { geo: at(face(cyl(0.355, 0.355, 0.022, 10)), 0.082, -0.14, 0.02), color: C.plateLight, shade: 0.85 },
    { geo: at(new THREE.SphereGeometry(0.075, 6, 4), 0.13, -0.14, 0.02), color: C.plateLight },
    { geo: at(box(0.02, 0.46, 0.06), 0.125, -0.14, 0.02), color: bone, shade: 0.9 },
    { geo: at(box(0.02, 0.06, 0.46), 0.125, -0.14, 0.02), color: bone, shade: 0.9 },
  ];
}

/** Two-sided bent cape hanging from the shoulders (rigid; the chest bone carries it). */
function cape(color) {
  const g = new THREE.PlaneGeometry(0.62, 1.08, 2, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), hang = Math.min(1, Math.max(0, -y / 1.08 + 0.5));
    pos.setXYZ(i, x * (1 + hang * 0.35), y - 0.54, -hang * hang * 0.34 - 0.02);
  }
  // a winding-flipped copy makes the back face front-facing for the FrontSide material
  const flipped = g.clone(); const idx = flipped.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  flipped.computeVertexNormals();
  return [{ geo: g, color, shade: 0.75 }, { geo: flipped, color, shade: 0.6 }];
}

/**
 * Tabard panel: a hanging cloth slab with a raised bone border (two verticals + a hem) and a ragged hem of
 * hanging tongues. Frame: centred on x = 0, top at y0, hanging to y1, at depth z (sign = front/back).
 */
function tabardPanel(w, y0, y1, z, C, bone) {
  const parts = [], h = y0 - y1, s = Math.sign(z) || 1, d = 0.022;
  parts.push({ geo: at(box(w, h, d), 0, (y0 + y1) * 0.5, z), color: C.clothDark, shade: 1.0 });
  for (const sx of [-1, 1]) parts.push({ geo: at(box(0.03, h - 0.02, d + 0.006), sx * (w * 0.5 - 0.02), (y0 + y1) * 0.5, z + s * 0.003), color: bone, shade: 0.92 });
  parts.push({ geo: at(box(w, 0.035, d + 0.006), 0, y1 + 0.04, z + s * 0.003), color: bone, shade: 0.92 });
  for (let i = 0; i < 3; i++) { // hanging tongues below the hem band
    const x = (i - 1) * w * 0.34, tongue = new THREE.ConeGeometry(w * 0.17, 0.1, 3); tongue.rotateX(Math.PI); tongue.rotateY(Math.PI / 6);
    parts.push({ geo: at(tongue, x, y1 - 0.03, z), color: C.clothDark, shade: 0.9 });
  }
  return parts;
}

// -------------------------------------------------------------------------------------------------
// Clips: humanoid set + enemy-specific reactions

/**
 * Held hit-stop recoil: torso thrown back and rolled away from the cut, head snapped back, the arm on the far side
 * of the blow flung wide, the near arm thrown up, front leg braced, rear leg skidding back on its toe. Holds for
 * 70 ms (the hit-stop) then eases out over ctx.dur. ctx.param < 0 mirrors it (a cut arriving from the other side).
 */
function recoil(t, P, ctx) {
  const k = 1 - sm((t - 0.07) / (ctx.dur || 0.45)), m = ctx.param < 0 ? -1 : 1;
  const wide = m > 0 ? 'R' : 'L', high = m > 0 ? 'L' : 'R', front = m > 0 ? 'L' : 'R', back = m > 0 ? 'R' : 'L';
  const sg = (side) => (side === 'L' ? 1 : -1);
  P.set('hips', 0, -0.18 * k * m, 0.06 * k * m);
  P.set('spine', -0.34 * k, -0.12 * k * m, 0.2 * k * m);
  P.set('chest', -0.3 * k, -0.14 * k * m, 0.16 * k * m);
  P.set('neck', -0.1 * k, 0, 0);
  P.set('head', -0.28 * k, 0.15 * k * m, -0.12 * k * m);
  P.set('shoulder' + wide, -0.45 * k, 0.35 * k * sg(wide), (1.35 * k + 0.15) * sg(wide)); P.set('elbow' + wide, -1.0 * k, 0, 0);
  P.set('shoulder' + high, -2.3 * k, 0.2 * k * sg(high), (0.45 * k + 0.15) * sg(high)); P.set('elbow' + high, -0.35 * k, 0, 0);
  P.set('hip' + front, -0.6 * k, 0.1 * sg(front), 0.14 * k * sg(front)); P.set('knee' + front, 1.0 * k, 0, 0); P.set('ankle' + front, -0.38 * k, 0, 0);
  P.set('hip' + back, 0.55 * k, 0, 0.2 * k * sg(back)); P.set('knee' + back, 0.28 * k, 0, 0); P.set('ankle' + back, 0.55 * k, 0, 0);
  P.extra(0, -0.16 * k);
  P.extra(1, -0.12 * k);
}
/** Gameplay flinch: a shorter, harder version of the shared hit (torso bends away, arms thrown out). */
function hit(t, P, ctx) {
  // directional: bends back (forward when struck from behind) and rolls / turns away from the blow's lateral side
  const k = 1 - sm(t / (ctx.dur || 0.32)), m = ctx.param || 0, b = 1 - 2 * (ctx.back || 0);
  P.set('spine', -0.36 * k * b, 0.1 * k * m, 0.12 * k - 0.25 * k * m); P.set('chest', -0.3 * k * b, 0.1 * k + 0.1 * k * m, 0.1 * k - 0.12 * k * m); P.set('head', -0.42 * k * b, 0.3 * k * m, -0.08 * k - 0.1 * k * m);
  P.set('hips', 0, -0.1 * k * m, 0.05 * k * m);
  P.set('shoulderL', -0.8 * k, 0.2 * k, 0.8 * k + 0.15); P.set('shoulderR', -0.6 * k, -0.2 * k, -0.8 * k - 0.15);
  P.set('elbowL', -0.7 * k, 0, 0); P.set('elbowR', -0.9 * k, 0, 0);
  P.set('hipL', -0.3 * k, 0, 0.08); P.set('kneeL', 0.55 * k, 0, 0); P.set('hipR', 0.3 * k, 0, -0.1); P.set('kneeR', 0.3 * k, 0, 0);
  P.set('ankleL', -0.25 * k, 0, 0); P.set('ankleR', 0.25 * k, 0, 0);
  P.extra(0, -0.1 * k); P.extra(1, -0.08 * k);
}
export const ENEMY_CLIPS = { ...HUMANOID_CLIPS, hit, recoil };

// -------------------------------------------------------------------------------------------------
// Rig

/**
 * Build an armoured humanoid. opts: { kit: 'soldier'|'knight', colors, weapon: 'sword'|'greatsword'|'spear', shield, cape }
 * Returns { root, mesh, bones, animator, materials:[body, head], bladeMat, handRLocal, update(dt) }.
 */
export function createArmoredRig(opts = {}) {
  const C = opts.colors || ENEMY_COLORS.soldier, knight = opts.kit === 'knight', bone = C.bone || C.trim;
  const rb = new RigBuilder();
  rb.parts.push([]); // material slot 2: blade (emissive telegraph)
  // same layout as createHumanoid so HUMANOID_CLIPS apply
  const hips = rb.bone('hips', null, 0, 0.98, 0);
  const spine = rb.bone('spine', hips, 0, 0.1, 0);
  const chest = rb.bone('chest', spine, 0, 0.22, 0);
  const neck = rb.bone('neck', chest, 0, 0.18, 0);
  rb.bone('head', neck, 0, 0.07, 0);
  const shL = rb.bone('shoulderL', chest, 0.22, 0.16, 0); rb.bone('elbowL', shL, 0, -0.29, 0);
  const shR = rb.bone('shoulderR', chest, -0.22, 0.16, 0); rb.bone('elbowR', shR, 0, -0.29, 0);
  const hipL = rb.bone('hipL', hips, 0.1, -0.06, 0); const knL = rb.bone('kneeL', hipL, 0, -0.45, 0); rb.bone('ankleL', knL, 0, -0.42, 0);
  const hipR = rb.bone('hipR', hips, -0.1, -0.06, 0); const knR = rb.bone('kneeR', hipR, 0, -0.45, 0); rb.bone('ankleR', knR, 0, -0.42, 0);
  const p = (n) => rb.pos(n);
  const part = (geo, bone, color, shade = 1, mat = 0, o = null) => rb.part(geo, bone, color, mat, shade, o);

  // ---- hips: belt, pelvis, pleated skirt with a trim band, tassets, lower tabard
  const hy = p('hips').y;
  part(at(box(0.32, 0.2, 0.24), 0, hy - 0.06, 0), 'hips', knight ? C.cloth : C.clothDark, 0.85);
  part(at(cyl(0.245, 0.245, 0.07, 8), 0, hy + 0.01, 0), 'hips', C.trim, 0.9);
  part(at(box(0.08, 0.055, 0.03), 0, hy + 0.01, 0.245), 'hips', bone, 1.1);
  part(at(cyl(0.2, 0.3, 0.38, 8, true), 0, hy - 0.29, 0), 'hips', C.clothDark, 0.9, 0, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.1, bottom: hy - 0.48, max: 0.5 } });
  if (!knight) part(at(cyl(0.295, 0.305, 0.03, 8, true), 0, hy - 0.465, 0), 'hips', bone, 0.75, 0, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.1, bottom: hy - 0.48, max: 0.5 } });
  const tassetAngles = knight ? [-0.45, 0.45, 1.35, -1.35, 2.3, -2.3] : [1.45, -1.45];
  for (const a of tassetAngles) {
    const g = box(knight ? 0.17 : 0.16, knight ? 0.26 : 0.24, 0.03);
    g.translate(0, -0.1, 0.24); g.rotateX(-0.18); g.rotateY(a); g.translate(0, hy - 0.02, 0);
    part(g, 'hips', C.plate, 0.9 + 0.08 * Math.cos(a));
  }
  if (knight) part(at(box(0.2, 0.44, 0.02), 0, hy - 0.24, 0.265), 'hips', C.accent, 0.85);
  else for (const z of [0.27, -0.27]) for (const t of tabardPanel(0.26, hy + 0.04, hy - 0.4, z, C, bone)) part(t.geo, 'hips', t.color, t.shade * (z < 0 ? 0.85 : 1), 0, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: hy - 0.42, max: 0.35 } });

  // ---- spine: gambeson / cuirass lower
  const sy = p('spine').y;
  part(at(cyl(0.215, 0.235, 0.32, 8), 0, sy + 0.14, 0), 'spine', knight ? C.plate : C.cloth, 0.95);
  if (!knight) for (let i = 0; i < 3; i++) part(at(cyl(0.222, 0.228, 0.018, 8), 0, sy + 0.03 + i * 0.1, 0), 'spine', C.clothDark, 0.8);

  // ---- chest: breastplate + ridge + gorget, upper tabard, pauldrons, upper arms
  const cy = p('chest').y;
  part(at(cyl(0.26, 0.235, 0.28, 8), 0, cy + 0.1, 0), 'chest', C.plate, 1.0);
  part(rot(box(0.07, 0.28, 0.07), 0, Math.PI / 4, 0).translate(0, cy + 0.1, 0.225), 'chest', C.plateLight, 1.0);
  part(at(cyl(0.11, 0.18, 0.1, 8), 0, cy + 0.25, 0), 'chest', C.plate, 0.85);
  if (knight) part(at(box(0.2, 0.2, 0.02), 0, cy, 0.255), 'chest', C.accent, 0.85);
  else {
    for (const z of [0.27, -0.26]) for (const t of tabardPanel(0.26, cy + 0.2, cy - 0.1, z, C, bone)) part(t.geo, 'chest', t.color, t.shade * (z < 0 ? 0.85 : 1));
    // bone diamond emblem on the chest panel
    part(rot(box(0.07, 0.07, 0.01), 0, 0, Math.PI / 4).translate(0, cy + 0.07, 0.292), 'chest', bone, 1.0);
  }
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, sh = p('shoulder' + side), el = p('elbow' + side), b = 'shoulder' + side, eb = 'elbow' + side;
    const big = knight || side === 'L'; // the soldier's one pauldron guards the shield shoulder
    if (big) {
      part(at(cap(knight ? 0.165 : 0.19, 0.55 * Math.PI), sh.x + s * 0.04, sh.y + 0.05, 0), b, C.plateLight, 0.95);
      if (!knight) part(at(cyl(0.2, 0.2, 0.022, 8, true), sh.x + s * 0.04, sh.y + 0.04, 0), b, bone, 0.8); // trim ring under the cap
      const low = cap(knight ? 0.135 : 0.16, 0.5 * Math.PI); low.rotateZ(-s * 0.55); part(at(low, sh.x + s * 0.09, sh.y - 0.07, 0), b, C.plate, 0.9);
      const low2 = cap(knight ? 0.115 : 0.135, 0.5 * Math.PI); low2.rotateZ(-s * 0.85); part(at(low2, sh.x + s * 0.13, sh.y - 0.18, 0), b, C.plate, 0.82);
      if (!knight) { const low3 = cap(0.11, 0.5 * Math.PI); low3.rotateZ(-s * 1.1); part(at(low3, sh.x + s * 0.15, sh.y - 0.27, 0), b, C.plate, 0.75); }
    } else {
      part(at(cap(0.105, 0.5 * Math.PI), sh.x + s * 0.02, sh.y + 0.03, 0), b, C.trim, 0.9); // leather shoulder cap + strap
      part(at(box(0.05, 0.03, 0.22), sh.x + s * 0.02, sh.y + 0.08, 0), b, C.trim, 0.75);
    }
    part(at(cyl(0.063, 0.058, 0.27, 6), sh.x, sh.y - 0.145, 0), b, knight ? C.clothDark : C.cloth, 0.95);
    if (!knight) for (let i = 0; i < 2; i++) part(at(cyl(0.066, 0.064, 0.014, 6), sh.x, sh.y - 0.1 - i * 0.1, 0), b, C.clothDark, 0.8); // quilting
    part(at(new THREE.SphereGeometry(0.06, 6, 4), el.x, el.y, 0), eb, C.plate, 0.9);
    part(at(cyl(0.062, 0.05, 0.23, 6), el.x, el.y - 0.14, 0), eb, C.plate, 0.8);
    part(at(new THREE.SphereGeometry(0.053, 6, 4), el.x, el.y - 0.29, 0), eb, PALETTE.leather, 0.9);
  }

  // ---- neck + head: faceless head, helm + crest
  const ny = p('neck').y, hdy = p('head').y + 0.12; // hdy = head sphere centre
  part(at(cyl(0.06, 0.075, 0.12, 5), 0, ny + 0.04, 0), 'neck', C.skin, 0.8);
  part(at(new THREE.SphereGeometry(0.135, 12, 9), 0, hdy, 0), 'head', C.skin, 1, 1);
  if (knight) {
    part(at(cyl(0.155, 0.165, 0.32, 8), 0, hdy + 0.02, 0), 'head', C.plateLight, 0.95);
    part(at(cyl(0.16, 0.16, 0.03, 8), 0, hdy + 0.185, 0), 'head', C.plate, 0.9);
    part(at(box(0.22, 0.022, 0.06), 0, hdy + 0.03, 0.15), 'head', C.clothDark, 0.3);
    part(at(box(0.03, 0.2, 0.4), 0, hdy + 0.28, -0.04), 'head', bone, 0.85);
    const plume = new THREE.ConeGeometry(0.06, 0.42, 5); plume.rotateX(-2.3); part(at(plume, 0, hdy + 0.25, -0.3), 'head', C.accent, 0.7);
  } else {
    // mail aventail: a charcoal curtain from under the helm down over the shoulders, open at the face
    part(at(sector(0.15, 0.23, 0.26, 9, Math.PI * 0.2, Math.PI * 1.6), 0, hdy - 0.14, -0.01), 'head', C.clothDark, 0.8, 0, { blend: { bone: 'neck', y: hdy - 0.18, width: 0.12 } });
    // kettle hat: domed crown, ridge, wide down-turned brim with a pale upper face
    part(at(cap(0.16, 0.6 * Math.PI), 0, hdy + 0.02, 0), 'head', C.plateLight, 0.95);
    part(at(cyl(0.25, 0.275, 0.028, 10), 0, hdy - 0.035, 0), 'head', C.plateLight, 0.82);
    part(at(cyl(0.17, 0.26, 0.05, 10, true), 0, hdy + 0.0, 0), 'head', C.plate, 0.9);
    part(at(box(0.05, 0.035, 0.36), 0, hdy + 0.16, 0), 'head', C.plate, 0.85);
    // bone fin crest with a serrated top and a dark horsehair tail off the back
    part(at(box(0.026, 0.17, 0.32), 0, hdy + 0.25, -0.01), 'head', bone, 0.95);
    for (let i = 0; i < 4; i++) { const sp = new THREE.ConeGeometry(0.032, 0.08 + 0.025 * (i === 1 || i === 2 ? 1 : 0), 3); part(at(sp, 0, hdy + 0.37, 0.11 - i * 0.078), 'head', bone, 0.9); }
    const tail = new THREE.ConeGeometry(0.035, 0.3, 4); tail.rotateX(-2.1); part(at(tail, 0, hdy + 0.14, -0.26), 'head', C.accent, 0.7);
  }

  // ---- legs: thigh, strap, poleyn, greave, boot (on the ankle)
  for (const side of ['L', 'R']) {
    const hp = p('hip' + side), kn = p('knee' + side), an = p('ankle' + side), hb = 'hip' + side, kb = 'knee' + side, ab = 'ankle' + side;
    part(at(cyl(0.1, 0.08, 0.4, 6), hp.x, hp.y - 0.21, 0), hb, knight ? C.plate : C.cloth, 0.92);
    part(at(cyl(0.098, 0.095, 0.045, 6), hp.x, hp.y - 0.3, 0), hb, C.trim, 0.9);
    part(at(new THREE.SphereGeometry(0.078, 6, 4), kn.x, kn.y, 0), kb, C.plate, 0.9);
    part(at(cyl(0.074, 0.058, 0.36, 6), kn.x, kn.y - 0.2, 0), kb, knight ? C.plate : C.clothDark, 0.85);
    if (!knight) { const gr = box(0.09, 0.3, 0.035); gr.rotateX(0.05); part(at(gr, kn.x, kn.y - 0.2, 0.06), kb, C.plate, 0.95); } // greave on the shin
    part(at(box(0.13, 0.1, 0.28), an.x, an.y - 0.02, 0.05), ab, PALETTE.leather, 0.85);
  }

  // ---- weapon, shield, cape
  const handR = p('elbowR').clone().add(new THREE.Vector3(0, -0.32, 0.01));
  for (const w of weapon(opts.weapon || 'sword', C)) part(at(w.geo, handR.x, handR.y, handR.z), 'elbowR', w.color, w.shade, w.blade ? 2 : 0);
  if (opts.shield) { const hl = p('elbowL').clone().add(new THREE.Vector3(0, -0.18, 0)); for (const s of shield(C)) part(at(s.geo, hl.x, hl.y, hl.z), 'elbowL', s.color, s.shade); }
  if (opts.cape) for (const c of cape(C.accent)) part(at(c.geo, 0, cy + 0.2, -0.21), 'chest', c.color, c.shade);

  const [body, head] = charMats();
  body.roughness = 0.78; body.side = THREE.DoubleSide; // open sectors (aventail, skirt) read from any angle
  body.onBeforeCompile = enemyRimHook; head.onBeforeCompile = enemyRimHook;
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.45, metalness: 0.15, emissive: 0x000000 });
  const rig = rb.build([body, head, bladeMat]);
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = 0.98; rig.mesh.position.y = -0.98; pivot.add(rig.mesh); root.add(pivot);
  const animator = new Animator(rig, ENEMY_CLIPS, pivot);
  return { root, mesh: rig.mesh, bones: rig.bones, animator, materials: [body, head], bladeMat, handRLocal: handR, update(dt) { animator.update(dt); } };
}
