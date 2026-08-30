/**
 * Site dressing for structure kits — the reusable pieces that make a place read as old and lived-in:
 * stepped buttresses, stone stairs, crenellations, jagged broken wall tops, wall sconces / braziers /
 * campfires (each registers a flame so Atmosphere draws a glow and the kit bakes warm light into the
 * stone), rubble, graveyards, banners and lit windows. Every helper adds into a Kit (Structures.js) in
 * the kit's *current frame*, so a whole POI still merges to one mesh (+ one emissive mesh).
 */
import { PALETTE } from '../render/Style.js';

const TAU = Math.PI * 2;

/**
 * Stepped Gothic buttress. (x, z) is the point on the wall face, (dx, dz) the outward direction.
 * Two stages with sloped trim caps; total height h1 + h2 + cap.
 */
export function buttress(k, x, y, z, dx, dz, o = {}) {
  const { w = 1.1, h1 = 4.4, h2 = 2.4, d1 = 1.3, d2 = 0.8, cap = 0.7, color = PALETTE.stone, trim = PALETTE.stoneLight, base = true } = o;
  k.push(x, z, Math.atan2(dx, dz), y);
  k.box(w, h1, d1, 0, 0, d1 / 2, color, { tint: 1 });
  if (base) k.box(w + 0.16, 0.5, d1 + 0.1, 0, 0, d1 / 2 + 0.05, PALETTE.stoneDark, { tint: 1, mul: 0.92, seg: 4 }); // proud footing course
  k.wedge(w, d1 - d2, cap, 0, h1, d2, trim);
  k.box(w, h2, d2, 0, h1, d2 / 2, color, { tint: 1 });
  k.wedge(w, d2, cap, 0, h1 + h2, 0, trim);
  k.pop();
}

/** Flight of solid stone steps rising toward -z; the bottom step's front edge sits at z, width w. */
export function stairs(k, x, y, z, w, n, rise, run, color = PALETTE.stoneDark, o = {}) {
  for (let i = 0; i < n; i++) k.box(w, (i + 1) * rise, run, x, y, z - (i + 0.5) * run, color, { tint: 1, seg: 4, solid: false }); // steps: walkable
  if (o.cheeks) {
    const L = n * run, h = n * rise + 0.5, cw = 0.7;
    k.box(cw, h, L, x - w / 2 - cw / 2, y, z - L / 2, color, { tint: 0.95 });
    k.box(cw, h, L, x + w / 2 + cw / 2, y, z - L / 2, color, { tint: 0.95 });
  }
}

/** Crenellations along local X centred on 0, base at y, thickness t (along z), centred on z. */
export function merlons(k, L, y, z, t, color = PALETTE.stoneDark, o = {}) {
  const { w = 1.1, gap = 0.9, h = 1.1, cap = true } = o;
  const pitch = w + gap, n = Math.max(1, Math.floor((L + gap) / pitch)), start = -((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const x = start + i * pitch;
    k.boxC(w, h, t, x, y + h / 2, z, color, 0, 0, 0, { tint: 1, seg: 4 });
    if (cap) k.boxC(w + 0.16, 0.16, t + 0.16, x, y + h + 0.08, z, color, 0, 0, 0, { tint: 1.08, seg: 4 });
  }
}

/**
 * Wall along local X (length L, thickness t, centred on 0) whose top is a jagged, stepped break.
 * Height at u (0..1 along the wall) = profile(u) if given, else a sine sweep between h0 and hMax.
 */
export function brokenWall(k, L, t, h0, hMax, color = PALETTE.stone, o = {}) {
  const { cw = 0.8, profile = null, seed = 0, y = 0, z = 0, course = 0.35, jitter = 0.35, mul = 1 } = o;
  const n = Math.max(1, Math.round(L / cw)), w = L / n;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, x = -L / 2 + (i + 0.5) * w;
    const base = profile ? profile(u) : h0 + (hMax - h0) * (0.5 + 0.5 * Math.sin(u * 3.1 + seed));
    let h = Math.max(course, base + k.rng.range(-jitter, jitter));
    h = Math.round(h / course) * course;
    k.box(w, h, t, x, y, z, color, { tint: 1, mul, seg: 1.2 });
  }
}

/** Wall-mounted iron sconce with a flame; the bracket projects toward local +z from the wall face at z. */
export function torch(k, x, y, z, ry = 0, o = {}) {
  k.push(x, z, ry, y);
  k.box(0.1, 0.1, 0.46, 0, -0.05, 0.23, PALETTE.iron, { ao: false, tint: 0.9 });
  k.boxC(0.08, 0.5, 0.08, 0, -0.26, 0.22, PALETTE.iron, 0.6, 0, 0, { ao: false, tint: 0.85 });
  k.cyl(0.16, 0.09, 0.34, 6, 0, 0, 0.44, PALETTE.iron, { ao: false, tint: 0.8 });
  k.cone(0.22, 0.62, 5, 0, 0.26, 0.44, PALETTE.ember, { glow: true, ao: false });
  k.cone(0.11, 0.86, 4, 0, 0.3, 0.44, PALETTE.torch, { glow: true, ao: false });
  k.fire(0, 0.78, 0.44, { r: o.r ?? 2.4, i: o.i ?? 1.9, halo: o.halo });
  k.pop();
}

/** Free-standing iron brazier: bowl on a stem with a tall flame. */
export function brazier(k, x, y, z, o = {}) {
  k.push(x, z, 0, y);
  k.cyl(0.42, 0.52, 0.12, 6, 0, 0, 0, PALETTE.iron, { tint: 0.7 });
  k.cyl(0.09, 0.13, 0.95, 5, 0, 0.1, 0, PALETTE.iron, { tint: 0.8 });
  k.cyl(0.52, 0.34, 0.5, 8, 0, 0.95, 0, PALETTE.iron, { tint: 0.85 });
  k.cone(0.4, 0.95, 6, 0, 1.3, 0, PALETTE.ember, { glow: true, ao: false });
  k.cone(0.2, 1.3, 5, 0, 1.36, 0, PALETTE.torch, { glow: true, ao: false });
  k.fire(0, 1.8, 0, { r: o.r ?? 3.0, i: o.i ?? 2.2, halo: o.halo });
  k.pop();
}

/** Ring of stones, two crossed logs and a flame. */
export function campfire(k, x, y, z, o = {}) {
  k.push(x, z, 0, y);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; k.boxC(0.36, 0.3, 0.36, Math.cos(a) * 1.0, 0.15, Math.sin(a) * 1.0, PALETTE.rockProp, 0, a, 0); }
  k.cylC(0.09, 0.09, 1.3, 5, 0, 0.14, 0, PALETTE.woodDark, 0, 0.6, Math.PI / 2, { tint: 0.8 });
  k.cylC(0.09, 0.09, 1.3, 5, 0, 0.14, 0, PALETTE.woodDark, 0, -0.7, Math.PI / 2, { tint: 0.7 });
  k.cone(0.38, 0.9, 6, 0, 0.1, 0, PALETTE.ember, { glow: true, ao: false });
  k.cone(0.2, 1.2, 5, 0, 0.15, 0, PALETTE.torch, { glow: true, ao: false });
  k.fire(0, 0.9, 0, { r: o.r ?? 3.2, i: o.i ?? 2.4 });
  k.pop();
}

/** Scatter n tumbled stone blocks inside radius r around (cx, cz). */
export function rubble(k, cx, cz, r, n, color = PALETTE.stoneDark, o = {}) {
  const { y = 0, smin = 0.3, smax = 0.9, tilt = 0.35 } = o, rng = k.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.float() * TAU, d = Math.sqrt(rng.float()) * r, s = rng.range(smin, smax);
    k.boxC(s, s * rng.range(0.5, 0.8), s * rng.range(0.8, 1.4), cx + Math.cos(a) * d, y + s * 0.2, cz + Math.sin(a) * d, color,
      rng.range(-tilt, tilt), rng.float() * Math.PI, rng.range(-tilt, tilt), { seg: 4 });
  }
}

/**
 * Ruined wall along local X (length L centred on 0, thickness t centred on z=0, base at o.y) whose top follows
 * top(u) (u = 0..1 along +x, metres) quantised to stone courses, with pointed-arch openings [{x, w, h, sill}]
 * that may stack. Openings survive only where the wall still stands: jambs stay as piers wherever the break
 * runs through them, and the arch head is built only when both springers are still there. Columns whose
 * top is below o.full (number or fn of u — the intact height) get a per-column jitter so breaks read jagged.
 */
export function ruinWall(k, L, t, openings, top, color, o = {}) {
  const { cw = 0.75, course = 0.35, jitter = 0.14, y = 0, full = Infinity, tint = 1, mul = 1, seg = 1.2 } = o, rng = k.rng;
  const fullAt = typeof full === 'function' ? full : () => full, bo = { tint, mul, seg };
  const ops = openings.slice().sort((a, b) => (a.sill || 0) - (b.sill || 0));
  const cuts = [-L / 2, L / 2];
  for (const op of ops) cuts.push(op.x - op.w / 2, op.x + op.w / 2);
  cuts.sort((a, b) => a - b);
  const hAt = (u) => { const h = top(u), j = h < fullAt(u) - 0.05 ? rng.range(-jitter, jitter) : 0; return Math.max(0, Math.round((h + j) / course) * course); };
  for (let i = 0; i < cuts.length - 1; i++) {
    const x0 = cuts[i], x1 = cuts[i + 1], span = x1 - x0;
    if (span < 0.02) continue;
    const n = Math.max(1, Math.round(span / cw)), w = span / n, xm = (x0 + x1) / 2;
    const here = ops.filter((op) => xm > op.x - op.w / 2 && xm < op.x + op.w / 2);
    for (let j = 0; j < n; j++) {
      const xc = x0 + (j + 0.5) * w, h = hAt((xc + L / 2) / L);
      let y0 = 0;
      for (const op of here) {
        const sill = op.sill || 0;
        if (sill - y0 > 0.01 && h > y0 + 0.01) k.box(w, Math.min(sill, h) - y0, t, xc, y + y0, 0, color, bo);
        y0 = sill + op.h;
      }
      if (h - y0 > 0.01) k.box(w, h - y0, t, xc, y + y0, 0, color, bo);
    }
  }
  for (const op of ops) {
    const sill = op.sill || 0, apex = sill + op.h, spring = apex - op.w * 0.62;
    const uL = (op.x - op.w / 2 - 0.25 + L / 2) / L, uR = (op.x + op.w / 2 + 0.25 + L / 2) / L, uC = (op.x + L / 2) / L;
    if (Math.min(top(uL), top(uR), top(uC)) >= spring + 0.5) k.archHead(op.x, op.w, sill + y, apex + y, t, color, bo);
  }
}

/** Blind arcading: n shallow pointed recesses (slabs 12 cm proud, darker stone) along local x centred on (x, z); ry turns local +z toward the face normal. */
export function blindArcade(k, x, y, z, ry, n, w, h, pitch, color = PALETTE.stoneDark, o = {}) {
  const opt = { tint: 0.5, ...o }, pt = Math.min(h * 0.35, w * 0.6);
  k.push(x, z, ry, y);
  for (let i = 0; i < n; i++) {
    const px = (i - (n - 1) / 2) * pitch;
    k.box(w, h - pt, 0.12, px, 0, 0, color, opt); k.prism(w, pt, 0.12, px, h - pt, 0, color, opt);
  }
  k.pop();
}

/** Corbel table: small blocks every o.pitch m along local x (length L, centred), base at y, standing proud of the face at z. */
export function corbelTable(k, L, y, z, color = PALETTE.stoneLight, o = {}) {
  const { pitch = 0.6, w = 0.32, h = 0.4, d = 0.3 } = o, n = Math.floor(L / pitch), start = -((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) k.box(w, h, d, start + i * pitch, y, z + d / 2, color, { tint: 0.9, seg: 4 });
}

/** Rows of headstones, crosses and tomb chests centred on (cx, cz), rows along z, facing local -z; o.mix = [headstone, cross] cumulative shares. */
export function graveyard(k, cx, cz, ry, rows, cols, o = {}) {
  const { pitchX = 1.8, pitchZ = 2.2, y = 0, color = PALETTE.grave, dark = PALETTE.stoneDark, trim = PALETTE.stoneLight, mix = [0.55, 0.8] } = o, rng = k.rng;
  k.push(cx, cz, ry, y);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (rng.chance(0.2)) continue;
    const x = (c - (cols - 1) / 2) * pitchX + rng.range(-0.25, 0.25), z = (r - (rows - 1) / 2) * pitchZ + rng.range(-0.2, 0.2);
    const kind = rng.float(), yaw = rng.range(-0.2, 0.2), lean = rng.range(-0.12, 0.12), tint = rng.range(0.62, 0.82);
    if (kind < mix[0]) {
      const h = rng.range(0.7, 1.0);
      k.boxC(0.72, h, 0.18, x, h / 2 - 0.2, z, color, lean, yaw, 0, { tint, seg: 4 });
      k.boxC(0.5, 0.24, 0.18, x, h - 0.2 + 0.1, z, color, lean, yaw, 0, { tint, seg: 4 });
      graveMound(k, x, 0, z, yaw);
    } else if (kind < mix[1]) {
      k.boxC(0.15, 1.4, 0.15, x, 0.5, z, dark, lean, yaw, 0, { tint });
      k.boxC(0.62, 0.15, 0.15, x, 0.85, z, dark, lean, yaw, 0, { tint });
      graveMound(k, x, 0, z, yaw);
    } else {
      k.box(0.95, 0.55, 1.8, x, -0.15, z, dark, { ry: yaw, tint });
      k.box(1.05, 0.12, 1.9, x, 0.4, z, trim, { ry: yaw, tint });
    }
  }
  k.pop();
}

/** Low earth mound in front (local -z) of a headstone at (x, z): a long low ridge of dark soil sunk into the turf. */
export function graveMound(k, x, y, z, yaw = 0, o = {}) {
  const { L = 1.6, w = 0.85, h = 0.2, color = PALETTE.terrain.dirt } = o;
  k.push(x, z, yaw, y - 0.06);
  k.prism(w, h, L, 0, 0, -(L / 2 + 0.12), color, { tint: 0.95, seg: 4 });
  k.pop();
}

/**
 * Hood mould over a pointed opening (x centre, width w, sill, apex) on a wall face at z: two sloping bands
 * following the head, with label stops at the springers; o.full adds the jamb bands down to the sill.
 */
export function hoodMould(k, x, w, sill, apex, z, color = PALETTE.stoneLight, o = {}) {
  const { t = 0.2, d = 0.16, proud = 0.02, full = false } = o, rectTop = apex - w * 0.62, hw = w / 2 + t / 2, zc = z + proud + d / 2;
  k.beam(x - hw, rectTop - 0.1, zc, x, apex + t * 0.7, zc, t, color, { d, tint: 0.95, seg: 4 });
  k.beam(x + hw, rectTop - 0.1, zc, x, apex + t * 0.7, zc, t, color, { d, tint: 0.95, seg: 4 });
  for (const s of [-1, 1]) k.box(t * 1.7, t * 1.3, d, x + s * hw, rectTop - 0.42, zc, color, { tint: 1, seg: 4 });
  if (full) for (const s of [-1, 1]) k.box(t, rectTop - 0.42 - sill, d, x + s * hw, sill, zc, color, { tint: 0.95, seg: 4 });
}

/** Hanging banner on a wall bracket (bracket projects toward local +z from the face at z). */
export function banner(k, x, y, z, ry, color, o = {}) {
  const { w = 0.9, h = 2.6 } = o;
  k.push(x, z, ry, y);
  k.box(0.08, 0.08, 0.8, 0, -0.04, 0.4, PALETTE.woodDark, { ao: false });
  k.box(w + 0.2, 0.07, 0.07, 0, -0.035, 0.78, PALETTE.woodDark, { ao: false });
  k.box(w, h, 0.05, 0, -h, 0.78, color, { ao: false, tint: 0.8 });
  k.pop();
}

/** Dim warm glow slab set just inside a window opening (face toward local +z). */
export function litWindow(k, w, h, x, y, z, ry = 0) {
  k.push(x, z, ry, y);
  k.box(w, h, 0.06, 0, 0, 0, PALETTE.torch, { dim: true, ao: false });
  k.pop();
}

/** Square stone pier with a pyramid finial (gate posts, stair piers). */
export function pier(k, x, y, z, s, h, color = PALETTE.stone, trim = PALETTE.stoneLight) {
  k.box(s, h, s, x, y, z, color, { tint: 1 });
  k.box(s + 0.2, 0.18, s + 0.2, x, y + h, z, trim, { tint: 1 });
  k.cone(s * 0.62, s * 0.9, 4, x, y + h + 0.18, z, trim, { ry: Math.PI / 4, tint: 1 });
}

/** Flagstone path: n slabs marching toward +z from (x, z). */
export function path(k, x, y, z, n, color = PALETTE.stoneDark) {
  const rng = k.rng;
  for (let i = 0; i < n; i++) {
    const s = rng.range(1.0, 1.5);
    k.box(s, 0.12, s * 0.8, x + rng.range(-0.5, 0.5), y - 0.04, z + i * 1.45 + rng.range(-0.1, 0.1), color, { ry: rng.range(-0.25, 0.25), tint: rng.range(0.9, 1.1), ao: false });
  }
}

/**
 * Pointed-arch recess drawn as a dark slab standing 8 cm proud of a wall face (cheap window, arrow slit,
 * belfry opening). (x, z) is the point on the face, ry turns local +z toward the face's outward normal.
 */
export function lancet(k, w, h, x, y, z, ry = 0, color = PALETTE.boulderDark, o = {}) {
  const pt = Math.min(h * 0.4, w * 0.6), opt = { tint: 0.3, ao: false, ...o };
  k.push(x, z, ry, y);
  k.box(w, h - pt, 0.16, 0, 0, 0, color, opt);
  k.prism(w, pt, 0.16, 0, h - pt, 0, color, opt);
  k.pop();
}
