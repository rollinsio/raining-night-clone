/**
 * Instanced low-poly props: dead trees (2 small + 2 hero variants), rocks, boulders, crag formations, clumped
 * grass tufts (tall wispy / short dense), gravestones, standing stones, ruin fragments (columns / arches / wall
 * stubs) and iron braziers with emissive flames. Stone props carry baked per-face value (pale crowns, dark
 * flanks). Dense scatter types are bucketed into a 4x4 region grid so frustum culling discards far regions;
 * sparse silhouette types are one InstancedMesh each. Limveld supplies landmarks, braziers, meadows and tracks.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat, emissive, grassMat } from '../render/Style.js';
import { vnoise } from './Terrain.js';

const REGIONS = 4;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _dummy = new THREE.Object3D();
const _c = new THREE.Color();
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();

/** Vertex colours as a vertical gradient hexBottom -> hexTop over [yMin, yMax]. */
function colorize(geo, hexBottom, hexTop, yMin, yMax) {
  const n = geo.attributes.position.count, pos = geo.attributes.position.array, col = new Float32Array(n * 3);
  const a = new THREE.Color(hexBottom), b = new THREE.Color(hexTop);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (pos[i * 3 + 1] - yMin) / (yMax - yMin)));
    _c.copy(a).lerp(b, t);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Tapered limb from `from` along `dir` with length len. */
function limb(from, dir, len, r0, r1, segs = 4) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true);
  g.translate(0, len / 2, 0);
  _dir.copy(dir).normalize();
  _q.setFromUnitVectors(_up, _dir);
  g.applyQuaternion(_q);
  g.translate(from.x, from.y, from.z);
  return g;
}

function deadTree(rng, variant) {
  const parts = [];
  const h = variant === 0 ? 5.2 : 4.0;
  const lean = new THREE.Vector3(rng.range(-0.12, 0.12), 1, rng.range(-0.12, 0.12));
  parts.push(limb(new THREE.Vector3(0, -0.3, 0), lean, h, 0.42, 0.12, 5));
  const nb = variant === 0 ? 5 : 4;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rng.range(-0.4, 0.4), y = 1.9 + (i / nb) * (h - 2.4);
    const tilt = rng.range(0.55, 1.0);
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt));
    const from = new THREE.Vector3(lean.x * y * 0.9, y, lean.z * y * 0.9);
    const len = rng.range(1.6, 2.8);
    parts.push(limb(from, d, len, 0.11, 0.03));
    const twigs = rng.int(1, 2);
    for (let t = 0; t < twigs; t++) {
      const k = rng.range(0.45, 0.8);
      const f2 = from.clone().addScaledVector(d, len * k);
      const d2 = d.clone().add(new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(0.2, 0.9), rng.range(-0.8, 0.8))).normalize();
      parts.push(limb(f2, d2, rng.range(0.7, 1.3), 0.05, 0.015, 3));
    }
  }
  const top = new THREE.Vector3(lean.x * h, h, lean.z * h);
  parts.push(limb(top, new THREE.Vector3(rng.range(-0.3, 0.3), 1, rng.range(-0.3, 0.3)), 1.2, 0.12, 0.02));
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.treeDark, PALETTE.treePale, 0, h + 1);
}

/** Big gnarled ancient tree: thick trunk, wide reaching crown with sub-branches (silhouette landmark, ~12 m). */
function heroTree(rng, variant) {
  const parts = [];
  const h = variant === 0 ? 9.5 : 8;
  const lean = new THREE.Vector3(rng.range(-0.1, 0.1), 1, rng.range(-0.1, 0.1));
  parts.push(limb(new THREE.Vector3(0, -0.6, 0), lean, h, 1.15, 0.45, 6));
  // root flare
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    parts.push(limb(new THREE.Vector3(Math.cos(a) * 0.6, -0.4, Math.sin(a) * 0.6), new THREE.Vector3(Math.cos(a) * 0.8, -0.3, Math.sin(a) * 0.8), rng.range(1.4, 2.2), 0.45, 0.08, 4));
  }
  const nb = variant === 0 ? 7 : 6;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rng.range(-0.35, 0.35), y = h * 0.45 + (i / nb) * h * 0.5;
    const tilt = rng.range(0.25, 0.75);
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt));
    const from = new THREE.Vector3(lean.x * y, y, lean.z * y);
    const len = rng.range(4, 6.5);
    parts.push(limb(from, d, len, 0.38, 0.1, 5));
    const subs = rng.int(2, 3);
    for (let t = 0; t < subs; t++) {
      const k = rng.range(0.4, 0.9);
      const f2 = from.clone().addScaledVector(d, len * k);
      const d2 = d.clone().add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(0.3, 1.1), rng.range(-0.9, 0.9))).normalize();
      const l2 = rng.range(1.8, 3.2);
      parts.push(limb(f2, d2, l2, 0.14, 0.03, 4));
      const f3 = f2.clone().addScaledVector(d2, l2 * rng.range(0.5, 0.9));
      const d3 = d2.clone().add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(0.2, 0.9), rng.range(-0.9, 0.9))).normalize();
      parts.push(limb(f3, d3, rng.range(0.8, 1.6), 0.06, 0.015, 3));
    }
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.treeDark, PALETTE.treePale, -0.5, h + 4);
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const fhash = (i, seed) => { const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * Per-face stone shading (value structure baked like the terrain): pale where a face points up, dark on the
 * flanks, a faint lift with height and a per-face jitter so facets step. Returns a non-indexed geometry.
 */
function shadeRock(geo, hexDark, hexLight, yMin, yMax, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array, n = g.attributes.position.count, col = new Float32Array(n * 3);
  const a = new THREE.Color(hexDark), b = new THREE.Color(hexLight);
  for (let f = 0; f < n; f += 3) {
    const o = f * 3;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const up = Math.max(0, ny / (Math.hypot(nx, ny, nz) || 1));
    const ht = clamp01(((pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3 - yMin) / (yMax - yMin));
    const t = clamp01(0.2 + up * up * 0.55 + ht * 0.25 + (fhash(f, seed) - 0.5) * 0.2);
    _c.copy(a).lerp(b, t);
    for (let k = 0; k < 3; k++) { col[o + k * 3] = _c.r; col[o + k * 3 + 1] = _c.g; col[o + k * 3 + 2] = _c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function rock(rng) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * rng.range(0.75, 1.25), p.getY(i) * rng.range(0.55, 0.9), p.getZ(i) * rng.range(0.75, 1.25));
  }
  return shadeRock(g, PALETTE.rockPropDark, PALETTE.rockProp, -0.7, 0.9, 3);
}

/** Boulder: subdivided icosahedron displaced by position-hashed noise (seams stay closed), squat, dark flanks / pale top. */
function boulder(rng, variant) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, sx = rng.range(0.85, 1.3), sz = rng.range(0.8, 1.2), sy = variant === 0 ? 0.68 : 0.85;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + (vnoise(x * 1.9 + 7 + variant * 3, y * 1.9 + z * 1.1, 55) - 0.5) * 0.5;
    p.setXYZ(i, x * d * sx, y * d * sy, z * d * sz);
  }
  return shadeRock(g, PALETTE.boulderDark, PALETTE.boulder, -0.7, 0.85, 4 + variant);
}

/**
 * Crag: Ashen-style stacked-slab cliff — a stepped pile of wide, slightly offset, anisotropic prisms (each
 * layer smaller than the one below), a leaning spine on top and a couple of fallen blocks at the foot.
 * ~9-14 m; dark slate flanks with pale horizontal crowns so every step reads as a ledge.
 */
function crag(rng, variant) {
  const parts = [];
  const H = variant === 0 ? 12 : 8.5, layers = variant === 0 ? 4 : 3, R = variant === 0 ? 7.5 : 5;
  // the whole stack drifts sideways as it rises (a leaning, eroded pile), layer radii wander rather than taper
  const driftX = rng.range(-0.9, 0.9), driftZ = rng.range(-0.9, 0.9);
  let y = -1.8, ox = 0, oz = 0;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1), h = rng.range(1.0, 2.0) * (H / 12) * (i === 0 ? 1.5 : 1);
    const r = R * (1 - t * 0.45) * rng.range(0.62, 1.15);
    const g = new THREE.CylinderGeometry(r * rng.range(0.8, 1.0), r, h, rng.int(5, 7), 1);
    g.scale(rng.range(0.6, 1.5), 1, rng.range(0.6, 1.5));
    g.translate(0, h / 2, 0);
    g.rotateY(rng.float() * 6.28); g.rotateX(rng.range(-0.12, 0.12)); g.rotateZ(rng.range(-0.14, 0.14));
    ox += driftX + rng.range(-1.4, 1.4); oz += driftZ + rng.range(-1.4, 1.4);
    g.translate(ox, y, oz);
    parts.push(g.toNonIndexed());
    y += h * rng.range(0.7, 0.9);
  }
  // two unequal leaning spines on the summit: a notched crest instead of a single apex
  for (let k = 0; k < 2; k++) {
    const sh = H * (k === 0 ? rng.range(0.38, 0.5) : rng.range(0.2, 0.32)), sr = R * (k === 0 ? 0.4 : 0.28);
    const spine = new THREE.CylinderGeometry(sr * 0.35, sr, sh, 5, 1);
    spine.scale(rng.range(0.8, 1.3), 1, rng.range(0.8, 1.3));
    spine.translate(0, sh / 2, 0); spine.rotateZ(rng.range(-0.25, 0.25)); spine.rotateX(rng.range(-0.15, 0.15)); spine.rotateY(rng.float() * 6.28);
    const a = rng.float() * 6.28, d = k === 0 ? R * 0.12 : R * 0.4;
    spine.translate(ox + Math.cos(a) * d, y - 0.6, oz + Math.sin(a) * d);
    parts.push(spine.toNonIndexed());
  }
  // fallen blocks at the foot
  for (let k = 0; k < 3; k++) {
    const b = new THREE.CylinderGeometry(rng.range(0.9, 1.6), rng.range(1.4, 2.4), rng.range(0.7, 1.5), rng.int(4, 6), 1);
    const a = rng.float() * 6.28, d = R * rng.range(0.95, 1.35);
    b.rotateY(a); b.rotateX(rng.range(-0.3, 0.3)); b.translate(Math.cos(a) * d, -0.7, Math.sin(a) * d);
    parts.push(b.toNonIndexed());
  }
  const g = mergeGeometries(parts, false);
  return shadeRock(g, PALETTE.cragDark, PALETTE.crag, -1, H, 6 + variant);
}

/**
 * Cliff: Ashen-style sheer rock — a row of tall tilted slabs (square-section prisms scaled flat) leaning the
 * same way, tallest near the middle, each a few big flat faces with pale crowns and dark flanks, and a scatter
 * of fallen blocks along the foot. Variant 0: five slabs ~14 m; variant 1: three slabs ~9 m. ~100-170 tris.
 */
function cliff(rng, variant) {
  const parts = [];
  const n = variant === 0 ? 5 : 3, H = variant === 0 ? 14 : 9, step = variant === 0 ? 3.4 : 2.7;
  const lean = rng.range(-0.16, -0.06), yaw0 = rng.range(-0.12, 0.12), tiltSign = rng.chance(0.5) ? 1 : -1;
  let x = -(n - 1) * 0.5 * step;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5, mid = 1 - Math.abs(t - 0.5) * 2;
    const h = H * (0.55 + 0.45 * mid) * rng.range(0.85, 1.1);
    const r = (variant === 0 ? 2.3 : 1.8) * rng.range(0.85, 1.15);
    const g = new THREE.CylinderGeometry(r * rng.range(0.45, 0.7), r, h, 4, 1);
    g.rotateY(Math.PI / 4);                                      // square section: four flat faces
    g.scale(rng.range(1.15, 1.5), 1, rng.range(0.5, 0.75));      // flat slab along the row
    g.translate(0, h / 2 - 1.5, 0);
    g.rotateX(lean * rng.range(0.7, 1.3));                       // the whole row leans back
    g.rotateZ(tiltSign * rng.range(0.02, 0.12));                 // slabs tip sideways together
    g.rotateY(yaw0 + rng.range(-0.2, 0.2));
    g.translate(x + rng.range(-0.3, 0.3), 0, rng.range(-0.7, 0.7));
    parts.push(g.toNonIndexed());
    x += step * rng.range(0.85, 1.1);
  }
  for (let k = 0; k < (variant === 0 ? 4 : 2); k++) {
    const b = new THREE.CylinderGeometry(rng.range(0.6, 1.1), rng.range(1.0, 1.7), rng.range(0.7, 1.4), 4, 1);
    b.rotateY(rng.float() * 6.28); b.rotateX(rng.range(-0.3, 0.3));
    b.translate(rng.range(-(n - 1) * 0.5 * step, (n - 1) * 0.5 * step), -0.6, rng.range(1.6, 3.0) * (rng.chance(0.5) ? 1 : -1));
    parts.push(b.toNonIndexed());
  }
  const g = mergeGeometries(parts, false);
  return shadeRock(g, PALETTE.cragDark, PALETTE.crag, -1, H, 8 + variant);
}

/** Blade-tuft recipes: blade count, height range, width, lean range and base spread (m). */
const TUFTS = [
  { n: 7, h: [0.2, 0.34], w: 0.03, lean: [0.16, 0.38], r0: 0.1 },     // tall wispy fountain
  { n: 8, h: [0.09, 0.18], w: 0.038, lean: [0.1, 0.26], r0: 0.12 },   // short cushion
  { n: 11, h: [0.14, 0.28], w: 0.042, lean: [0.24, 0.5], r0: 0.26 },  // broad hay clump, wider than tall
];
/** Three clump tints (multiply the dark-base -> tuft-colour gradient): cool olive, straw, pale dry. */
const TUFT_TINTS = [[0.66, 0.72, 0.72], [1.0, 0.92, 0.66], [1.18, 1.08, 0.8]];

/**
 * Grass tuft: thin curved blades (base quad + tip triangle), single winding with an up-facing normal — the grass
 * material is double-sided without the normal flip, so blades are lit like the ground from every side.
 * Three silhouettes (TUFTS) so clumps vary in shape, not just scale.
 */
function grassTuft(rng, variant) {
  const v = [], { n: nB, h: hr, w, lean: lr, r0: spread } = TUFTS[variant];
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const h = rng.range(hr[0], hr[1]), lean = rng.range(lr[0], lr[1]);
    const cx = Math.cos(a), cz = Math.sin(a), r0 = rng.range(0, spread), px = -cz, pz = cx;
    const bx = cx * r0, bz = cz * r0, mx = cx * (r0 + lean * 0.35), my = h * 0.55, mz = cz * (r0 + lean * 0.35);
    const b0 = [bx + px * w, 0, bz + pz * w], b1 = [bx - px * w, 0, bz - pz * w];
    const m0 = [mx + px * w * 0.7, my, mz + pz * w * 0.7], m1 = [mx - px * w * 0.7, my, mz - pz * w * 0.7];
    const tip = [cx * (r0 + lean), h, cz * (r0 + lean)];
    v.push(...b0, ...b1, ...m1, ...b0, ...m1, ...m0, ...m0, ...m1, ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  const nrm = new Float32Array(v.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return colorize(g, PALETTE.grassTuftDark, PALETTE.grassTuft, 0, hr[1] * 0.95);
}

function gravestone(rng, variant) {
  const parts = [];
  if (variant === 0) {
    const b = new THREE.BoxGeometry(0.5, 0.8, 0.12); b.translate(0, 0.4, 0); parts.push(b);
    const c = new THREE.CylinderGeometry(0.25, 0.25, 0.12, 8); c.rotateX(Math.PI / 2); c.translate(0, 0.8, 0); parts.push(c);
  } else {
    const b = new THREE.BoxGeometry(0.16, 1.1, 0.12); b.translate(0, 0.55, 0); parts.push(b);
    const c = new THREE.BoxGeometry(0.55, 0.14, 0.12); c.translate(0, 0.82, 0); parts.push(c);
  }
  const base = new THREE.BoxGeometry(0.7, 0.15, 0.4); base.translate(0, 0.05, 0); parts.push(base);
  const g = mergeGeometries(parts, false);
  return colorize(g, PALETTE.stoneDark, PALETTE.grave, 0, 1.0);
}

/** Tall tapered standing stone with a chipped top (4-sided, ~7 m). */
function monolith(rng) {
  const body = new THREE.CylinderGeometry(0.55, 0.95, 7, 4, 1);
  body.translate(0, 3.2, 0);
  const cap = new THREE.CylinderGeometry(0.05, 0.55, 0.9, 4, 1);
  cap.translate(0, 7.1, 0);
  cap.rotateZ(rng.range(-0.25, 0.25));
  const g = mergeGeometries([body, cap], false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.monolithDark, PALETTE.monolith, -0.5, 7.5);
}

/** Broken column: fluted shaft, optional square capital, a wider plinth. */
function brokenColumn(rng, tall) {
  const h = tall ? rng.range(4.5, 6.5) : rng.range(1.4, 2.8);
  const shaft = new THREE.CylinderGeometry(0.42, 0.5, h, 8, 1); shaft.translate(0, h / 2, 0);
  const plinth = new THREE.BoxGeometry(1.3, 0.35, 1.3); plinth.translate(0, 0.17, 0);
  const parts = [shaft, plinth];
  if (tall) { const cap = new THREE.BoxGeometry(1.2, 0.4, 1.2); cap.translate(0, h + 0.2, 0); parts.push(cap); }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.stoneDark, PALETTE.stoneLight, -0.3, h + 0.5);
}

/** Free-standing pointed arch: two piers and two leaning lintel blocks meeting at the apex. */
function archFragment() {
  const parts = [];
  for (const x of [-1.6, 1.6]) { const p = new THREE.BoxGeometry(0.9, 4.2, 1.0); p.translate(x, 2.1, 0); parts.push(p); }
  const len = 2.1, ang = 0.75;
  for (const sgn of [-1, 1]) {
    const b = new THREE.BoxGeometry(len, 0.7, 1.0);
    b.rotateZ(-sgn * ang);
    b.translate(sgn * 0.85, 4.2 + Math.sin(ang) * len / 2 - 0.05, 0);
    parts.push(b);
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.stoneDark, PALETTE.stoneLight, -0.3, 6);
}

/** Wall stub with a stepped broken top. */
function wallStub(rng) {
  const L = rng.range(3.5, 5.5), H = rng.range(2.2, 3.4);
  const a = new THREE.BoxGeometry(L, H, 0.85); a.translate(0, H / 2, 0);
  const b = new THREE.BoxGeometry(L * 0.4, H * 0.45, 0.85); b.translate(-L * 0.28, H + H * 0.22, 0);
  const c = new THREE.BoxGeometry(L * 0.18, H * 0.2, 0.85); c.translate(L * 0.32, H + H * 0.1, 0);
  const g = mergeGeometries([a, b, c], false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.stoneDark, PALETTE.stoneLight, -0.3, H * 1.5);
}

/** Iron brazier: tripod legs, bowl, coal rim. Flame is a separate emissive cone. */
function brazier() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.04, 0.05, 1.1, 4); leg.translate(0, 0.55, 0); leg.rotateZ(0.22); leg.rotateY(a); parts.push(leg);
  }
  const bowl = new THREE.CylinderGeometry(0.55, 0.25, 0.4, 8, 1, true); bowl.translate(0, 1.0, 0); parts.push(bowl);
  const rim = new THREE.TorusGeometry(0.55, 0.05, 4, 10); rim.rotateX(Math.PI / 2); rim.translate(0, 1.2, 0); parts.push(rim);
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.computeVertexNormals();
  return colorize(g, PALETTE.iron, PALETTE.iron, 0, 1);
}
function flame() {
  const g = new THREE.ConeGeometry(0.38, 1.1, 5); g.translate(0, 1.7, 0);
  const g2 = new THREE.ConeGeometry(0.2, 0.7, 4); g2.translate(0.08, 2.2, -0.05);
  const m = mergeGeometries([g, g2], false);
  return colorize(m, PALETTE.torch, PALETTE.spark, 1.2, 2.6);
}

export class Props {
  constructor(game, terrain, limveld, rng) {
    this.game = game; this.terrain = terrain; this.limveld = limveld; this.rng = rng;
    this.group = new THREE.Group(); this.group.name = 'props';
    this.meshes = [];
  }

  _regionOf(x, z) {
    const s = this.terrain.size / REGIONS, h = this.terrain.half;
    const rx = Math.min(REGIONS - 1, Math.max(0, Math.floor((x + h) / s)));
    const rz = Math.min(REGIONS - 1, Math.max(0, Math.floor((z + h) / s)));
    return rz * REGIONS + rx;
  }

  /** Create InstancedMeshes from a list of {x,y,z,ry,s,sy,tx,tz,cr,cg,cb} placements (bucketed per region unless bucket=false). */
  _instance(geo, placements, material, { castShadow = true, receiveShadow = true, color = true, bucket = true } = {}) {
    const buckets = bucket ? Array.from({ length: REGIONS * REGIONS }, () => []) : [placements];
    if (bucket) for (const p of placements) buckets[this._regionOf(p.x, p.z)].push(p);
    for (const list of buckets) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        _dummy.position.set(p.x, p.y, p.z);
        _dummy.rotation.set(p.tx || 0, p.ry || 0, p.tz || 0);
        _dummy.scale.set(p.s, p.sy ?? p.s, p.s);
        _dummy.updateMatrix();
        im.setMatrixAt(i, _dummy.matrix);
        if (color) im.setColorAt(i, _c.setRGB(p.cr ?? 1, p.cg ?? 1, p.cb ?? 1));
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = castShadow; im.receiveShadow = receiveShadow;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      this.group.add(im);
      this.meshes.push(im);
    }
  }

  /** Scatter everything by terrain rules. Call after Limveld.plan() and Terrain.build(). */
  build() {
    const T = this.terrain, L = this.limveld, rng = this.rng;
    const half = T.half - 40;
    const ok = (x, z, margin) => {
      const h = T.getHeight(x, z);
      return h > T.waterLevel + 1.2 && L.isClear(x, z, margin);
    };
    const mat = vertexMat();

    // small dead trees: explicit landmarks (ridge-crest lines that read against the fog bands) + clumped
    // forests via low-frequency noise
    const treeGeos = [deadTree(rng, 0), deadTree(rng, 1)];
    const trees = [[], []];
    let n = 0;
    for (const lm of L.landmarks) {
      if (lm.type !== 'tree') continue;
      const s = lm.s ?? 1.2, tint = lm.tint ?? 1;
      trees[lm.v ?? 0].push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - 0.1, z: lm.z, ry: lm.ry ?? rng.float() * 6.28, s, sy: s * (lm.sy ?? 1.1), cr: tint, cg: tint, cb: tint * 1.05 });
      n++;
    }
    for (let i = 0; i < 14000 && n < 900; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 7) || T.pathDist(x, z) < 2.5) continue;
      const h = T.getHeight(x, z), nrm = T.getNormal(x, z);
      if (1 - nrm.y > 0.42 || h > 58) continue;
      const forest = vnoise(x * 0.0045 + 7, z * 0.0045, 21);
      const density = forest > 0.5 ? 0.55 : 0.07;
      if (rng.float() > density * (h > 36 ? 0.35 : 1)) continue;
      const v = rng.chance(0.55) ? 0 : 1;
      const s = rng.range(0.6, 1.7), tint = rng.range(0.85, 1.2);
      trees[v].push({ x, y: h - 0.1, z, ry: rng.float() * 6.28, s, sy: s * rng.range(0.9, 1.3), cr: tint, cg: tint, cb: tint * 1.05 });
      n++;
    }
    this._instance(treeGeos[0], trees[0], mat);
    this._instance(treeGeos[1], trees[1], mat);

    // hero trees: explicit landmarks + a sparse scatter preferring hilltops and ridges
    const heroGeos = [heroTree(rng, 0), heroTree(rng, 1)];
    const heroes = [[], []];
    for (const lm of L.landmarks) {
      if (lm.type !== 'heroTree') continue;
      heroes[lm.v ?? 0].push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - 0.2, z: lm.z, ry: lm.ry ?? 0, s: lm.s ?? 1.2, cr: 0.95, cg: 0.95, cb: 1 });
    }
    for (let i = 0; i < 6000 && heroes[0].length + heroes[1].length < 70; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 12)) continue;
      const h = T.getHeight(x, z), slope = 1 - T.getNormal(x, z).y;
      if (slope > 0.3 || h > 60) continue;
      const crest = vnoise(x * 0.003 + 13, z * 0.003, 22);
      if (rng.float() > 0.08 + Math.max(0, h - 12) * 0.012 + crest * 0.25) continue;
      const tint = rng.range(0.85, 1.1);
      heroes[rng.chance(0.5) ? 0 : 1].push({ x, y: h - 0.2, z, ry: rng.float() * 6.28, s: rng.range(0.9, 1.5), cr: tint, cg: tint, cb: tint * 1.05 });
    }
    this._instance(heroGeos[0], heroes[0], mat, { bucket: false });
    this._instance(heroGeos[1], heroes[1], mat, { bucket: false });

    // rocks: more on slopes, shores, meadows and along the worn tracks
    const rockGeo = rock(rng), rocks = [];
    for (let i = 0; i < 7000 && rocks.length < 1100; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      const h = T.getHeight(x, z);
      if (h < T.waterLevel - 1 || !L.isClear(x, z, 4)) continue;
      const slope = 1 - T.getNormal(x, z).y, pd = T.pathDist(x, z);
      const shore = Math.abs(h - T.waterLevel) < 3 ? 0.5 : 0, track = pd > 1.6 && pd < 5 ? 0.5 : 0;
      if (pd < 1.4 || rng.float() > 0.2 + slope * 1.6 + shore + track + L.meadowBoost(x, z) * 0.4) continue;
      const s = rng.range(0.35, 2.2) * (slope > 0.4 ? 1.4 : 1), tint = rng.range(0.85, 1.15);
      rocks.push({ x, y: h - s * 0.25, z, ry: rng.float() * 6.28, tx: rng.range(-0.2, 0.2), tz: rng.range(-0.2, 0.2), s, sy: s * rng.range(0.6, 1.1), cr: tint, cg: tint, cb: tint });
    }
    this._instance(rockGeo, rocks, mat);

    // boulders: explicit landmarks + scatter favouring slopes, crests, track sides and meadow edges
    const boulderGeos = [boulder(rng, 0), boulder(rng, 1)], boulders = [[], []];
    for (const lm of L.landmarks) {
      if (lm.type !== 'boulder') continue;
      const s = lm.s ?? 1.5;
      boulders[lm.v ?? (s > 1.6 ? 0 : 1)].push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - s * 0.32, z: lm.z, ry: lm.ry ?? 0, tx: 0.08, tz: -0.06, s, sy: s * 0.9, cr: 1, cg: 1, cb: 1 });
    }
    for (let i = 0; i < 9000 && boulders[0].length + boulders[1].length < 420; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 5)) continue;
      const h = T.getHeight(x, z), slope = 1 - T.getNormal(x, z).y, conv = T.concavity(x, z), pd = T.pathDist(x, z);
      if (h > 75 || pd < 1.8) continue;
      const p = 0.02 + slope * 0.9 + Math.max(0, -conv) * 0.12 + (pd < 6 ? 0.25 : 0) + L.meadowBoost(x, z) * 0.12;
      if (rng.float() > p) continue;
      const s = rng.range(0.9, 2.8) * (slope > 0.35 ? 1.3 : 1), tint = rng.range(0.88, 1.12);
      boulders[rng.chance(0.5) ? 0 : 1].push({ x, y: h - s * 0.32, z, ry: rng.float() * 6.28, tx: rng.range(-0.25, 0.25), tz: rng.range(-0.25, 0.25), s, sy: s * rng.range(0.7, 1.05), cr: tint, cg: tint, cb: tint });
    }
    this._instance(boulderGeos[0], boulders[0], mat);
    this._instance(boulderGeos[1], boulders[1], mat);

    // crags: explicit silhouette landmarks + scatter on steep, high ground and ridge crests
    const cragGeos = [crag(rng, 0), crag(rng, 1)], crags = [[], []];
    for (const lm of L.landmarks) {
      if (lm.type !== 'crag') continue;
      crags[lm.v ?? 0].push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - 0.4, z: lm.z, ry: lm.ry ?? 0, tx: rng.range(-0.05, 0.05), tz: rng.range(-0.05, 0.05), s: lm.s ?? 1, cr: 1, cg: 1, cb: 1 });
    }
    for (let i = 0; i < 8000 && crags[0].length + crags[1].length < 70; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 16)) continue;
      const h = T.getHeight(x, z), slope = 1 - T.getNormal(x, z).y, conv = T.concavity(x, z);
      if (h < 16 || h > 95 || T.pathDist(x, z) < 8) continue;
      const p = (slope > 0.3 ? 0.12 : 0) + (conv < -1.0 && h > 24 ? 0.1 : 0) + smoothstep(40, 80, h) * 0.08;
      if (rng.float() > p) continue;
      const tint = rng.range(0.9, 1.1);
      crags[rng.chance(0.5) ? 0 : 1].push({ x, y: h - 0.4, z, ry: rng.float() * 6.28, tx: rng.range(-0.08, 0.08), tz: rng.range(-0.08, 0.08), s: rng.range(0.7, 1.6), sy: rng.range(0.85, 1.3), cr: tint, cg: tint, cb: tint });
    }
    this._instance(cragGeos[0], crags[0], mat, { bucket: false });
    this._instance(cragGeos[1], crags[1], mat, { bucket: false });

    // cliffs: explicit landmark rows (vista crest bands, foreground outcrops) + a sparse scatter on the steepest
    // high ground so every big slope carries some sheer rock
    const cliffGeos = [cliff(rng, 0), cliff(rng, 1)], cliffs = [[], []];
    for (const lm of L.landmarks) {
      if (lm.type !== 'cliff') continue;
      const s = lm.s ?? 1;
      cliffs[lm.v ?? 0].push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - 0.3 * s, z: lm.z, ry: lm.ry ?? 0, tx: rng.range(-0.04, 0.04), tz: rng.range(-0.04, 0.04), s, sy: s * (lm.sy ?? 1), cr: 1, cg: 1, cb: 1 });
    }
    for (let i = 0; i < 8000 && cliffs[0].length + cliffs[1].length < 60; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 16)) continue;
      const h = T.getHeight(x, z), slope = 1 - T.getNormal(x, z).y;
      if (h < 14 || h > 110 || slope < 0.3 || T.pathDist(x, z) < 8) continue;
      if (rng.float() > 0.18 + smoothstep(40, 90, h) * 0.2) continue;
      const nrm = T.getNormal(x, z), tint = rng.range(0.9, 1.1);
      cliffs[rng.chance(0.5) ? 0 : 1].push({ x, y: h - 0.5, z, ry: Math.atan2(nrm.x, nrm.z) + 1.57, tx: rng.range(-0.06, 0.06), tz: rng.range(-0.06, 0.06), s: rng.range(0.8, 1.6), sy: rng.range(0.85, 1.25), cr: tint, cg: tint, cb: tint });
    }
    this._instance(cliffGeos[0], cliffs[0], mat, { bucket: false });
    this._instance(cliffGeos[1], cliffs[1], mat, { bucket: false });

    // grass: clumps (5-12 tufts sharing a tint and silhouette) — uniform meadow noise everywhere, a dense pass
    // in Limveld's meadow zones; thinned on bare ground (dirt patches, scuffs, the worn track) so dark earth
    // shows between the clumps; three tuft silhouettes and a wide cool-olive -> warm-straw tint range
    const grassGeos = [grassTuft(rng, 0), grassTuft(rng, 1), grassTuft(rng, 2)], grass = [[], [], []];
    const gMat = grassMat();
    const clump = (x, z, boost, fixed) => {
      if (!fixed) {
        if (!ok(x, z, 1.5)) return;
        const h0 = T.getHeight(x, z);
        if (h0 > 40 || 1 - T.getNormal(x, z).y > 0.45) return;
        if (rng.float() < T.groundMask(x, z) * 0.85) return;
      }
      const pick = rng.float() + boost * 0.2;
      const v = pick < 0.4 ? 1 : pick < 0.75 ? 2 : 0, k = fixed ? fixed.k : rng.int(3, 7), r = fixed ? fixed.r : rng.range(0.6, 1.6);
      // one of three tints per clump (cool olive / straw / pale dry) — the pale ones are rare highlights
      const wv = fixed && fixed.warm !== undefined ? fixed.warm : rng.float();
      const tint = TUFT_TINTS[wv < 0.45 ? 0 : wv < 0.86 ? 1 : 2], cr = tint[0], cg = tint[1], cb = tint[2];
      const base = rng.range(0.6, 1.0) * (1 + boost * 0.1);
      for (let i = 0; i < k; i++) {
        const a = rng.float() * 6.28, d = Math.sqrt(rng.float()) * r, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        const pm = T.pathMask(px, pz);
        if (pm > 0.3 || !ok(px, pz, fixed ? 0.2 : 1.0)) continue;
        if (rng.float() < Math.max(T.groundMask(px, pz) * 0.6, L.trampledAt(px, pz) * 0.9)) continue;
        const h = T.getHeight(px, pz), t = rng.range(0.9, 1.1);
        grass[v].push({ x: px, y: h - 0.02, z: pz, ry: rng.float() * 6.28, s: base * rng.range(0.7, 1.2) * (1 - pm * 0.6), cr: cr * t, cg: cg * t, cb: cb * t });
      }
    };
    for (const lm of L.landmarks) if (lm.type === 'grass') clump(lm.x, lm.z, 0.3, lm);
    const grassCount = () => grass[0].length + grass[1].length + grass[2].length;
    for (let i = 0; i < 9000 && grassCount() < 2800; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      const meadow = vnoise(x * 0.01, z * 0.01, 33);
      if (rng.float() > 0.1 + meadow * 0.65) continue;
      clump(x, z, 0);
    }
    // meadows: sparse clumps with bare turf between them (m.density scales the pass) + a litter of small dark
    // stones (size biased small, sunk into the turf)
    const meadowRocks = [];
    for (const m of L.meadows) {
      const nC = Math.floor(m.r * m.r / 5 * (m.density ?? 1)), nR = Math.floor(m.r * m.r / 12);
      for (let i = 0; i < nC; i++) {
        const a = rng.float() * 6.28, d = Math.sqrt(rng.float());
        if (rng.float() > 1 - d * d * 0.7) continue;
        clump(m.x + Math.cos(a) * d * m.r, m.z + Math.sin(a) * d * m.r, 1 - d * d);
      }
      for (let i = 0; i < nR; i++) {
        const a = rng.float() * 6.28, d = Math.sqrt(rng.float()) * m.r, x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
        if (!ok(x, z, 2.5) || T.pathDist(x, z) < 1.3) continue;
        const u = rng.float(), s = 0.22 + u * u * 0.95, tint = rng.range(0.8, 1.1);
        meadowRocks.push({ x, y: T.getHeight(x, z) - s * 0.35, z, ry: rng.float() * 6.28, tx: rng.range(-0.25, 0.25), tz: rng.range(-0.25, 0.25), s, sy: s * rng.range(0.5, 0.9), cr: tint, cg: tint, cb: tint });
      }
    }
    for (const lm of L.landmarks) {
      if (lm.type !== 'rock') continue;
      const s = lm.s ?? 1;
      meadowRocks.push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - s * 0.3, z: lm.z, ry: lm.ry ?? 0, tx: 0.1, tz: -0.08, s, sy: s * 0.6, cr: 1.05, cg: 1.05, cb: 1.05 });
    }
    // track litter: small dark stones kicked to the verges of the worn tracks (about one every 2 m of track)
    for (const path of T.paths) {
      const pts = path.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let k = 0, nS = Math.floor(len / 2); k < nS; k++) {
          const t = rng.float(), side = rng.chance(0.5) ? 1 : -1, off = side * (path.w * 0.9 + rng.float() * rng.float() * 3.5);
          const x = ax + (bx - ax) * t + nx * off, z = az + (bz - az) * t + nz * off;
          if (!ok(x, z, 1.2)) continue;
          const u = rng.float(), s = 0.16 + u * u * 0.6, tint = rng.range(0.8, 1.1);
          meadowRocks.push({ x, y: T.getHeight(x, z) - s * 0.4, z, ry: rng.float() * 6.28, tx: rng.range(-0.3, 0.3), tz: rng.range(-0.3, 0.3), s, sy: s * rng.range(0.5, 0.85), cr: tint, cg: tint, cb: tint });
        }
      }
    }
    this._instance(grassGeos[0], grass[0], gMat, { castShadow: false });
    this._instance(grassGeos[1], grass[1], gMat, { castShadow: false });
    this._instance(grassGeos[2], grass[2], gMat, { castShadow: false });
    this._instance(rockGeo, meadowRocks, mat);

    // standing stones: explicit landmarks + scatter on ridges
    const monoGeo = monolith(rng), monos = [];
    for (const lm of L.landmarks) {
      if (lm.type !== 'monolith') continue;
      monos.push({ x: lm.x, y: T.getHeight(lm.x, lm.z) - 0.3, z: lm.z, ry: lm.ry ?? 0, tx: rng.range(-0.06, 0.06), tz: rng.range(-0.06, 0.06), s: lm.s ?? 1, cr: 1, cg: 1, cb: 1 });
    }
    for (let i = 0; i < 5000 && monos.length < 50; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 8)) continue;
      const h = T.getHeight(x, z), slope = 1 - T.getNormal(x, z).y;
      if (slope > 0.28 || h > 70) continue;
      if (rng.float() > 0.03 + Math.max(0, h - 14) * 0.01) continue;
      const tint = rng.range(0.9, 1.1);
      monos.push({ x, y: h - 0.3, z, ry: rng.float() * 6.28, tx: rng.range(-0.12, 0.12), tz: rng.range(-0.12, 0.12), s: rng.range(0.7, 1.5), sy: rng.range(0.8, 1.4), cr: tint, cg: tint, cb: tint });
    }
    this._instance(monoGeo, monos, mat, { bucket: false });

    // ruin fragments: small clusters on high, flat ground
    const colTall = brokenColumn(rng, true), colShort = brokenColumn(rng, false), archGeo = archFragment(), wallGeo = wallStub(rng);
    const cols = [[], []], arches = [], walls = [];
    for (const lm of L.landmarks) {
      if (lm.type !== 'ruinBit') continue;
      const p = { x: lm.x, y: T.getHeight(lm.x, lm.z) - 0.15, z: lm.z, ry: lm.ry ?? 0, s: lm.s ?? 1, cr: 1, cg: 1, cb: 1 };
      if (lm.sub === 'arch') arches.push(p); else if (lm.sub === 'wall') walls.push(p); else cols[lm.sub === 'colShort' ? 1 : 0].push(p);
    }
    for (let i = 0, sites = 0; i < 6000 && sites < 30; i++) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!ok(x, z, 14)) continue;
      const h = T.getHeight(x, z), slope = 1 - T.getNormal(x, z).y;
      if (slope > 0.18 || h < 12 || h > 60) continue;
      if (rng.float() > 0.05 + (h - 12) * 0.01) continue;
      sites++;
      const yaw = rng.float() * 6.28, tint = rng.range(0.9, 1.08);
      const nc = rng.int(2, 5);
      for (let k = 0; k < nc; k++) {
        const a = rng.float() * 6.28, r = rng.range(2, 7), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        cols[rng.chance(0.45) ? 0 : 1].push({ x: px, y: T.getHeight(px, pz) - 0.15, z: pz, ry: yaw + rng.range(-0.2, 0.2), tx: rng.range(-0.05, 0.05), tz: rng.range(-0.05, 0.05), s: rng.range(0.9, 1.2), cr: tint, cg: tint, cb: tint });
      }
      if (rng.chance(0.5)) arches.push({ x, y: h - 0.15, z, ry: yaw, s: rng.range(1, 1.3), cr: tint, cg: tint, cb: tint });
      if (rng.chance(0.6)) { const a = yaw + 1.57, px = x + Math.cos(a) * 5, pz = z + Math.sin(a) * 5; walls.push({ x: px, y: T.getHeight(px, pz) - 0.15, z: pz, ry: yaw + rng.range(-0.3, 0.3), s: 1, cr: tint, cg: tint, cb: tint }); }
    }
    this._instance(colTall, cols[0], mat, { bucket: false });
    this._instance(colShort, cols[1], mat, { bucket: false });
    this._instance(archGeo, arches, mat, { bucket: false });
    this._instance(wallGeo, walls, mat, { bucket: false });

    // braziers (+ emissive flames) where Limveld asked for them
    if (L.braziers.length) {
      const bz = L.braziers.map((b) => ({ x: b.x, y: T.getHeight(b.x, b.z), z: b.z, ry: rng.float() * 6.28, s: 1, cr: 1, cg: 1, cb: 1 }));
      this._instance(brazier(), bz, mat, { bucket: false });
      this._instance(flame(), bz, emissive(PALETTE.torch, 2.2, { vertexColors: true }), { bucket: false, castShadow: false, receiveShadow: false });
    }

    // gravestones: rows near churches and the catacomb
    const graveGeos = [gravestone(rng, 0), gravestone(rng, 1)];
    const graves = [[], []];
    for (const poi of L.pois) {
      if (poi.type !== 'church' && poi.type !== 'catacomb') continue;
      const rows = poi.type === 'church' ? 4 : 3, cols2 = poi.type === 'church' ? 7 : 5;
      const base = poi.type === 'church' ? 17 : 12;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols2; c++) {
        if (rng.chance(0.25)) continue;
        const lx = (c - (cols2 - 1) / 2) * 1.9 + rng.range(-0.2, 0.2), lz = base + r * 2.1 + rng.range(-0.2, 0.2);
        const side = poi.type === 'church' ? -1 : 1;
        const ox = poi.type === 'church' ? lz * side : lx, oz = poi.type === 'church' ? lx : lz;
        const x = poi.x + ox * Math.cos(poi.yaw) + oz * Math.sin(poi.yaw), z = poi.z - ox * Math.sin(poi.yaw) + oz * Math.cos(poi.yaw);
        const h = T.getHeight(x, z);
        if (h < T.waterLevel + 1) continue;
        const v = rng.chance(0.7) ? 0 : 1, tint = rng.range(0.85, 1.1);
        graves[v].push({ x, y: h - 0.05, z, ry: poi.yaw + rng.range(-0.15, 0.15), tx: rng.range(-0.12, 0.12), tz: rng.range(-0.12, 0.12), s: rng.range(0.9, 1.2), cr: tint, cg: tint, cb: tint });
      }
    }
    this._instance(graveGeos[0], graves[0], mat);
    this._instance(graveGeos[1], graves[1], mat);
    this.game.scene.add(this.group);
    this.counts = { trees: n, heroes: heroes[0].length + heroes[1].length, rocks: rocks.length + meadowRocks.length, boulders: boulders[0].length + boulders[1].length, crags: crags[0].length + crags[1].length, cliffs: cliffs[0].length + cliffs[1].length, grass: grassCount(), monoliths: monos.length, ruinBits: cols[0].length + cols[1].length + arches.length + walls.length, graves: graves[0].length + graves[1].length, meshes: this.meshes.length };
  }
}
