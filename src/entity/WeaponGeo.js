/**
 * Weapon geometry, built in the hand-local frame: origin at the centre of the fist, blade along −Y, the guard just
 * below the fist, the pommel poking out above it (callers tilt the whole thing 0.35 rad forward and bind it to the
 * wrist). Instead of boxes: blades are lofted diamond sections that taper to a point, axe bits are lens-section
 * crescents with a horn, heel and beard, guards are tapered bars that droop toward the blade, grips are wrapped.
 *
 * Every loft carries a baked per-vertex `shade` attribute that RigBuilder.part multiplies into the vertex colour:
 * a blade is split down its ridge so one face is lit and the other shadowed (the crease smoothing would otherwise
 * average the two faces' normals into one flat plane), edges and bevels brighten toward the cutting edge, grip
 * wraps alternate light / dark bands. Colours come from the palette; `shade` per part is the base lift.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../render/Style.js';

const TAU = Math.PI * 2;
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Steel base lift (the blade shading spreads ~0.8..1.3 around it, so the bright side stays short of white). */
export const STEEL_SHADE = 0.92;

// -------------------------------------------------------------------------------------------------
// Lofting

/**
 * Loft equal-sized rings ([x, y, z] lists) into an indexed geometry with a 'shade' attribute and no normals
 * (RigBuilder.part computes flat ones; the rig build crease-smooths them). Side quads are wound away from the
 * centroid of their ring pair, caps fan to the ring centroid and face away from the neighbouring ring — so rings
 * only need to be star-shaped around their own centroid. `shade`: per ring, a number or a per-point array.
 */
export function loft(rings, { closed = true, capStart = false, capEnd = false, shade = null } = {}) {
  const n = rings[0].length, R = rings.length, pos = [], idx = [], sh = [];
  for (let r = 0; r < R; r++) for (let i = 0; i < n; i++) {
    const p = rings[r][i]; pos.push(p[0], p[1], p[2]);
    const s = shade ? shade[r] : 1; sh.push(Array.isArray(s) ? s[i] : s);
  }
  const cen = rings.map((r) => { let x = 0, y = 0, z = 0; for (const p of r) { x += p[0]; y += p[1]; z += p[2]; } return [x / n, y / n, z / n]; });
  const tri = (a, b, c, o) => { // wound so the face normal points away from o
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const abx = pos[b * 3] - ax, aby = pos[b * 3 + 1] - ay, abz = pos[b * 3 + 2] - az;
    const acx = pos[c * 3] - ax, acy = pos[c * 3 + 1] - ay, acz = pos[c * 3 + 2] - az;
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const fx = ax + (abx + acx) / 3 - o[0], fy = ay + (aby + acy) / 3 - o[1], fz = az + (abz + acz) / 3 - o[2];
    if (nx * fx + ny * fy + nz * fz < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  const segs = closed ? n : n - 1;
  for (let r = 0; r < R - 1; r++) {
    const o = [(cen[r][0] + cen[r + 1][0]) / 2, (cen[r][1] + cen[r + 1][1]) / 2, (cen[r][2] + cen[r + 1][2]) / 2];
    for (let i = 0; i < segs; i++) {
      const a = r * n + i, b = r * n + ((i + 1) % n), c = a + n, d = b + n;
      tri(a, c, b, o); tri(b, c, d, o);
    }
  }
  const cap = (r, away) => {
    const ci = pos.length / 3; pos.push(cen[r][0], cen[r][1], cen[r][2]); sh.push(sh[r * n]);
    for (let i = 0; i < segs; i++) tri(ci, r * n + i, r * n + ((i + 1) % n), away);
  };
  if (capStart) cap(0, cen[1]);
  if (capEnd) cap(R - 1, cen[R - 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(sh, 1));
  g.setIndex(idx);
  return g;
}

/** Ring of n points around +Y at height y: half-widths w (x) / d (z), squareness e (1 = ellipse, lower = bevelled box). */
function ringY(n, y, w, d, e = 0.8) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; pts.push([w * spow(Math.cos(a), e), y, d * spow(Math.sin(a), e)]); }
  return pts;
}
/** Ring of n points around +X at x: half-height h, half-depth d, centre height yc. */
function ringX(n, x, h, d, yc = 0, e = 0.75) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; pts.push([x, yc + h * spow(Math.cos(a), e), d * spow(Math.sin(a), e)]); }
  return pts;
}

// -------------------------------------------------------------------------------------------------
// Pieces

/**
 * Blade lofted from `profile` = [[y, halfWidth, halfThick], ...] (base first, tip last), diamond section split down
 * the ridge into two halves: the −x face is shadowed (ridge `dark`, edge 1.0), the +x face lit (ridge `light`, edge
 * `edge`). single: one cutting edge on −x, a narrow spine flat on +x. curve(y) bends the blade along z.
 */
export function blade(profile, { single = false, curve = null, light = 1.08, dark = 0.6, edge = 1.28 } = {}) {
  const halves = [];
  for (const s of [-1, 1]) {
    const rings = [], sh = [];
    for (const [y, w, t] of profile) {
      const z = curve ? curve(y) : 0, wx = s > 0 && single ? w * 0.4 : w;
      const e = [s * wx, y, z];
      rings.push(s < 0 ? [[0, y, z - t], e, [0, y, z + t]] : [[0, y, z + t], e, [0, y, z - t]]);
      const ridge = s < 0 ? dark : light, tip = s < 0 ? 1.0 : single ? 1.0 : edge;
      sh.push([ridge, tip, ridge]);
    }
    halves.push(loft(rings, { closed: false, shade: sh }));
  }
  return mergeGeometries(halves, false);
}

/**
 * Axe bit in the head's frame (haft along Y at x = 0, bit reaching `s * reach` along x; −Y is the far end of the haft):
 * a crescent edge bulging between the horn (far corner) and heel (near corner), a mild beard under the heel, a lens
 * section whose flat cheeks are inset from the edge ring so the bevel brightens to a bright edge.
 */
export function axeBit({ reach = 0.3, horn = 0.24, heel = 0.3, eye = 0.12, t = 0.04, s = -1, beard = 0.55 } = {}) {
  const o = [[0, -eye], [reach * 0.42, -horn * 0.86], [reach * 0.89, -horn]];
  const N = 5;
  for (let i = 1; i < N; i++) { const u = i / N; o.push([reach * (0.89 + 0.11 * Math.sin(Math.PI * u)), lerp(-horn, heel, u)]); }
  o.push([reach * 0.89, heel], [reach * 0.52, heel * beard], [0, eye]);
  const ring = (z, k) => o.map(([x, y]) => [s * x * k, y * (k === 1 ? 1 : 0.84), z]);
  const edge = o.map(([x]) => 0.95 + 0.4 * clamp01((x / reach - 0.45) / 0.4));
  return loft([ring(-t / 2, 0.78), ring(0, 1), ring(t / 2, 0.78)], { capStart: true, capEnd: true, shade: [0.82, edge, 0.82] });
}

/** Cross-guard along X: half-length L, half-height h, half-depth d; the quillons taper and droop toward the blade (−Y). */
export function crossguard(L, h, d, droop = 0, segs = 6) {
  const rings = [], sh = [];
  for (const u of [-1, -0.72, -0.3, 0.3, 0.72, 1]) {
    const k = 1 - 0.42 * u * u;
    rings.push(ringX(segs, u * L, h * k, d * k, -droop * u * u));
    sh.push(0.95 + 0.15 * (1 - u * u));
  }
  return loft(rings, { capStart: true, capEnd: true, shade: sh });
}

/** Wrapped grip along Y from y0 (blade end) to y1 (pommel end), radius r: alternating bands baked light / dark. */
export function grip(y0, y1, r, band = 0.026, segs = 7) {
  const rings = [], sh = [], nB = Math.max(2, Math.round((y1 - y0) / band));
  for (let i = 0; i <= nB; i++) {
    const y = lerp(y0, y1, i / nB), k = i % 2, rr = r * (k ? 1 : 0.93);
    rings.push(ringY(segs, y, rr, rr, 1)); sh.push(k ? 1.08 : 0.8);
  }
  return loft(rings, { capStart: true, capEnd: true, shade: sh });
}

/** Hammer poll / back block along +X from the haft: half-height h, half-depth d, length len. */
function poll(h, d, len, s = 1) {
  return loft([ringX(6, s * 0.02, h, d), ringX(6, s * len, h * 0.85, d * 0.85)], { capStart: true, capEnd: true, shade: [1.0, 0.92] });
}

const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const rz = (g, a) => { g.rotateZ(a); return g; };

// -------------------------------------------------------------------------------------------------
// Weapons

/**
 * Parts for a weapon visual: [{ geo, color, shade }] in the hand frame, tilted 0.35 rad forward. Visuals: greatsword,
 * sword, katana, halberd, axe (a bearded one-hander with a hammer poll), greatAxe (the Raider's double-bit), dagger,
 * staff (glintstone orb), bow (plain), none.
 */
export function weaponParts(visual) {
  const P = [];
  const S = PALETTE.steel, SD = PALETTE.steelDark, L = PALETTE.leather, G = PALETTE.gold, WD = PALETTE.woodDark;
  const add = (geo, color, shade = 1, y = 0, x = 0, z = 0) => { if (x || y || z) geo.translate(x, y, z); P.push({ geo, color, shade }); };
  switch (visual) {
    case 'greatsword':
      add(blade([[-0.3, 0.056, 0.012], [-0.42, 0.058, 0.013], [-1.15, 0.048, 0.011], [-1.42, 0.036, 0.009], [-1.6, 0.003, 0.002]]), S, STEEL_SHADE);
      add(crossguard(0.17, 0.022, 0.03, 0.045), SD, 1.0, -0.28);
      add(cyl(0.031, 0.035, 0.03, 6), SD, 0.9, -0.255);
      add(grip(-0.24, 0.05, 0.026), L, 1.0);
      add(cyl(0.032, 0.024, 0.03, 6), SD, 1.0, 0.066); // faceted pommel cap (a bright ball read as a second hand)
      break;
    case 'sword':
      add(blade([[-0.14, 0.028, 0.008], [-0.24, 0.029, 0.008], [-0.78, 0.024, 0.007], [-0.92, 0.016, 0.005], [-1.0, 0.002, 0.001]]), S, STEEL_SHADE);
      add(crossguard(0.11, 0.016, 0.024, 0.02), SD, 1.0, -0.125);
      add(grip(-0.11, 0.05, 0.021, 0.024), L, 1.0);
      add(cyl(0.024, 0.018, 0.022, 6), SD, 1.0, 0.066);
      break;
    case 'katana': {
      const curve = (y) => 0.045 * Math.pow(clamp01((-y - 0.14) / 0.86), 2);
      add(blade([[-0.14, 0.022, 0.007], [-0.3, 0.023, 0.007], [-0.85, 0.019, 0.006], [-0.96, 0.012, 0.004], [-1.0, 0.002, 0.001]], { single: true, curve }), S, STEEL_SHADE);
      add(cyl(0.048, 0.048, 0.008, 8), SD, 0.9, -0.125); // tsuba
      add(cyl(0.021, 0.024, 0.024, 6), G, 1.0, -0.108); // habaki collar
      add(grip(-0.095, 0.07, 0.019, 0.022), PALETTE.clothDark, 1.0);
      add(cyl(0.02, 0.018, 0.012, 6), SD, 1.0, 0.082);
      break;
    }
    case 'dagger':
      add(blade([[-0.11, 0.021, 0.006], [-0.2, 0.022, 0.006], [-0.48, 0.014, 0.005], [-0.565, 0.002, 0.001]]), S, STEEL_SHADE);
      add(crossguard(0.06, 0.012, 0.018, 0.012), SD, 1.0, -0.1);
      add(grip(-0.09, 0.04, 0.017, 0.02), L, 1.0);
      add(cyl(0.02, 0.015, 0.018, 6), G, 1.0, 0.055);
      break;
    case 'halberd':
      add(cyl(0.022, 0.026, 2.2, 6), WD, 1.0, -0.55);
      add(cyl(0.034, 0.038, 0.12, 8), SD, 0.95, -1.58);
      add(box(0.012, 0.6, 0.064), SD, 0.9, -1.25);
      add(axeBit({ reach: 0.32, horn: 0.24, heel: 0.24, eye: 0.11, t: 0.022, s: -1 }), S, STEEL_SHADE, -1.32);
      add(rz(blade([[0, 0.026, 0.012], [-0.12, 0.014, 0.007], [-0.2, 0.002, 0.001]]), Math.PI / 2 - 0.3), S, STEEL_SHADE, -1.3); // back hook
      add(blade([[-1.64, 0.028, 0.014], [-1.74, 0.034, 0.016], [-1.92, 0.02, 0.01], [-2.02, 0.002, 0.001]]), S, STEEL_SHADE);
      add(cyl(0.028, 0.02, 0.06, 6), SD, 0.9, 0.53);
      break;
    case 'axe':
      add(cyl(0.026, 0.03, 1.1, 7), WD, 1.0, -0.35);
      add(grip(-0.12, 0.08, 0.029), L, 1.0);
      add(cyl(0.046, 0.046, 0.24, 8), SD, 0.95, -0.76);
      add(box(0.012, 0.4, 0.07), SD, 0.9, -0.56);
      add(axeBit({ reach: 0.26, horn: 0.18, heel: 0.22, eye: 0.1, t: 0.024, s: -1 }), S, STEEL_SHADE, -0.76);
      add(poll(0.06, 0.045, 0.09), SD, 1.0, -0.76);
      add(cyl(0.032, 0.032, 0.03, 7), SD, 0.9, -0.88);
      break;
    case 'greatAxe': // the Raider's: carried choked up, the head low by the hand, the haft rising past the shoulder
      add(cyl(0.03, 0.036, 1.55, 8), WD, 1.0, -0.2);
      add(grip(-0.12, 0.16, 0.038), L, 0.95);
      add(cyl(0.062, 0.062, 0.3, 8), SD, 0.95, -0.72);
      add(box(0.016, 0.5, 0.1), SD, 0.9, -0.47);
      for (const s of [-1, 1]) add(axeBit({ reach: 0.3, horn: 0.24, heel: 0.3, eye: 0.12, t: 0.04, s }), S, STEEL_SHADE, -0.72);
      add(blade([[-0.95, 0.04, 0.02], [-1.02, 0.045, 0.022], [-1.15, 0.02, 0.01], [-1.22, 0.003, 0.002]]), S, STEEL_SHADE); // top spike
      add(cyl(0.04, 0.04, 0.03, 8), SD, 0.9, -0.5); add(cyl(0.04, 0.04, 0.03, 8), SD, 0.9, -0.96);
      add(sph(0.045, 6, 4), SD, 1.0, 0.58);
      break;
    case 'staff': {
      add(cyl(0.02, 0.026, 1.7, 6), WD, 1.0, -0.45);
      add(cyl(0.03, 0.025, 0.06, 6), SD, 0.9, 0.33);
      add(sph(0.07, 6, 5), 0x8a6aff, 1.0, 0.42);
      for (let k = 0; k < 3; k++) { // gold prongs cradling the orb
        const g = blade([[0, 0.012, 0.006], [-0.16, 0.007, 0.003], [-0.2, 0.001, 0.001]]);
        g.rotateZ(Math.PI); g.rotateZ(-0.16); g.translate(0.075, 0.34, 0); g.rotateY((k * TAU) / 3);
        add(g, G, 1.15);
      }
      break;
    }
    case 'bow': {
      const a = box(0.03, 0.7, 0.025); a.rotateX(-0.35); add(a, WD, 1.0, -0.35, 0, 0.12);
      const b = box(0.03, 0.7, 0.025); b.rotateX(0.35); add(b, WD, 1.0, 0.35, 0, 0.12);
      add(box(0.006, 1.3, 0.006), 0xd8d4c8, 1.0);
      break;
    }
    default: break;
  }
  for (const p of P) p.geo.rotateX(-0.35);
  return P;
}
