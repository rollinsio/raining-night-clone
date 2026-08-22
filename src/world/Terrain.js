/**
 * Seeded fbm heightfield (~1200x1200 m) split into 8x8 chunks with a 2-level LOD,
 * per-face vertex colours (grass / dirt / rock / peak / shore) and a lake plane in a basin.
 * getHeight/getNormal sample the heightfield bilinearly.
 */
import * as THREE from 'three';
import { PALETTE, vertexMat } from '../render/Style.js';
import { MOON_DIR } from '../render/Atmosphere.js';

const LAKE = { x: -260, z: 60, r: 140 };
const AO_RES = 1.0;   // metres per occlusion-map cell
const PEAKS = { x: 330, z: -330, sigma: 170, h: 60 };
/**
 * Art-directed landforms (anisotropic gaussians) that give the vista its depth bands:
 * the overlook knoll the player stands on, a mist-filled valley below it, a ridge carrying the
 * Overlook Ruins, and the far-shore hills beyond the lake. ax/az = ridge direction, sa/sb = sigmas along/across.
 */
const LANDFORMS = [
  { x: 150, z: 210, ax: 1, az: 0, sa: 55, sb: 55, h: 11 },
  { x: 60, z: 150, ax: 1, az: 0, sa: 60, sb: 45, h: -8 },
  { x: -30, z: 135, ax: 0.53, az: -0.85, sa: 95, sb: 26, h: 16, rough: 0.5 },
  { x: -300, z: -60, ax: 0.53, az: -0.85, sa: 140, sb: 40, h: 22, rough: 0.6 },
  { x: 120, z: 20, ax: 0.9, az: 0.44, sa: 70, sb: 30, h: 9, rough: 0.5 },
  // vista silhouette bands: a steep spur receding diagonally right of the overlook (~80-120 m, dark, near),
  // a tall cliff band behind the ruin ridge (~300 m, second fog band), a small knoll for the left crag group
  { x: 112, z: 125, ax: 0.39, az: -0.92, sa: 34, sb: 11, h: 26, rough: 0.45 },
  { x: -120, z: 150, ax: 0.53, az: -0.85, sa: 70, sb: 16, h: 40, rough: 0.55 },
  { x: 72, z: 198, ax: 1, az: 0, sa: 14, sb: 10, h: 5 },
];
const BACKDROP = { r0: 620, r1: 1000, rPeak: 800, hMax: 175, segs: 160 };
// Moon direction (Atmosphere's) — baked per-facet value steps so flat shading reads even in the backlit foreground.
const MOON = MOON_DIR;

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Value noise in [0,1]. */
export function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
/** fbm in roughly [-1,1]. */
export function fbm(x, z, oct = 5, seed = 0) {
  let s = 0, amp = 1, tot = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += (vnoise(x * f, z * f, seed + i * 131) * 2 - 1) * amp;
    tot += amp; amp *= 0.5; f *= 2.03;
  }
  return s / tot;
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export class Terrain {
  constructor(game, { size = 1200, chunks = 8, segs = 48, seed = 7 } = {}) {
    this.game = game;
    this.size = size; this.half = size / 2; this.chunks = chunks; this.segs = segs; this.seed = seed;
    this.n = chunks * segs; this.samples = this.n + 1; this.cell = size / this.n;
    this.heights = new Float32Array(this.samples * this.samples);
    this.waterLevel = -4;
    this.lake = LAKE;
    this.paths = [];      // {w, pts:[[x,z],...]} worn tracks (Limveld pushes them in plan(); build() adds the POI network; baked as vertex colour)
    this._segs = null; this._segsFor = -1;   // flattened path segments with bounding boxes (pathDist fast reject)
    this.ao = null; this.damp = null; this.aoN = 0; // occlusion / damp maps (1 m cells) baked from static object footprints
    this.chunkMeshes = [];
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this._n = new THREE.Vector3();
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
    this._c3 = new THREE.Color();
  }

  /** Analytic height function (before flattening). */
  heightFn(x, z) {
    const s = this.seed;
    let h = fbm(x * 0.0016, z * 0.0016, 5, s) * 22;
    h += fbm(x * 0.0045 + 3, z * 0.0045, 4, s + 2) * 8;
    h += fbm(x * 0.012 + 10, z * 0.012, 3, s + 7) * 2.0;
    h += fbm(x * 0.05 + 40, z * 0.05, 2, s + 9) * 1.0 + fbm(x * 0.11 - 17, z * 0.11, 1, s + 10) * 0.35; // facet-scale roughness so flat shading reads
    // ridged mid-scale crests: sharper low-poly ridgelines than plain fbm
    const rg = 1 - Math.abs(fbm(x * 0.0028 + 21, z * 0.0028 - 13, 3, s + 17));
    h += rg * rg * 14;
    h += 8;
    // art-directed landforms
    for (let i = 0; i < LANDFORMS.length; i++) {
      const f = LANDFORMS[i], dx = x - f.x, dz = z - f.z;
      const a = dx * f.ax + dz * f.az, b = -dx * f.az + dz * f.ax;
      const g = Math.exp(-(a * a / (2 * f.sa * f.sa) + b * b / (2 * f.sb * f.sb)));
      const rough = f.rough ? 1 - f.rough + f.rough * 2 * vnoise(x * 0.02 + 5, z * 0.02, 61 + i) : 1;
      h += f.h * g * rough;
    }
    // peaks cluster
    const dp = Math.hypot(x - PEAKS.x, z - PEAKS.z);
    const ridge = 1 - Math.abs(fbm(x * 0.004, z * 0.004, 3, s + 3));
    h += PEAKS.h * Math.exp(-(dp * dp) / (2 * PEAKS.sigma * PEAKS.sigma)) * (0.6 + 0.6 * ridge);
    // rim mountains keep the player inside: an inner foothill band and a taller jagged outer wall
    const m = Math.max(Math.abs(x), Math.abs(z));
    const jag = 0.6 + 0.8 * (1 - Math.abs(fbm(x * 0.0055, z * 0.0055, 3, s + 23)));
    const t1 = smoothstep(350, 500, m);
    h += t1 * t1 * 40 * (0.5 + jag * 0.6);
    const t = smoothstep(450, 600, m);
    // sharp ridged spikes so the far band has a crisp, notched crest line instead of a soft swell
    const spike = Math.pow(1 - Math.abs(fbm(x * 0.014 + 3, z * 0.014 + 9, 2, s + 27)), 3);
    h += t * t * 92 * jag + t * t * spike * 34 + t * 12 * fbm(x * 0.01, z * 0.01, 3, s + 11);
    // lake basin
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    const lk = 1 - smoothstep(LAKE.r * 0.72, LAKE.r * 1.35, dl);
    h = lerp(h, -11 + fbm(x * 0.01, z * 0.01, 2, s + 5) * 1.5, lk);
    return h;
  }

  generate() {
    const { samples, cell, half } = this;
    for (let j = 0; j < samples; j++) {
      const z = -half + j * cell;
      for (let i = 0; i < samples; i++) {
        this.heights[j * samples + i] = this.heightFn(-half + i * cell, z);
      }
    }
  }

  /** Flatten a disk to a plane (height = centre height unless given) with a feathered edge. */
  flattenDisk(x, z, r, feather = r * 0.6, h = undefined) {
    const h0 = h === undefined ? this.getHeight(x, z) : h;
    this._stamp(x, z, r + feather, (px, pz, cur) => {
      const d = Math.hypot(px - x, pz - z);
      const k = 1 - smoothstep(r, r + feather, d);
      return lerp(cur, h0, k);
    });
    return h0;
  }

  /** Shave bumps above the centre height inside a disk (hollows and facets stay; nothing pokes up). */
  shaveDisk(x, z, r, feather = r * 0.6) {
    const h0 = this.getHeight(x, z);
    this._stamp(x, z, r + feather, (px, pz, cur) => {
      const d = Math.hypot(px - x, pz - z);
      const k = 1 - smoothstep(r, r + feather, d);
      return Math.min(cur, lerp(cur, h0, k));
    });
    return h0;
  }

  /** Raise a smooth dome (hillside for the catacomb). */
  raiseDome(x, z, r, height) {
    this._stamp(x, z, r, (px, pz, cur) => {
      const d = Math.hypot(px - x, pz - z) / r;
      if (d >= 1) return cur;
      const k = 1 - d * d; // parabolic dome
      return cur + height * k * k;
    });
  }

  _stamp(x, z, radius, fn) {
    const { samples, cell, half } = this;
    const i0 = Math.max(0, Math.floor((x - radius + half) / cell)), i1 = Math.min(samples - 1, Math.ceil((x + radius + half) / cell));
    const j0 = Math.max(0, Math.floor((z - radius + half) / cell)), j1 = Math.min(samples - 1, Math.ceil((z + radius + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * samples + i;
      this.heights[idx] = fn(-half + i * cell, -half + j * cell, this.heights[idx]);
    }
  }

  /** Bilinear height sample; clamps to the map edge. */
  getHeight(x, z) {
    const { samples, cell, half } = this;
    let fx = (x + half) / cell, fz = (z + half) / cell;
    fx = Math.min(samples - 1.001, Math.max(0, fx)); fz = Math.min(samples - 1.001, Math.max(0, fz));
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const H = this.heights, o = j * samples + i;
    const a = H[o], b = H[o + 1], c = H[o + samples], d = H[o + samples + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** Normal by central differences, written into out (default: shared temp). */
  getNormal(x, z, out = this._n) {
    const e = this.cell * 0.5;
    const hx = this.getHeight(x + e, z) - this.getHeight(x - e, z);
    const hz = this.getHeight(x, z + e) - this.getHeight(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  isWater(x, z) { return this.getHeight(x, z) < this.waterLevel; }
  /** Distance to the lake centre, used by placement rules. */
  lakeDist(x, z) { return Math.hypot(x - LAKE.x, z - LAKE.z); }

  /** Flatten the path polylines into segments with bounding boxes (rebuilt when paths are added). */
  _pathSegs() {
    let n = 0;
    for (const p of this.paths) n += Math.max(0, p.pts.length - 1);
    if (this._segs && this._segsFor === n) return this._segs;
    const s = new Float32Array(n * 9);
    let k = 0;
    for (const p of this.paths) {
      const pts = p.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        s[k++] = ax; s[k++] = az; s[k++] = bx; s[k++] = bz; s[k++] = p.w;
        s[k++] = Math.min(ax, bx) - 10; s[k++] = Math.min(az, bz) - 10; s[k++] = Math.max(ax, bx) + 10; s[k++] = Math.max(az, bz) + 10;
      }
    }
    this._segs = s; this._segsFor = n;
    return s;
  }

  /** Distance (m) from (x,z) to the nearest worn path centre-line; Infinity when there are no paths. */
  pathDist(x, z) {
    let best = Infinity;
    this._pathW = 1;
    const s = this._pathSegs();
    for (let o = 0; o < s.length; o += 9) {
      if (x < s[o + 5] || z < s[o + 6] || x > s[o + 7] || z > s[o + 8]) continue;
      const ax = s[o], az = s[o + 1], dx = s[o + 2] - ax, dz = s[o + 3] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const ex = x - (ax + dx * t), ez = z - (az + dz * t), d = Math.sqrt(ex * ex + ez * ez);
      if (d < best) { best = d; this._pathW = s[o + 4]; }
    }
    return best;
  }

  /**
   * Trodden-path network: a minimum spanning tree over the graces + spawn, every POI and arena tied to its nearest
   * grace. Each edge is a wobbling polyline (low-frequency lateral noise, ~14 m nodes) pushed clear of the lake.
   * Runs in build() after Limveld.plan() has placed everything; the hand-placed vista tracks are kept.
   */
  _planPaths() {
    const L = this.game.limveld;
    if (!L || !L.graces.length) return;
    const s = this.seed;
    const nodes = L.graces.map((g) => ({ x: g.x, z: g.z }));
    nodes.push({ x: L.spawn.x, z: L.spawn.z });
    const edges = [];
    // Prim's MST over graces + spawn
    const inTree = new Set([0]);
    while (inTree.size < nodes.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        if (!best || d < best.d) best = { i, j, d };
      }
      inTree.add(best.j); edges.push({ a: nodes[best.i], b: nodes[best.j], w: 0.95 });
    }
    const nearestGrace = (x, z) => { let b = null, bd = Infinity; for (const g of nodes) { const d = Math.hypot(g.x - x, g.z - z); if (d < bd) { bd = d; b = g; } } return b; };
    for (const p of L.pois) { const g = nearestGrace(p.x, p.z); if (Math.hypot(g.x - p.x, g.z - p.z) > 6) edges.push({ a: g, b: { x: p.x, z: p.z }, w: 1.15, r: p.r }); }
    for (const a of L.arenas) { const g = nearestGrace(a.x, a.z); edges.push({ a: g, b: { x: a.x, z: a.z }, w: 0.8 }); }
    let e = 0;
    for (const ed of edges) {
      const len = Math.hypot(ed.b.x - ed.a.x, ed.b.z - ed.a.z);
      if (len < 8 || len > 480) continue;
      const n = Math.max(2, Math.round(len / 14)), ux = (ed.b.x - ed.a.x) / len, uz = (ed.b.z - ed.a.z) / len, nx = -uz, nz = ux;
      const amp = Math.min(14, len * 0.07), pts = [];
      e++;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const wob = (fbm(t * 2.6 + e * 7.3, e * 3.1, 3, s + 200 + e) * amp + (vnoise(t * 9 + e, 2.0, s + 300 + e) - 0.5) * 3) * Math.sin(Math.PI * t);
        let x = ed.a.x + ux * len * t + nx * wob, z = ed.a.z + uz * len * t + nz * wob;
        // stay out of the lake: push the node radially past the shore
        const dl = Math.hypot(x - LAKE.x, z - LAKE.z), keep = LAKE.r * 1.42;
        if (dl < keep && k > 0 && k < n) { const q = keep / Math.max(dl, 1); x = LAKE.x + (x - LAKE.x) * q; z = LAKE.z + (z - LAKE.z) * q; }
        if (k > 0 && k < n && this.getHeight(x, z) < this.waterLevel + 1.5) { pts.length = 0; break; }
        pts.push([x, z]);
      }
      if (pts.length > 1) this.paths.push({ w: ed.w, pts });
    }
  }
  /** 0..1 worn-path coverage at (x,z): 1 on the track, feathered and noise-wobbled at the edge. */
  pathMask(x, z) {
    if (!this.paths.length) return 0;
    const d = this.pathDist(x, z) + (vnoise(x * 0.22, z * 0.22, 96) - 0.5) * 1.2, w = this._pathW;
    return 1 - smoothstep(w * 0.7, w * 1.6, d);
  }
  /** Local concavity (m): mean of the 4 neighbours at 2 cells minus the centre. >0 hollow, <0 crest. */
  concavity(x, z) {
    const e = this.cell * 2;
    return (this.getHeight(x + e, z) + this.getHeight(x - e, z) + this.getHeight(x, z + e) + this.getHeight(x, z - e)) * 0.25 - this.getHeight(x, z);
  }

  /** 0..1 bare-earth patch mask: ragged 10-25 m pockets (two octaves), ~20 % of the map, clear of the overlook itself. */
  patchMask(x, z) {
    return smoothstep(0.6, 0.72, vnoise(x * 0.018 + 17, z * 0.018, 130) * 0.65 + vnoise(x * 0.05 + 9, z * 0.05, 131) * 0.35);
  }
  /** 0..1 small scuff mask (~5 m specks of bare earth between the clumps). */
  scuffMask(x, z) { return smoothstep(0.72, 0.84, vnoise(x * 0.07 + 80, z * 0.07, 98)); }
  /** 0..1 bare-ground coverage at (x,z): dirt patches, small scuffs and the worn path (grass thins here). */
  groundMask(x, z) {
    return Math.max(this.patchMask(x, z), this.scuffMask(x, z) * 0.8, this.pathMask(x, z));
  }

  /**
   * Face colour for (height, slope, normal, position) into this._c. Value structure is baked here, not lit:
   * broad / fine / facet-scale mottling, dry straw in patches on convex moonlit ground, damp dark hollows,
   * bare dirt patches + small scuffs, the worn path, pale stone outcrops (pale top faces, dark sides), rock
   * on slopes, then a strong moon-facing value step and a per-face jitter so neighbouring facets read apart.
   */
  _faceColor(h, slope, nrm, x, z, seedJitter) {
    const T = PALETTE.terrain, c = this._c, c2 = this._c2;
    const broad = vnoise(x * 0.006 + 11, z * 0.006, 90), fine = vnoise(x * 0.03, z * 0.03, 91), mid = vnoise(x * 0.11 + 3, z * 0.11, 97);
    c.setHex(T.grassDark).lerp(c2.setHex(T.grass), broad * 0.45 + fine * 0.3 + mid * 0.25);
    const conv = this.concavity(x, z);
    const facing = Math.max(0, nrm.x * MOON.x + nrm.y * MOON.y + nrm.z * MOON.z);
    // dry straw: low-frequency patches, favouring higher, convex, moon-facing ground
    const dry = vnoise(x * 0.004 + 30, z * 0.004, 92) * 0.45 + smoothstep(14, 40, h) * 0.2 + smoothstep(0.0, -1.2, conv) * 0.25 + facing * 0.2 + mid * 0.15;
    c.lerp(c2.setHex(T.grassPale), smoothstep(0.5, 0.85, dry) * 0.75);
    c.lerp(c2.setHex(T.straw), smoothstep(0.85, 1.1, dry) * 0.6);
    // damp hollows and low ground
    c.lerp(c2.setHex(T.damp), smoothstep(0.35, 1.8, conv) * 0.75);
    c.lerp(c2.setHex(T.mud), smoothstep(6, -2, h) * 0.35);
    // bare dirt: ragged patches + small scuffs (the same masks thin the grass there)
    c.lerp(c2.setHex(T.dirt), this.patchMask(x, z) * 0.85);
    c.lerp(c2.setHex(T.dirt), this.scuffMask(x, z) * 0.6);
    // worn path: warm dirt, slightly darker ruts at the edge
    const pm = this.pathMask(x, z);
    if (pm > 0) { c.lerp(c2.setHex(T.path), pm * 0.85); const edge = pm * (1 - pm) * 4; c.multiplyScalar(1 - edge * 0.22); }
    // pale stone / gravel: the third ground layer — low-frequency sheets that favour slopes, convex crests and the
    // moon-facing side, so bare grey-buff stone shows through the turf in broad ragged patches
    const grav = vnoise(x * 0.011 + 50, z * 0.011, 140) * 0.55 + vnoise(x * 0.04 + 3, z * 0.04, 141) * 0.3 + vnoise(x * 0.13, z * 0.13 + 7, 142) * 0.15
      + slope * 0.55 + smoothstep(0.2, -1.2, conv) * 0.12 + facing * 0.08;
    const gravK = smoothstep(0.64, 0.8, grav) * 0.85;
    if (gravK > 0) { this._c3.setHex(T.sand).lerp(c2.setHex(T.outcrop), 0.45).multiplyScalar(0.92); c.lerp(this._c3, gravK); }
    // stone outcrops: mid-frequency cells, more likely on slopes and crests; top faces pale, sides dark
    const oc = vnoise(x * 0.035 + 70, z * 0.035, 95) + slope * 0.9 + smoothstep(0.2, -1.5, conv) * 0.12;
    const ocK = smoothstep(0.8, 0.93, oc);
    if (ocK > 0) { this._c3.setHex(T.outcropDark).lerp(c2.setHex(T.outcrop), smoothstep(0.5, 0.97, nrm.y)); c.lerp(this._c3, ocK); }
    // altitude
    c.lerp(c2.setHex(T.peak), smoothstep(55, 90, h) * 0.85);
    c.lerp(c2.setHex(T.snow), smoothstep(110, 170, h) * 0.6);
    // slope -> rock
    const rk = vnoise(x * 0.05, z * 0.05, 94);
    const rock = this._c3.setHex(T.rock).lerp(c2.setHex(T.rockDark), rk * 0.6);
    c.lerp(rock, smoothstep(0.22, 0.42, slope));
    // shore: a dark damp band above the waterline (ragged, noise-broken), then sand at the lip, mud under water
    const dw = h - this.waterLevel;
    const shoreN = vnoise(x * 0.05 + 21, z * 0.05, 143);
    c.lerp(c2.setHex(T.damp), (1 - smoothstep(2.5 + shoreN * 3, 8 + shoreN * 4, dw)) * smoothstep(0.4, 1.6, dw) * 0.7);
    c.lerp(c2.setHex(T.sand), smoothstep(3.0, 1.2, dw) * 0.8);
    c.lerp(c2.setHex(T.mud), smoothstep(0.8, -1.5, dw) * 0.9);
    // baked facet shading toward the moon + per-face jitter (stylised value steps)
    const j = (0.82 + seedJitter * 0.36) * (0.72 + facing * 0.52);
    const warm = smoothstep(0.8, 0.98, nrm.y) * (1 - smoothstep(0.22, 0.42, slope)) * 0.1; // flat turf: warm; rock faces: neutral
    c.r *= j * (1 + warm); c.g *= j * (1 + warm * 0.4); c.b *= j * (1 - warm);
    return c;
  }

  /** Build a chunk geometry at a given cell step (1 = full res). */
  _buildChunkGeo(cx, cz, step) {
    const { segs, cell, half, samples } = this;
    const cells = segs / step;
    const count = cells * cells * 6;
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let p = 0, q = 0, faceId = 0;
    const H = this.heights;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
    const emit = (ax, az, ai, aj, bx, bz, bi, bj, cx2, cz2, ci, cj) => {
      v[0].set(ax, H[aj * samples + ai], az); v[1].set(bx, H[bj * samples + bi], bz); v[2].set(cx2, H[cj * samples + ci], cz2);
      ab.subVectors(v[1], v[0]); ac.subVectors(v[2], v[0]); nrm.crossVectors(ab, ac).normalize();
      const mh = (v[0].y + v[1].y + v[2].y) / 3, mx = (ax + bx + cx2) / 3, mz = (az + bz + cz2) / 3;
      const c = this._faceColor(mh, 1 - nrm.y, nrm, mx, mz, hash2(faceId++, cx * 131 + cz, 5));
      for (let k = 0; k < 3; k++) {
        pos[p++] = v[k].x; pos[p++] = v[k].y; pos[p++] = v[k].z;
        col[q++] = c.r; col[q++] = c.g; col[q++] = c.b;
      }
    };
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const i0 = cx * segs + i * step, j0 = cz * segs + j * step, i1 = i0 + step, j1 = j0 + step;
      const x0 = -half + i0 * cell, z0 = -half + j0 * cell, x1 = -half + i1 * cell, z1 = -half + j1 * cell;
      const h00 = H[j0 * samples + i0], h10 = H[j0 * samples + i1], h01 = H[j1 * samples + i0], h11 = H[j1 * samples + i1];
      // pick the shorter diagonal (cleaner low-poly silhouettes)
      if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) {
        emit(x0, z0, i0, j0, x0, z1, i0, j1, x1, z1, i1, j1);
        emit(x0, z0, i0, j0, x1, z1, i1, j1, x1, z0, i1, j0);
      } else {
        emit(x0, z0, i0, j0, x0, z1, i0, j1, x1, z0, i1, j0);
        emit(x1, z0, i1, j0, x0, z1, i0, j1, x1, z1, i1, j1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.userData.baseColor = col.slice(); // untouched colours: applyOcclusion() recolours from these
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  // ------------------------------------------------------------------------------------ occlusion bake

  /**
   * Bake an occlusion / damp map from static object footprints so the turf darkens under trees, rocks, tents and
   * along wall bases. occluders: [{x, z, r, k}] (props: soft discs, multiplicative); structureRoot: every mesh under
   * it contributes its low vertices (local y < 1.3 m) as a wall-base band (max-combined, plus damp tint).
   * Call once after props are placed; then applyOcclusion() recolours the chunks.
   */
  buildOcclusion(occluders, structureRoot) {
    const N = Math.ceil(this.size / AO_RES) + 1, half = this.half;
    this.aoN = N;
    const ao = this.ao = new Float32Array(N * N), damp = this.damp = new Float32Array(N * N);
    const splat = (x, z, r, k, mode, dampK) => {
      const i0 = Math.max(0, Math.floor((x - r + half) / AO_RES)), i1 = Math.min(N - 1, Math.ceil((x + r + half) / AO_RES));
      const j0 = Math.max(0, Math.floor((z - r + half) / AO_RES)), j1 = Math.min(N - 1, Math.ceil((z + r + half) / AO_RES));
      const r2 = r * r;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = -half + i * AO_RES - x, dz = -half + j * AO_RES - z, d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        const t = 1 - d2 / r2, f = k * t * t * (0.6 + 0.4 * t), idx = j * N + i;
        ao[idx] = mode === 1 ? Math.max(ao[idx], f) : 1 - (1 - ao[idx]) * (1 - f);
        if (dampK) damp[idx] = Math.max(damp[idx], dampK * t);
      }
    };
    for (const o of occluders) splat(o.x, o.z, o.r, o.k, 0, o.damp || 0);
    if (structureRoot) {
      structureRoot.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      structureRoot.traverse((m) => {
        if (!m.isMesh || !m.geometry || !m.geometry.attributes.position || m.material.transparent) return;
        const p = m.geometry.attributes.position, step = p.count > 6000 ? 3 : 1;
        for (let i = 0; i < p.count; i += step) {
          const ly = p.getY(i);
          if (ly < -0.6 || ly > 1.3) continue;
          v.set(p.getX(i), ly, p.getZ(i)).applyMatrix4(m.matrixWorld);
          splat(v.x, v.z, 2.2, 0.42, 1, 0.5);
        }
      });
    }
    this._aoBaked = false;
  }

  /** 0..1 baked occlusion at (x,z) (0 = open ground); bilinear. */
  occlusionAt(x, z) { return this._sampleMap(this.ao, x, z); }
  /** 0..1 damp tint weight at (x,z) (wall bases). */
  dampAt(x, z) { return this._sampleMap(this.damp, x, z); }
  _sampleMap(map, x, z) {
    if (!map) return 0;
    const N = this.aoN;
    let fx = (x + this.half) / AO_RES, fz = (z + this.half) / AO_RES;
    fx = Math.min(N - 1.001, Math.max(0, fx)); fz = Math.min(N - 1.001, Math.max(0, fz));
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, o = j * N + i;
    const a = map[o], b = map[o + 1], c = map[o + N], d = map[o + N + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /**
   * Baked ground value at (x,z): the facet's moon-facing step (1 on level turf, brighter on moon-facing slopes,
   * darker facing away) times the occlusion. Grass and small props multiply their tint by this so tufts under a
   * tree or on a shadowed slope go as dark as the turf they grow from.
   */
  shadeAt(x, z) {
    const n = this.getNormal(x, z);
    const facing = Math.max(0, n.x * MOON.x + n.y * MOON.y + n.z * MOON.z);
    return ((0.72 + facing * 0.52) / 0.907) * (1 - 0.62 * this.occlusionAt(x, z));
  }

  /** Recolour every chunk from its base colours: darken by the occlusion map, lerp toward damp at wall bases. */
  applyOcclusion() {
    if (!this.ao || this._aoBaked) return;
    this._aoBaked = true;
    const dampC = this._c2.setHex(PALETTE.terrain.damp);
    const recolor = (geo) => {
      const pos = geo.attributes.position.array, col = geo.attributes.color.array, base = geo.userData.baseColor;
      if (!base) return;
      for (let f = 0; f < pos.length; f += 9) {
        const mx = (pos[f] + pos[f + 3] + pos[f + 6]) / 3, mz = (pos[f + 2] + pos[f + 5] + pos[f + 8]) / 3;
        const ao = this.occlusionAt(mx, mz), dp = this.dampAt(mx, mz);
        const mul = 1 - 0.62 * ao;
        for (let k = 0; k < 9; k += 3) {
          let r = base[f + k], g = base[f + k + 1], b = base[f + k + 2];
          if (dp > 0) { r += (dampC.r - r) * dp * 0.6; g += (dampC.g - g) * dp * 0.6; b += (dampC.b - b) * dp * 0.6; }
          col[f + k] = r * mul; col[f + k + 1] = g * mul; col[f + k + 2] = b * mul;
        }
      }
      geo.attributes.color.needsUpdate = true;
    };
    for (const c of this.chunkMeshes) { recolor(c.hi.geometry); recolor(c.lo.geometry); }
  }

  /** Create chunk meshes (hi + lo LOD) and the lake plane; adds everything to the scene. */
  build() {
    this._planPaths();
    const mat = vertexMat();
    for (let cz = 0; cz < this.chunks; cz++) for (let cx = 0; cx < this.chunks; cx++) {
      const hi = new THREE.Mesh(this._buildChunkGeo(cx, cz, 1), mat);
      const lo = new THREE.Mesh(this._buildChunkGeo(cx, cz, 4), mat);
      hi.castShadow = true; hi.receiveShadow = true; lo.receiveShadow = true;
      lo.visible = false;
      hi.matrixAutoUpdate = false; lo.matrixAutoUpdate = false;
      this.group.add(hi, lo);
      const cxm = -this.half + (cx + 0.5) * this.segs * this.cell, czm = -this.half + (cz + 0.5) * this.segs * this.cell;
      this.chunkMeshes.push({ hi, lo, x: cxm, z: czm, isHi: true });
    }
    // lake: a pale sheet that reads as sky-coloured water / mist
    const waterMat = new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.5, metalness: 0.0, emissive: PALETTE.waterGlow, emissiveIntensity: 0.35 });
    this.water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r * 1.3, 40), waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(LAKE.x, this.waterLevel, LAKE.z);
    this.water.receiveShadow = true;
    this.group.add(this.water);
    this.group.add(this._buildBackdrop());
    this.game.scene.add(this.group);
  }

  /** Ring of tall jagged peaks beyond the playable rim (620..1000 m): a third, fully fogged silhouette band. */
  _buildBackdrop() {
    const { r0, r1, rPeak, hMax, segs } = BACKDROP, rings = [r0, (r0 + rPeak) / 2, rPeak, (rPeak + r1) / 2, r1];
    const pos = [], col = [], T = PALETTE.terrain, c = this._c, c2 = this._c2;
    const pt = (i, k) => {
      const a = (i / segs) * Math.PI * 2, r = rings[k];
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const rad = k === 0 || k === rings.length - 1 ? 0 : k === 2 ? 1 : 0.45;
      const jag = Math.pow(1 - Math.abs(fbm(x * 0.004 + 7, z * 0.004 - 3, 4, this.seed + 41)), 1.6);
      const y = -20 + hMax * rad * (0.35 + 0.9 * jag) + (k === 0 ? 60 : 0);
      return [x, y, z];
    };
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < segs; i++) {
      const a = pt(i, k), b = pt(i + 1, k), d = pt(i, k + 1), e = pt(i + 1, k + 1);
      const tris = (k + i) % 2 ? [a, b, d, b, e, d] : [a, e, d, a, b, e];
      for (let t = 0; t < 2; t++) {
        const v0 = tris[t * 3], v1 = tris[t * 3 + 1], v2 = tris[t * 3 + 2];
        const mh = (v0[1] + v1[1] + v2[1]) / 3;
        c.setHex(T.rockDark).lerp(c2.setHex(T.peak), smoothstep(20, 180, mh)).lerp(c2.setHex(T.snow), smoothstep(160, 260, mh) * 0.5);
        const jit = 0.92 + hash2(i, k * 3 + t, 9) * 0.16;
        for (const v of [v0, v1, v2]) { pos.push(v[0], v[1], v[2]); col.push(c.r * jit, c.g * jit, c.b * jit); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, vertexMat());
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.name = 'backdrop';
    return m;
  }

  /** LOD swap by camera distance (cheap: 64 checks). */
  update(camPos) {
    const far2 = 230 * 230;
    for (let i = 0; i < this.chunkMeshes.length; i++) {
      const c = this.chunkMeshes[i];
      const dx = c.x - camPos.x, dz = c.z - camPos.z;
      const hi = dx * dx + dz * dz < far2;
      if (hi !== c.isHi) { c.isHi = hi; c.hi.visible = hi; c.lo.visible = !hi; }
    }
  }
}
