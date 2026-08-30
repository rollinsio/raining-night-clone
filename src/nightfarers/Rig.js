/**
 * Nightfarer rigs: the shared faceless humanoid (entity/Humanoid.js) dressed per class with a costume overlay —
 * one extra SkinnedMesh bound to the SAME skeleton, drawn with the base rig's own body / head materials so the
 * rim / fill / wrap shading, hit flash and telegraph tint match exactly (a per-rig emissive material carries
 * glowing bits such as the glintstone). Costumes are built from lofted rings and bevelled boxes with vertex-colour
 * gradients, crease-smoothed like the base. Also the roster presentation clips (`present_<id>`) and the ability
 * clips (cast / bow / spin / leap / roar) merged into each rig's animator.
 *
 * Bone layout (bind, model space): hips 0.98, chest 1.30, neck 1.48, head centre 1.67; shoulders ±0.22 @ 1.46,
 * elbows 1.16, wrists 0.875; hips ±0.1 @ 0.92, knees 0.48, ankles 0.08. Model faces +Z, right side is −X.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, NIGHTFARER_COLORS } from '../render/Style.js';
import { createHumanoid, RigBuilder, HUMANOID_CLIPS, weaponParts } from '../entity/Humanoid.js';
import { WEAPONS } from '../combat/Weapons.js';

const TAU = Math.PI * 2;
const _c = new THREE.Color(), _c2 = new THREE.Color();
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
/** Hex between two hex colours (sRGB lerp) — every costume tone is derived from the palette this way. */
export const mixc = (a, b, t) => { _c.setHex(a); _c2.setHex(b); return _c.lerp(_c2, t).getHex(); };
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// -------------------------------------------------------------------------------------------------
// Geometry helpers (model space; same conventions as the base rig)

const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
const rx = (g, a) => { g.rotateX(a); return g; };
const ry = (g, a) => { g.rotateY(a); return g; };
const rz = (g, a) => { g.rotateZ(a); return g; };
const scaled = (g, x, y, z) => { g.scale(x, y, z); return g; };
const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const dome = (r, w, h, frac) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, Math.PI * frac);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);

/** Ring of n points around +Y at height y: half-widths w (x) / d (z), centre (xc, zc), squareness e. */
function ringY(n, y, w, d, xc = 0, zc = 0, e = 0.85) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; pts.push([xc + w * spow(Math.cos(a), e), y, zc + d * spow(Math.sin(a), e)]); }
  return pts;
}
/** Ring around +Y with a wavy rim (pleats / drooping brim): y alternates ±amp. */
function ringWave(n, y, r, amp, zc = 0, dz = 1) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push([Math.sin(a) * r, y + amp * (k % 2 ? 1 : -1), zc + Math.cos(a) * r * dz]); }
  return pts;
}
/** Open arc around +Y from angle a0 to a1 (0 = +Z, the face). */
function arc(n, y, r, a0, a1, zc = 0, dz = 1) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = a0 + ((a1 - a0) * k) / (n - 1); pts.push([Math.sin(a) * r, y, zc + Math.cos(a) * r * dz]); }
  return pts;
}
/** Ring around +Z (beaks, bow limbs) at depth z: half-width w, y from y0 to y1. */
function ringZ(n, z, w, y0, y1, e = 0.8) {
  const pts = [], yc = (y0 + y1) * 0.5, h = (y1 - y0) * 0.5;
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; pts.push([w * spow(Math.cos(a), e), yc + h * spow(Math.sin(a), e), z]); }
  return pts;
}
/** 2-D outline [[x, y], ...] lifted to depth z. */
const outline = (pts, z) => pts.map(([x, y]) => [x, y, z]);

/** Loft equal-sized rings into an indexed geometry (caps fan to the centroid; winding auto-corrected). */
function loft(rings, { closed = true, capStart = false, capEnd = false } = {}) {
  const n = rings[0].length, R = rings.length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  const segs = closed ? n : n - 1;
  for (let r = 0; r < R - 1; r++) for (let i = 0; i < segs; i++) {
    const a = r * n + i, b = r * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (r, rev) => {
    const ci = pos.length / 3; let cx = 0, cy = 0, cz = 0;
    for (const p of rings[r]) { cx += p[0]; cy += p[1]; cz += p[2]; }
    pos.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < segs; i++) { const a = r * n + i, b = r * n + ((i + 1) % n); if (rev) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(R - 1, true);
  let cx = 0, cy = 0, cz = 0; const N = pos.length / 3;
  for (let i = 0; i < N; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
  cx /= N; cy /= N; cz /= N;
  const P = (i) => [pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]];
  const a = P(0), b = P(1), c = P(2);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
  const fx = (a[0] + b[0] + c[0]) / 3 - cx, fy = (a[1] + b[1] + c[1]) / 3 - cy, fz = (a[2] + b[2] + c[2]) / 3 - cz;
  if (nx * fx + ny * fy + nz * fz < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Flat prism from a convex 2-D outline (shield bodies, axe blades), thickness t along Z. */
const prism = (pts, t) => loft([outline(pts, -t / 2), outline(pts, t / 2)], { capStart: true, capEnd: true });

/** Jagged hanging cone (pelts, tasset skirts): from ring (r0, y0) to (r1, y1) with leaf tips, over the arc a0..a1. */
function fan(r0, y0, r1, y1, tip, seg, a0 = 0, a1 = TAU, zs = 1) {
  const v = [];
  const push = (a, b, c) => v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const full = Math.abs(a1 - a0 - TAU) < 1e-6;
  for (let i = 0; i < seg; i++) {
    const s0 = a0 + ((a1 - a0) * i) / seg, s1 = a0 + ((a1 - a0) * (i + 1)) / seg, am = (s0 + s1) * 0.5;
    const T0 = [Math.sin(s0) * r0, y0, Math.cos(s0) * r0 * zs], T1 = [Math.sin(s1) * r0, y0, Math.cos(s1) * r0 * zs];
    const B0 = [Math.sin(s0) * r1, y1, Math.cos(s0) * r1 * zs], B1 = [Math.sin(s1) * r1, y1, Math.cos(s1) * r1 * zs];
    const tl = tip * (0.7 + 0.3 * ((i * 7) % 3) / 2);
    const P = [Math.sin(am) * (r1 + 0.02), y1 - tl, Math.cos(am) * (r1 + 0.02) * zs];
    push(T0, B0, B1); push(T0, B1, T1); push(B0, P, B1);
  }
  void full;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
/** Tube along a polyline (bow limbs, lyre arms). */
function tube(points, r, segs = 10, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return new THREE.TubeGeometry(curve, segs, r, radial, false);
}

/** Crease-aware smooth normals (faces within `angle` of the vertex's own face average), as the base rig does. */
function smoothNormals(geo, angle = 60) {
  const pos = geo.attributes.position.array, n = geo.attributes.position.count, F = n / 3;
  const fw = new Float32Array(F * 3), fu = new Float32Array(F * 3);
  for (let f = 0; f < F; f++) {
    const a = f * 9;
    const ax = pos[a + 3] - pos[a], ay = pos[a + 4] - pos[a + 1], az = pos[a + 5] - pos[a + 2];
    const bx = pos[a + 6] - pos[a], by = pos[a + 7] - pos[a + 1], bz = pos[a + 8] - pos[a + 2];
    const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, l = Math.hypot(x, y, z) || 1;
    fw[f * 3] = x; fw[f * 3 + 1] = y; fw[f * 3 + 2] = z; fu[f * 3] = x / l; fu[f * 3 + 1] = y / l; fu[f * 3 + 2] = z / l;
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 2500)},${Math.round(pos[i * 3 + 1] * 2500)},${Math.round(pos[i * 3 + 2] * 2500)}`;
    let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(i);
  }
  const cosA = Math.cos((angle * Math.PI) / 180), out = new Float32Array(n * 3);
  for (const list of groups.values()) for (let u = 0; u < list.length; u++) {
    const i = list[u], f = (i / 3) | 0; let x = 0, y = 0, z = 0;
    for (let v = 0; v < list.length; v++) {
      const g = (list[v] / 3) | 0;
      if (fu[f * 3] * fu[g * 3] + fu[f * 3 + 1] * fu[g * 3 + 1] + fu[f * 3 + 2] * fu[g * 3 + 2] < cosA) continue;
      x += fw[g * 3]; y += fw[g * 3 + 1]; z += fw[g * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

// -------------------------------------------------------------------------------------------------
// Overlay: costume parts skinned to an existing rig's skeleton

class Overlay {
  constructor(rig) {
    this.rig = rig;
    const rb = this.rb = new RigBuilder();
    rb.byName = rig.bones; rb.parts = [[], [], []];
    rb.bones = rig.mesh.skeleton.bones;
    // bind-pose model-space bone positions (the skeleton was bound with every bone unrotated)
    for (const b of rb.bones) { const v = new THREE.Vector3(); let p = b; while (p && p.isBone) { v.add(p.position); p = p.parent; } rb.world[b.name] = v; }
    this.glow = null; this.glowColor = 0;
  }
  pos(name) { return this.rb.world[name]; }
  /** Flat/cloth part (material 0 — the base body material, crease-smoothed). */
  F(geo, bone, color, shade = 1, o = null) { return this.rb.part(geo, bone, color, 0, shade * 1.1, o); }
  /** Smooth part (material 1 — skin / hair). */
  S(geo, bone, color, shade = 1, o = null) { return this.rb.part(geo, bone, color, 1, shade * 1.1, o); }
  /** Glowing part (material 2 — per-rig emissive, one colour per costume). */
  G(geo, bone, color, shade = 1) { this.glowColor = color; return this.rb.part(geo, bone, color, 2, shade); }
  /** Merge into one SkinnedMesh on the base skeleton (identity bind — the base was bound at the origin too). */
  build() {
    const rb = this.rb, rig = this.rig, merged = [], matIdx = [];
    for (let m = 0; m < 3; m++) { if (!rb.parts[m].length) continue; merged.push(mergeGeometries(rb.parts[m], false)); matIdx.push(m); }
    if (!merged.length) return null;
    const geo = merged.length > 1 ? mergeGeometries(merged, true) : merged[0];
    if (merged.length > 1) geo.groups.forEach((g, i) => { g.materialIndex = matIdx[i]; });
    else geo.addGroup(0, geo.attributes.position.count, matIdx[0]);
    smoothNormals(geo, 60);
    const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: this.glowColor || 0x000000, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0 });
    const mesh = new THREE.SkinnedMesh(geo, [rig.materials[0], rig.materials[1], glow]);
    mesh.bind(rig.mesh.skeleton, new THREE.Matrix4());
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    rig.mesh.add(mesh);
    this.glow = glow;
    return mesh;
  }
}

// -------------------------------------------------------------------------------------------------
// Weapons built in the hand frame (origin at the fist centre, blade along −Y, the whole thing tilted 0.35 rad
// forward like the base weapons so trail spans line up)

function handFrame(parts, hand, tilt = -0.35) {
  for (const p of parts) { p.geo.rotateX(tilt); p.geo.translate(hand.x, hand.y, hand.z); }
  return parts;
}
const W = (geo, color, y, x = 0, z = 0, shade = 1) => ({ geo: at(geo, x, y, z), color, shade });

/** Raider's great axe: the head rides low by the hand (a heavy axe is carried choked up), the haft rises past the shoulder. */
function greatAxe() {
  const S = PALETTE.steel, SD = PALETTE.steelDark, WD = PALETTE.woodDark, L = PALETTE.leather;
  const blade = [[0.06, 0.34], [0.38, 0.46], [0.52, 0.1], [0.52, -0.1], [0.38, -0.46], [0.06, -0.34]];
  const mirror = blade.map(([x, y]) => [-x, y]).reverse();
  return [
    W(cyl(0.028, 0.034, 1.55, 7), WD, -0.2, 0, 0, 1.0),
    W(cyl(0.036, 0.036, 0.26, 7), L, 0.02, 0, 0, 0.9),
    W(scaled(prism(blade, 0.03), 1, 1, 1), S, -0.72, 0, 0, 1.45), W(prism(mirror, 0.03), S, -0.72, 0, 0, 1.45),
    W(box(0.16, 0.2, 0.07), SD, -0.72, 0, 0, 1.0), W(cone(0.035, 0.22, 5), SD, -1.08, 0, 0, 1.0),
    W(cyl(0.04, 0.04, 0.03, 7), SD, -0.5), W(cyl(0.04, 0.04, 0.03, 7), SD, -0.96),
    W(sph(0.045, 6, 4), SD, 0.58),
  ];
}
/** Ironeye's recurve bow (left hand, grip at the fist, limbs along ±Y, tips curling forward). */
function bow() {
  const WD = mixc(PALETTE.woodDark, PALETTE.leather, 0.4), L = PALETTE.leather, STR = mixc(PALETTE.moon, PALETTE.stone, 0.4);
  const limb = (s) => tube([[0, 0, 0.0], [0, s * 0.32, -0.05], [0, s * 0.62, -0.02], [0, s * 0.82, 0.1]], 0.016, 10, 5);
  const parts = [
    { geo: limb(1), color: WD, shade: 1.1 }, { geo: limb(-1), color: WD, shade: 1.1 },
    W(cyl(0.03, 0.03, 0.16, 7), L, 0.0, 0, 0.0, 0.9),
    W(cone(0.02, 0.06, 5), PALETTE.steelDark, 0.86, 0, 0.12), W(rx(cone(0.02, 0.06, 5), Math.PI), PALETTE.steelDark, -0.86, 0, 0.12),
    W(box(0.006, 1.66, 0.006), STR, 0, 0, 0.11, 1.3),
  ];
  return parts;
}
/** Revenant's bone staff with a caged spirit flame at the head. */
function spiritStaff() {
  const BONE = mixc(PALETTE.moon, PALETTE.skin, 0.4), SD = PALETTE.steelDark;
  return [
    W(cyl(0.018, 0.026, 1.7, 6), BONE, -0.45, 0, 0, 0.95),
    W(cyl(0.03, 0.03, 0.1, 6), SD, 0.38), W(cyl(0.03, 0.03, 0.1, 6), SD, 0.78),
    W(scaled(sph(0.06, 7, 5), 1, 1.4, 1), BONE, 0.58, 0.0, 0.0, 0.85),
    W(box(0.01, 0.3, 0.01), BONE, 0.58, 0.055, 0), W(box(0.01, 0.3, 0.01), BONE, 0.58, -0.055, 0), W(box(0.01, 0.3, 0.01), BONE, 0.58, 0, 0.055), W(box(0.01, 0.3, 0.01), BONE, 0.58, 0, -0.055),
  ];
}
/** Revenant's lyre (left hand): sound box at the fist, two curving arms, yoke and strings. */
function lyre() {
  const G = mixc(PALETTE.gold, PALETTE.leather, 0.35), D = mixc(PALETTE.woodDark, PALETTE.clothDark, 0.4), STR = mixc(PALETTE.moon, PALETTE.gold, 0.3);
  const arm = (s) => tube([[s * 0.08, 0.02, 0], [s * 0.15, 0.18, 0], [s * 0.14, 0.36, 0], [s * 0.1, 0.46, 0]], 0.014, 8, 5);
  const parts = [
    W(scaled(sph(0.1, 8, 6), 1.0, 0.75, 0.45), D, 0.0, 0, 0.0, 1.0),
    { geo: arm(1), color: G, shade: 1.25 }, { geo: arm(-1), color: G, shade: 1.25 },
    W(box(0.26, 0.018, 0.018), G, 0.45, 0, 0, 1.25),
  ];
  for (let i = 0; i < 5; i++) parts.push(W(box(0.004, 0.4, 0.004), STR, 0.25, -0.06 + i * 0.03, 0.01, 1.3));
  return parts;
}
/** Second dagger for the Duchess's left hand (mirror of the base dagger). */
function dagger() {
  const S = PALETTE.steel, SD = PALETTE.steelDark, L = PALETTE.leather, G = PALETTE.gold;
  return [W(box(0.04, 0.45, 0.012), S, -0.34, 0, 0, 1.45), W(box(0.12, 0.03, 0.04), SD, -0.1), W(cyl(0.018, 0.02, 0.14, 5), L, -0.02), W(sph(0.022, 6, 4), G, 0.06)];
}

// -------------------------------------------------------------------------------------------------
// Costumes. Each receives the overlay, palette-derived tones and the bind positions.

const COSTUMES = {
  /** Wylder: the hooded hero as-is, plus the grappling-claw gauntlet on the left forearm. */
  Wylder: {
    base: { hood: true, helm: false, cloak: true, scarf: PALETTE.sparkBlood },
    scale: [1, 1, 1],
    dress(ov) {
      const el = ov.pos('elbowL'), wr = ov.pos('wristL'), SD = PALETTE.steelDark;
      ov.F(loft([ringY(8, wr.y + 0.16, 0.05, 0.048, el.x, 0, 0.7), ringY(8, wr.y + 0.03, 0.042, 0.04, el.x, 0, 0.7)], { capStart: true, capEnd: true }), 'elbowL', SD, 0.95, { blend: { bone: 'wristL', y: wr.y + 0.03, width: 0.04 } });
      for (let i = -1; i <= 1; i++) { const claw = rx(cone(0.012, 0.12, 4), -1.9); ov.F(at(claw, el.x + i * 0.03, wr.y + 0.01, 0.06), 'wristL', PALETTE.steel, 1.3); }
    },
  },
  /** Guardian: avian great helm with a feather crest, layered pauldrons, breastplate, tassets, greaves, tall shield. */
  Guardian: {
    base: { hood: false, helm: false, cloak: true },
    scale: [1.12, 1.08, 1.12],
    dress(ov, col) {
      const hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0)), ny = ov.pos('neck').y, hy = ov.pos('hips').y;
      const S = mixc(PALETTE.steel, PALETTE.stone, 0.25), SD = mixc(PALETTE.steelDark, PALETTE.stone, 0.2), FE = mixc(PALETTE.moon, col.accent, 0.45), LEA = PALETTE.leather;
      // helm: domed skull, hooked beak, brow ridge, neck guard, crest of feathers sweeping back
      ov.F(at(scaled(sph(0.15, 10, 8), 1.02, 1.05, 1.18), hc.x, hc.y + 0.03, hc.z - 0.01), 'head', S, 0.95, { shadeFn: (x, y) => lerp(0.85, 1.05, sm((y - hc.y + 0.1) / 0.25)) });
      ov.F(loft([ringZ(8, 0.1, 0.085, hc.y - 0.05, hc.y + 0.09), ringZ(8, 0.2, 0.05, hc.y - 0.08, hc.y + 0.02), ringZ(8, 0.3, 0.02, hc.y - 0.13, hc.y - 0.09)], { capStart: true, capEnd: true }), 'head', SD, 1.0);
      ov.F(at(box(0.26, 0.035, 0.08), 0, hc.y + 0.06, 0.13), 'head', SD, 0.95);
      ov.F(loft([ringY(10, hc.y - 0.08, 0.16, 0.17), ringY(10, hc.y - 0.22, 0.19, 0.2, 0, -0.02), ringY(10, hc.y - 0.3, 0.23, 0.22, 0, -0.04)], { closed: true }), 'head', SD, 0.9, { blend: { bone: 'neck', y: hc.y - 0.2, width: 0.12 } });
      for (let i = 0; i < 5; i++) {
        const h = 0.32 - i * 0.04, fin = rx(box(0.02, h, 0.07 - i * 0.006), -0.55 - i * 0.32);
        ov.F(at(fin, 0, hc.y + 0.12 + i * 0.02, 0.08 - i * 0.07), 'head', FE, 1.15 - i * 0.05);
      }
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) ov.F(at(rz(rx(box(0.016, 0.2, 0.05), -0.9), s * (0.6 + i * 0.35)), s * (0.1 + i * 0.05), hc.y + 0.04 - i * 0.03, -0.06), 'head', FE, 1.05);
      // gorget + breastplate with a centre ridge
      ov.F(loft([ringY(10, ny + 0.04, 0.12, 0.1), ringY(10, ny - 0.05, 0.17, 0.13), ringY(10, ny - 0.1, 0.2, 0.15)], {}), 'chest', SD, 0.95);
      ov.F(loft([ringY(10, hy + 0.12, 0.195, 0.145), ringY(10, hy + 0.26, 0.225, 0.165), ringY(10, hy + 0.4, 0.235, 0.17), ringY(10, hy + 0.49, 0.19, 0.13), ringY(10, hy + 0.53, 0.1, 0.08)], { capEnd: true }), 'chest', S, 0.92,
        { blend: { bone: 'spine', y: hy + 0.2, width: 0.16 }, shadeFn: (x, y, z) => (z < 0 ? 0.88 : 1) * lerp(1.05, 0.85, sm((y - hy - 0.3) / 0.25)) });
      ov.F(at(box(0.04, 0.34, 0.04), 0, hy + 0.34, 0.16), 'chest', SD, 1.0);
      // pauldrons: a big dome on the chest plus two lames that follow the arm; feather tufts behind
      for (const side of ['L', 'R']) {
        const s = side === 'L' ? 1 : -1, sh = ov.pos('shoulder' + side);
        ov.F(at(scaled(dome(0.15, 9, 5, 0.5), 1.05, 0.8, 1.05), sh.x + s * 0.05, sh.y + 0.06, 0), 'chest', S, 1.0, { shadeFn: (x, y) => lerp(0.85, 1.1, sm((y - sh.y) / 0.14)) });
        ov.F(at(scaled(dome(0.135, 9, 4, 0.42), 1.05, 0.7, 1.05), sh.x + s * 0.08, sh.y - 0.03, 0), 'shoulder' + side, S, 0.9);
        ov.F(at(scaled(dome(0.12, 9, 4, 0.42), 1.05, 0.7, 1.05), sh.x + s * 0.1, sh.y - 0.12, 0), 'shoulder' + side, S, 0.82);
        ov.F(at(cyl(0.16, 0.16, 0.016, 9), sh.x + s * 0.05, sh.y + 0.06, 0), 'chest', col.accent, 0.9);
        for (let i = 0; i < 3; i++) ov.F(at(rz(rx(box(0.018, 0.22, 0.05), -1.1 - i * 0.25), s * (0.3 + i * 0.3)), sh.x + s * (0.06 + i * 0.04), sh.y + 0.1, -0.1 - i * 0.03), 'chest', FE, 1.05);
      }
      // tassets over the hips, greaves on the shins, sabaton caps
      for (let i = 0; i < 6; i++) {
        const a = -1.15 + i * 0.46, plate = ry(rx(box(0.15, 0.24, 0.025), -0.15), a);
        ov.F(at(plate, Math.sin(a) * 0.21, hy - 0.15, Math.cos(a) * 0.17 + 0.02), 'hips', S, 0.88, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.02, bottom: hy - 0.3, max: 0.5 } });
      }
      ov.F(at(cyl(0.2, 0.21, 0.06, 10), 0, hy + 0.03, 0), 'hips', LEA, 1.2);
      for (const side of ['L', 'R']) {
        const kn = ov.pos('knee' + side), an = ov.pos('ankle' + side);
        ov.F(loft([ringY(8, kn.y - 0.03, 0.068, 0.072, kn.x, 0.004, 0.75), ringY(8, kn.y - 0.2, 0.064, 0.07, kn.x, 0, 0.75), ringY(8, an.y + 0.08, 0.055, 0.06, an.x, 0.004, 0.75)], { capStart: true }), 'knee' + side, S, 0.9, { blend: { bone: 'ankle' + side, y: an.y + 0.08, width: 0.06 } });
        ov.F(at(sph(0.07, 8, 5), kn.x, kn.y, 0.01), 'knee' + side, SD, 0.95);
      }
      // tall shield on the left forearm: tapered body, raised rim, centre ridge, pale chevron
      const el = ov.pos('elbowL'), wr = ov.pos('wristL'), fy = (el.y + wr.y) * 0.5;
      const body = [[-0.29, 0.58], [0, 0.64], [0.29, 0.58], [0.31, 0.05], [0.17, -0.5], [0, -0.72], [-0.17, -0.5], [-0.31, 0.05]];
      const inner = body.map(([x, y]) => [x * 0.86, y * 0.88 + 0.01]);
      ov.F(at(prism(body, 0.035), el.x, fy, 0.1), 'elbowL', SD, 0.9, { blend: { bone: 'wristL', y: wr.y + 0.02, width: 0.08 } });
      ov.F(at(prism(inner, 0.03), el.x, fy, 0.13), 'elbowL', S, 0.82, { shadeFn: (x, y) => lerp(1.08, 0.85, sm((y - fy + 0.4) / 0.9)) });
      ov.F(at(rz(box(0.05, 0.42, 0.02), 0.55), el.x - 0.12, fy + 0.12, 0.15), 'elbowL', col.accent, 1.0); ov.F(at(rz(box(0.05, 0.42, 0.02), -0.55), el.x + 0.12, fy + 0.12, 0.15), 'elbowL', col.accent, 1.0);
      ov.F(at(box(0.04, 0.9, 0.03), el.x, fy - 0.05, 0.155), 'elbowL', SD, 1.0);
    },
  },
  /** Ironeye: slim hooded scout, iron half-mask, quiver and harness, tall recurve bow in the left hand. */
  Ironeye: {
    base: { hood: true, helm: false, cloak: true },
    scale: [0.94, 1.0, 0.94],
    dress(ov, col) {
      const hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0)), hy = ov.pos('hips').y, ny = ov.pos('neck').y;
      const IRON = mixc(PALETTE.iron, PALETTE.steelDark, 0.5), LEA = PALETTE.leather, FLE = mixc(col.accent, PALETTE.moon, 0.4);
      // mask: a curved iron plate from the brow to the chin across the face opening, with a pale seam
      ov.F(loft([arc(9, hc.y + 0.08, 0.128, -1.05, 1.05, hc.z - 0.01), arc(9, hc.y + 0.0, 0.135, -1.15, 1.15, hc.z - 0.01), arc(9, hc.y - 0.09, 0.13, -1.05, 1.05, hc.z - 0.015), arc(9, hc.y - 0.15, 0.11, -0.8, 0.8, hc.z - 0.02)], { closed: false }), 'head', IRON, 0.85,
        { shadeFn: (x, y) => lerp(1.05, 0.8, sm((hc.y + 0.08 - y) / 0.22)) });
      ov.F(at(box(0.17, 0.012, 0.02), 0, hc.y + 0.02, hc.z + 0.128), 'head', mixc(PALETTE.steel, PALETTE.moon, 0.3), 1.2);
      // quiver on the back (tilted), arrows with pale fletching
      const q = rz(cyl(0.05, 0.044, 0.52, 7), 0.42);
      ov.F(at(q, -0.13, hy + 0.36, -0.17), 'chest', LEA, 1.1, { blend: { bone: 'spine', y: hy + 0.25, width: 0.1 } });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU, ox = Math.cos(a) * 0.025, oz = Math.sin(a) * 0.025;
        ov.F(at(rz(cyl(0.005, 0.005, 0.36, 4), 0.42), -0.13 - 0.14 + ox, hy + 0.36 + 0.36, -0.17 + oz), 'chest', PALETTE.woodDark, 1.1);
        ov.F(at(rz(box(0.024, 0.07, 0.004), 0.42), -0.13 - 0.2 + ox, hy + 0.36 + 0.5, -0.17 + oz), 'chest', FLE, 1.15);
      }
      // harness straps across the chest, belt pouches, bracer on the bow arm
      ov.F(at(rz(box(0.05, 0.62, 0.02), 0.5), 0.0, hy + 0.3, 0.16), 'chest', LEA, 1.0, { blend: { bone: 'spine', y: hy + 0.2, width: 0.14 } });
      ov.F(at(rz(box(0.05, 0.62, 0.02), -0.5), 0.0, hy + 0.3, -0.15), 'chest', LEA, 0.9, { blend: { bone: 'spine', y: hy + 0.2, width: 0.14 } });
      ov.F(at(box(0.11, 0.1, 0.07), 0.17, hy - 0.08, 0.08), 'hips', LEA, 1.05);
      const el = ov.pos('elbowL'), wr = ov.pos('wristL');
      ov.F(loft([ringY(8, wr.y + 0.17, 0.054, 0.05, el.x, 0, 0.7), ringY(8, wr.y + 0.02, 0.042, 0.04, el.x, 0, 0.7)], { capStart: true, capEnd: true }), 'elbowL', LEA, 1.25, { blend: { bone: 'wristL', y: wr.y + 0.02, width: 0.04 } });
      void ny; // (the bow is the swappable weapon mesh: setRigWeapon)
    },
  },
  /** Raider: hulking, bare-armed, pelt over one shoulder, iron-banded belt, fur boots, a great axe carried head-down. */
  Raider: {
    base: { hood: false, helm: false, cloak: false },
    scale: [1.17, 1.12, 1.17],
    dress(ov, col) {
      const hy = ov.pos('hips').y, ny = ov.pos('neck').y, hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0));
      const SKIN = mixc(PALETTE.skin, PALETTE.skinDark, 0.32), FUR = mixc(PALETTE.wolfFur, PALETTE.leather, 0.45), FURP = mixc(PALETTE.wolfFur, PALETTE.skin, 0.3), LEA = PALETTE.leather, IRON = mixc(PALETTE.iron, PALETTE.steelDark, 0.5);
      // bare barrel chest over the tunic, pec shelf, a diagonal harness with iron studs
      ov.S(loft([ringY(10, hy - 0.01, 0.2, 0.15), ringY(10, hy + 0.14, 0.225, 0.165), ringY(10, hy + 0.3, 0.262, 0.185), ringY(10, hy + 0.42, 0.258, 0.18, 0, -0.004), ringY(10, hy + 0.5, 0.2, 0.14, 0, -0.01), ringY(10, hy + 0.55, 0.1, 0.085, 0, -0.01)], { capEnd: true }), 'chest', SKIN, 0.98,
        { blend: { bone: 'spine', y: hy + 0.18, width: 0.18 }, shadeFn: (x, y, z) => (z < 0 ? 0.86 : 1) * lerp(1.02, 0.84, sm((y - hy - 0.3) / 0.3)) * (Math.abs(x) < 0.03 && z > 0 ? 0.9 : 1) });
      ov.F(at(rz(box(0.08, 0.7, 0.02), 0.6), 0.02, hy + 0.3, 0.2), 'chest', LEA, 0.95, { blend: { bone: 'spine', y: hy + 0.2, width: 0.14 } });
      for (let i = 0; i < 4; i++) ov.F(at(box(0.03, 0.03, 0.02), -0.2 + i * 0.13, hy + 0.5 - i * 0.13, 0.215), 'chest', IRON, 1.2);
      // bulky bare arms over the sleeves, iron arm rings
      for (const side of ['L', 'R']) {
        const sh = ov.pos('shoulder' + side), el = ov.pos('elbow' + side), wr = ov.pos('wrist' + side), s = side === 'L' ? 1 : -1;
        ov.S(loft([ringY(10, sh.y + 0.07, 0.1, 0.095, sh.x + s * 0.015), ringY(10, sh.y - 0.05, 0.105, 0.1, sh.x + s * 0.01), ringY(10, sh.y - 0.16, 0.085, 0.082, sh.x), ringY(10, el.y + 0.06, 0.068, 0.066, el.x), ringY(10, el.y - 0.01, 0.06, 0.06, el.x)], { capStart: true }), 'shoulder' + side, SKIN, 1.0,
          { blend: { bone: 'elbow' + side, y: el.y, width: 0.1 }, shadeFn: (x, y) => lerp(0.84, 1.02, sm((sh.y - y) / 0.2)) });
        ov.S(at(sph(0.062, 8, 6), el.x, el.y, 0), 'elbow' + side, SKIN, 0.95);
        ov.S(loft([ringY(10, el.y - 0.01, 0.06, 0.06, el.x), ringY(10, el.y - 0.08, 0.068, 0.064, el.x), ringY(10, el.y - 0.17, 0.058, 0.054, el.x), ringY(10, wr.y + 0.03, 0.046, 0.044, el.x), ringY(10, wr.y - 0.01, 0.042, 0.04, el.x)], { capEnd: true }), 'elbow' + side, SKIN, 1.0, { blend: { bone: 'wrist' + side, y: wr.y, width: 0.06 } });
        ov.F(at(cyl(0.108, 0.108, 0.035, 9), sh.x + s * 0.005, sh.y - 0.07, 0), 'shoulder' + side, IRON, 1.1);
        ov.F(loft([ringY(8, wr.y + 0.16, 0.064, 0.06, el.x, 0, 0.7), ringY(8, wr.y + 0.03, 0.05, 0.047, el.x, 0, 0.7)], { capStart: true, capEnd: true }), 'elbow' + side, LEA, 1.1, { blend: { bone: 'wrist' + side, y: wr.y + 0.03, width: 0.04 } });
      }
      // pelt over the left shoulder and across the back, fur collar
      ov.F(fan(0.14, ny + 0.06, 0.36, ny - 0.3, 0.12, 8, 0.6, 3.9), 'chest', FUR, 0.95, { shadeFn: (x, y) => lerp(0.8, 1.1, sm((ny + 0.06 - y) / 0.35)) });
      ov.F(fan(0.12, ny + 0.1, 0.22, ny - 0.1, 0.06, 7, 0.6, 3.9), 'chest', FURP, 0.9);
      ov.F(at(cyl(0.1, 0.15, 0.1, 9, true), 0, ny + 0.07, -0.02), 'neck', FUR, 1.0);
      // belt with iron plates, fur loincloth strips, leather pteruges
      ov.F(at(cyl(0.215, 0.225, 0.1, 10), 0, hy + 0.0, 0), 'hips', LEA, 1.15);
      for (let i = 0; i < 5; i++) { const a = -1.1 + i * 0.55; ov.F(at(ry(box(0.1, 0.08, 0.025), a), Math.sin(a) * 0.22, hy, Math.cos(a) * 0.2), 'hips', IRON, 1.15); }
      for (let i = 0; i < 7; i++) {
        const a = -1.35 + i * 0.45, st = ry(rx(box(0.07, 0.26, 0.02), -0.1), a);
        ov.F(at(st, Math.sin(a) * 0.2, hy - 0.17, Math.cos(a) * 0.16 + 0.02), 'hips', LEA, 0.95, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.02, bottom: hy - 0.32, max: 0.55 } });
      }
      ov.F(at(rx(box(0.16, 0.34, 0.03), -0.12), 0, hy - 0.2, 0.17), 'hips', FUR, 1.0, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.02, bottom: hy - 0.38, max: 0.35 } });
      ov.F(at(rx(box(0.2, 0.36, 0.03), 0.1), 0, hy - 0.22, -0.15), 'hips', FUR, 0.85, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.02, bottom: hy - 0.4, max: 0.35 } });
      // fur boot cuffs, long braid down the back
      for (const side of ['L', 'R']) { const kn = ov.pos('knee' + side); ov.F(at(cyl(0.078, 0.09, 0.12, 8), kn.x, kn.y - 0.2, 0), 'knee' + side, FUR, 1.0); }
      for (let i = 0; i < 7; i++) ov.S(at(sph(0.032 - i * 0.002, 7, 5), 0, hc.y + 0.06 - i * 0.06, -0.14 - i * 0.03), 'head', col.secondary, 0.9);
      // (the great axe is the swappable weapon mesh: setRigWeapon)
    },
  },
  /** Recluse: wide drooping witch hat with a crooked crown, long pale hair, floor-length robe, bell sleeves, glintstone. */
  Recluse: {
    base: { hood: false, helm: false, cloak: true },
    scale: [1.0, 1.0, 1.0],
    dress(ov, col) {
      const hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0)), hy = ov.pos('hips').y, ny = ov.pos('neck').y, an = ov.pos('ankleL').y;
      const HAT = mixc(col.primary, PALETTE.clothDark, 0.55), BAND = mixc(col.accent, PALETTE.clothDark, 0.55), HAIR = mixc(PALETTE.moon, PALETTE.stone, 0.42), ROBE = mixc(col.primary, PALETTE.clothDark, 0.3), LIN = mixc(col.secondary, PALETTE.stone, 0.4);
      // hat: brim (wavy drooping rim), band, tall crown bending back, charm chain
      const hb = hc.y + 0.075;
      const brim = loft([ringY(16, hb + 0.005, 0.135, 0.135, 0, 0, 1), ringY(16, hb - 0.008, 0.3, 0.3, 0, 0, 1), ringY(16, hb - 0.04, 0.43, 0.42, 0, -0.02, 1), ringWave(16, hb - 0.085, 0.48, 0.018, -0.03, 0.95)], {});
      brim.rotateX(-0.1);
      ov.F(brim, 'head', HAT, 1.0, { shadeFn: (x, y) => lerp(1.0, 0.86, sm((hb - y) / 0.08)) });
      const crown = loft([ringY(14, hb, 0.138, 0.138, 0, 0, 1), ringY(14, hb + 0.1, 0.125, 0.125, 0, -0.01, 1), ringY(14, hb + 0.22, 0.092, 0.092, 0, -0.04, 1), ringY(14, hb + 0.34, 0.055, 0.055, 0, -0.11, 1), ringY(14, hb + 0.44, 0.025, 0.025, 0, -0.2, 1), ringY(14, hb + 0.49, 0.006, 0.006, 0, -0.27, 1)], { capEnd: true });
      crown.rotateX(-0.1);
      ov.F(crown, 'head', HAT, 1.0, { shadeFn: (x, y, z) => lerp(0.95, 1.12, sm((y - hb) / 0.5)) * (z < -0.05 ? 0.9 : 1) });
      ov.F(at(rx(cyl(0.145, 0.145, 0.04, 14), -0.1), 0, hb + 0.03, 0.003), 'head', BAND, 1.0);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ov.F(at(sph(0.012, 5, 4), Math.sin(a) * 0.47, hb - 0.1 - 0.03 * Math.cos(a), Math.cos(a) * 0.45 - 0.03), 'head', PALETTE.gold, 1.3); }
      // long pale hair: a sheet behind the head and neck, two locks before the shoulders
      ov.S(loft([ringY(10, hc.y + 0.04, 0.12, 0.06, 0, -0.06, 1), ringY(10, hc.y - 0.14, 0.135, 0.05, 0, -0.1, 1), ringY(10, ny - 0.16, 0.15, 0.04, 0, -0.13, 1), ringY(10, ny - 0.42, 0.14, 0.035, 0, -0.15, 1), ringY(10, ny - 0.6, 0.1, 0.03, 0, -0.16, 1)], { capEnd: true }), 'head', HAIR, 0.95,
        { blend: { bone: 'chest', y: ny - 0.2, width: 0.3 }, shadeFn: (x, y) => lerp(1.0, 0.78, sm((hc.y - y) / 0.7)) });
      for (const s of [-1, 1]) ov.S(at(scaled(sph(0.03, 6, 5), 1, 5.5, 0.8), s * 0.12, hc.y - 0.2, 0.05), 'head', HAIR, 0.95);
      // robe: floor-length skirt with a paler inner panel, waist sash, bell sleeves
      ov.F(loft([ringY(12, hy - 0.03, 0.19, 0.14), ringY(12, hy - 0.3, 0.27, 0.21), ringY(12, hy - 0.6, 0.33, 0.26), ringY(12, an + 0.04, 0.37, 0.3)], {}), 'hips', ROBE, 1.0,
        { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: an, max: 0.45 }, shadeFn: (x, y, z) => (z < 0 ? 0.88 : 1) * lerp(1.0, 0.82, sm((hy - y) / 0.9)) });
      ov.F(at(box(0.13, 0.84, 0.012), 0, hy - 0.46, 0.255), 'hips', LIN, 1.1, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: an, max: 0.3 } });
      ov.F(at(cyl(0.2, 0.205, 0.08, 10), 0, hy + 0.02, 0), 'hips', BAND, 1.05);
      for (const side of ['L', 'R']) {
        const el = ov.pos('elbow' + side), wr = ov.pos('wrist' + side);
        ov.F(loft([ringY(9, el.y - 0.08, 0.058, 0.056, el.x), ringY(9, wr.y + 0.08, 0.09, 0.085, el.x), ringY(9, wr.y - 0.04, 0.12, 0.115, el.x)], {}), 'elbow' + side, ROBE, 1.0, { blend: { bone: 'wrist' + side, y: wr.y, width: 0.1 }, shadeFn: (x, y) => lerp(1.0, 0.82, sm((y - wr.y + 0.04) / 0.2)) });
      }
      // a book in the left hand (the glintstone staff + crystal is the swappable weapon mesh: setRigWeapon)
      const hl = ov.pos('wristL').clone().add(new THREE.Vector3(0, -0.05, 0.012));
      ov.F(at(box(0.15, 0.2, 0.036), hl.x, hl.y - 0.03, hl.z + 0.045), 'wristL', mixc(PALETTE.leather, PALETTE.sparkBlood, 0.35), 1.05);
      ov.F(at(box(0.135, 0.185, 0.024), hl.x, hl.y - 0.03, hl.z + 0.052), 'wristL', mixc(PALETTE.moon, PALETTE.skin, 0.35), 1.1);
    },
  },
  /** Executor: conical straw hat pulled low, bandaged arms and face, sheathed katana at the hip, grey ponytail. */
  Executor: {
    base: { hood: false, helm: false, cloak: true },
    scale: [1.0, 1.0, 1.0],
    dress(ov, col) {
      const hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0)), hy = ov.pos('hips').y, ny = ov.pos('neck').y;
      const STRAW = mixc(PALETTE.terrain.straw, PALETTE.leather, 0.3), LINEN = mixc(PALETTE.moon, PALETTE.leather, 0.4), HAIR = mixc(PALETTE.stone, PALETTE.moon, 0.35), RED = mixc(col.secondary, PALETTE.sparkBlood, 0.3);
      // kasa: shallow cone with ridged facets, a chin cord
      const hk = hc.y + 0.02;
      const kasa = loft([ringY(16, hk + 0.19, 0.015, 0.015, 0, 0, 1), ringY(16, hk + 0.15, 0.12, 0.12, 0, 0, 1), ringY(16, hk + 0.09, 0.25, 0.25, 0, 0, 1), ringY(16, hk + 0.02, 0.36, 0.36, 0, 0, 1), ringWave(16, hk - 0.01, 0.39, 0.006)], {});
      kasa.rotateX(-0.12);
      ov.F(kasa, 'head', STRAW, 1.0, { shadeFn: (x, y) => lerp(1.08, 0.88, sm((hk + 0.19 - y) / 0.2)) });
      ov.F(at(rx(loft([ringY(16, hk + 0.0, 0.37, 0.37, 0, 0, 1), ringY(16, hk - 0.03, 0.26, 0.26, 0, 0, 1), ringY(16, hk - 0.05, 0.14, 0.14, 0, 0, 1)], {}), -0.12), 0, 0, 0), 'head', mixc(STRAW, PALETTE.clothDark, 0.5), 0.8);
      // face wrap at eye level, neck wrap
      ov.F(at(cyl(0.128, 0.13, 0.045, 12), 0, hc.y + 0.015, 0.002), 'head', LINEN, 0.95);
      ov.F(at(cyl(0.075, 0.085, 0.08, 9), 0, ny + 0.06, 0), 'neck', LINEN, 0.9);
      // bandage bands on the arms, a diagonal torso wrap
      for (const side of ['L', 'R']) {
        const sh = ov.pos('shoulder' + side), el = ov.pos('elbow' + side), wr = ov.pos('wrist' + side);
        for (let i = 0; i < 3; i++) ov.F(at(cyl(0.046 + i * 0.004, 0.05 + i * 0.004, 0.035, 8), el.x, wr.y + 0.06 + i * 0.07, 0), 'elbow' + side, LINEN, 0.95 - i * 0.02, { blend: { bone: 'wrist' + side, y: wr.y + 0.02, width: 0.04 } });
        for (let i = 0; i < 2; i++) ov.F(at(cyl(0.07, 0.072, 0.04, 8), sh.x, sh.y - 0.12 - i * 0.08, 0), 'shoulder' + side, LINEN, 0.92);
      }
      ov.F(at(rz(box(0.09, 0.62, 0.015), 0.62), 0.02, hy + 0.3, 0.175), 'chest', LINEN, 0.9, { blend: { bone: 'spine', y: hy + 0.2, width: 0.14 } });
      // sheath at the left hip with a red cord, ponytail
      ov.F(at(rz(rx(box(0.045, 0.86, 0.035), 0.25), 0.2), 0.2, hy - 0.25, -0.05), 'hips', mixc(PALETTE.clothDark, PALETTE.woodDark, 0.4), 1.0);
      ov.F(at(cyl(0.04, 0.04, 0.03, 7), 0.17, hy - 0.02, 0.0), 'hips', RED, 1.1);
      ov.F(at(cyl(0.2, 0.2, 0.05, 10), 0, hy + 0.03, 0), 'hips', RED, 1.0);
      ov.S(loft([ringY(8, hc.y + 0.02, 0.035, 0.03, 0, -0.13), ringY(8, hc.y - 0.2, 0.04, 0.03, 0, -0.16), ringY(8, ny - 0.25, 0.03, 0.025, 0, -0.18), ringY(8, ny - 0.5, 0.015, 0.012, 0, -0.17)], { capStart: true, capEnd: true }), 'head', HAIR, 0.95, { blend: { bone: 'chest', y: ny - 0.1, width: 0.3 } });
    },
  },
  /** Duchess: slim, hair in a high bun, pleated ruff, fitted bodice with a pale front, split skirt and bustle, twin daggers. */
  Duchess: {
    base: { hood: false, helm: false, cloak: false },
    scale: [0.95, 1.0, 0.95],
    dress(ov, col) {
      const hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0)), hy = ov.pos('hips').y, ny = ov.pos('neck').y, kn = ov.pos('kneeL').y;
      const HAIR = mixc(col.secondary, PALETTE.clothDark, 0.55), CREAM = mixc(PALETTE.moon, PALETTE.skin, 0.3), DRESS = mixc(col.primary, PALETTE.clothDark, 0.25), WINE = mixc(col.secondary, PALETTE.sparkBlood, 0.25), G = PALETTE.gold;
      // bun with a gold pin, side locks, circlet
      ov.S(at(scaled(sph(0.075, 8, 6), 1, 0.9, 1), 0, hc.y + 0.11, -0.09), 'head', HAIR, 0.9);
      ov.F(at(ry(box(0.2, 0.012, 0.012), 0.6), 0, hc.y + 0.14, -0.09), 'head', G, 1.3);
      for (const s of [-1, 1]) ov.S(at(scaled(sph(0.028, 6, 5), 1, 4.5, 0.9), s * 0.115, hc.y - 0.06, 0.03), 'head', HAIR, 0.9);
      ov.F(at(cyl(0.126, 0.126, 0.014, 12), 0, hc.y + 0.08, 0), 'head', G, 1.1);
      // pleated ruff
      ov.F(loft([ringY(18, ny + 0.035, 0.085, 0.08, 0, 0, 1), ringWave(18, ny + 0.02, 0.19, 0.022, 0, 1)], {}), 'neck', CREAM, 1.0, { blend: { bone: 'chest', y: ny, width: 0.05 } });
      // bodice, pale front panel with buttons, lace cuffs
      ov.F(loft([ringY(10, hy + 0.02, 0.175, 0.128), ringY(10, hy + 0.14, 0.158, 0.118), ringY(10, hy + 0.3, 0.205, 0.142), ringY(10, hy + 0.45, 0.21, 0.147), ringY(10, hy + 0.51, 0.16, 0.115)], {}), 'chest', DRESS, 1.0,
        { blend: { bone: 'spine', y: hy + 0.2, width: 0.18 }, shadeFn: (x, y, z) => (z < 0 ? 0.88 : 1) * lerp(1.02, 0.86, sm((y - hy - 0.3) / 0.25)) });
      ov.F(at(box(0.11, 0.4, 0.014), 0, hy + 0.27, 0.146), 'chest', CREAM, 1.05, { blend: { bone: 'spine', y: hy + 0.2, width: 0.14 } });
      for (let i = 0; i < 4; i++) ov.F(at(sph(0.012, 5, 4), 0, hy + 0.12 + i * 0.1, 0.155), 'chest', G, 1.3);
      for (const side of ['L', 'R']) { const el = ov.pos('elbow' + side), wr = ov.pos('wrist' + side); ov.F(at(cyl(0.048, 0.075, 0.06, 9, true), el.x, wr.y + 0.035, 0), 'elbow' + side, CREAM, 1.0, { blend: { bone: 'wrist' + side, y: wr.y + 0.02, width: 0.04 } }); }
      // split skirt (open at the front), wine lining glimpsed at the edges, bustle at the back, sash
      ov.F(loft([arc(12, hy - 0.03, 0.19, 0.45, TAU - 0.45), arc(12, hy - 0.25, 0.31, 0.4, TAU - 0.4, -0.02), arc(12, hy - 0.55, 0.41, 0.35, TAU - 0.35, -0.05), arc(12, kn - 0.12, 0.47, 0.3, TAU - 0.3, -0.08)], { closed: false }), 'hips', DRESS, 1.0,
        { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: kn - 0.1, max: 0.5 }, shadeFn: (x, y, z) => (z < 0 ? 0.86 : 1) * lerp(1.0, 0.84, sm((hy - y) / 0.7)) });
      for (const s of [-1, 1]) ov.F(at(rx(box(0.06, 0.75, 0.012), 0.12), s * 0.2, hy - 0.4, 0.21), 'hips', WINE, 1.0, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: kn - 0.1, max: 0.5 } });
      ov.F(at(scaled(sph(0.15, 9, 6), 1.25, 0.6, 0.85), 0, hy - 0.06, -0.2), 'hips', DRESS, 0.95);
      ov.F(at(cyl(0.19, 0.2, 0.06, 10), 0, hy + 0.02, 0), 'hips', WINE, 1.05);
      // (both daggers are the swappable weapon mesh: setRigWeapon)
    },
  },
  /** Revenant: veiled in pale cloth, floor-length gown, bone staff, lyre, and a doll companion at her hip. */
  Revenant: {
    base: { hood: false, helm: false, cloak: false },
    scale: [0.98, 1.0, 0.98],
    dress(ov, col) {
      const hc = ov.pos('head').clone().add(new THREE.Vector3(0, 0.12, 0)), hy = ov.pos('hips').y, ny = ov.pos('neck').y, kn = ov.pos('kneeL').y, an = ov.pos('ankleL').y;
      const VEIL = mixc(PALETTE.moon, col.primary, 0.38), GOWN = mixc(col.primary, PALETTE.stone, 0.25), DARK = mixc(col.secondary, PALETTE.clothDark, 0.4), LACE = mixc(PALETTE.moon, PALETTE.skin, 0.4), G = mixc(PALETTE.gold, PALETTE.moon, 0.3);
      // circlet and veil: open at the face, draping over the shoulders down the back
      ov.F(at(cyl(0.132, 0.132, 0.016, 12), 0, hc.y + 0.1, 0), 'head', G, 1.2);
      ov.F(loft([arc(11, hc.y + 0.11, 0.135, 0.8, TAU - 0.8), arc(11, hc.y - 0.04, 0.16, 0.75, TAU - 0.75, -0.01), arc(11, hc.y - 0.24, 0.2, 0.7, TAU - 0.7, -0.03), arc(11, ny - 0.3, 0.27, 0.65, TAU - 0.65, -0.05), arc(11, hy + 0.18, 0.3, 0.6, TAU - 0.6, -0.06, 1.05)], { closed: false }), 'head', VEIL, 0.9,
        { blend: { bone: 'chest', y: ny - 0.05, width: 0.3 }, shadeFn: (x, y, z) => lerp(1.05, 0.78, sm((hc.y + 0.1 - y) / 0.9)) * (z < -0.05 ? 0.9 : 1) });
      // gown to the floor with a lace hem, dark bodice, hanging sleeves, pendant
      ov.F(loft([ringY(12, hy - 0.03, 0.19, 0.14), ringY(12, hy - 0.32, 0.26, 0.2), ringY(12, kn, 0.31, 0.25), ringY(12, an - 0.01, 0.36, 0.29)], {}), 'hips', GOWN, 1.0,
        { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: an, max: 0.4 }, shadeFn: (x, y, z) => (z < 0 ? 0.88 : 1) * lerp(1.0, 0.8, sm((hy - y) / 0.95)) });
      ov.F(at(cyl(0.365, 0.37, 0.035, 12, true), 0, an + 0.02, 0), 'hips', LACE, 1.0, { skirt: { L: 'hipL', R: 'hipR', top: hy - 0.05, bottom: an, max: 0.4 } });
      ov.F(loft([ringY(10, hy + 0.02, 0.172, 0.126), ringY(10, hy + 0.16, 0.16, 0.12), ringY(10, hy + 0.32, 0.205, 0.142), ringY(10, hy + 0.47, 0.2, 0.14), ringY(10, hy + 0.52, 0.14, 0.1)], {}), 'chest', DARK, 1.0, { blend: { bone: 'spine', y: hy + 0.2, width: 0.18 }, shadeFn: (x, y, z) => (z < 0 ? 0.88 : 1) });
      for (const side of ['L', 'R']) {
        const el = ov.pos('elbow' + side), wr = ov.pos('wrist' + side);
        ov.F(loft([ringY(9, el.y - 0.06, 0.056, 0.054, el.x), ringY(9, wr.y + 0.1, 0.08, 0.076, el.x), ringY(9, wr.y - 0.1, 0.11, 0.105, el.x, -0.02)], {}), 'elbow' + side, GOWN, 0.95, { blend: { bone: 'wrist' + side, y: wr.y, width: 0.1 } });
      }
      ov.G(at(new THREE.OctahedronGeometry(0.028, 0), 0, hy + 0.42, 0.155), 'chest', col.accent, 1.0);
      // lyre in the left hand (the bone staff is the swappable weapon mesh: setRigWeapon)
      const hl = ov.pos('wristL').clone().add(new THREE.Vector3(0, -0.05, 0.012));
      for (const p of handFrame(lyre(), hl, 0)) ov.F(p.geo, 'wristL', p.color, p.shade);
      // the doll: porcelain head, bonnet, dark dress, stub arms — hovering at her left hip
      const dx = 0.52, dy = hy + 0.22, dz = 0.12;
      ov.S(at(sph(0.062, 9, 7), dx, dy + 0.2, dz), 'hips', mixc(PALETTE.moon, PALETTE.skin, 0.25), 1.0);
      ov.F(at(dome(0.07, 9, 5, 0.55), dx, dy + 0.21, dz - 0.01), 'hips', DARK, 0.95);
      ov.F(loft([ringY(8, dy + 0.15, 0.04, 0.035, dx, dz), ringY(8, dy + 0.02, 0.075, 0.065, dx, dz), ringY(8, dy - 0.14, 0.11, 0.095, dx, dz)], { capStart: true, capEnd: true }), 'hips', DARK, 1.0, { shadeFn: (x, y) => lerp(1.0, 0.8, sm((dy + 0.15 - y) / 0.3)) });
      ov.F(at(cyl(0.042, 0.042, 0.03, 8), dx, dy + 0.14, dz), 'hips', LACE, 1.05);
      for (const s of [-1, 1]) ov.S(at(rz(scaled(sph(0.02, 5, 4), 1, 3.2, 1), s * 0.5), dx + s * 0.08, dy + 0.07, dz), 'hips', DARK, 0.95);
      ov.G(at(sph(0.014, 5, 4), dx, dy + 0.04, dz + 0.07), 'hips', col.accent, 1.0);
    },
  },
};

// -------------------------------------------------------------------------------------------------
// Clips: roster presentation poses + ability poses (merged over HUMANOID_CLIPS per rig)

const E_HIPSY = 0, E_PITCH = 1, E_ROLL = 2, E_YAW = 3;
const PH = { p: 0, k: 0 };
function phase(t, ctx) {
  if (t < ctx.windup) { PH.p = 0; PH.k = t / ctx.windup; return PH; }
  t -= ctx.windup;
  if (t < ctx.active) { PH.p = 1; PH.k = t / ctx.active; return PH; }
  t -= ctx.active;
  if (t < ctx.recover) { PH.p = 2; PH.k = t / ctx.recover; return PH; }
  PH.p = 3; PH.k = 1; return PH;
}
/** Relaxed standing legs, feet a little apart (optionally one foot forward). */
function stand(P, spread = 0.1, fwd = 0) {
  P.set('hipL', -fwd, 0.05, spread); P.set('hipR', fwd * 0.5, -0.05, -spread);
  P.set('kneeL', 0.06 + fwd, 0, 0); P.set('kneeR', 0.06, 0, 0);
  P.set('ankleL', -0.06, 0, 0); P.set('ankleR', -0.06, 0, 0);
}

export const NF_CLIPS = {
  /** Wylder: greatsword shouldered, free hand on the belt, chest up. */
  present_wylder(t, P) {
    const b = Math.sin(t * 1.4);
    P.set('spine', -0.03 + 0.015 * b, 0.1, 0); P.set('chest', -0.05, 0.08, 0); P.set('head', 0.02, -0.15, 0.02);
    P.set('shoulderR', -1.15, 0.3, -0.4); P.set('elbowR', -1.95, 0, 0); P.set('wristR', -0.1, 0, 0);
    P.set('shoulderL', 0.25, 0.3, 0.5); P.set('elbowL', -1.05, 0, 0); P.set('wristL', 0.2, 0, 0);
    stand(P, 0.14, 0.12); P.extra(E_HIPSY, 0.005 * b);
  },
  /** Guardian: at ease, halberd planted diagonally, shield across the front. */
  present_guardian(t, P) {
    const b = Math.sin(t * 1.2);
    P.set('spine', -0.04 + 0.01 * b, -0.08, 0); P.set('chest', -0.04, -0.05, 0); P.set('head', 0.0, 0.12, 0);
    P.set('shoulderR', -0.7, 0.55, -0.25); P.set('elbowR', -0.75, 0, 0); P.set('wristR', 0.5, 0, 0);
    P.set('shoulderL', -0.45, 0.1, 0.28); P.set('elbowL', -1.25, 0, 0); P.set('wristL', 0.1, 0, 0);
    stand(P, 0.2, 0.05);
  },
  /** Ironeye: bow lowered at the side, the other hand reaching for the quiver, head turned. */
  present_ironeye(t, P) {
    const b = Math.sin(t * 1.6);
    P.set('hips', 0, 0.2, 0); P.set('spine', 0.02, -0.1, 0.02); P.set('chest', 0.02 + 0.01 * b, -0.1, 0); P.set('head', -0.03, 0.35, -0.05);
    P.set('shoulderL', -0.12, 0.15, 0.42); P.set('elbowL', -0.25, 0, 0); P.set('wristL', 0.2, 0, 0);
    P.set('shoulderR', -2.45, 0.4, -0.55); P.set('elbowR', -2.05, 0, 0); P.set('wristR', 0.3, 0, 0);
    stand(P, 0.1, 0.3);
  },
  /** Raider: planted wide, chest out, the axe hanging head-down at his side, free fist clenched. */
  present_raider(t, P) {
    const b = Math.sin(t * 1.1);
    P.set('spine', -0.08 + 0.015 * b, 0, 0); P.set('chest', -0.1, 0, 0); P.set('head', 0.06, 0.08, 0);
    P.set('shoulderR', 0.2, 0.1, -0.55); P.set('elbowR', -0.3, 0, 0); P.set('wristR', 0.45, 0, 0);
    P.set('shoulderL', 0.15, -0.1, 0.55); P.set('elbowL', -0.75, 0, 0); P.set('wristL', 0.5, 0, 0);
    stand(P, 0.26, 0.0); P.set('kneeL', 0.1, 0, 0); P.set('kneeR', 0.1, 0, 0);
  },
  /** Recluse: staff planted upright, reading the book held in the other hand, head bowed. */
  present_recluse(t, P) {
    const b = Math.sin(t * 1.3);
    P.set('spine', 0.08, 0.05, 0); P.set('chest', 0.08 + 0.01 * b, 0.05, 0); P.set('head', 0.32, -0.1, 0.03);
    P.set('shoulderR', -0.5, 0.1, -0.2); P.set('elbowR', -0.4, 0, 0); P.set('wristR', 1.1, 0, 0);
    P.set('shoulderL', -0.85, 0.35, 0.12); P.set('elbowL', -1.75, 0, 0); P.set('wristL', -0.35, 0, 0);
    stand(P, 0.06, 0.0);
  },
  /** Executor: low stance, katana held back and low, the free hand on the sheath, face hidden under the hat. */
  present_executor(t, P) {
    const b = Math.sin(t * 1.5);
    P.set('hips', 0, -0.25, 0); P.set('spine', 0.12, 0.1, 0); P.set('chest', 0.1 + 0.01 * b, 0.1, 0); P.set('head', 0.3, 0.05, 0);
    P.set('shoulderR', 0.35, -0.1, -0.3); P.set('elbowR', -0.2, 0, 0); P.set('wristR', 0.75, 0, 0);
    P.set('shoulderL', -0.35, 0.55, 0.15); P.set('elbowL', -1.35, 0, 0); P.set('wristL', 0.3, 0, 0);
    P.set('hipL', -0.35, 0.15, 0.12); P.set('kneeL', 0.55, 0, 0); P.set('ankleL', -0.18, 0, 0);
    P.set('hipR', 0.1, -0.1, -0.14); P.set('kneeR', 0.4, 0, 0); P.set('ankleR', -0.35, 0, 0);
    P.extra(E_HIPSY, -0.08);
  },
  /** Duchess: weight on one hip, a dagger raised beside the shoulder, the other hanging reversed, head tilted. */
  present_duchess(t, P) {
    const b = Math.sin(t * 1.7);
    P.set('hips', 0, 0.08, 0.07); P.set('spine', 0.0, -0.05, -0.05); P.set('chest', -0.02 + 0.01 * b, -0.05, -0.03); P.set('head', 0.04, 0.1, -0.16);
    P.set('shoulderR', -1.55, 0.45, -0.35); P.set('elbowR', -1.95, 0, 0); P.set('wristR', 0.35, 0, 0);
    P.set('shoulderL', 0.12, 0.05, 0.28); P.set('elbowL', -0.4, 0, 0); P.set('wristL', 0.3, 0, 0);
    P.set('hipL', 0, 0.05, 0.04); P.set('kneeL', 0.04, 0, 0); P.set('ankleL', -0.04, 0, 0);
    P.set('hipR', 0.12, -0.05, -0.24); P.set('kneeR', 0.3, 0, 0); P.set('ankleR', -0.25, 0, 0);
    P.extra(E_HIPSY, -0.015);
  },
  /** Revenant: lyre raised before her, staff planted, head bowed beneath the veil. */
  present_revenant(t, P) {
    const b = Math.sin(t * 1.2);
    P.set('spine', 0.04, 0, 0); P.set('chest', 0.04 + 0.01 * b, 0, 0); P.set('head', 0.18, 0.05, 0.04);
    P.set('shoulderL', -0.85, 0.4, 0.25); P.set('elbowL', -1.55, 0, 0); P.set('wristL', 0.15, 0, 0);
    P.set('shoulderR', -0.35, 0.05, -0.3); P.set('elbowR', -0.3, 0, 0); P.set('wristR', 0.85, 0, 0);
    stand(P, 0.05, 0.0);
  },
  /** Spell cast: the staff swings up then thrusts forward with the free hand pushed out at the release. */
  cast(t, P, ctx) {
    const f = phase(t, ctx); let rxR, rxL, lean, push;
    if (f.p === 0) { const k = sm(f.k); rxR = -0.6 - 1.5 * k; rxL = -0.3 - 0.3 * k; lean = -0.12 * k; push = 0; }
    else if (f.p === 1) { const k = f.k; rxR = -2.1 + 0.5 * k; rxL = -0.6 - 0.9 * k; lean = -0.12 + 0.35 * k; push = k; }
    else { const k = sm(f.k); rxR = -1.6 * (1 - k) - 0.1 * k; rxL = -1.5 * (1 - k); lean = 0.23 * (1 - k); push = 1 - k; }
    P.set('shoulderR', rxR, 0.2, -0.3); P.set('elbowR', -0.3, 0, 0); P.set('wristR', 0.9, 0, 0);
    P.set('shoulderL', rxL, -0.3 * push, 0.25); P.set('elbowL', -0.5 + 0.3 * push, 0, 0); P.set('wristL', -0.6 * push, 0, 0);
    P.set('spine', lean * 0.5, 0.15 * push, 0); P.set('chest', lean * 0.6, 0.1 * push, 0); P.set('head', -lean * 0.5, 0, 0);
    P.set('hipL', -0.35, 0.1, 0.08); P.set('kneeL', 0.5, 0, 0); P.set('ankleL', -0.12, 0, 0);
    P.set('hipR', 0.25, 0, -0.1); P.set('kneeR', 0.35, 0, 0); P.set('ankleR', -0.42, 0, 0);
    P.extra(E_HIPSY, -0.05);
  },
  /** Bow draw: the bow arm straightens toward the target, the draw hand comes back to the cheek and snaps open. */
  bow(t, P, ctx) {
    const f = phase(t, ctx); let draw, rel;
    if (f.p === 0) { draw = sm(f.k); rel = 0; } else if (f.p === 1) { draw = 1; rel = f.k; } else { draw = 1 - sm(f.k); rel = 1 - sm(f.k); }
    P.set('hips', 0, 0.7, 0); P.set('spine', 0.02, 0.2, 0); P.set('chest', 0.0, 0.25, 0); P.set('head', -0.05, -0.7, 0);
    P.set('shoulderL', -1.55 * draw - 0.15, 0.6 * draw, 0.4); P.set('elbowL', -0.15, 0, 0); P.set('wristL', 0.35, 0, 0);
    P.set('shoulderR', -1.2 * draw - 0.3, -0.5 * draw, -0.8 * draw - 0.2); P.set('elbowR', -2.2 * draw + 0.6 * rel, 0, 0); P.set('wristR', 0.3, 0, 0);
    P.set('hipL', -0.3, 0.2, 0.14); P.set('kneeL', 0.45, 0, 0); P.set('ankleL', -0.12, 0, 0);
    P.set('hipR', 0.2, -0.2, -0.14); P.set('kneeR', 0.35, 0, 0); P.set('ankleR', -0.35, 0, 0);
    P.extra(E_HIPSY, -0.06);
  },
  /** Whirlwind: arms out with the polearm level; the entity yaw itself is spun by the ability. */
  spin(t, P, ctx) {
    const f = phase(t, ctx); let out;
    if (f.p === 0) out = sm(f.k); else if (f.p === 1) out = 1; else out = 1 - sm(f.k);
    P.set('shoulderR', -1.35 * out - 0.2, 0.1, -1.1 * out - 0.15); P.set('elbowR', -0.2, 0, 0); P.set('wristR', 1.2 * out, 0, 0);
    P.set('shoulderL', -1.2 * out - 0.2, -0.1, 1.1 * out + 0.15); P.set('elbowL', -0.3, 0, 0);
    P.set('spine', 0.1 * out, 0, 0); P.set('chest', 0.12 * out, 0, 0); P.set('head', -0.1 * out, 0, 0);
    P.set('hipL', -0.3, 0.1, 0.2); P.set('kneeL', 0.5, 0, 0); P.set('ankleL', -0.15, 0, 0);
    P.set('hipR', -0.3, -0.1, -0.2); P.set('kneeR', 0.5, 0, 0); P.set('ankleR', -0.15, 0, 0);
    P.extra(E_HIPSY, -0.14 * out);
  },
  /** Leap: wings out (arms spread and up), legs tucked; k = airborne fraction (ctx.param). */
  leap(t, P, ctx) {
    const k = clamp01(ctx.param), tuck = Math.sin(k * Math.PI);
    P.set('shoulderR', -0.9 - 0.8 * tuck, 0, -1.3 - 0.4 * tuck); P.set('elbowR', -0.4, 0, 0); P.set('wristR', 0.6, 0, 0);
    P.set('shoulderL', -0.9 - 0.8 * tuck, 0, 1.3 + 0.4 * tuck); P.set('elbowL', -0.4, 0, 0);
    P.set('spine', -0.15 + 0.35 * tuck, 0, 0); P.set('chest', -0.1 + 0.2 * tuck, 0, 0); P.set('head', -0.2 * (1 - tuck), 0, 0);
    P.set('hipL', -0.9 * tuck, 0.1, 0.18); P.set('hipR', -0.9 * tuck, -0.1, -0.18); P.set('kneeL', 1.4 * tuck + 0.1, 0, 0); P.set('kneeR', 1.4 * tuck + 0.1, 0, 0);
    P.set('ankleL', 0.3 * tuck, 0, 0); P.set('ankleR', 0.3 * tuck, 0, 0);
    P.extra(E_PITCH, -0.15 * tuck);
  },
  /** Roar / transformation: arms thrown back, chest to the sky, then a crouch. */
  roar(t, P, ctx) {
    const f = phase(t, ctx); let open, crouch;
    if (f.p === 0) { open = sm(f.k); crouch = 0.3 * sm(f.k); } else if (f.p === 1) { open = 1; crouch = 0.3 + 0.7 * f.k; } else { const k = sm(f.k); open = 1 - k; crouch = 1 - k; }
    P.set('shoulderR', 0.5 * open - 0.2, 0, -1.2 * open - 0.2); P.set('elbowR', -0.6 * open - 0.2, 0, 0); P.set('wristR', 0.4, 0, 0);
    P.set('shoulderL', 0.5 * open - 0.2, 0, 1.2 * open + 0.2); P.set('elbowL', -0.6 * open - 0.2, 0, 0);
    P.set('spine', -0.35 * open + 0.3 * crouch, 0, 0); P.set('chest', -0.3 * open + 0.25 * crouch, 0, 0); P.set('head', -0.5 * open + 0.2 * crouch, 0, 0);
    P.set('hipL', -0.3 - 0.4 * crouch, 0.15, 0.22); P.set('kneeL', 0.5 + 0.7 * crouch, 0, 0); P.set('ankleL', -0.15, 0, 0);
    P.set('hipR', -0.3 - 0.4 * crouch, -0.15, -0.22); P.set('kneeR', 0.5 + 0.7 * crouch, 0, 0); P.set('ankleR', -0.15, 0, 0);
    P.extra(E_HIPSY, -0.1 - 0.3 * crouch);
  },
};
void E_ROLL; void E_YAW;

// -------------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------------
// Swappable weapon mesh: one more SkinnedMesh on the rig's skeleton (same trick as the costume overlay), rebuilt
// whenever the held weapon changes, so the rig itself never has a weapon baked in.

/** Class signature looks for a base weapon visual (display only: combat spans / HUD glyphs use the base visual). */
const SIGNATURE = { Raider: { axe: 'greatAxe' }, Revenant: { staff: 'spiritStaff' }, Recluse: { staff: 'glintstaff' } };
export function signatureVisual(nfId, visual) { const s = SIGNATURE[nfId]; return (s && s[visual]) || visual; }

/**
 * Give the rig a weapon mesh for `visual` (a WEAPONS visual or a signature look), replacing any it holds.
 * Bows go in the left fist (the draw hand is the right), daggers are a pair, staves carry a glowing head.
 */
export function setRigWeapon(rig, visual, col) {
  if (rig.weaponMesh) {
    rig.mesh.remove(rig.weaponMesh);
    rig.weaponMesh.geometry.dispose();
    const mats = rig.weaponMesh.material; if (Array.isArray(mats) && mats[2]) mats[2].dispose(); // the per-mesh glow
    rig.weaponMesh = null;
  }
  rig.weaponVisual = visual || 'none';
  if (!visual || visual === 'none') return null;
  const ov = new Overlay(rig), rb = ov.rb;
  const accent = (col && col.accent) || PALETTE.gold;
  const hr = ov.pos('wristR').clone().add(new THREE.Vector3(0, -0.05, 0.012));
  const hl = ov.pos('wristL').clone().add(new THREE.Vector3(0, -0.05, 0.012));
  // base visuals shade exactly as createHumanoid bakes them (steel lifted, the rest plain)
  const base = (v) => { for (const w of weaponParts(v)) rb.part(at(w.geo, hr.x, hr.y, hr.z), 'wristR', w.color, 0, w.color === PALETTE.steel ? 1.45 : 1.0); };
  const head = (geo, along) => { geo.rotateX(-0.35); geo.translate(hr.x, hr.y + along * Math.cos(0.35), hr.z - along * Math.sin(0.35)); return geo; };
  switch (visual) {
    case 'greatAxe': for (const p of handFrame(greatAxe(), hr)) ov.F(p.geo, 'wristR', p.color, p.shade); break;
    case 'spiritStaff':
      for (const p of handFrame(spiritStaff(), hr)) ov.F(p.geo, 'wristR', p.color, p.shade);
      ov.G(head(scaled(new THREE.OctahedronGeometry(0.04, 1), 0.9, 1.5, 0.9), 0.58), 'wristR', accent, 1.0); // caged spirit flame
      break;
    case 'glintstaff':
      base('staff');
      ov.G(head(scaled(new THREE.OctahedronGeometry(0.075, 0), 0.8, 1.25, 0.8), 0.42), 'wristR', accent, 1.0); // crystal over the orb
      break;
    case 'bow': for (const p of handFrame(bow(), hl, 0)) ov.F(p.geo, 'wristL', p.color, p.shade); break;
    case 'dagger': base('dagger'); for (const p of handFrame(dagger(), hl)) ov.F(p.geo, 'wristL', p.color, p.shade); break;
    default: base(visual); break;
  }
  rig.weaponMesh = ov.build();
  return rig.weaponMesh;
}

/**
 * Build a dressed Nightfarer. Returns the base humanoid interface ({ root, mesh, bones, animator, materials, cloak,
 * contacts, handRLocal, update, setGroundNormal }) plus `overlay` (the costume SkinnedMesh), `glow` (its emissive
 * material), `nf`, `weaponMesh` / `weaponVisual` and `setWeapon(visual)` (swaps the held weapon mesh; the class's
 * starting weapon is attached here). opts.ground(x, z, n) feeds the foot contact shadows as for createHumanoid.
 */
export function createNightfarerRig(nf, opts = {}) {
  const id = nf && nf.id, C = COSTUMES[id] || COSTUMES.Wylder;
  const colors = NIGHTFARER_COLORS[id] || NIGHTFARER_COLORS.Wylder;
  const rig = createHumanoid({ colors, weapon: 'none', armed: true, hood: C.base.hood, helm: C.base.helm, cloak: C.base.cloak, scarf: C.base.scarf || (C.base.cloak ? colors.accent : null), ground: opts.ground || null });
  const ov = new Overlay(rig);
  C.dress(ov, colors, rig);
  rig.overlay = ov.build();
  rig.glow = ov.glow;
  rig.root.scale.set(C.scale[0], C.scale[1], C.scale[2]);
  rig.animator.clips = { ...HUMANOID_CLIPS, ...NF_CLIPS };
  rig.nf = nf;
  rig.presentClip = 'present_' + String(id || 'wylder').toLowerCase();
  rig.weaponMesh = null; rig.weaponVisual = 'none';
  rig.setWeapon = (visual) => setRigWeapon(rig, visual, colors);
  const start = WEAPONS[nf && nf.weapon];
  rig.setWeapon(signatureVisual(id, start ? start.visual : 'sword'));
  return rig;
}

/** Body scale per class (the Player uses it for reach / hit volumes). */
export function nightfarerScale(id) { const C = COSTUMES[id]; return C ? C.scale[1] : 1; }
