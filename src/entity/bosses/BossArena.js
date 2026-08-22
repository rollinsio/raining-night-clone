/**
 * Boss arena dressing so the field-boss fight happens *somewhere*: one continuous paved floor (Paving.js
 * decal: flush running-bond flagstones with grout, joint occlusion and missing slabs), a few heaved slabs
 * and loose stones for relief, a broken ring of cracked, leaning stone columns (chipped tops, fallen
 * drums), a ruined gate and low wall stubs, four iron braziers on stone plinths with emissive flames +
 * additive glow billboards (registered in limveld.fires so the world's warm point light and the rising
 * embers follow them), and a gibbet post toward the moon as a mid-ground silhouette. Built lazily once per
 * arena and cached; 4 draw calls (floor, stone, flames, glows).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat, emissive } from '../../render/Style.js';
import { Glows } from '../../render/Glows.js';
import { TAU, sm, lerp, rough, cyl, box, cone } from './BossRig.js';
import { pavedFloor } from './Paving.js';

const _c = new THREE.Color(), _c2 = new THREE.Color();
const MOON = new THREE.Vector2(-0.5, -0.6).normalize(); // horizontal moon direction (Atmosphere MOON_DIR)
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/** Bake vertex colours: lerp(dark, light) by height in [y0,y1] times a per-part multiplier. */
function colorize(g, dark, light, y0, y1, mul = 1) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  _c.setHex(dark); _c2.setHex(light);
  for (let i = 0; i < p.count; i++) {
    const k = sm((p.getY(i) - y0) / (y1 - y0));
    col[i * 3] = lerp(_c.r, _c2.r, k) * mul; col[i * 3 + 1] = lerp(_c.g, _c2.g, k) * mul; col[i * 3 + 2] = lerp(_c.b, _c2.b, k) * mul;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  return g;
}

/** Broken column: plinth + stacked drums, chipped top, slight lean. Origin at the plinth base. */
function column(rng, h, r, seed) {
  const parts = [];
  const plinth = rough(box(r * 2.6, 0.5, r * 2.6), 0.06, seed); plinth.translate(0, 0.25, 0); parts.push(plinth.toNonIndexed());
  const n = Math.max(2, Math.round(h / 0.9)); let y = 0.5;
  for (let i = 0; i < n; i++) {
    const dh = (h - 0.5) / n, rb = r * (1 - 0.04 * i), rt = r * (1 - 0.04 * (i + 1));
    const g = new THREE.CylinderGeometry(rt, rb, dh, 7, 1); g.rotateY(rng.float() * 0.5); g.translate(0, y + dh / 2, 0);
    rough(g, 0.07 + 0.03 * i, seed + i);
    parts.push(g.toNonIndexed()); y += dh;
  }
  const m = mergeGeometries(parts, false);
  const p = m.attributes.position; // chip the top: drop the upper vertices unevenly
  for (let i = 0; i < p.count; i++) { const py = p.getY(i); if (py > h - 0.35) p.setY(i, py - (0.1 + 0.55 * ((Math.sin(p.getX(i) * 9.1 + p.getZ(i) * 7.3 + seed) * 0.5 + 0.5)))); }
  m.computeVertexNormals();
  return colorize(m, PALETTE.monolithDark, PALETTE.stone, -0.5, h * 1.1, 0.92 + rng.float() * 0.16);
}

/** Column drum lying on its side. */
function fallenDrum(rng, r, len, seed) {
  const g = new THREE.CylinderGeometry(r * 0.96, r, len, 7, 1); rough(g, 0.08, seed);
  g.rotateZ(Math.PI / 2); g.rotateY(rng.float() * TAU); g.translate(0, r * 0.82, 0);
  return colorize(g, PALETTE.monolithDark, PALETTE.stone, -r, r * 1.6, 0.95);
}

function rubble(rng, r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 0); rough(g, r * 0.55, seed);
  g.rotateY(rng.float() * TAU); g.translate(0, r * 0.55, 0);
  return colorize(g, PALETTE.rockPropDark, PALETTE.rockProp, -r * 0.3, r * 1.2, 0.9 + rng.float() * 0.2);
}

/** Stone plinth + iron bowl (the flame is a separate emissive part). */
function brazier(seed) {
  const parts = [];
  const plinth = rough(cyl(0.5, 0.62, 1.25, 6), 0.05, seed); plinth.translate(0, 0.62, 0); parts.push(colorize(plinth, PALETTE.monolithDark, PALETTE.stoneLight, -0.3, 1.4));
  const cap = box(1.1, 0.16, 1.1); cap.translate(0, 1.32, 0); parts.push(colorize(cap, PALETTE.stoneDark, PALETTE.stoneLight, 1.2, 1.45));
  const bowl = new THREE.CylinderGeometry(0.66, 0.3, 0.52, 8, 1, true); bowl.translate(0, 1.68, 0); parts.push(colorize(bowl, PALETTE.iron, PALETTE.iron, 0, 1, 0.9));
  const rim = new THREE.TorusGeometry(0.66, 0.06, 4, 10); rim.rotateX(Math.PI / 2); rim.translate(0, 1.94, 0); parts.push(colorize(rim, PALETTE.iron, PALETTE.steelDark, 1.9, 2.0));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; const sp = cone(0.05, 0.3, 4); sp.translate(Math.sin(a) * 0.64, 2.05, Math.cos(a) * 0.64); parts.push(colorize(sp, PALETTE.iron, PALETTE.steelDark, 1.9, 2.2)); }
  return mergeGeometries(parts, false);
}
function flame() {
  const g = new THREE.ConeGeometry(0.42, 1.2, 5); g.translate(0, 2.45, 0);
  const g2 = new THREE.ConeGeometry(0.22, 0.8, 4); g2.translate(0.1, 2.95, -0.06);
  const coals = new THREE.SphereGeometry(0.4, 6, 4); coals.scale(1, 0.45, 1); coals.translate(0, 1.9, 0);
  return colorize(mergeGeometries([g, g2, coals].map((p) => p.toNonIndexed()), false), PALETTE.torch, PALETTE.spark, 1.8, 3.3);
}

/** Gibbet: tall post, arm with a brace, hanging chain and an iron cage. */
function gibbet(seed) {
  const parts = [];
  const post = rough(cyl(0.14, 0.2, 6.2, 6), 0.04, seed); post.translate(0, 3.1, 0); parts.push(colorize(post, PALETTE.woodDark, PALETTE.wood, -0.5, 6.5));
  const arm = box(2.6, 0.22, 0.22); arm.translate(1.1, 6.0, 0); parts.push(colorize(arm, PALETTE.woodDark, PALETTE.wood, 5.2, 6.4));
  const brace = box(0.16, 1.6, 0.16); brace.rotateZ(-0.75); brace.translate(0.7, 5.35, 0); parts.push(colorize(brace, PALETTE.woodDark, PALETTE.wood, 4.5, 6.0));
  const chain = cyl(0.03, 0.03, 1.3, 4); chain.translate(2.15, 5.3, 0); parts.push(colorize(chain, PALETTE.iron, PALETTE.steelDark, 4.5, 6.0));
  const cage = new THREE.CylinderGeometry(0.42, 0.34, 1.5, 6, 1, true); cage.translate(2.15, 3.9, 0); parts.push(colorize(cage, PALETTE.iron, PALETTE.iron, 3, 5, 0.8));
  for (const y of [3.2, 3.9, 4.6]) { const ring = new THREE.TorusGeometry(0.4, 0.035, 4, 8); ring.rotateX(Math.PI / 2); ring.translate(2.15, y, 0); parts.push(colorize(ring, PALETTE.iron, PALETTE.steelDark, 3, 5)); }
  const lid = cone(0.46, 0.4, 6); lid.translate(2.15, 4.82, 0); parts.push(colorize(lid, PALETTE.iron, PALETTE.steelDark, 4.6, 5.1));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
}

/**
 * Heaved slabs: a few flagstones that have lifted out of the paving (tilted, one edge proud of the floor),
 * dark joint-shadow under the raised edge baked into the vertex colours. Placed on a ring at radius r0..r1
 * keeping clear of the fight line (angles near `keepA` are skipped).
 */
function heavedSlabs(rng, T, cx, cz, r0, r1, n, keepA, out) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.25, 0.25);
    const dKeep = Math.abs(Math.atan2(Math.sin(a - keepA), Math.cos(a - keepA)));
    if (dKeep < 0.35) continue;
    const r = rng.range(r0, r1), x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const w = rng.range(0.95, 1.3), d = rng.range(0.8, 1.05), t = 0.14;
    const g = rough(box(w, t, d), 0.03, 170 + i * 7);
    const tilt = rng.range(0.08, 0.2);
    g.translate(0, t * 0.5, 0); g.rotateX(tilt * (rng.chance(0.5) ? 1 : -1)); g.rotateY(rng.float() * TAU);
    const y = T.getHeight(x, z) - 0.03; g.translate(x, y, z);
    out.push(colorize(g, PALETTE.monolithDark, PALETTE.stoneLight, y - 0.06, y + 0.2, 0.78 + rng.float() * 0.2));
  }
}

/** Low ruined wall: two or three courses of blocks along the local X axis, crumbling toward one end. */
function wallStub(rng, len, h, seed) {
  const parts = [];
  const bw = 0.92, bh = 0.46, bd = 0.62, rows = Math.max(2, Math.round(h / bh));
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5, n = Math.ceil(len / bw) + 1;
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + off + i * bw;
      if (x > len / 2) break;
      const fall = sm((x + len * 0.1) / len); // crumbles toward +X
      if (r > 0 && rng.float() < fall * 0.75 * (r / (rows - 1))) continue;
      const g = rough(box(bw * 0.96, bh * 0.94, bd), 0.05, seed + r * 31 + i); g.translate(x, bh * (r + 0.5), rng.range(-0.03, 0.03));
      parts.push(colorize(g, PALETTE.monolithDark, PALETTE.stoneLight, -0.2, h * 1.1, 0.88 + rng.float() * 0.2));
    }
  }
  return mergeGeometries(parts, false);
}

/** Ruined gate: two square piers with chipped tops and the broken stub of a lintel on one of them. */
function gate(rng, seed) {
  const parts = [];
  const pier = (x, h, s) => {
    const base = rough(box(1.9, 0.6, 1.9), 0.05, s); base.translate(x, 0.3, 0); parts.push(colorize(base, PALETTE.monolithDark, PALETTE.stone, -0.2, 1));
    for (let i = 0; i < Math.round(h / 1.1); i++) {
      const g = rough(box(1.5 - i * 0.02, 1.08, 1.5 - i * 0.02), 0.06 + 0.02 * i, s + i * 3); g.rotateY(rng.range(-0.03, 0.03)); g.translate(x, 0.6 + 0.55 + i * 1.1, 0);
      parts.push(colorize(g, PALETTE.monolithDark, PALETTE.stoneLight, -0.5, h * 1.15, 0.9 + rng.float() * 0.18));
    }
    const top = rough(box(1.9, 0.5, 1.9), 0.22, s + 99); top.translate(x, 0.6 + h + 0.2, 0); parts.push(colorize(top, PALETTE.monolithDark, PALETTE.stone, h - 0.5, h + 1));
  };
  pier(-3.2, 6.6, seed); pier(3.2, 5.2, seed + 7);
  const lintel = rough(box(3.4, 0.8, 1.5), 0.08, seed + 50); lintel.rotateZ(0.05); lintel.translate(-1.9, 7.6, 0); parts.push(colorize(lintel, PALETTE.monolithDark, PALETTE.stoneLight, 7, 8.2));
  const chunk = rough(box(1.2, 0.7, 1.2), 0.25, seed + 60); chunk.rotateY(0.5); chunk.translate(1.4, 0.35, 1.6); parts.push(colorize(chunk, PALETTE.monolithDark, PALETTE.stone, 0, 0.8));
  return mergeGeometries(parts, false);
}

const cache = new Map();

export class BossArena {
  /** Dressing for an arena ({x, z, r, name}); built once and kept in the scene. */
  static get(game, arena) {
    let a = cache.get(arena.name);
    if (!a || a.game !== game) { a = new BossArena(game, arena); cache.set(arena.name, a); }
    return a;
  }

  constructor(game, arena) {
    this.game = game; this.arena = arena;
    const T = game.terrain, rng = game.rng.fork(900 + hash(arena.name));
    const cx = arena.x, cz = arena.z, R = 13.5;
    const stone = [], flames = [], glows = [];
    const put = (g, x, z, ry, sink = 0) => { g.rotateY(ry); g.translate(x, T.getHeight(x, z) - sink, z); stone.push(g); };
    const moonA = Math.atan2(MOON.x, MOON.y);
    // ring of columns with a gap toward the moon (the gibbet stands there) and one fallen stretch
    const n = 10, gapA = moonA, fallA = moonA + Math.PI * 0.85;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.12, 0.12);
      const dGap = Math.abs(Math.atan2(Math.sin(a - gapA), Math.cos(a - gapA)));
      const dFall = Math.abs(Math.atan2(Math.sin(a - fallA), Math.cos(a - fallA)));
      const r = R + rng.range(-1.2, 1.2), x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (dGap < 0.42) continue;
      const fallen = dFall < 0.4;
      const h = fallen ? rng.range(1.2, 2.2) : rng.range(3.6, 7.4), cr = rng.range(0.55, 0.8);
      const g = column(rng, h, cr, i * 13);
      g.rotateX(rng.range(-0.06, 0.06)); g.rotateZ(rng.range(-0.07, 0.07));
      put(g, x, z, rng.float() * TAU, 0.25);
      if (fallen) for (let k = 0; k < 2; k++) put(fallenDrum(rng, cr * 0.95, rng.range(1.2, 2.2), i * 7 + k), x + rng.range(-2.5, 2.5), z + rng.range(-2.5, 2.5), 0, 0.05);
      for (let k = 0; k < 5; k++) { const rr = rng.range(0.18, 0.5); put(rubble(rng, rr, i * 17 + k), x + rng.range(-2.2, 2.2), z + rng.range(-2.2, 2.2), 0, rr * 0.3); }
    }
    for (let k = 0; k < 16; k++) { // loose stones, mostly toward the rim of the paving
      const a = rng.float() * TAU, r = rng.range(5, R - 1.5), rr = rng.range(0.1, 0.26);
      put(rubble(rng, rr, 300 + k), cx + Math.sin(a) * r, cz + Math.cos(a) * r, 0, rr * 0.4);
    }
    const PAVE_R = 11;
    heavedSlabs(rng, T, cx, cz, 6.5, PAVE_R - 1.5, 9, moonA + Math.PI, stone); // relief at the rim, clear of the fight line
    // ruined gate in the column gap toward the moon (the boss is seen against it), gibbet beside it
    { const ga = moonA + 0.62; put(gate(rng, 11), cx + Math.sin(ga) * (R + 1.0), cz + Math.cos(ga) * (R + 1.0), ga + Math.PI * 0.5 + 0.25, 0.35); } // off the fight axis: both piers + the broken lintel stand beside the boss against the sky
    put(gibbet(5), cx + Math.sin(moonA - 0.5) * (R + 1.0), cz + Math.cos(moonA - 0.5) * (R + 1.0), moonA + Math.PI * 0.5 - 0.3, 0.2); // silhouetted on the other flank
    // low broken walls between the columns on both flanks
    for (const [da, len, h, s] of [[0.95, 6.0, 2.2, 1], [-1.0, 5.0, 1.6, 2], [1.75, 4.0, 1.3, 3], [-1.8, 4.5, 1.9, 4]]) {
      const a = moonA + da, r = R + 0.6;
      put(wallStub(rng, len, h, 400 + s * 17), cx + Math.sin(a) * r, cz + Math.cos(a) * r, a + Math.PI * 0.5, 0.15);
    }
    // braziers at the quarter points, inside the ring
    for (let i = 0; i < 4; i++) {
      const a = moonA + Math.PI * 0.25 + (i / 4) * TAU, r = R - 3.2, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r, y = T.getHeight(x, z) - 0.08;
      const b = brazier(i); b.rotateY(a); b.translate(x, y, z); stone.push(b);
      const f = flame(); f.rotateY(rng.float() * TAU); f.translate(x, y, z); flames.push(f);
      glows.push({ x, y: y + 2.55, z, color: PALETTE.torch, size: 2.6 });
    }
    const group = new THREE.Group(); group.name = 'bossArena:' + arena.name;
    const floor = pavedFloor(T, cx, cz, PAVE_R);
    const stoneMesh = new THREE.Mesh(mergeGeometries(stone, false), vertexMat());
    stoneMesh.castShadow = true; stoneMesh.receiveShadow = true;
    const flameMesh = new THREE.Mesh(mergeGeometries(flames, false), emissive(PALETTE.torch, 2.2, { vertexColors: true }));
    flameMesh.castShadow = false; flameMesh.receiveShadow = false;
    this.glows = new Glows(glows);
    group.add(floor, stoneMesh, flameMesh, this.glows.mesh);
    game.scene.add(group);
    this.group = group; this.fires = glows;
    // the world's flame list drives the roaming warm point light (Grace.update) and the rising embers (Combat)
    if (game.limveld && game.limveld.fires) for (const f of glows) game.limveld.fires.push(new THREE.Vector3(f.x, f.y - 1.1, f.z));
  }

  /** Nearest brazier flame to (x,z) — a warm light anchor for the arena. */
  nearestFire(x, z) {
    let best = null, bd = Infinity;
    for (const f of this.fires) { const d = (f.x - x) ** 2 + (f.z - z) ** 2; if (d < bd) { bd = d; best = f; } }
    return best;
  }

  update(dt) { this.glows.update(dt); }
}
