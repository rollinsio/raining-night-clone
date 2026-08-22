/**
 * The Roundtable Hold: a twelve-sided stone hall built from ashlar courses (three open arches to dark
 * galleries and a stair on the far side, lancet windows east and west), pillars with capitals and vault
 * ribs, and at its heart the great round table — oak planks, the map of Limveld, candle clusters on wax
 * pools, books, letters, a goblet, game pieces — ringed by high-backed chairs. Banners, a bookcase, jars,
 * a spear rack and a golden grace plinth dress the walls. Everything merges into one mesh per material.
 *
 * buildHall() returns the merged group plus the light anchors, flame positions, window slabs and the map
 * placement; Roundtable.js adds the dynamic lights, glows, motes, shafts and the Nightfarers.
 */
import * as THREE from 'three';
import { PALETTE, mixHex } from '../render/Style.js';
import { HallKit } from './HallKit.js';

const TAU = Math.PI * 2;
const mix = (a, b, t) => mixHex(a, b, t).getHex();
const cssHex = (css) => new THREE.Color(css).getHex();
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Hall dimensions (m) shared with Roundtable.js (camera, figure ring, grace). */
export const HALL = { R: 9.0, sides: 12, wallH: 7.4, tableR: 2.35, tableY: 0.84, grace: { x: 1.7, z: -4.9 }, figureR: 3.3 };

/** Nightfarer stand positions: slot 0 is the hero mark (near-left, seen from behind), the rest ring the far side. */
export const STANDS = [
  { x: -2.95, z: 1.55 },
  ...[268, 236, 204, 174, 144, 112, 76].map((deg) => { const a = (deg / 360) * TAU; return { x: HALL.figureR * Math.sin(a), z: HALL.figureR * Math.cos(a) }; }),
];

export function buildHall(game, rng) {
  const K = new HallKit(rng);
  K.aoFloor = 0.62; K.aoHeight = 2.2;
  const C = {
    stone: PALETTE.stone, stoneDark: PALETTE.stoneDark, stoneLight: PALETTE.stoneLight,
    floor: mix(PALETTE.stoneDark, PALETTE.stone, 0.5),
    wood: PALETTE.wood, woodDark: PALETTE.woodDark, oak: mix(PALETTE.wood, PALETTE.leather, 0.45), oakPale: mix(PALETTE.wood, PALETTE.skinDark, 0.35),
    paper: mix(PALETTE.moon, PALETTE.skin, 0.4), wax: mix(PALETTE.moon, PALETTE.skin, 0.25), clay: mix(PALETTE.leather, PALETTE.skinDark, 0.45),
    iron: PALETTE.iron, gold: PALETTE.gold, steel: PALETTE.steel,
    wine: mix(cssHex(PALETTE.ui.hpDark), PALETTE.clothDark, 0.3), navy: mix(cssHex(PALETTE.ui.fpDark), PALETTE.clothDark, 0.25),
    olive: mix(PALETTE.terrain.grassDark, PALETTE.leather, 0.4), leather: PALETTE.leather, black: PALETTE.clothDark,
  };
  const out = { flames: [], lights: [], windows: [], clusters: [] };
  const R = HALL.R, TR = HALL.tableR, TY = HALL.tableY;

  // world-space occlusion: under the table top, inside the galleries, the foot of the walls
  K.shade = (x, y, z) => {
    let k = 1;
    const r = Math.hypot(x, z);
    const under = (1 - sm((r - TR - 0.2) / 0.7)) * (1 - sm((y - 0.7) / 0.12));
    k *= 1 - 0.6 * under;
    if (r > R - 0.2) k *= 0.78;
    return k;
  };

  buildFloor(K, rng, C, R);
  buildWalls(K, rng, C, out);
  buildTable(K, rng, C, out);
  buildChairs(K, rng, C);
  buildDressing(K, rng, C, out);
  buildGrace(K, rng, C, out);

  const built = K.build();
  return { ...built, ...out, map: { x: 0.12, y: TY + 0.012, z: -0.05, w: 2.0, d: 1.45, yaw: 0.06 } };
}

// ------------------------------------------------------------------------------------------------- floor
function buildFloor(K, rng, C, R) {
  K.cyl(R + 7, R + 7, 0.12, 24, 0, -0.13, 0, 'stone', C.stoneDark, { mul: 0.35, jitter: 0, ao: false });
  const taken = new Set();
  for (let gx = -16; gx <= 16; gx++) for (let gz = -16; gz <= 16; gz++) {
    if (taken.has(gx + ',' + gz)) continue;
    const x = gx * 0.98, z = gz * 0.98;
    if (Math.hypot(x, z) > R + 6.5) continue;
    // some slabs span two cells (long flags) for a less regular grid
    let w = 0.9 + rng.float() * 0.06, d = 0.9 + rng.float() * 0.06, cx = x, cz = z;
    if (rng.float() < 0.22 && !taken.has((gx + 1) + ',' + gz)) { taken.add((gx + 1) + ',' + gz); w += 0.98; cx += 0.49; }
    else if (rng.float() < 0.18 && !taken.has(gx + ',' + (gz + 1))) { taken.add(gx + ',' + (gz + 1)); d += 0.98; cz += 0.49; }
    K.box(w, 0.08, d, cx, -0.04 + rng.float() * 0.014, cz, 'stone', C.floor, { jitter: 0.02, objJitter: 0.16, ao: false, mul: 0.92 });
  }
}

// ------------------------------------------------------------------------------------------------- walls
/** Pointed-arch profile: height of the opening at x for a half-width hw, springing ys and rise hh. */
const archTop = (x, hw, ys, hh) => ys + hh * (1 - Math.pow(Math.min(1, Math.abs(x) / hw), 1.75));

function buildWalls(K, rng, C, out) {
  const R = HALL.R, N = HALL.sides, W = 2 * R * Math.tan(Math.PI / N), H = HALL.wallH, CH = 0.46;
  const kinds = { 3: 'window', 9: 'moon', 5: 'arch', 6: 'arch', 7: 'arch' };
  const stoneOpts = { mul: 0.74, jitter: 0.03, objJitter: 0.15 };
  for (let i = 0; i < N; i++) {
    const phi = (i * TAU) / N, kind = kinds[i] || 'blind';
    K.push(R * Math.sin(phi), 0, R * Math.cos(phi), phi); // local x along the wall, +z outward
    const inside = (x, y) => {
      if (kind === 'arch') return Math.abs(x) < 1.55 && y < archTop(x, 1.55, 3.3, 2.0);
      if (kind === 'window' || kind === 'moon') return Math.abs(x) < 0.55 && y > 4.0 && y < archTop(x, 0.55, 6.2, 1.0);
      return false;
    };
    // dark backing so mortar gaps and dropped blocks read as shadow, not sky
    K.box(W + 0.6, H, 0.3, 0, H / 2, 0.5, 'stone', C.stoneDark, { mul: 0.3, jitter: 0, ao: false });
    // ashlar courses with a half-block stagger
    for (let course = 0, y = 0; y < H; y += CH, course++) {
      let x = -W / 2 - (course % 2 ? 0.35 + rng.float() * 0.2 : rng.float() * 0.2);
      while (x < W / 2) {
        const L = 0.62 + rng.float() * 0.72;
        const x0 = Math.max(x, -W / 2 - 0.25), x1 = Math.min(x + L, W / 2 + 0.25);
        x += L + 0.02;
        if (x1 - x0 < 0.25) continue;
        const cy = y + CH / 2;
        if (inside(x0 + 0.04, cy) || inside((x0 + x1) / 2, cy) || inside(x1 - 0.04, cy)) continue;
        const z = 0.3 + (rng.float() - 0.5) * 0.06;
        K.box(x1 - x0, CH - 0.025, 0.6, (x0 + x1) / 2, cy, z, 'stone', C.stone, stoneOpts);
      }
    }
    // openings: voussoir ring + jambs
    if (kind === 'arch') voussoirs(K, C, 1.55, 3.3, 2.0, 0.34, 0.7), jambs(K, C, 1.55, 3.3, 0.36, 0.72);
    if (kind === 'window' || kind === 'moon') {
      voussoirs(K, C, 0.55, 6.2, 1.0, 0.26, 0.7);
      K.box(0.3, 2.2, 0.72, -0.7, 5.1, 0.3, 'stone', C.stoneLight, { mul: 0.72, objJitter: 0.04 });
      K.box(0.3, 2.2, 0.72, 0.7, 5.1, 0.3, 'stone', C.stoneLight, { mul: 0.72, objJitter: 0.04 });
      K.box(1.7, 0.22, 0.8, 0, 3.95, 0.28, 'stone', C.stoneLight, { mul: 0.68 }); // sill
      out.windows.push({ x: 0, y: 5.55, z: 0.62, w: 1.0, h: 2.9, phi, moon: kind === 'moon' });
    }
    // cornice, the dark band above it, the vault rib springing from this bay's pillar side
    K.box(W + 0.4, 0.32, 0.62, 0, H + 0.16, 0.02, 'stone', C.stoneLight, { mul: 0.62, jitter: 0.02 });
    K.box(W + 0.4, 2.4, 0.5, 0, H + 0.32 + 1.2, 0.35, 'stone', C.stoneDark, { mul: 0.42, jitter: 0.04, ao: false });
    // galleries behind the arches (side walls, back wall, a stair through the centre arch)
    if (kind === 'arch') gallery(K, rng, C, out, W, i === 6);
    K.pop();
  }
  // pillars at the corners with plinth, capital and an engaged upper shaft; vault ribs to the crown
  for (let i = 0; i < N; i++) {
    const phi = ((i + 0.5) * TAU) / N, pr = R / Math.cos(Math.PI / N) - 0.62;
    K.push(pr * Math.sin(phi), 0, pr * Math.cos(phi), phi);
    K.box(1.35, 0.5, 1.35, 0, 0.25, 0, 'stone', C.stoneLight, { mul: 0.66, objJitter: 0.04, rot: [0, Math.PI / 8, 0] });
    K.cyl(0.5, 0.56, 5.6, 8, 0, 0.5, 0, 'stone', C.stoneLight, { mul: 0.74, jitter: 0.05, objJitter: 0.03 });
    K.cyl(0.66, 0.5, 0.42, 8, 0, 6.1, 0, 'stone', C.stoneLight, { mul: 0.7, objJitter: 0.03 });
    K.box(1.34, 0.26, 1.34, 0, 6.65, 0, 'stone', C.stoneLight, { mul: 0.66, objJitter: 0.03, rot: [0, Math.PI / 8, 0] });
    K.cyl(0.4, 0.44, H - 6.78, 8, 0, 6.78, 0, 'stone', C.stoneLight, { mul: 0.66, objJitter: 0.03 });
    K.pop();
    const ax = pr * Math.sin(phi), az = pr * Math.cos(phi);
    beam(K, ax, H + 0.3, az, 0, H + 3.6, 0, 0.42, 'stone', C.stoneDark, { mul: 0.5, jitter: 0.04, ao: false });
  }
  K.cyl(R + 1.6, R + 1.6, 0.3, N, 0, H + 3.55, 0, 'stone', C.stoneDark, { mul: 0.3, jitter: 0, ao: false });
  K.cyl(0.9, 1.2, 0.6, 8, 0, H + 3.3, 0, 'stone', C.stoneLight, { mul: 0.5, ao: false }); // crown boss
}

/** Ring of wedge blocks following the pointed arch on both sides. */
function voussoirs(K, C, hw, ys, hh, t, depth) {
  const steps = 9;
  for (const s of [-1, 1]) {
    let px = 0, py = archTop(0, hw, ys, hh) + 0.0;
    for (let k = 1; k <= steps; k++) {
      const x = (s * hw * k) / steps, y = archTop(x, hw, ys, hh);
      const mx = (px + x) / 2, my = (py + y) / 2 + t * 0.45, len = Math.hypot(x - px, y - py) + 0.03;
      const ang = Math.atan2(y - py, x - px);
      K.add(box(len, t, depth), 'stone', C.stoneLight, { rot: [0, 0, ang], at: [mx, my, 0.3], mul: 0.8, objJitter: 0.05, jitter: 0.02 });
      px = x; py = y;
    }
  }
}
function jambs(K, C, hw, ys, t, depth) {
  for (const s of [-1, 1]) K.box(t, ys, depth, s * (hw + t / 2 - 0.02), ys / 2, 0.3, 'stone', C.stoneLight, { mul: 0.76, objJitter: 0.04, jitter: 0.02 });
}

/** Box between two points (current frame), square section w. */
function beam(K, ax, ay, az, bx, by, bz, w, bucket, hex, o = {}) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const g = box(w, w, len);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return K.add(g, bucket, hex, o);
}

/** Dark gallery behind an arch; the centre one carries a broad stair up to a second doorway. */
function gallery(K, rng, C, out, W, stair) {
  const H = HALL.wallH, depth = stair ? 7.2 : 4.0;
  const dark = { mul: 0.5, jitter: 0.03, objJitter: 0.1, ao: false };
  for (const s of [-1, 1]) {
    for (let y = 0; y < H; y += 0.62) for (let z = 0.6; z < depth; z += 1.1) K.box(0.5, 0.6, 1.08, s * (W / 2 + 0.1), y + 0.3, z + 0.55, 'stone', C.stone, dark);
  }
  for (let y = 0; y < H + 2; y += 0.62) for (let x = -W / 2 - 0.3; x < W / 2 + 0.3; x += 1.1) K.box(1.08, 0.6, 0.5, x + 0.55, y + 0.3, depth + 0.25, 'stone', C.stone, dark);
  K.box(W + 1, 0.5, depth + 0.5, 0, H + 0.25, depth / 2, 'stone', C.stoneDark, { mul: 0.3, jitter: 0, ao: false }); // gallery ceiling
  if (stair) {
    for (let k = 0; k < 8; k++) {
      const h = 0.21 * (k + 1);
      K.box(3.6, h, 0.5, 0, h / 2, 2.0 + k * 0.5, 'stone', C.stoneLight, { mul: 0.7, jitter: 0.02, objJitter: 0.08, ao: false });
    }
    K.box(3.6, 1.72, 1.2, 0, 0.86, 6.5, 'stone', C.stoneLight, { mul: 0.66, ao: false }); // landing
    K.box(1.8, 3.2, 0.3, 0, 1.72 + 1.6, depth + 0.05, 'stone', C.stoneDark, { mul: 0.12, jitter: 0, ao: false }); // the dark doorway beyond
    K.box(1.8, 0.3, 0.3, 0, 1.72 + 3.2, depth + 0.02, 'stone', C.stoneLight, { mul: 0.6, ao: false });
    for (const s of [-1, 1]) { // stair cheeks + a candle cluster on the steps
      K.box(0.34, 2.2, 4.6, s * 1.95, 1.1, 4.0, 'stone', C.stoneLight, { mul: 0.62, objJitter: 0.05, ao: false });
    }
    const c = candleCluster(K, rng, C, out, -1.25, 0.21 * 4, 3.55, 4, 0.22);
    out.lights.push({ x: c.x, y: c.y + 0.3, z: c.z, kind: 'warm', intensity: 2.6, distance: 9 });
  } else {
    // a dim candle far inside so the gallery has depth
    const c = candleCluster(K, rng, C, out, rng.range(-1.2, 1.2), 0, depth - 0.7, 2, 0.12);
    out.clusters.push(c);
  }
}

// ------------------------------------------------------------------------------------------------- table
function buildTable(K, rng, C, out) {
  const TR = HALL.tableR, TY = HALL.tableY;
  const furn = { ao: false };
  // oak planks running left-right in the view, slightly uneven, a darker apron ring, pedestal, legs, stretchers
  for (let pz = -TR + 0.19; pz < TR; pz += 0.38) {
    const half = Math.sqrt(Math.max(0, TR * TR - pz * pz)); if (half < 0.3) continue;
    K.box(half * 2 + 0.04, 0.12, 0.37, 0, TY - 0.06 + (rng.float() - 0.5) * 0.008, pz, 'wood', C.oak, { ...furn, mul: 0.95, jitter: 0.015, objJitter: 0.1 });
  }
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; K.add(box(0.66, 0.24, 0.16), 'wood', C.woodDark, { ...furn, rot: [0, a, 0], at: [TR * Math.sin(a), TY - 0.2, TR * Math.cos(a)], mul: 1.05, jitter: 0.02, objJitter: 0.06 }); }
  K.cyl(0.5, 0.62, TY - 0.12, 8, 0, 0, 0, 'wood', C.woodDark, { ...furn, mul: 0.9 });
  K.cyl(0.95, 1.05, 0.1, 8, 0, 0, 0, 'wood', C.woodDark, { ...furn, mul: 0.85 });
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * TAU, lx = 1.95 * Math.sin(a), lz = 1.95 * Math.cos(a);
    K.add(box(0.14, TY - 0.12, 0.14), 'wood', C.woodDark, { ...furn, rot: [0, a, 0], at: [lx, (TY - 0.12) / 2, lz], mul: 0.95 });
    K.add(box(0.1, 0.08, 1.45), 'wood', C.woodDark, { ...furn, rot: [0, a, 0], at: [lx * 0.62, 0.22, lz * 0.62], mul: 0.9 });
  }

  // candle clusters (the map's light): near-left, far-right, near-right
  const A = candleCluster(K, rng, C, out, -1.5, TY, 1.05, 6, 0.26, { stick: true });
  out.lights.push({ x: A.x + 0.05, y: TY + 0.36, z: A.z, kind: 'warm', intensity: 5.2, distance: 11 });
  const B = candleCluster(K, rng, C, out, 1.5, TY, -0.95, 4, 0.2, { stick: true });
  out.lights.push({ x: B.x, y: TY + 0.34, z: B.z, kind: 'warm', intensity: 4.2, distance: 10 });
  const D = candleCluster(K, rng, C, out, 1.72, TY, 1.3, 3, 0.14);
  out.lights.push({ x: D.x, y: TY + 0.28, z: D.z, kind: 'warm', intensity: 2.4, distance: 8 });

  // books: stacks, an open volume, a few on the floor beside the table
  bookStack(K, rng, C, 0.95, TY, -1.62, 3, 0.25);
  bookStack(K, rng, C, -0.55, TY, -1.78, 2, -0.4);
  openBook(K, rng, C, -1.62, TY, -0.25, 0.55);
  bookStack(K, rng, C, 3.05, 0, 1.35, 2, 0.9);
  openBook(K, rng, C, 3.3, 0, 0.45, -1.2);
  K.add(box(0.24, 0.05, 0.32), 'cloth', C.wine, { ...furn, rot: [0, 0.7, 0], at: [3.6, 0.025, 1.0], mul: 0.9 });
  K.add(box(0.2, 0.036, 0.29), 'paper', C.paper, { ...furn, rot: [0, 0.7, 0], at: [3.62, 0.025, 1.0], mul: 0.85 });
  // letters and sheets
  for (const [x, z, a, curl] of [[1.6, 0.42, 0.3, 0.02], [-0.62, 1.58, -0.22, 0.025], [0.55, 1.5, 0.16, 0.015], [-1.9, 0.5, 0.9, 0.02]]) {
    K.sheet(0.3, 0.42, x, TY + 0.006, z, 'paper', C.paper, { ...furn, rot: [0, a, 0], curl, segs: 6, mul: 0.92, jitter: 0 });
  }
  K.sheet(0.34, 0.46, 3.35, 0.004, -0.5, 'paper', C.paper, { ...furn, rot: [0, 0.4, 0], curl: 0.02, segs: 6, mul: 0.8, jitter: 0 });
  // goblet, bowl, inkwell + quill, a rolled scroll, a dagger across the map's corner, gold game pieces on the map
  K.lathe([[0.0, 0], [0.06, 0], [0.055, 0.01], [0.018, 0.02], [0.016, 0.09], [0.03, 0.11], [0.062, 0.14], [0.058, 0.2], [0.05, 0.21], [0.0, 0.21]], 8, 1.2, TY, 0.95, 'metal', C.steel, { ...furn, mul: 0.55, jitter: 0.05 });
  K.lathe([[0.0, 0], [0.1, 0], [0.15, 0.05], [0.14, 0.07], [0.1, 0.02], [0.0, 0.02]], 8, -1.0, TY, -1.3, 'wood', C.oakPale, { ...furn, mul: 0.9 });
  K.lathe([[0.0, 0], [0.045, 0], [0.05, 0.03], [0.035, 0.055], [0.02, 0.06], [0.0, 0.06]], 8, 0.02, TY, 1.42, 'metal', C.iron, { ...furn, mul: 0.5 });
  K.add(box(0.008, 0.22, 0.016), 'paper', C.paper, { ...furn, rot: [0.9, 0.4, 0.35], at: [0.06, TY + 0.1, 1.38], mul: 0.95, jitter: 0 });
  K.add(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), 'paper', C.paper, { ...furn, rot: [0, 0, Math.PI / 2], at: [1.85, TY + 0.035, -0.15], mul: 0.82, jitter: 0.02 });
  K.add(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6), 'paper', C.paper, { ...furn, rot: [0, 0, Math.PI / 2], at: [1.85, TY + 0.06, -0.09], mul: 0.78, jitter: 0.02 });
  K.push(0.9, TY + 0.012, 0.56, 0.45);
  K.box(0.03, 0.008, 0.3, 0, 0.006, 0.0, 'metal', C.steel, { ...furn, mul: 0.9, jitter: 0.03 });
  K.box(0.09, 0.016, 0.03, 0, 0.008, -0.16, 'metal', C.iron, { ...furn, mul: 0.6 });
  K.box(0.03, 0.025, 0.1, 0, 0.012, -0.23, 'wood', C.leather, { ...furn, mul: 0.8 });
  K.pop();
  for (const [x, z] of [[0.35, -0.3], [-0.25, 0.12], [0.6, 0.2], [-0.55, -0.45]]) {
    K.cyl(0.028, 0.036, 0.012, 8, x, TY + 0.012, z, 'gold', C.gold, { ...furn, mul: 0.8 });
    K.cone(0.022, 0.07, 6, x, TY + 0.024, z, 'gold', C.gold, { ...furn, mul: 0.85 });
    K.add(new THREE.SphereGeometry(0.013, 6, 5), 'gold', C.gold, { ...furn, at: [x, TY + 0.1, z], mul: 0.9 });
  }
}

/** A cluster of candles of varied height on a shared wax pool; optional iron candlestick. Returns the centre. */
function candleCluster(K, rng, C, out, cx, y, cz, n, spread, o = {}) {
  const furn = { ao: false };
  K.cyl(spread + 0.1, spread + 0.14, 0.014, 10, cx, y, cz, 'wax', C.wax, { ...furn, mul: 0.78, jitter: 0.03 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.float() * 0.8, r = i === 0 ? 0 : spread * (0.5 + rng.float() * 0.5);
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const h = 0.05 + rng.float() * 0.2, rad = 0.022 + rng.float() * 0.02;
    candle(K, rng, C, out, x, y + 0.012, z, h, rad);
  }
  if (o.stick) {
    const sx = cx - spread - 0.12, sz = cz - spread * 0.4;
    K.cyl(0.06, 0.075, 0.016, 8, sx, y, sz, 'metal', C.iron, { ...furn, mul: 0.55 });
    K.cyl(0.011, 0.013, 0.3, 6, sx, y + 0.016, sz, 'metal', C.iron, { ...furn, mul: 0.5 });
    K.cyl(0.04, 0.022, 0.02, 8, sx, y + 0.3, sz, 'metal', C.iron, { ...furn, mul: 0.55 });
    candle(K, rng, C, out, sx, y + 0.32, sz, 0.14, 0.024);
  }
  return { x: cx, y, z: cz };
}
function candle(K, rng, C, out, x, y, z, h, r) {
  const furn = { ao: false };
  K.cyl(r * 0.92, r, h, 8, x, y, z, 'wax', C.wax, { ...furn, mul: 0.92, jitter: 0.02, objJitter: 0.04 });
  for (let d = 0; d < 2; d++) { const a = rng.float() * TAU; K.add(box(r * 0.5, h * 0.5 + 0.02, r * 0.35), 'wax', C.wax, { ...furn, at: [x + Math.sin(a) * r, y + h * 0.72, z + Math.cos(a) * r], mul: 0.95, jitter: 0.02 }); }
  K.cyl(0.003, 0.003, 0.014, 4, x, y + h, z, 'metal', C.black, { ...furn, mul: 0.3, jitter: 0 });
  const p = K.flame(x, y + h + 0.008, z, 0.07 + h * 0.18, 1);
  out.flames.push(p);
}

function bookStack(K, rng, C, x, y, z, n, yaw) {
  const covers = [C.wine, C.navy, C.olive, C.leather, C.black, C.woodDark];
  let top = y;
  for (let i = 0; i < n; i++) {
    const w = 0.2 + rng.float() * 0.08, d = 0.27 + rng.float() * 0.08, h = 0.035 + rng.float() * 0.03, a = yaw + (rng.float() - 0.5) * 0.35;
    const cov = covers[rng.int(0, covers.length - 1)];
    K.push(x + (rng.float() - 0.5) * 0.04, top, z + (rng.float() - 0.5) * 0.04, a);
    K.box(w, 0.008, d, 0, 0.004, 0, 'cloth', cov, { ao: false, mul: 0.95 });
    K.box(w, 0.008, d, 0, h - 0.004, 0, 'cloth', cov, { ao: false, mul: 1.0 });
    K.box(0.012, h, d, -w / 2 + 0.006, h / 2, 0, 'cloth', cov, { ao: false, mul: 0.9 });
    K.box(w - 0.03, h - 0.016, d - 0.02, 0.008, h / 2, 0, 'paper', C.paper, { ao: false, mul: 0.8, jitter: 0.04 });
    K.pop();
    top += h;
  }
}
function openBook(K, rng, C, x, y, z, yaw) {
  K.push(x, y, z, yaw);
  K.box(0.5, 0.01, 0.34, 0, 0.005, 0, 'cloth', C.leather, { ao: false, mul: 0.9 });
  for (const s of [-1, 1]) {
    K.add(box(0.23, 0.03, 0.31), 'paper', C.paper, { ao: false, rot: [0, 0, s * 0.06], at: [s * 0.125, 0.025, 0], mul: 0.88, jitter: 0.03 });
  }
  K.add(box(0.22, 0.003, 0.3), 'paper', C.paper, { ao: false, rot: [0, 0, -0.3], at: [0.05, 0.05, 0], mul: 0.95, jitter: 0 }); // a turning page
  K.pop();
}

// ------------------------------------------------------------------------------------------------- chairs
function buildChairs(K, rng, C) {
  const chair = (a, r, yaw = 0) => {
    K.push(r * Math.sin(a), 0, r * Math.cos(a), a + Math.PI + yaw);
    const furn = { ao: false, mul: 0.95, jitter: 0.02, objJitter: 0.06 };
    K.box(0.54, 0.06, 0.5, 0, 0.47, 0, 'wood', C.oak, furn);
    for (const [sx, sz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) K.box(0.06, 0.47, 0.06, sx, 0.235, sz, 'wood', C.woodDark, furn);
    for (const sx of [-0.23, 0.23]) { K.box(0.07, 1.08, 0.07, sx, 0.47 + 0.54, -0.22, 'wood', C.woodDark, furn); K.cone(0.04, 0.09, 6, sx, 1.55, -0.22, 'wood', C.woodDark, furn); }
    K.box(0.42, 0.2, 0.035, 0, 0.86, -0.22, 'wood', C.oak, furn);
    K.box(0.42, 0.16, 0.035, 0, 1.16, -0.22, 'wood', C.oak, furn);
    K.box(0.54, 0.1, 0.08, 0, 1.45, -0.22, 'wood', C.oak, furn);
    for (const sx of [-0.26, 0.26]) { K.box(0.05, 0.05, 0.42, sx, 0.72, -0.03, 'wood', C.woodDark, furn); K.box(0.05, 0.22, 0.05, sx, 0.58, 0.15, 'wood', C.woodDark, furn); }
    K.pop();
  };
  for (const deg of [204, 174, 144]) chair((deg / 360) * TAU, 4.0, rng.range(-0.12, 0.12));
  chair((22 / 360) * TAU, 3.45, 0.35);
  chair((318 / 360) * TAU, 3.9, -0.5);
}

// ------------------------------------------------------------------------------------------------- dressing
function buildDressing(K, rng, C, out) {
  const R = HALL.R, N = HALL.sides, W = 2 * R * Math.tan(Math.PI / N);
  const bay = (i, f) => { const phi = (i * TAU) / N; K.push(R * Math.sin(phi), 0, R * Math.cos(phi), phi); f(W); K.pop(); };
  // banners: two great ones flanking the view, two smaller on the piers beside the stair arch
  bay(4, () => banner(K, rng, C, 1.2, 3.4, 0, 6.3, -0.12, C.navy));
  bay(8, () => banner(K, rng, C, 1.2, 3.4, 0, 6.3, -0.12, C.wine));
  bay(6, () => { banner(K, rng, C, 0.8, 2.2, -2.05, 6.4, -0.12, C.wine); banner(K, rng, C, 0.8, 2.2, 2.05, 6.4, -0.12, C.navy); });
  bay(5, () => banner(K, rng, C, 0.8, 2.2, -2.05, 6.4, -0.12, C.navy));
  bay(7, () => banner(K, rng, C, 0.8, 2.2, 2.05, 6.4, -0.12, C.wine));
  // bookcase under the east window, a second one in the south-east bay
  bay(3, () => bookcase(K, rng, C, 0, -0.1, 3.0, 2.5));
  bay(2, () => bookcase(K, rng, C, 0.6, -0.1, 2.4, 2.2));
  // jars + a barrel by the north-east bay, a spear rack + shield by the west-north-west one
  bay(4, (w) => { for (const [x, s] of [[-1.9, 1], [-1.5, 0.8], [-1.65, 0.6], [1.7, 0.9]]) jar(K, rng, C, x, -0.6 - rng.float() * 0.3, s); barrel(K, rng, C, 1.35, -0.7); });
  bay(8, () => { rack(K, rng, C, 0.9, -0.25); barrel(K, rng, C, -1.6, -0.7); jar(K, rng, C, -1.0, -0.5, 0.8); });
  bay(10, () => { barrel(K, rng, C, -0.5, -0.7); barrel(K, rng, C, 0.3, -0.7); });
  // a tall iron candelabra left of the hero mark: the warm key on the near figures
  candelabra(K, rng, C, out, -4.3, 0, -1.1);
  // straw and grit on the near floor
  for (let i = 0; i < 70; i++) {
    const a = rng.float() * TAU, r = 2.8 + rng.float() * 4.5, x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.hypot(x, z) > R - 0.8) continue;
    K.add(box(0.2 + rng.float() * 0.22, 0.006, 0.012), 'paper', C.paper, { ao: false, rot: [0, rng.float() * TAU, 0], at: [x, 0.004, z], mul: 0.55 + rng.float() * 0.25, jitter: 0 });
  }
  for (let i = 0; i < 18; i++) {
    const a = rng.float() * TAU, r = 3 + rng.float() * 5;
    K.add(box(0.08 + rng.float() * 0.12, 0.04, 0.06 + rng.float() * 0.08), 'stone', C.stone, { ao: false, rot: [0, rng.float() * TAU, 0], at: [Math.sin(a) * r, 0.01, Math.cos(a) * r], mul: 0.6, objJitter: 0.15 });
  }
}

function banner(K, rng, C, w, h, x, yTop, z, main) {
  const furn = { ao: false, jitter: 0.015 };
  K.add(new THREE.CylinderGeometry(0.03, 0.03, w + 0.5, 6), 'metal', C.iron, { ...furn, rot: [0, 0, Math.PI / 2], at: [x, yTop + 0.03, z], mul: 0.55 });
  const g = new THREE.PlaneGeometry(w, h, 6, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) / w, v = (p.getY(i) + h / 2) / h; p.setZ(i, Math.sin(v * 6.0 + u * 3.0) * 0.035 * (1 - v) + (1 - v) * 0.06); }
  g.computeVertexNormals();
  // border + emblem via vertex colour: border = darker gold, field = main
  const nonIdx = g.toNonIndexed();
  const pp = nonIdx.attributes.position, col = new Float32Array(pp.count * 3);
  const cm = new THREE.Color(main), cb = mixHex(PALETTE.gold, main, 0.45);
  for (let i = 0; i < pp.count; i++) {
    const u = Math.abs(pp.getX(i)) / (w / 2), v = (pp.getY(i) + h / 2) / h;
    const edge = u > 0.86 || v > 0.95 || v < 0.08;
    const c = edge ? cb : cm;
    const k = (0.82 + 0.18 * v) * (1 + (rng.float() - 0.5) * 0.05);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(col, 3));
  nonIdx.rotateY(Math.PI); nonIdx.translate(x, yTop - h / 2 - 0.04, z);
  K.buckets.get('cloth') || K.buckets.set('cloth', []);
  nonIdx.applyMatrix4(K.frame);
  K.buckets.get('cloth').push(nonIdx);
  // emblem: a gold ring and diamond at the banner's upper third, a fringe of tassels along the hem
  K.add(new THREE.TorusGeometry(w * 0.17, 0.018, 5, 12), 'gold', C.gold, { ...furn, at: [x, yTop - h * 0.36, z - 0.02], mul: 0.85 });
  K.add(box(w * 0.14, w * 0.14, 0.012), 'gold', C.gold, { ...furn, rot: [0, 0, Math.PI / 4], at: [x, yTop - h * 0.36, z - 0.02], mul: 0.9 });
  for (let k = 0; k < 5; k++) K.cone(0.03, 0.16, 5, x - w / 2 + (k + 0.5) * (w / 5), yTop - h - 0.18, z - 0.01, 'gold', C.gold, { ...furn, mul: 0.7, rot: [Math.PI, 0, 0] });
}

function bookcase(K, rng, C, x, z, w, h) {
  const furn = { ao: false, jitter: 0.02, objJitter: 0.05 };
  const covers = [C.wine, C.navy, C.olive, C.leather, C.black, C.oak];
  K.box(w, h, 0.08, x, h / 2, z - 0.2, 'wood', C.woodDark, { ...furn, mul: 0.7 });
  for (const s of [-1, 1]) K.box(0.07, h, 0.42, x + s * (w / 2 - 0.035), h / 2, z, 'wood', C.woodDark, { ...furn, mul: 0.85 });
  const rows = Math.floor(h / 0.55);
  for (let r = 0; r <= rows; r++) {
    const y = r * 0.55;
    K.box(w, 0.045, 0.42, x, y + 0.02, z, 'wood', C.oak, { ...furn, mul: 0.85 });
    if (r === rows) break;
    let bx = x - w / 2 + 0.12;
    while (bx < x + w / 2 - 0.14) {
      const bw = 0.035 + rng.float() * 0.05, bh = 0.2 + rng.float() * 0.18;
      if (rng.float() < 0.12) { bx += bw + 0.08; continue; }
      const tilt = rng.float() < 0.12 ? rng.range(-0.18, 0.18) : 0;
      K.add(box(bw, bh, 0.26), 'cloth', covers[rng.int(0, covers.length - 1)], { ...furn, rot: [0, 0, tilt], at: [bx + bw / 2, y + 0.045 + bh / 2, z + 0.04], mul: 0.85 + rng.float() * 0.2 });
      bx += bw + 0.006;
    }
  }
}
function jar(K, rng, C, x, z, s) {
  K.lathe([[0, 0], [0.12, 0], [0.19, 0.14], [0.17, 0.36], [0.09, 0.44], [0.11, 0.5], [0.0, 0.5]].map(([r, y]) => [r * s, y * s]), 8, x, 0, z, 'stone', C.clay, { ao: false, mul: 0.75, jitter: 0.03, objJitter: 0.1 });
}
function barrel(K, rng, C, x, z) {
  K.lathe([[0, 0], [0.3, 0], [0.34, 0.35], [0.3, 0.75], [0.0, 0.75]], 10, x, 0, z, 'wood', C.oak, { ao: false, mul: 0.8, jitter: 0.03 });
  for (const y of [0.1, 0.38, 0.65]) K.cyl(0.345, 0.345, 0.04, 10, x, y, z, 'metal', C.iron, { ao: false, mul: 0.5 });
}
function rack(K, rng, C, x, z) {
  for (let k = 0; k < 3; k++) {
    K.add(new THREE.CylinderGeometry(0.018, 0.022, 2.3, 6), 'wood', C.woodDark, { ao: false, rot: [0.12, 0, 0.06 + k * 0.04], at: [x + k * 0.18, 1.15, z + 0.05], mul: 0.9 });
    K.add(box(0.05, 0.3, 0.012), 'metal', C.steel, { ao: false, rot: [0.12, 0, 0.06 + k * 0.04], at: [x + k * 0.18 - 0.14 * (0.06 + k * 0.04) * 10, 2.35, z + 0.05 - 0.26], mul: 0.9 });
  }
  K.add(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 12), 'metal', C.iron, { ao: false, rot: [Math.PI / 2 - 0.2, 0, 0], at: [x - 0.6, 0.38, z + 0.15], mul: 0.55 });
  K.add(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8), 'metal', C.steel, { ao: false, rot: [Math.PI / 2 - 0.2, 0, 0], at: [x - 0.6, 0.38, z + 0.2], mul: 0.9 });
}
function candelabra(K, rng, C, out, x, y, z) {
  const furn = { ao: false, mul: 0.5, jitter: 0.03 };
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; K.add(box(0.05, 0.05, 0.36), 'metal', C.iron, { ...furn, rot: [0, a, 0], at: [x + Math.sin(a) * 0.16, y + 0.03, z + Math.cos(a) * 0.16] }); }
  K.cyl(0.025, 0.035, 1.35, 6, x, y + 0.05, z, 'metal', C.iron, furn);
  K.cyl(0.06, 0.03, 0.06, 6, x, y + 0.8, z, 'metal', C.iron, furn);
  const arms = [[0, 1.5], [(2 / 3) * Math.PI, 1.42], [(4 / 3) * Math.PI, 1.46]];
  for (const [a, h] of arms) {
    const ax = x + Math.sin(a) * 0.26, az = z + Math.cos(a) * 0.26;
    K.add(box(0.03, 0.03, 0.3), 'metal', C.iron, { ...furn, rot: [0, a, 0], at: [x + Math.sin(a) * 0.13, y + h - 0.12, z + Math.cos(a) * 0.13] });
    K.cyl(0.05, 0.035, 0.025, 8, ax, y + h - 0.1, az, 'metal', C.iron, furn);
    candle(K, rng, C, out, ax, y + h - 0.075, az, 0.1 + rng.float() * 0.08, 0.024);
  }
  K.cyl(0.05, 0.035, 0.025, 8, x, y + 1.4, z, 'metal', C.iron, furn);
  candle(K, rng, C, out, x, y + 1.425, z, 0.2, 0.028);
  out.lights.push({ x, y: y + 1.6, z, kind: 'warm', intensity: 5.5, distance: 12 });
}

// ------------------------------------------------------------------------------------------------- grace
function buildGrace(K, rng, C, out) {
  const { x, z } = HALL.grace;
  const furn = { ao: false };
  K.cyl(0.62, 0.7, 0.22, 8, x, 0, z, 'stone', C.stoneLight, { ...furn, mul: 0.72, jitter: 0.03 });
  K.cyl(0.46, 0.54, 0.18, 8, x, 0.22, z, 'stone', C.stoneLight, { ...furn, mul: 0.78, jitter: 0.03 });
  // the golden hilt: tapered blade sunk in the plinth, curved guard arms, wrapped grip, pommel; gilt roots
  K.push(x, 0.4, z, 0.4);
  K.add(box(0.06, 0.5, 0.02), 'gold', C.gold, { ...furn, at: [0, 0.2, 0], mul: 0.9 });
  for (const s of [-1, 1]) {
    K.add(box(0.28, 0.03, 0.03), 'gold', C.gold, { ...furn, rot: [0, 0, s * 0.35], at: [s * 0.15, 0.48, 0], mul: 0.95 });
    K.add(box(0.14, 0.025, 0.025), 'gold', C.gold, { ...furn, rot: [0, 0, s * 1.1], at: [s * 0.3, 0.58, 0], mul: 0.9 });
  }
  K.cyl(0.028, 0.032, 0.34, 6, 0, 0.46, 0, 'gold', C.gold, { ...furn, mul: 0.8 });
  K.add(new THREE.SphereGeometry(0.05, 6, 5), 'gold', C.gold, { ...furn, at: [0, 0.84, 0], mul: 1.0 });
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; K.add(box(0.04, 0.03, 0.5 + rng.float() * 0.3), 'gold', C.gold, { ...furn, rot: [0, a, 0], at: [Math.sin(a) * 0.55, 0.01, Math.cos(a) * 0.55], mul: 0.75 }); }
  K.pop();
  out.lights.push({ x, y: 1.9, z, kind: 'grace', intensity: 9, distance: 16 });
}
