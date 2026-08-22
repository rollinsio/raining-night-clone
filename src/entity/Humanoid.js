/**
 * Low-poly faceless humanoid rig built from lofted, bevelled sections and skinned to a small bone set
 * (one SkinnedMesh = 2 draw calls, + cloak + foot contact shadows), plus a generic Animator that blends
 * procedural pose clips. Exports RigBuilder / Animator (also used by the quadruped Wolf) and createHumanoid().
 *
 * Conventions: model faces +Z, right side is -X. Bones use Euler order 'YXZ'. For a limb hanging
 * down, negative rx swings it forward; ry yaws it in the parent frame; for the left arm +rz moves
 * the hand outward, for the right arm -rz does. Ankle +rx points the toe down. Wrist +rx curls the hand
 * (and weapon) down toward the forearm's inside.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, charMats } from '../render/Style.js';

const _c = new THREE.Color(), _c2 = new THREE.Color();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
/** Hex colour between two hex colours (sRGB lerp), for derived costume tones. */
const mixc = (a, b, t) => { _c.setHex(a); _c2.setHex(b); return _c.lerp(_c2, t).getHex(); };

// -------------------------------------------------------------------------------------------------
// RigBuilder

export class RigBuilder {
  constructor() { this.bones = []; this.byName = {}; this.parts = [[], []]; this.world = {}; }

  /** Create a bone at a parent-relative position; records its bind-pose model-space position. */
  bone(name, parent, x, y, z) {
    const b = new THREE.Bone();
    b.name = name; b.position.set(x, y, z); b.rotation.order = 'YXZ';
    if (parent) parent.add(b);
    const pw = parent ? this.world[parent.name] : new THREE.Vector3();
    this.world[name] = new THREE.Vector3(x, y, z).add(pw);
    b.userData.index = this.bones.length;
    this.bones.push(b); this.byName[name] = b;
    return b;
  }

  pos(name) { return this.world[name]; }

  /**
   * Add a model-space geometry bound to a bone. matIndex 0 = flat shaded, 1 = smooth.
   * o.blend {bone, y, width}: vertices below model-space y blend into the child bone (smooth joints).
   * o.skirt {L, R, top, bottom, max}: vertices follow the hip on their side, more toward the hem.
   * o.shadeFn(x, y, z) -> per-vertex brightness multiplier (baked AO / gradients).
   */
  part(geo, boneName, color, matIndex = 0, shade = 1, o = null) {
    if (geo.index) geo = geo.toNonIndexed();
    const pa = geo.attributes.position.array, n = geo.attributes.position.count, idx = this.byName[boneName].userData.index;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
    _c.setHex(color).multiplyScalar(shade);
    const blendIdx = o && o.blend ? this.byName[o.blend.bone].userData.index : -1;
    const skL = o && o.skirt ? this.byName[o.skirt.L].userData.index : -1;
    const skR = o && o.skirt ? this.byName[o.skirt.R].userData.index : -1;
    for (let i = 0; i < n; i++) {
      const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
      let iB = idx, wB = 0;
      if (blendIdx >= 0) { const b = o.blend; iB = blendIdx; wB = sm((b.y + b.width * 0.5 - y) / b.width); }
      else if (skL >= 0) { const s = o.skirt; iB = x >= 0 ? skL : skR; wB = s.max * sm((s.top - y) / (s.top - s.bottom)); }
      si[i * 4] = idx; si[i * 4 + 1] = iB; sw[i * 4] = 1 - wB; sw[i * 4 + 1] = wB;
      const m = o && o.shadeFn ? o.shadeFn(x, y, z) : 1;
      col[i * 3] = _c.r * m; col[i * 3 + 1] = _c.g * m; col[i * 3 + 2] = _c.b * m;
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    this.parts[matIndex].push(geo);
    return geo;
  }

  /**
   * Merge parts per material and build the SkinnedMesh. Returns { mesh, bones, boneList }.
   * opts.smooth (degrees): crease-aware smoothed normals over the whole merged body (lofts shade round, hems /
   * caps / blades keep their hard edges) — only visible on materials with flatShading off.
   * opts.ao {strength, radius, gain}: bakes a point-based occlusion term into the vertex colours (armpits, crotch,
   * under the hood / mantle / belt). Both are opt-in so existing rigs are unchanged.
   */
  build(materials, opts = null) {
    const merged = [], matIdx = [];
    for (let m = 0; m < this.parts.length; m++) {
      if (!this.parts[m].length) continue;
      merged.push(mergeGeometries(this.parts[m], false)); matIdx.push(m);
    }
    const geo = merged.length > 1 ? mergeGeometries(merged, true) : merged[0];
    if (merged.length > 1) geo.groups.forEach((g, i) => { g.materialIndex = matIdx[i]; });
    else geo.addGroup(0, geo.attributes.position.count, matIdx[0]);
    if (opts && opts.smooth) smoothNormals(geo, opts.smooth);
    if (opts && opts.ao) bakeAO(geo, opts.ao, opts.ao.pose ? this.posed(geo, opts.ao.pose) : null);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius *= 1.8;
    const mesh = new THREE.SkinnedMesh(geo, materials);
    mesh.add(this.bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return { mesh, bones: this.byName, boneList: this.bones };
  }

  /**
   * Skin the merged geometry into a spread pose (bone name -> [rx, ry, rz]) for the occlusion bake, so limbs that hang
   * against the body in the bind pose do not darken it; the bones are returned to rest. Returns { pos, nor }.
   */
  posed(geo, pose) {
    const root = this.bones[0];
    for (const name in pose) { const b = this.byName[name]; if (b) b.rotation.set(pose[name][0], pose[name][1], pose[name][2]); }
    root.updateMatrixWorld(true);
    const pa = geo.attributes.position.array, na = geo.attributes.normal.array, si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array, n = pa.length / 3;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const mats = this.bones.map((b) => b.matrixWorld), offs = this.bones.map((b) => this.world[b.name]);
    for (let i = 0; i < n; i++) {
      let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < 2; k++) {
        const w = sw[i * 4 + k]; if (w === 0) continue;
        const j = si[i * 4 + k], m = mats[j], o = offs[j];
        _v.set(pa[i * 3] - o.x, pa[i * 3 + 1] - o.y, pa[i * 3 + 2] - o.z).applyMatrix4(m);
        px += _v.x * w; py += _v.y * w; pz += _v.z * w;
        _n.set(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]).transformDirection(m);
        nx += _n.x * w; ny += _n.y * w; nz += _n.z * w;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
      nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
    }
    for (const name in pose) { const b = this.byName[name]; if (b) b.rotation.set(0, 0, 0); }
    root.updateMatrixWorld(true);
    return { pos, nor };
  }
}

// -------------------------------------------------------------------------------------------------
// Baked shading: crease-aware smooth normals + point-based ambient occlusion (build-time, per rig)

/**
 * Crease-aware smooth normals for a non-indexed geometry: at each vertex the area-weighted normals of the faces
 * sharing that position are averaged, but only faces within `angle` degrees of the vertex's own face join in, so
 * an 8–10 sided loft shades as a round limb while caps, hems, blade edges and box corners stay crisp.
 */
function smoothNormals(geo, angle = 60) {
  const pos = geo.attributes.position.array, n = geo.attributes.position.count, F = n / 3;
  const fw = new Float32Array(F * 3), fu = new Float32Array(F * 3); // area-weighted / unit face normals
  for (let f = 0; f < F; f++) {
    const a = f * 9;
    const ax = pos[a + 3] - pos[a], ay = pos[a + 4] - pos[a + 1], az = pos[a + 5] - pos[a + 2];
    const bx = pos[a + 6] - pos[a], by = pos[a + 7] - pos[a + 1], bz = pos[a + 8] - pos[a + 2];
    const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, l = Math.hypot(x, y, z) || 1;
    fw[f * 3] = x; fw[f * 3 + 1] = y; fw[f * 3 + 2] = z;
    fu[f * 3] = x / l; fu[f * 3 + 1] = y / l; fu[f * 3 + 2] = z / l;
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 2500)},${Math.round(pos[i * 3 + 1] * 2500)},${Math.round(pos[i * 3 + 2] * 2500)}`;
    let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(i);
  }
  const cosA = Math.cos((angle * Math.PI) / 180), out = new Float32Array(n * 3);
  for (const list of groups.values()) {
    for (let u = 0; u < list.length; u++) {
      const i = list[u], f = (i / 3) | 0; let x = 0, y = 0, z = 0;
      for (let v = 0; v < list.length; v++) {
        const g = (list[v] / 3) | 0;
        if (fu[f * 3] * fu[g * 3] + fu[f * 3 + 1] * fu[g * 3 + 1] + fu[f * 3 + 2] * fu[g * 3 + 2] < cosA) continue;
        x += fw[g * 3]; y += fw[g * 3 + 1]; z += fw[g * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

/**
 * Point-based ambient occlusion (Bunnell-style disc emitters, one per triangle, two-sided so cloth layers shade what
 * hangs under them) baked into the vertex colours of a non-indexed geometry. A uniform grid keeps it to a few
 * million pair tests (~50 ms for a 9k-vertex rig). Also darkens toward the ground below `groundY + groundH`.
 */
const hash3 = (x, y, z) => { const t = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return t - Math.floor(t); };
/** Trilinear value noise in [0, 1] (build-time only). */
function vnoise(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = sm(x - x0), fy = sm(y - y0), fz = sm(z - z0);
  const c = (dx, dy, dz) => hash3(x0 + dx, y0 + dy, z0 + dz);
  const a = lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy);
  const b = lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy);
  return lerp(a, b, fz);
}

function bakeAO(geo, { strength = 0.8, radius = 0.3, gain = 1.0, groundY = 0, groundH = 0, groundK = 0, mottle = 0 } = {}, posed = null) {
  const pos = posed ? posed.pos : geo.attributes.position.array, nor = posed ? posed.nor : geo.attributes.normal.array, col = geo.attributes.color.array;
  const n = pos.length / 3, F = n / 3;
  const ec = new Float32Array(F * 3), en = new Float32Array(F * 3), ea = new Float32Array(F);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let f = 0; f < F; f++) {
    const a = f * 9;
    const ax = pos[a + 3] - pos[a], ay = pos[a + 4] - pos[a + 1], az = pos[a + 5] - pos[a + 2];
    const bx = pos[a + 6] - pos[a], by = pos[a + 7] - pos[a + 1], bz = pos[a + 8] - pos[a + 2];
    const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, l = Math.hypot(x, y, z) || 1e-9;
    en[f * 3] = x / l; en[f * 3 + 1] = y / l; en[f * 3 + 2] = z / l; ea[f] = l * 0.5;
    const cx = (pos[a] + pos[a + 3] + pos[a + 6]) / 3, cy = (pos[a + 1] + pos[a + 4] + pos[a + 7]) / 3, cz = (pos[a + 2] + pos[a + 5] + pos[a + 8]) / 3;
    ec[f * 3] = cx; ec[f * 3 + 1] = cy; ec[f * 3 + 2] = cz;
    if (cx < minX) minX = cx; if (cy < minY) minY = cy; if (cz < minZ) minZ = cz;
    if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy; if (cz > maxZ) maxZ = cz;
  }
  const cell = radius, nx = Math.ceil((maxX - minX) / cell) + 1, ny = Math.ceil((maxY - minY) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const cellOf = (x, y, z) => [Math.min(nx - 1, Math.max(0, ((x - minX) / cell) | 0)), Math.min(ny - 1, Math.max(0, ((y - minY) / cell) | 0)), Math.min(nz - 1, Math.max(0, ((z - minZ) / cell) | 0))];
  const counts = new Int32Array(nx * ny * nz + 1);
  const fc = new Int32Array(F);
  for (let f = 0; f < F; f++) { const c = cellOf(ec[f * 3], ec[f * 3 + 1], ec[f * 3 + 2]); fc[f] = (c[0] * ny + c[1]) * nz + c[2]; counts[fc[f] + 1]++; }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const order = new Int32Array(F), fill = counts.slice();
  for (let f = 0; f < F; f++) order[fill[fc[f]]++] = f;
  const R2 = radius * radius, stats = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2], mx = nor[i * 3], my = nor[i * 3 + 1], mz = nor[i * 3 + 2];
    const c = cellOf(px, py, pz); let occ = 0;
    for (let cx = Math.max(0, c[0] - 1); cx <= Math.min(nx - 1, c[0] + 1); cx++)
      for (let cy = Math.max(0, c[1] - 1); cy <= Math.min(ny - 1, c[1] + 1); cy++)
        for (let cz = Math.max(0, c[2] - 1); cz <= Math.min(nz - 1, c[2] + 1); cz++) {
          const id = (cx * ny + cy) * nz + cz;
          for (let k = counts[id]; k < counts[id + 1]; k++) {
            const f = order[k];
            let vx = ec[f * 3] - px, vy = ec[f * 3 + 1] - py, vz = ec[f * 3 + 2] - pz;
            const d2 = vx * vx + vy * vy + vz * vz;
            if (d2 > R2 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2); vx /= d; vy /= d; vz /= d;
            // emitters grazing the receiver's tangent plane are its own loft curving away — not occluders
            const cosR = (mx * vx + my * vy + mz * vz - 0.18) / 0.82;
            if (cosR <= 0) continue;
            const cosE = Math.abs(en[f * 3] * vx + en[f * 3 + 1] * vy + en[f * 3 + 2] * vz);
            const fall = 1 - d2 / R2;
            occ += (ea[f] * cosE * cosR) / (Math.PI * (d2 + 2.5e-4) + ea[f]) * fall; // disc-to-point form factor
          }
        }
    let ao = 1 - strength * Math.min(1, Math.pow(occ * gain, 0.85));
    if (groundK > 0) ao *= lerp(1 - groundK, 1, sm((py - groundY) / groundH));
    // hand-painted feel: a low-frequency value mottle so no panel is one flat tone
    if (mottle > 0) ao *= 1 + mottle * (0.7 * vnoise(px * 7 + 3.1, py * 7 + 1.7, pz * 7 + 5.3) + 0.3 * vnoise(px * 23 + 9.2, py * 23 + 4.4, pz * 23 + 1.8) - 0.5);
    col[i * 3] *= ao; col[i * 3 + 1] *= ao; col[i * 3 + 2] *= ao;
    stats[i] = ao;
  }
  geo.attributes.color.needsUpdate = true;
  // distribution for tuning (sorted copy is cheap at 9k verts)
  const s = Float32Array.from(stats).sort();
  let mean = 0; for (let i = 0; i < n; i++) mean += s[i];
  geo.userData.ao = { min: s[0], p05: s[(n * 0.05) | 0], p25: s[(n * 0.25) | 0], median: s[(n * 0.5) | 0], mean: mean / n, perVertex: stats };
}

// -------------------------------------------------------------------------------------------------
// Animator: clips write target angles; current pose eases toward the target each frame.

const E_HIPSY = 0, E_PITCH = 1, E_ROLL = 2, E_YAW = 3;

export class Animator {
  /**
   * @param rig  {boneList, bones} from RigBuilder.build
   * @param clips  { name: (t, P, ctx) => void }
   * @param pivot  Object3D rotated by whole-body pitch/roll/yaw (placed at hip height)
   */
  constructor(rig, clips, pivot, rootRestY) {
    this.bones = rig.boneList; this.clips = clips; this.pivot = pivot;
    this.n = this.bones.length;
    this.idx = {}; this.bones.forEach((b, i) => { this.idx[b.name] = i; });
    this.cur = new Float32Array(this.n * 3 + 4);
    this.tgt = new Float32Array(this.n * 3 + 4);
    this.root = this.bones[0]; this.rootRestY = rootRestY ?? this.root.position.y;
    this.pivotRestY = pivot.position.y;
    this.clip = null; this.name = ''; this.t = 0; this.rate = 14;
    this.ctx = { speed: 0, dur: 1, windup: 0.2, active: 0.15, recover: 0.4, param: 0 };
    /** Optional per-step hook (dt) — used for secondary motion such as cloak lift; also runs in settle(). */
    this.onUpdate = null;
  }
  set(name, rx, ry, rz) { const i = this.idx[name]; if (i === undefined) return; this.tgt[i * 3] = rx; this.tgt[i * 3 + 1] = ry; this.tgt[i * 3 + 2] = rz; }
  add(name, rx, ry, rz) { const i = this.idx[name]; if (i === undefined) return; this.tgt[i * 3] += rx; this.tgt[i * 3 + 1] += ry; this.tgt[i * 3 + 2] += rz; }
  extra(k, v) { this.tgt[this.n * 3 + k] = v; }

  /** Switch clip (no-op if already playing unless restart). */
  play(name, { rate = 14, restart = false } = {}) {
    if (this.name === name && !restart) { this.rate = rate; return; }
    this.name = name; this.clip = this.clips[name] || this.clips.idle; this.t = 0; this.rate = rate;
    const p = this.n * 3 + E_PITCH; // wrap whole-body pitch so a finished roll does not unwind
    this.cur[p] = Math.atan2(Math.sin(this.cur[p]), Math.cos(this.cur[p]));
  }

  update(dt) {
    this.t += dt;
    const tg = this.tgt; tg.fill(0);
    if (this.clip) this.clip(this.t, this, this.ctx);
    const f = 1 - Math.exp(-this.rate * dt), cur = this.cur;
    for (let i = 0; i < cur.length; i++) cur[i] += (tg[i] - cur[i]) * f;
    this.apply();
    if (this.onUpdate) this.onUpdate(dt);
  }

  /** Write the current pose into the bones and pivot. */
  apply() {
    const cur = this.cur;
    for (let b = 0; b < this.n; b++) this.bones[b].rotation.set(cur[b * 3], cur[b * 3 + 1], cur[b * 3 + 2]);
    const e = this.n * 3;
    this.pivot.position.y = this.pivotRestY + cur[e + E_HIPSY];
    this.pivot.rotation.set(cur[e + E_PITCH], cur[e + E_YAW], cur[e + E_ROLL]);
  }

  /** Advance and then snap exactly onto the clip's target (deterministic screenshot poses). */
  settle(steps = 30) {
    for (let i = 0; i < steps; i++) this.update(1 / 60);
    this.cur.set(this.tgt); this.apply();
    if (this.onUpdate) this.onUpdate(0);
  }
}

// -------------------------------------------------------------------------------------------------
// Humanoid clips

const PH = { p: 0, k: 0 };
function phase(t, ctx) {
  if (t < ctx.windup) { PH.p = 0; PH.k = t / ctx.windup; return PH; }
  t -= ctx.windup;
  if (t < ctx.active) { PH.p = 1; PH.k = t / ctx.active; return PH; }
  t -= ctx.active;
  if (t < ctx.recover) { PH.p = 2; PH.k = t / ctx.recover; return PH; }
  PH.p = 3; PH.k = 1; return PH;
}
/** Wide fighting stance, left foot forward; ankles keep the feet flat. */
function stance(P, dip = -0.05) {
  P.set('hipL', -0.3, 0.1, 0.06); P.set('kneeL', 0.45, 0, 0); P.set('ankleL', -0.12, 0, 0);
  P.set('hipR', 0.22, 0, -0.08); P.set('kneeR', 0.35, 0, 0); P.set('ankleR', -0.4, 0, 0);
  P.extra(E_HIPSY, dip);
}

/**
 * Run cycle timing. The `character` screenshot pose plays the clip at HERO_SPEED and settles it for 40 steps
 * (t = 0.667 s); RUN_PH0 is chosen so that moment lands on the hero frame — left knee driving up with the shin
 * folded, right leg (camera side) extended behind at toe-off, free arm pumped back, sword arm forward with the
 * blade pointing ahead and down.
 */
const runCadence = (sp) => 1.15 + sp * 0.65;
export const HERO_SPEED = 0.85;
const HERO_PH = 1.0; // phase of the LEFT leg at the hero frame (right leg is PI ahead)
const RUN_PH0 = HERO_PH - (40 / 60) * TAU * runCadence(HERO_SPEED);

export const HUMANOID_CLIPS = {
  idle(t, P) {
    const b = Math.sin(t * 1.7);
    P.set('chest', 0.03 * b, 0, 0); P.set('spine', 0.02 * b, 0, 0); P.set('head', 0.05 - 0.02 * b, 0, 0);
    P.set('shoulderL', -0.06 + 0.02 * b, 0, 0.16); P.set('shoulderR', -0.1 + 0.02 * b, 0, -0.16);
    P.set('elbowL', -0.25, 0, 0); P.set('elbowR', -0.4, 0, 0);
    P.set('wristR', 0.25, 0, 0);
    P.set('hipL', 0, 0, 0.03); P.set('hipR', 0, 0, -0.03); P.set('kneeL', 0.05, 0, 0); P.set('kneeR', 0.05, 0, 0);
    P.set('ankleL', -0.05, 0, 0); P.set('ankleR', -0.05, 0, 0);
    P.extra(E_HIPSY, 0.01 * b);
  },
  /**
   * Run / sprint (ctx.speed 0..1). Gait per leg (phase p, left leg uses ph, right ph + PI):
   * thigh reaches forward at p = PI/2, plants ~2.2, drives back through stance, toes off ~4.6; the knee folds
   * hard through swing (peak 0.7), straightens to land, softens at mid-stance. Arms counter-swing with bent
   * elbows; the sword wrist keeps the blade low. Whole body leans from the hips; hips counter-rotate the chest.
   */
  run(t, P, ctx) {
    const sp = clamp01(ctx.speed);
    const ph = t * TAU * runCadence(sp) + RUN_PH0;
    const s = Math.sin(ph), c = Math.cos(ph);
    const leg = 1 + sp * 0.25, arm = 1 + sp * 0.35, lean = 0.2 + sp * 0.16;
    // per-leg phase p: thigh peaks forward at PI/2, plants ~2.3, drives back through stance, toes off ~4.6
    const thigh = (ss) => -0.28 * leg - 0.66 * leg * ss;
    const knee = (p) => 0.14 + 1.55 * leg * Math.pow(Math.max(0, Math.sin(p + 0.9)), 2.4) + 0.4 * Math.pow(Math.max(0, Math.sin(p - 2.0)), 2);
    const toe = (ss) => 0.22 * Math.pow(Math.max(0, -ss), 1.4) - 0.2 * Math.max(0, ss); // toe skims the ground at toe-off, heel leads on landing
    // the swinging knee drifts a little outward so it clears the body silhouette
    P.set('hipL', thigh(s), 0.05 * s, 0.05 + 0.1 * Math.max(0, s)); P.set('hipR', thigh(-s), 0.05 * s, -0.05 - 0.1 * Math.max(0, -s));
    P.set('kneeL', knee(ph), 0, 0); P.set('kneeR', knee(ph + Math.PI), 0, 0);
    P.set('ankleL', toe(s), 0, 0); P.set('ankleR', toe(-s), 0, 0);
    // free (left) arm pumps with a folded elbow; the weapon (right) arm swings less with the forearm carried
    // level so the blade rides forward-and-up, clear of the ground and the legs, bobbing with the stride
    P.set('shoulderL', -0.35 + 0.7 * arm * s, 0.14, 0.28 + 0.1 * Math.max(0, -s));
    P.set('elbowL', -1.0 - 0.5 * arm * Math.max(0, -s), 0, 0);
    const shR = -0.35 - 0.25 * arm * s, elR = -0.6 - 0.25 * Math.max(0, s);
    // net hand pitch in the chest frame; the spine + chest + pivot lean (~0.6 rad at a sprint) pitches it back to
    // ~20° above horizontal in world space, tip ahead at shoulder height
    const wantBlade = -2.2 + 0.1 * s;
    P.set('shoulderR', shR, -0.18, -0.3); P.set('elbowR', elR, 0, 0);
    P.set('wristR', Math.min(0.9, Math.max(-1.0, wantBlade - (shR + elR))), 0, 0);
    // lean lives mostly in the spine (legs stay under the body); pelvis rolls and yaws with the stride, chest counter-rotates, head stays level
    P.set('hips', 0, 0.14 * s, 0.06 * s); P.set('spine', lean * 0.75, -0.12 * s, -0.04 * s); P.set('chest', lean * 0.55, -0.14 * s, 0);
    P.set('neck', -lean * 0.4, 0.05 * s, 0); P.set('head', -lean * 0.6, 0.07 * s, -0.02 * c);
    P.extra(E_HIPSY, 0.035 * Math.sin(2 * ph - 2.43) - 0.03 - 0.015 * sp);
    P.extra(E_PITCH, 0.08 + 0.1 * sp);
  },
  roll(t, P, ctx) {
    const k = clamp01(t / ctx.dur);
    const tuck = Math.sin(Math.min(1, k * 1.2) * Math.PI);
    P.set('spine', 0.6 * tuck, 0, 0); P.set('chest', 0.5 * tuck, 0, 0); P.set('head', 0.6 * tuck, 0, 0);
    P.set('hipL', -1.7 * tuck, 0, 0.12); P.set('hipR', -1.7 * tuck, 0, -0.12); P.set('kneeL', 2.1 * tuck, 0, 0); P.set('kneeR', 2.1 * tuck, 0, 0);
    P.set('ankleL', 0.4 * tuck, 0, 0); P.set('ankleR', 0.4 * tuck, 0, 0);
    P.set('shoulderL', -1.3 * tuck, 0, 0.35); P.set('shoulderR', -1.3 * tuck, 0, -0.35); P.set('elbowL', -1.8 * tuck, 0, 0); P.set('elbowR', -1.8 * tuck, 0, 0);
    P.extra(E_HIPSY, -0.5 * tuck);
    P.extra(E_PITCH, TAU * sm(k));
  },
  light1(t, P, ctx) {
    const f = phase(t, ctx); let ry, rx, tw, lean;
    if (f.p === 0) { const k = sm(f.k); ry = -0.4 - 1.3 * k; rx = -1.2 - 0.3 * k; tw = -0.6 * k; lean = 0.05; }
    else if (f.p === 1) { const k = f.k; ry = -1.7 + 3.0 * k; rx = -1.5 + 0.25 * Math.sin(k * Math.PI); tw = -0.6 + 1.1 * k; lean = 0.2; }
    else { const k = sm(f.k); ry = 1.3 * (1 - k); rx = -1.5 * (1 - k) - 0.1 * k; tw = 0.5 * (1 - k); lean = 0.2 * (1 - k); }
    P.set('shoulderR', rx, ry, -0.25); P.set('elbowR', -0.25, 0, 0);
    P.set('spine', lean, tw * 0.6, 0); P.set('chest', lean, tw * 0.5, 0); P.set('head', -lean * 0.8, -tw * 0.6, 0);
    P.set('shoulderL', -0.35, 0.35, 0.55); P.set('elbowL', -1.1, 0, 0);
    stance(P, -0.06);
  },
  light2(t, P, ctx) {
    const f = phase(t, ctx); let ry, rx, tw, lean;
    if (f.p === 0) { const k = sm(f.k); ry = 0.3 + 1.0 * k; rx = -1.4 - 0.4 * k; tw = 0.55 * k; lean = 0.05; }
    else if (f.p === 1) { const k = f.k; ry = 1.3 - 2.9 * k; rx = -1.8 + 0.6 * k; tw = 0.55 - 1.1 * k; lean = 0.22; }
    else { const k = sm(f.k); ry = -1.6 * (1 - k); rx = -1.2 * (1 - k) - 0.1 * k; tw = -0.55 * (1 - k); lean = 0.22 * (1 - k); }
    P.set('shoulderR', rx, ry, -0.2); P.set('elbowR', -0.3, 0, 0);
    P.set('spine', lean, tw * 0.6, 0); P.set('chest', lean, tw * 0.5, 0); P.set('head', -lean * 0.8, -tw * 0.6, 0);
    P.set('shoulderL', -0.4, 0.3, 0.5); P.set('elbowL', -1.2, 0, 0);
    stance(P, -0.06);
  },
  light3(t, P, ctx) {
    const f = phase(t, ctx); let rx, lean, dip;
    if (f.p === 0) { const k = sm(f.k); rx = -1.3 - 1.7 * k; lean = -0.15 * k; dip = -0.04; }
    else if (f.p === 1) { const k = f.k; rx = -3.0 + 2.3 * k; lean = -0.15 + 0.6 * k; dip = -0.04 - 0.16 * k; }
    else { const k = sm(f.k); rx = -0.7 * (1 - k) - 0.1 * k; lean = 0.45 * (1 - k); dip = -0.2 * (1 - k); }
    P.set('shoulderR', rx, 0.1, -0.15); P.set('elbowR', -0.2, 0, 0);
    P.set('shoulderL', rx * 0.35, 0.2, 0.4); P.set('elbowL', -0.9, 0, 0);
    P.set('spine', lean * 0.5, 0, 0); P.set('chest', lean * 0.6, 0, 0); P.set('head', -lean * 0.5, 0, 0);
    P.set('hipL', -0.45, 0.1, 0.06); P.set('kneeL', 0.7, 0, 0); P.set('ankleL', -0.2, 0, 0);
    P.set('hipR', 0.25, 0, -0.08); P.set('kneeR', 0.4, 0, 0); P.set('ankleR', -0.45, 0, 0);
    P.extra(E_HIPSY, dip);
  },
  heavy(t, P, ctx) {
    const f = phase(t, ctx); let rxR, rxL, lean, dip, knee;
    if (f.p === 0) { const k = sm(f.k); rxR = -0.4 - 2.7 * k; rxL = -0.4 - 2.5 * k; lean = -0.3 * k; dip = -0.08 * k; knee = 0.3 * k; }
    else if (f.p === 1) { const k = f.k; rxR = -3.1 + 2.6 * k; rxL = -2.9 + 2.5 * k; lean = -0.3 + 0.95 * k; dip = -0.08 - 0.2 * k; knee = 0.3 + 0.6 * k; }
    else { const k = sm(f.k); rxR = -0.5 * (1 - k) - 0.1 * k; rxL = -0.4 * (1 - k); lean = 0.65 * (1 - k); dip = -0.28 * (1 - k); knee = 0.9 * (1 - k); }
    P.set('shoulderR', rxR, -0.15, -0.2); P.set('elbowR', -0.25, 0, 0);
    P.set('shoulderL', rxL, 0.25, 0.25); P.set('elbowL', -0.4, 0, 0);
    P.set('spine', lean * 0.5, 0, 0); P.set('chest', lean * 0.6, 0, 0); P.set('head', -lean * 0.6, 0, 0);
    P.set('hipL', -0.5, 0.1, 0.08); P.set('kneeL', 0.5 + knee, 0, 0); P.set('ankleL', -0.1 - knee * 0.4, 0, 0);
    P.set('hipR', 0.3, 0, -0.1); P.set('kneeR', 0.3 + knee * 0.5, 0, 0); P.set('ankleR', -0.45, 0, 0);
    P.extra(E_HIPSY, dip);
  },
  hit(t, P, ctx) {
    const k = 1 - sm(t / (ctx.dur || 0.4));
    P.set('spine', -0.3 * k, 0, 0); P.set('chest', -0.25 * k, 0.1 * k, 0); P.set('head', -0.35 * k, 0, 0);
    P.set('shoulderL', -0.7 * k, 0, 0.6 * k + 0.15); P.set('shoulderR', -0.7 * k, 0, -0.6 * k - 0.15);
    P.set('elbowL', -0.9 * k, 0, 0); P.set('elbowR', -0.9 * k, 0, 0);
    P.set('hipL', -0.2 * k, 0, 0.08); P.set('kneeL', 0.4 * k, 0, 0); P.set('hipR', 0.1 * k, 0, -0.08); P.set('kneeR', 0.35 * k, 0, 0);
    P.set('ankleL', -0.2 * k, 0, 0); P.set('ankleR', -0.4 * k, 0, 0);
    P.extra(E_HIPSY, -0.08 * k);
  },
  stagger(t, P, ctx) {
    const k = 1 - sm(t / (ctx.dur || 0.8));
    const w = Math.sin(t * 9) * 0.15 * k;
    P.set('spine', -0.45 * k, w, 0); P.set('chest', -0.35 * k, 0, 0); P.set('head', -0.5 * k, 0, w);
    P.set('shoulderL', -1.0 * k, 0, 0.9 * k + 0.15); P.set('shoulderR', -1.0 * k, 0, -0.9 * k - 0.15);
    P.set('elbowL', -0.7 * k, 0, 0); P.set('elbowR', -0.7 * k, 0, 0);
    P.set('hipL', -0.35 * k, 0, 0.15); P.set('kneeL', 0.6 * k, 0, 0); P.set('hipR', 0.2 * k, 0, -0.15); P.set('kneeR', 0.5 * k, 0, 0);
    P.set('ankleL', -0.25 * k, 0, 0); P.set('ankleR', -0.5 * k, 0, 0);
    P.extra(E_HIPSY, -0.15 * k);
  },
  death(t, P) {
    const k = sm(t / 0.9), kk = k * k;
    P.extra(E_PITCH, -1.5 * kk);
    P.extra(E_HIPSY, -0.82 * kk);
    P.set('shoulderL', -0.6 * k, 0, 0.9 * k); P.set('shoulderR', -0.4 * k, 0, -1.1 * k);
    P.set('elbowL', -0.5 * k, 0, 0); P.set('elbowR', -0.8 * k, 0, 0);
    P.set('hipL', -0.15 * k, 0, 0.25 * k); P.set('hipR', 0.1 * k, 0, -0.15 * k); P.set('kneeL', 0.5 * k, 0, 0); P.set('kneeR', 0.2 * k, 0, 0);
    P.set('ankleL', 0.5 * k, 0, 0); P.set('ankleR', 0.5 * k, 0, 0);
    P.set('head', -0.4 * k, 0.3 * k, 0); P.set('spine', -0.15 * k, 0, 0);
  },
  guard(t, P) {
    const b = Math.sin(t * 2) * 0.02;
    P.set('shoulderL', -1.25 + b, 0.55, 0.25); P.set('elbowL', -1.5, 0, 0);
    P.set('shoulderR', -0.5, -0.4, -0.2); P.set('elbowR', -1.4, 0, 0);
    P.set('spine', 0.12, 0.2, 0); P.set('chest', 0.1, 0.15, 0); P.set('head', -0.1, -0.2, 0);
    stance(P, -0.07);
  },
  rest(t, P) {
    const b = Math.sin(t * 1.5) * 0.02;
    P.extra(E_HIPSY, -0.58);
    P.set('hipL', -1.45, 0.25, 0.2); P.set('hipR', -1.45, -0.25, -0.2); P.set('kneeL', 1.95, 0, 0); P.set('kneeR', 1.95, 0, 0);
    P.set('ankleL', -0.5, 0, 0); P.set('ankleR', -0.5, 0, 0);
    P.set('spine', 0.22 + b, 0, 0); P.set('chest', 0.12, 0, 0); P.set('head', 0.25, 0, 0);
    P.set('shoulderL', -0.7, 0.1, 0.2); P.set('shoulderR', -0.7, -0.1, -0.2); P.set('elbowL', -1.2, 0, 0); P.set('elbowR', -1.2, 0, 0);
  },
  alert(t, P) {
    const b = Math.sin(t * 2.5) * 0.03;
    P.set('shoulderR', -0.9 + b, -0.6, -0.3); P.set('elbowR', -0.9, 0, 0);
    P.set('shoulderL', -0.6, 0.5, 0.35); P.set('elbowL', -1.2, 0, 0);
    P.set('spine', 0.1, -0.15, 0); P.set('chest', 0.08, -0.1, 0); P.set('head', -0.05, 0.2, 0);
    stance(P, -0.05);
  },
};

// -------------------------------------------------------------------------------------------------
// Geometry helpers (model space)

const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
const cyl = (rt, rb, h, seg = 7, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sph = (r, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const scaled = (g, x, y, z) => { g.scale(x, y, z); return g; };
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

/** Ring of n points around +Y at height y: half-widths w (x) / d (z), centre (xc, zc), squareness e (1 = ellipse, lower = bevelled box). */
function ringY(n, y, w, d, xc = 0, zc = 0, e = 0.8) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; pts.push([xc + w * spow(Math.cos(a), e), y, zc + d * spow(Math.sin(a), e)]); }
  return pts;
}
/** Ring of n points around +Z (foot sections) at depth z: half-width w, bottom y0, top y1, bevelled (e < 1) so the sole is flat. */
function ringZ(n, z, w, y0, y1, e = 0.6) {
  const pts = [], yc = (y0 + y1) * 0.5, h = (y1 - y0) * 0.5;
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; pts.push([w * spow(Math.cos(a), e), yc + h * spow(Math.sin(a), e), z]); }
  return pts;
}
/** Open ring around +Y (hood sections): n points from angle `open` to TAU-open, angle 0 = +Z (the face opening). */
function arcY(n, y, r, zc, open, dz = 1) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = open + ((TAU - 2 * open) * k) / (n - 1); pts.push([Math.sin(a) * r, y, zc + Math.cos(a) * r * dz]); }
  return pts;
}

/**
 * Loft equal-sized rings into an indexed geometry with smooth normals (flat material ignores them). Caps fan
 * to the ring centroid. Winding is auto-corrected so faces point away from the centroid.
 */
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
  // orientation test on the first side quad
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

/**
 * Boot: wedge foot lofted from a rounded heel through a high instep to a tapered, slightly upturned toe.
 * Frame: ankle at the origin, sole near y = 0, toe toward +Z. Returns the foot shell (a heel block is added separately).
 */
function footGeo(n = 10) {
  const upper = loft([
    ringZ(n, -0.09, 0.036, 0.03, 0.085, 0.8),
    ringZ(n, -0.068, 0.052, 0.016, 0.12, 0.75),
    ringZ(n, -0.02, 0.058, 0.012, 0.135, 0.75),
    ringZ(n, 0.04, 0.059, 0.011, 0.105, 0.75),
    ringZ(n, 0.105, 0.056, 0.011, 0.066, 0.75),
    ringZ(n, 0.165, 0.047, 0.012, 0.044, 0.8),
    ringZ(n, 0.215, 0.03, 0.016, 0.036, 0.85),
    ringZ(n, 0.25, 0.013, 0.03, 0.042, 0.9),
  ], { capStart: true, capEnd: true });
  // sole slab: flat, a touch wider than the upper, sits under it with a raised heel block
  const sole = loft([
    ringZ(n, -0.096, 0.04, 0.0, 0.02, 0.55), ringZ(n, -0.06, 0.056, 0.0, 0.022, 0.55), ringZ(n, 0.0, 0.062, 0.0, 0.017, 0.55),
    ringZ(n, 0.075, 0.062, 0.0, 0.014, 0.55), ringZ(n, 0.16, 0.05, 0.0, 0.014, 0.55), ringZ(n, 0.225, 0.026, 0.005, 0.02, 0.6),
  ], { capStart: true, capEnd: true });
  return { upper, sole };
}

/** Shoulder mantle: a cone from the neck ring to the hem ring with a zig-zag of hanging leaf tips. */
function mantleGeo(r0, y0, r1, y1, tip, seg, back = 1, sz = 1) {
  const v = [];
  const push = (a, b, c) => v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU, am = (a0 + a1) * 0.5;
    const drop = (a) => (1 + back * 0.35 * Math.max(0, Math.cos(a))) ; // hangs lower at the back (+Z is front)
    const T0 = [Math.sin(a0) * r0, y0, Math.cos(a0) * r0 * sz], T1 = [Math.sin(a1) * r0, y0, Math.cos(a1) * r0 * sz];
    const B0 = [Math.sin(a0) * r1, y1 - (drop(a0 + Math.PI) - 1) * 0.06, Math.cos(a0) * r1 * sz];
    const B1 = [Math.sin(a1) * r1, y1 - (drop(a1 + Math.PI) - 1) * 0.06, Math.cos(a1) * r1 * sz];
    const tl = tip * (0.7 + 0.3 * ((i * 7) % 3) / 2);
    const P = [Math.sin(am) * (r1 + 0.025), Math.min(B0[1], B1[1]) - tl, Math.cos(am) * (r1 + 0.025) * sz];
    push(T0, B0, B1); push(T0, B1, T1); push(B0, P, B1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// -------------------------------------------------------------------------------------------------
// Shared shader hooks (module-level uniforms so every humanoid shares one program per material type)

/**
 * Character light rig (module-level uniforms — every humanoid shares one program per material type).
 *  rim / rimPow   moon backlight: fresnel edge, only where the surface leans toward the key light, widest when the
 *                 key sits behind the figure (≈ 1.5× the key's lit value on a dark cloth edge)
 *  fill           sky-coloured fill weighted to up-facing surfaces (top of the hood / shoulders lighter than the lower back)
 *  wrap           squared wrap from the key so the sides of round limbs roll off instead of stepping to the fill value
 *  indirect       scale on three's hemisphere + ambient term (the flat lift that made every back plane one value)
 *  keyScale       scale on any directional light other than the shadowed key: the world's shadowless "vista fill" sits
 *                 behind the character camera and would light the hero front-on like a flash
 */
const RIM = { value: 8.0 };
const RIM_POW = { value: 1.9 };
const RIM_COLOR = { value: new THREE.Color(PALETTE.moonLight) };
const FILL = { value: 1.3 };
const FILL_COLOR = { value: new THREE.Color(PALETTE.hemiSky) };
const WRAP = { value: 0.7 };
const INDIRECT = { value: 0.45 };
const KEY_SCALE = { value: 0.3 };

const DIR_LOOP_TAG = 'getDirectionalLightInfo( directionalLight, directLight );';
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.includes(DIR_LOOP_TAG)
  ? THREE.ShaderChunk.lights_fragment_begin.replace(DIR_LOOP_TAG, DIR_LOOP_TAG + '\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? 1.0 : uKeyScale;')
  : '#include <lights_fragment_begin>';

/**
 * Character lighting hook. Keeps three's shadowed key light, scales every other directional light by uKeyScale and the
 * hemisphere/ambient lift by uIndirect, then adds a sky-weighted fill, the key wrap and the fresnel backlight rim into
 * indirect diffuse (matte — no specular shine). With the moon behind the figure the visible back falls into a soft
 * gradient and the hood, shoulders, arms and cloak edge catch a bright cool outline against the fog.
 */
function rimHook(sh) {
  if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return; // depth / distance materials
  sh.uniforms.uRim = RIM; sh.uniforms.uRimPow = RIM_POW; sh.uniforms.uRimColor = RIM_COLOR; sh.uniforms.uFill = FILL; sh.uniforms.uFillColor = FILL_COLOR;
  sh.uniforms.uWrap = WRAP; sh.uniforms.uIndirect = INDIRECT; sh.uniforms.uKeyScale = KEY_SCALE;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uRim; uniform float uRimPow; uniform vec3 uRimColor; uniform float uFill; uniform vec3 uFillColor; uniform float uWrap; uniform float uIndirect; uniform float uKeyScale;
      #ifndef RIM_MUL
      #define RIM_MUL 1.0
      #endif`)
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        vec3 V = normalize( vViewPosition );
        float fres = 1.0 - saturate( dot( normal, V ) );
        vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
        float sky = dot( normal, upV ) * 0.5 + 0.5;
        reflectedLight.indirectDiffuse *= uIndirect;
        vec3 fill = uFill * uFillColor * ( 0.18 + 0.82 * sky * sky );
        float rim = 0.0;
        #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[ 0 ].direction;
          float NdL = dot( normal, L );
          float wr = NdL * 0.5 + 0.5;
          fill += uWrap * wr * wr * directionalLights[ 0 ].color;
          float behind = saturate( 0.55 - 0.6 * dot( L, V ) );
          rim = pow( fres, uRimPow ) * saturate( NdL * 1.4 + 0.55 ) * ( 0.3 + 0.7 * behind );
        #else
          rim = pow( fres, uRimPow ) * 0.5;
        #endif
        reflectedLight.indirectDiffuse += fill * diffuseColor.rgb;
        reflectedLight.indirectDiffuse += ( uRim * RIM_MUL ) * rim * uRimColor * ( 0.2 + 0.8 * diffuseColor.rgb );
      }`);
}

/** Cloak sway as a GLSL function of the rest position so the lit pass can also differentiate it for smooth normals. */
const CLOAK_FN = `
  uniform float uTime; uniform float uLift; attribute float aLift;
  vec3 cloakOffset(vec3 p, float liftMul) {
    float hang = clamp(-p.y, 0.0, 1.0);
    float h2 = hang * hang;
    float lift = uLift * liftMul;
    vec3 o = vec3(0.0);
    // gravity curve, then trails back and up with speed (hem lifts clear of the legs at a sprint but keeps hanging —
    // a cloak streaming level would catch the full moon and read as a white sheet)
    o.z -= h2 * (0.10 + 0.38 * lift) + hang * 0.05 * lift;
    o.y += h2 * 0.16 * lift - sin(hang * 3.1416) * 0.07 * lift;
    // a few broad vertical folds + travelling ripple + lazy wind
    o.z += sin(p.x * 7.0 + 0.7) * 0.03 * hang;
    o.y += sin(p.x * 8.0 + 1.9) * 0.02 * hang * lift;
    o.z += sin(uTime * (3.0 + 7.0 * lift) - hang * 6.0 + p.x * 3.0) * (0.02 + 0.06 * lift) * hang;
    o.x += sin(uTime * 1.7 + hang * 3.0) * 0.025 * hang + p.x * 0.4 * h2 * lift;
    // scarf-like strips (liftMul > 1) drift to the side and flutter faster
    float extra = max(liftMul - 1.0, 0.0);
    o.x += extra * h2 * (0.18 + 0.05 * sin(uTime * 9.0 - hang * 9.0));
    o.y += extra * h2 * 0.12 * uLift;
    return o;
  }`;
/** Smooth cloth normal: finite differences of the displaced surface (the strip rests in the XY plane). */
const CLOAK_NORMAL = `
  vec3 objectNormal = vec3( normal );
  {
    vec3 p0 = position + cloakOffset(position, aLift);
    vec3 p1 = position + vec3(0.03, 0.0, 0.0); p1 += cloakOffset(p1, aLift);
    vec3 p2 = position + vec3(0.0, -0.03, 0.0); p2 += cloakOffset(p2, aLift);
    vec3 cn = normalize(cross(p1 - p0, p2 - p0));
    objectNormal = dot(cn, normal) < 0.0 ? -cn : cn;
  }`;

/** Cloak vertex displacement shared by the lit material and its depth (shadow) material. */
function cloakHook(sh) {
  sh.uniforms.uTime = this.userData.uTime; sh.uniforms.uLift = this.userData.uLift;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>' + CLOAK_FN)
    .replace('#include <beginnormal_vertex>', CLOAK_NORMAL) // absent from the depth material (no-op there)
    .replace('#include <begin_vertex>', 'vec3 transformed = position + cloakOffset(position, aLift);');
  if (sh.fragmentShader.includes('#include <color_fragment>')) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb *= 0.62;');
  }
  rimHook(sh);
}

/**
 * Hanging cloth strip (cloak or scarf): trapezoid with a torn hem, vertex colours darken toward the top
 * (baked occlusion), per-vertex aLift scales how strongly the strip trails in the wind.
 */
function clothStrip(wTop, wBot, h, cols, rows, color, bright, liftMul, x0 = 0, y0 = 0, z0 = 0) {
  const pos = [], col = [], idx = [], lif = [];
  _c.setHex(color);
  const hash = (a, b) => { const t = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return t - Math.floor(t); };
  for (let r = 0; r <= rows; r++) {
    const v = r / rows, w = lerp(wTop, wBot, v);
    for (let c = 0; c <= cols; c++) {
      let u = c / cols - 0.5, y = -v * h;
      // jitter interior vertices so facets read as irregular cloth rather than a quilt
      if (c > 0 && c < cols && r > 0) u += (hash(c, r) - 0.5) * 0.3 / cols;
      if (r > 0 && r < rows) y += (hash(r, c + 7) - 0.5) * 0.3 * h / rows;
      if (r === rows) y -= (c % 2 ? 0.0 : 0.07 * h) + 0.02 * h * Math.sin(c * 2.3);
      pos.push(x0 + u * w, y0 + y, z0);
      const sh = lerp(0.62, 1.0, sm(v * 1.6)) * bright;
      col.push(_c.r * sh, _c.g * sh, _c.b * sh);
      lif.push(liftMul);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    if (c % 2) { idx.push(a, d, b, b, d, e); } else { idx.push(a, d, e, a, e, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aLift', new THREE.Float32BufferAttribute(lif, 1));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return ng;
}

/** Cloak (+ optional neck scarf that flies higher) as one mesh with the sway shader and a matching depth material. */
function makeCloak(color, scarf) {
  let geo = clothStrip(0.4, 0.66, 0.98, 6, 10, color, 0.34, 1.0);
  if (scarf) geo = mergeGeometries([geo, clothStrip(0.12, 0.08, 0.62, 1, 8, scarf, 0.85, 2.6, 0.06, 0.07, -0.03)], false);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: false, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { RIM_MUL: '0.3' }; // a streaming cloth is all grazing angles — the full rim turned it into a white sheet
  mat.userData.uTime = { value: 0 }; mat.userData.uLift = { value: 0 };
  mat.onBeforeCompile = cloakHook;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.userData.uTime = mat.userData.uTime; depth.userData.uLift = mat.userData.uLift;
  depth.onBeforeCompile = cloakHook;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

// -------------------------------------------------------------------------------------------------
// Contact shadows: one small soft oval under each foot (one mesh, positions rewritten per step), fades as the
// foot lifts and with distance fog.

const CONTACT_MAT = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0.85 } }]),
  vertexShader: `attribute float aAlpha; varying vec2 vUv; varying float vDepth; varying float vA;
    void main() { vUv = uv; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uOpacity; uniform float fogDensity; varying vec2 vUv; varying float vDepth; varying float vA;
    void main() {
      vec2 q = (vUv - 0.5) * 2.0; float d = length(q);
      float a = smoothstep(1.0, 0.12, d); a *= a * (0.75 + 0.25 * a);
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
      gl_FragColor = vec4(0.015, 0.017, 0.025, a * vA * uOpacity * (1.0 - fogF));
    }`,
  transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

class ContactShadows {
  constructor(count) {
    this.count = count;
    const pos = new Float32Array(count * 12), uv = new Float32Array(count * 8), al = new Float32Array(count * 4), index = new Uint16Array(count * 6);
    for (let i = 0; i < count; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh = new THREE.Mesh(geo, CONTACT_MAT);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
  }
  /** Oval i centred at c (local), lying on the plane with normal n, half-extents rx (sideways) / rz (along the foot). */
  set(i, c, n, rx, rz, alpha) {
    _t1.crossVectors(n, Z); if (_t1.lengthSq() < 1e-6) _t1.set(1, 0, 0); _t1.normalize();
    _t2.crossVectors(_t1, n).normalize();
    const p = this.posAttr.array, o = i * 12;
    p[o] = c.x - _t1.x * rx - _t2.x * rz; p[o + 1] = c.y - _t1.y * rx - _t2.y * rz; p[o + 2] = c.z - _t1.z * rx - _t2.z * rz;
    p[o + 3] = c.x + _t1.x * rx - _t2.x * rz; p[o + 4] = c.y + _t1.y * rx - _t2.y * rz; p[o + 5] = c.z + _t1.z * rx - _t2.z * rz;
    p[o + 6] = c.x + _t1.x * rx + _t2.x * rz; p[o + 7] = c.y + _t1.y * rx + _t2.y * rz; p[o + 8] = c.z + _t1.z * rx + _t2.z * rz;
    p[o + 9] = c.x - _t1.x * rx + _t2.x * rz; p[o + 10] = c.y - _t1.y * rx + _t2.y * rz; p[o + 11] = c.z - _t1.z * rx + _t2.z * rz;
    const a = this.alphaAttr.array; a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = a[i * 4 + 3] = alpha;
    this.posAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true;
  }
}

// -------------------------------------------------------------------------------------------------
// Weapon visuals (hand-local frame: origin at the centre of the fist, blade along -Y tilted slightly forward;
// the pommel pokes out just above the fist, the guard sits just below it)

function weaponParts(visual) {
  const parts = [];
  const add = (geo, color, y, x = 0, z = 0) => { geo.translate(x, y, z); parts.push({ geo, color }); };
  const S = PALETTE.steel, SD = PALETTE.steelDark, L = PALETTE.leather, G = PALETTE.gold;
  switch (visual) {
    case 'greatsword': {
      const blade = new THREE.BoxGeometry(0.1, 1.3, 0.024, 1, 2, 1).toNonIndexed();
      const p = blade.attributes.position; // fuller ridge + tapered point
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.6) { p.setX(i, p.getX(i) * 0.25); } if (Math.abs(p.getX(i)) < 0.01 && Math.abs(y) < 0.01) p.setZ(i, p.getZ(i) * 1.8); }
      blade.computeVertexNormals();
      add(blade, S, -0.95); add(new THREE.BoxGeometry(0.34, 0.05, 0.07), SD, -0.28);
      add(new THREE.CylinderGeometry(0.024, 0.028, 0.3, 6), L, -0.11);
      add(new THREE.CylinderGeometry(0.03, 0.022, 0.028, 6), SD, 0.072); // faceted pommel cap (the gold ball read as a second hand)
      break;
    }
    case 'sword': case 'katana':
      add(new THREE.BoxGeometry(visual === 'katana' ? 0.04 : 0.055, 0.86, 0.014), S, -0.57); add(new THREE.BoxGeometry(visual === 'katana' ? 0.1 : 0.22, 0.035, 0.05), SD, -0.125);
      add(new THREE.CylinderGeometry(0.02, 0.024, 0.17, 5), L, -0.03);
      add(new THREE.CylinderGeometry(0.024, 0.018, 0.022, 6), SD, 0.068); // small faceted pommel cap (a bright gold ball read as a second hand)
      break;
    case 'halberd':
      add(new THREE.CylinderGeometry(0.022, 0.022, 2.2, 5), PALETTE.woodDark, -0.55);
      add(new THREE.BoxGeometry(0.32, 0.4, 0.02), S, -1.3, -0.14); add(new THREE.ConeGeometry(0.035, 0.35, 5), S, -1.82);
      break;
    case 'axe':
      add(new THREE.CylinderGeometry(0.025, 0.028, 1.1, 5), PALETTE.woodDark, -0.35);
      add(new THREE.BoxGeometry(0.3, 0.34, 0.03), S, -0.78, -0.14); add(new THREE.BoxGeometry(0.3, 0.34, 0.03), S, -0.78, 0.14);
      break;
    case 'dagger':
      add(new THREE.BoxGeometry(0.04, 0.45, 0.012), S, -0.34); add(new THREE.BoxGeometry(0.12, 0.03, 0.04), SD, -0.1);
      add(new THREE.CylinderGeometry(0.018, 0.02, 0.14, 5), L, -0.02); add(new THREE.SphereGeometry(0.022, 6, 4), G, 0.06);
      break;
    case 'staff': {
      add(new THREE.CylinderGeometry(0.02, 0.026, 1.7, 5), PALETTE.woodDark, -0.45);
      const orb = new THREE.SphereGeometry(0.07, 6, 5); add(orb, 0x8a6aff, 0.42);
      break;
    }
    case 'bow': {
      const a = new THREE.BoxGeometry(0.03, 0.7, 0.025); a.rotateX(-0.35); add(a, PALETTE.woodDark, -0.35, 0, 0.12);
      const b = new THREE.BoxGeometry(0.03, 0.7, 0.025); b.rotateX(0.35); add(b, PALETTE.woodDark, 0.35, 0, 0.12);
      add(new THREE.BoxGeometry(0.006, 1.3, 0.006), 0xd8d4c8, 0, 0, 0.0);
      break;
    }
    default: break;
  }
  for (const p of parts) p.geo.rotateX(-0.35);
  return parts;
}

function shieldParts() {
  const plate = new THREE.CylinderGeometry(0.3, 0.3, 0.035, 6);
  plate.rotateX(Math.PI / 2); plate.rotateY(Math.PI / 2); plate.translate(0.1, -0.14, 0.02);
  const boss = new THREE.SphereGeometry(0.06, 6, 4); boss.translate(0.13, -0.14, 0.02);
  return [{ geo: plate, color: PALETTE.steelDark }, { geo: boss, color: PALETTE.gold }];
}

/**
 * Wedge mitt (hand-local: wrist at +Y, fingertips at -Y, palm toward +Z): a flat-backed wedge that is widest across the
 * knuckles and thins to the fingertips, with a short bevelled thumb lying along the palm side. s = +1 left hand.
 */
function fistGeo(s, tilt) {
  const fist = loft([
    ringY(8, 0.04, 0.026, 0.018, 0, 0.0, 0.8), ringY(8, 0.012, 0.038, 0.024, 0, 0.003, 0.6),
    ringY(8, -0.02, 0.044, 0.028, 0, 0.006, 0.55), ringY(8, -0.05, 0.04, 0.026, 0, 0.008, 0.6),
    ringY(8, -0.078, 0.03, 0.02, 0, 0.006, 0.7), ringY(8, -0.092, 0.018, 0.012, 0, 0.003, 0.8),
  ], { capStart: true, capEnd: true });
  const thumb = loft([
    ringY(6, 0.0, 0.011, 0.01, -s * 0.04, 0.012, 0.7), ringY(6, -0.02, 0.012, 0.011, -s * 0.046, 0.018, 0.7), ringY(6, -0.042, 0.008, 0.008, -s * 0.05, 0.024, 0.8),
  ], { capStart: true, capEnd: true });
  const g = mergeGeometries([fist, thumb], false);
  g.rotateX(tilt);
  return g;
}

// -------------------------------------------------------------------------------------------------

/**
 * Build a humanoid. Returns { root, mesh, bones, animator, materials, cloak, contacts, handRLocal, update(dt), setGroundNormal(n) }.
 * opts: { colors:{primary,secondary,accent,head}, weapon: visual, shield, hood, helm, cloak, scarf: hex,
 *         ground(x, z, outNormal) -> ground height (world) for the foot contact shadows }
 * Costume: tunic (primary) with a jagged hem over trousers (secondary warmed toward leather), ochre leather mantle
 * (accent), hooded cloak (primary cooled/darkened), leather belt / pouches / lofted bracers, cuffed boots that taper
 * into the ankle onto a wedge foot with a sole slab, gold buckle + pommel. 1.8 m tall, long-legged heroic proportions.
 * Everything is flat-faceted (soft 8–10 sided lofts) except the smooth faceless head, neck and hands.
 */
export function createHumanoid(opts = {}) {
  const col = opts.colors || { primary: 0x3a4a6a, secondary: 0x2a2f3c, accent: 0xc8a45a, head: PALETTE.skin };
  const rb = new RigBuilder();
  const hips = rb.bone('hips', null, 0, 0.98, 0);
  const spine = rb.bone('spine', hips, 0, 0.1, 0);
  const chest = rb.bone('chest', spine, 0, 0.22, 0);
  const neck = rb.bone('neck', chest, 0, 0.18, 0);
  rb.bone('head', neck, 0, 0.07, 0);
  const shL = rb.bone('shoulderL', chest, 0.22, 0.16, 0); const elL = rb.bone('elbowL', shL, 0, -0.3, 0); rb.bone('wristL', elL, 0, -0.285, 0);
  const shR = rb.bone('shoulderR', chest, -0.22, 0.16, 0); const elR = rb.bone('elbowR', shR, 0, -0.3, 0); rb.bone('wristR', elR, 0, -0.285, 0);
  const hipL = rb.bone('hipL', hips, 0.1, -0.06, 0); const knL = rb.bone('kneeL', hipL, 0, -0.44, 0); rb.bone('ankleL', knL, 0, -0.4, 0);
  const hipR = rb.bone('hipR', hips, -0.1, -0.06, 0); const knR = rb.bone('kneeR', hipR, 0, -0.44, 0); rb.bone('ankleR', knR, 0, -0.4, 0);
  const p = (n) => rb.pos(n);
  /** Costume parts: F = flat shaded (leather layers, straps, steel), S = smooth (cloth over body, skin, boots). CLOTH lifts the palette's night albedo. */
  const CLOTH = 1.2;
  const F = (g, b, c, sh = 1, o = null) => rb.part(g, b, c, 0, sh * CLOTH, o);
  const S = (g, b, c, sh = 1, o = null) => rb.part(g, b, c, 1, sh * CLOTH, o);

  // derived tones: trousers lifted toward warm leather so the legs read at night, cloak cooler/darker than the tunic,
  // boots a warmer leather with a paler cuff, so the layers separate in a backlit frame
  // tunic and mantle are pulled toward the world's muted stone / leather so the hero sits in the palette instead of
  // reading as saturated vinyl under the smooth shading
  const TUNIC = mixc(col.primary, PALETTE.stone, 0.42), MANTLE = mixc(col.accent, PALETTE.leather, 0.6), SKIN = col.head;
  const TROUSER = mixc(col.secondary, PALETTE.leather, 0.45);
  const CLOAK = mixc(col.primary, PALETTE.clothDark, 0.45);
  const LEA = PALETTE.leather, BOOT = mixc(PALETTE.leather, PALETTE.skinDark, 0.3), CUFF = mixc(PALETTE.leather, PALETTE.skin, 0.3);
  const hy = p('hips').y, ny = p('neck').y;
  const headC = p('head').clone().add(new THREE.Vector3(0, 0.12, 0));

  // Junction occlusion, painted explicitly (the point-based bake below is soft): every layer darkens where the layer
  // above it hangs — tunic under the mantle hem and into the belt, pelvis / thighs under the tunic hem, mantle under
  // the hood, upper arms under the mantle. `under(y, top, h)` -> 1 at `top - h`, `k` at `top`.
  const under = (y, top, h, k) => lerp(1, k, sm((y - (top - h)) / h));
  const MANTLE_HEM = ny - 0.27, BELT_Y = hy + 0.02, HEM_Y = hy - 0.2;

  // --- torso: pelvis (trousers) and a waist-to-shoulder tunic (faceted lofts, narrow waist, broad back) ---
  F(loft([ringY(10, hy - 0.15, 0.15, 0.115), ringY(10, hy - 0.07, 0.17, 0.128), ringY(10, hy + 0.01, 0.165, 0.122)], { capStart: true }), 'hips', TROUSER, 1.85,
    { shadeFn: (x, y) => under(y, hy + 0.01, 0.2, 0.5) });
  F(loft([
    ringY(10, hy - 0.02, 0.165, 0.122), ringY(10, hy + 0.06, 0.152, 0.114), ringY(10, hy + 0.16, 0.172, 0.126),
    ringY(10, hy + 0.27, 0.205, 0.142), ringY(10, hy + 0.38, 0.214, 0.148, 0, -0.006), ringY(10, hy + 0.47, 0.168, 0.12, 0, -0.012), ringY(10, hy + 0.52, 0.088, 0.078, 0, -0.012),
  ], { capEnd: true }), 'chest', TUNIC, 1.2, { blend: { bone: 'spine', y: hy + 0.18, width: 0.2 },
    shadeFn: (x, y, z) => under(y, MANTLE_HEM + 0.1, 0.22, 0.42) * (z < 0 ? 0.9 : 1) * lerp(0.66, 1, sm((y - BELT_Y - 0.02) / 0.12)) * lerp(1, 0.94, sm((Math.abs(x) - 0.08) / 0.12)) });
  // tunic hem: a short jagged skirt, halves follow the legs a little so the thighs do not punch through
  F(at(mantleGeo(0.175, hy - 0.02, 0.225, HEM_Y, 0.07, 9, 0, 0.82), 0, 0, 0), 'hips', TUNIC, 1.05,
    { skirt: { L: 'hipL', R: 'hipR', top: hy, bottom: hy - 0.26, max: 0.55 }, shadeFn: (x, y, z) => (z < 0 ? 0.86 : 1) * lerp(0.62, 1.05, sm((hy - y) / 0.16)) });
  // belt (doubled: a wide leather band with a narrower dark strap over it), small dark buckle, hip satchel with a flap on
  // the sword side, bedroll pouch + knife sheath on the other, diagonal bedroll strap across the back
  F(at(scaled(cyl(0.186, 0.194, 0.07, 10), 1.0, 1, 0.78), 0, BELT_Y - 0.005, 0), 'hips', LEA, 1.25, { shadeFn: (x, y) => lerp(0.8, 1.1, sm((y - BELT_Y + 0.035) / 0.07)) });
  F(at(scaled(cyl(0.191, 0.196, 0.028, 10), 1.0, 1, 0.78), 0, BELT_Y + 0.012, 0), 'hips', PALETTE.clothDark, 1.1);
  F(at(box(0.055, 0.04, 0.02), 0, BELT_Y + 0.012, 0.152), 'hips', PALETTE.steelDark, 1.0);
  F(at(box(0.12, 0.13, 0.075), -0.175, hy - 0.1, 0.03), 'hips', LEA, 0.95, { shadeFn: (x, y) => lerp(0.7, 1, sm((hy - 0.03 - y) / 0.1)) });
  F(at(box(0.126, 0.055, 0.082), -0.175, hy - 0.05, 0.03), 'hips', CUFF, 0.78, { shadeFn: (x, y) => lerp(0.9, 1.08, sm((y - hy + 0.08) / 0.05)) });
  F(at(box(0.02, 0.05, 0.012), -0.175, hy - 0.085, 0.072), 'hips', PALETTE.clothDark, 0.9);
  F(at(box(0.09, 0.085, 0.065), 0.165, hy - 0.07, -0.05), 'hips', LEA, 0.95, { shadeFn: (x, y) => lerp(0.75, 1, sm((hy - 0.03 - y) / 0.08)) });
  F(at(box(0.06, 0.11, 0.05), 0.12, hy - 0.08, 0.12), 'hips', CUFF, 0.85, { shadeFn: (x, y) => lerp(0.8, 1, sm((hy - 0.03 - y) / 0.08)) });
  { const strap = box(0.045, 0.56, 0.02); strap.rotateZ(0.5); F(at(strap, -0.02, p('spine').y + 0.2, -0.16), 'spine', LEA, 0.9, { blend: { bone: 'chest', y: p('chest').y, width: 0.16 } }); }

  // --- shoulder mantle (two jagged leather layers: a long dark under-layer and a shorter paler cape over it, plus a
  //     rolled collar where the hood drape meets it) ---
  F(at(mantleGeo(0.12, ny + 0.04, 0.34, MANTLE_HEM, 0.14, 11), 0, 0, 0), 'chest', MANTLE, 0.5, { shadeFn: (x, y) => lerp(0.62, 1.08, sm((ny + 0.04 - y) / 0.3)) });
  F(at(mantleGeo(0.11, ny + 0.06, 0.26, ny - 0.13, 0.09, 9), 0, 0, 0), 'chest', MANTLE, 0.8, { shadeFn: (x, y) => lerp(0.66, 1.1, sm((ny + 0.06 - y) / 0.18)) });
  F(loft([ringY(10, ny + 0.02, 0.13, 0.115, 0, -0.01, 0.9), ringY(10, ny + 0.06, 0.14, 0.125, 0, -0.012, 0.9), ringY(10, ny + 0.1, 0.12, 0.105, 0, -0.01, 0.9)], { capStart: true, capEnd: true }), 'neck', MANTLE, 0.66, { shadeFn: (x, y) => lerp(1.05, 0.72, sm((y - ny - 0.02) / 0.08)) });
  if (opts.scarf) F(at(scaled(cyl(0.085, 0.1, 0.08, 8, true), 1, 1, 1.05), 0, ny + 0.1, -0.01), 'neck', opts.scarf, 1.15);

  // --- neck + head (smooth, faceless) ---
  S(at(cyl(0.05, 0.06, 0.12, 8), 0, ny + 0.05, 0), 'neck', SKIN, 0.85);
  S(at(scaled(sph(0.12, 12, 10), 1, 1.12, 1.03), headC.x, headC.y, headC.z), 'head', SKIN, 1);
  if (opts.hood) {
    // cowl: a rounded shell hugging the crown with a short fold behind it, a rolled brim over the brow, then a drape
    // that widens onto the mantle; open at the face (the hood's inside shows through the opening, darkened)
    const hc = headC, n = 13;
    const hood = loft([
      arcY(n, hc.y + 0.08, 0.028, hc.z - 0.165, 0.7), arcY(n, hc.y + 0.135, 0.075, hc.z - 0.1, 0.7), arcY(n, hc.y + 0.158, 0.12, hc.z - 0.035, 0.76),
      arcY(n, hc.y + 0.125, 0.146, hc.z - 0.02, 0.82), arcY(n, hc.y + 0.05, 0.153, hc.z - 0.03, 0.88), arcY(n, hc.y - 0.05, 0.152, hc.z - 0.045, 0.94),
      arcY(n, hc.y - 0.14, 0.155, hc.z - 0.055, 1.0), arcY(n, hc.y - 0.21, 0.19, hc.z - 0.05, 1.0), arcY(n, hc.y - 0.29, 0.27, hc.z - 0.04, 0.9),
    ], { closed: false });
    F(hood, 'head', CLOAK, 1.4, { blend: { bone: 'neck', y: hc.y - 0.17, width: 0.14 }, shadeFn: (x, y, z) => lerp(1.08, 0.56, sm((hc.y + 0.08 - y) / 0.38)) * (z > 0.04 ? 0.7 : 1) });
  } else if (opts.helm) {
    F(at(scaled(sph(0.145, 8, 5), 1, 0.9, 1.05), headC.x, headC.y + 0.02, headC.z), 'head', PALETTE.steel, 0.95);
    F(at(cyl(0.16, 0.15, 0.035, 8), 0, headC.y - 0.02, 0), 'head', PALETTE.steelDark, 1);
    F(at(box(0.02, 0.12, 0.02), 0, headC.y - 0.07, 0.13), 'head', PALETTE.steelDark, 1);
  } else {
    // cropped hair cap + knot
    S(at(scaled(new THREE.SphereGeometry(0.128, 8, 5, 0, TAU, 0, 0.55 * Math.PI), 1, 0.95, 1.08), headC.x, headC.y + 0.015, headC.z - 0.01), 'head', col.secondary, 0.9);
    S(at(sph(0.045, 6, 4), 0, headC.y + 0.06, -0.13), 'head', col.secondary, 0.85);
  }

  // --- arms: full deltoid tapering to a slim elbow, forearm belly narrowing hard into the wrist (deltoid ≈ 3× the
  //     wrist), lofted bracer that follows the taper, wedge mitt ---
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, sh = p('shoulder' + side), el = p('elbow' + side), wr = p('wrist' + side);
    F(loft([
      ringY(10, sh.y + 0.045, 0.074, 0.072, sh.x + s * 0.008), ringY(10, sh.y - 0.04, 0.082, 0.079, sh.x + s * 0.004), ringY(10, sh.y - 0.14, 0.064, 0.062, sh.x),
      ringY(10, el.y + 0.06, 0.05, 0.049, el.x), ringY(10, el.y - 0.01, 0.045, 0.045, el.x),
    ], { capStart: true }), 'shoulder' + side, TUNIC, 1.15, { blend: { bone: 'elbow' + side, y: el.y, width: 0.1 }, shadeFn: (x, y) => lerp(0.6, 1, sm((sh.y + 0.02 - y) / 0.2)) });
    F(at(sph(0.047, 8, 6), el.x, el.y, 0), 'elbow' + side, TUNIC, 1.05);
    F(loft([
      ringY(10, el.y - 0.01, 0.045, 0.045, el.x), ringY(10, el.y - 0.07, 0.05, 0.048, el.x), ringY(10, el.y - 0.15, 0.038, 0.036, el.x),
      ringY(10, wr.y + 0.03, 0.029, 0.027, el.x), ringY(10, wr.y - 0.02, 0.025, 0.023, el.x),
    ], { capEnd: true }), 'elbow' + side, TUNIC, 1.15, { blend: { bone: 'wrist' + side, y: wr.y, width: 0.06 }, shadeFn: (x, y) => lerp(0.82, 1, sm((el.y - 0.02 - y) / 0.08)) });
    // bracer: flared below the elbow, tapering into the wrist (no flat cap), with two raised wrap straps
    F(loft([
      ringY(10, el.y - 0.105, 0.054, 0.052, el.x, 0, 0.7), ringY(10, el.y - 0.13, 0.05, 0.048, el.x, 0, 0.7), ringY(10, wr.y + 0.06, 0.038, 0.036, el.x, 0, 0.7),
      ringY(10, wr.y + 0.02, 0.031, 0.029, el.x, 0, 0.7), ringY(10, wr.y + 0.0, 0.027, 0.025, el.x, 0, 0.7),
    ], { capStart: true, capEnd: true }), 'elbow' + side, LEA, 1.25, { blend: { bone: 'wrist' + side, y: wr.y + 0.01, width: 0.04 }, shadeFn: (x, y) => lerp(0.8, 1.05, sm((y - wr.y) / 0.15)) });
    F(loft([ringY(10, el.y - 0.1, 0.058, 0.056, el.x, 0, 0.7), ringY(10, el.y - 0.118, 0.058, 0.056, el.x, 0, 0.7)], { capStart: true, capEnd: true }), 'elbow' + side, CUFF, 0.85);
    F(loft([ringY(10, wr.y + 0.036, 0.04, 0.038, el.x, 0, 0.7), ringY(10, wr.y + 0.05, 0.041, 0.039, el.x, 0, 0.7)], { capStart: true, capEnd: true }), 'elbow' + side, CUFF, 0.85);
    const armed = side === 'R' && (opts.weapon || 'sword') !== 'none';
    S(at(fistGeo(s, armed ? -0.35 : -0.15), wr.x, wr.y - 0.04, 0.012), 'wrist' + side, SKIN, 0.62, { shadeFn: (x, y) => lerp(0.72, 1.0, sm((y - wr.y + 0.12) / 0.1)) });
  }
  // --- legs: long thigh tapering from a full hip to a slim knee, calf swelling then narrowing hard into the ankle
  //     (thigh ≈ 2.4× the ankle), wrapped boot shaft with a folded cuff, wedge boot on a sole ---
  for (const side of ['L', 'R']) {
    const hp = p('hip' + side), kn = p('knee' + side), an = p('ankle' + side);
    F(loft([
      ringY(10, hp.y + 0.03, 0.098, 0.106, hp.x, 0.004), ringY(10, hp.y - 0.1, 0.092, 0.1, hp.x, 0.002), ringY(10, hp.y - 0.26, 0.072, 0.078, hp.x),
      ringY(10, kn.y + 0.05, 0.06, 0.063, kn.x), ringY(10, kn.y - 0.02, 0.056, 0.058, kn.x),
    ], { capStart: true }), 'hip' + side, TROUSER, 1.7, { blend: { bone: 'knee' + side, y: kn.y, width: 0.1 }, shadeFn: (x, y) => lerp(0.56, 1.0, sm((HEM_Y + 0.02 - y) / 0.2)) });
    F(at(sph(0.057, 8, 6), kn.x, kn.y, 0), 'knee' + side, TROUSER, 1.8);
    // shin in trousers: calf belly at the back just under the knee, then narrowing toward the boot cuff
    F(loft([
      ringY(10, kn.y - 0.02, 0.055, 0.057, kn.x), ringY(10, kn.y - 0.09, 0.056, 0.068, kn.x, -0.012), ringY(10, kn.y - 0.16, 0.048, 0.056, kn.x, -0.006), ringY(10, kn.y - 0.21, 0.042, 0.046, kn.x, -0.002),
    ]), 'knee' + side, TROUSER, 1.65, { shadeFn: (x, y) => lerp(0.92, 1.0, sm((kn.y - y) / 0.2)) * lerp(1, 0.86, sm((y - kn.y + 0.26) / 0.06)) });
    // boot shaft: folded cuff at mid-calf, tapering hard into the ankle, two wrap straps, then the foot
    F(loft([
      ringY(10, kn.y - 0.185, 0.054, 0.058, kn.x, 0, 0.75), ringY(10, kn.y - 0.215, 0.056, 0.06, kn.x, 0, 0.75), ringY(10, kn.y - 0.235, 0.05, 0.054, kn.x, 0, 0.75),
    ], { capStart: true, capEnd: true }), 'knee' + side, CUFF, 1.2, { shadeFn: (x, y, z) => (z < 0 ? 0.88 : 1) * lerp(1.06, 0.9, sm((kn.y - 0.2 - y) / 0.035)) });
    F(loft([
      ringY(10, kn.y - 0.23, 0.05, 0.054, kn.x, 0, 0.75), ringY(10, kn.y - 0.3, 0.046, 0.05, kn.x, -0.002, 0.75), ringY(10, kn.y - 0.35, 0.042, 0.046, kn.x, -0.002, 0.75),
      ringY(10, an.y + 0.04, 0.039, 0.044, an.x, 0, 0.75), ringY(10, an.y + 0.0, 0.04, 0.047, an.x, 0.006, 0.75),
    ]), 'knee' + side, BOOT, 1.5, { blend: { bone: 'ankle' + side, y: an.y + 0.05, width: 0.08 }, shadeFn: (x, y) => lerp(0.8, 1.05, sm((y - an.y) / 0.3)) * lerp(0.84, 1, sm((kn.y - 0.245 - y) / 0.04)) });
    for (const wy of [kn.y - 0.29, an.y + 0.075]) {
      const r = lerp(0.047, 0.041, (kn.y - 0.29 - wy) / 0.2);
      F(loft([ringY(10, wy - 0.012, r, r + 0.005, kn.x, -0.001, 0.75), ringY(10, wy + 0.012, r + 0.002, r + 0.007, kn.x, -0.001, 0.75)], { capStart: true, capEnd: true }), 'knee' + side, CUFF, 0.8,
        { blend: { bone: 'ankle' + side, y: an.y + 0.05, width: 0.08 } });
    }
    const foot = footGeo(10);
    F(at(foot.upper, an.x, 0, 0), 'ankle' + side, BOOT, 1.45, { shadeFn: (x, y, z) => lerp(0.74, 1.02, sm((y - 0.015) / 0.09)) * (z > 0.12 ? 1.04 : 1) });
    F(at(foot.sole, an.x, 0, 0), 'ankle' + side, PALETTE.clothDark, 0.9);
  }
  // --- weapon + shield bound to the hands ---
  const handR = p('wristR').clone().add(new THREE.Vector3(0, -0.05, 0.012));
  for (const w of weaponParts(opts.weapon || 'sword')) rb.part(at(w.geo, handR.x, handR.y, handR.z), 'wristR', w.color, 0, w.color === PALETTE.steel ? 1.45 : 1.0);
  if (opts.shield) { const hl = p('wristL').clone().add(new THREE.Vector3(0, -0.05, 0.012)); for (const w of shieldParts()) rb.part(at(w.geo, hl.x, hl.y + 0.12, hl.z), 'wristL', w.color); }

  const materials = charMats();
  materials[0].side = THREE.DoubleSide; // open cones (skirt, mantle) read from any angle
  materials[1].side = THREE.DoubleSide; // the hood's inside shows through the face opening
  // painterly soft shading: the body uses the crease-smoothed normals baked below (not per-face), matte cloth
  materials[0].flatShading = false; materials[0].roughness = 0.96; materials[1].roughness = 0.9;
  materials[0].onBeforeCompile = rimHook; materials[1].onBeforeCompile = rimHook;
  const rig = rb.build(materials, {
    smooth: 60,
    ao: {
      strength: 0.7, radius: 0.3, gain: 1.4, groundY: 0.02, groundH: 0.3, groundK: 0.2, mottle: 0.16,
      // bake in a spread pose: arms out and a little forward, legs apart — the hanging bind pose would darken every limb
      pose: { shoulderL: [-0.3, 0, 0.8], shoulderR: [-0.3, 0, -0.8], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0], hipL: [-0.1, 0, 0.22], hipR: [-0.1, 0, -0.22] },
    },
  });

  // hierarchy: root -> pivot (hip height, whole-body pitch/roll) -> mesh; contact shadows stay flat on root
  const root = new THREE.Group();
  const pivot = new THREE.Group(); pivot.position.y = 0.98;
  rig.mesh.position.y = -0.98;
  pivot.add(rig.mesh); root.add(pivot);

  let cloak = null;
  if (opts.cloak) {
    cloak = makeCloak(CLOAK, opts.scarf);
    cloak.position.set(0, 0.19, -0.15);
    rig.bones.chest.add(cloak);
    materials.push(cloak.material);
  }
  const contacts = new ContactShadows(3); // one oval per foot + a faint wide one under the pelvis (keeps an airborne stride grounded)
  root.add(contacts.mesh);
  const feet = [rig.bones.ankleL, rig.bones.ankleR, rig.bones.hips];
  const ground = opts.ground || null;

  const animator = new Animator(rig, HUMANOID_CLIPS, pivot);
  let time = 0, lift = 0;
  animator.onUpdate = (dt) => {
    if (cloak) {
      const ctx = animator.ctx, name = animator.name;
      const want = name === 'run' ? 0.5 + 0.5 * clamp01(ctx.speed) : name === 'roll' ? 0.9 : 0;
      lift += (want - lift) * (1 - Math.exp(-6 * dt));
      time += dt;
      cloak.material.userData.uTime.value = time; cloak.material.userData.uLift.value = lift;
    }
    if (!ground) return;
    // foot contacts: ankle world position -> ground under it -> oval in root space, fading as the foot lifts
    (root.parent || root).updateMatrixWorld(true);
    _m.copy(root.matrixWorld).invert();
    for (let i = 0; i < 3; i++) {
      _v.setFromMatrixPosition(feet[i].matrixWorld);
      const gh = ground(_v.x, _v.z, _n);
      const h = Math.max(0, _v.y - 0.08 - gh), k = clamp01(h / 0.45);
      _v.y = gh + 0.015; _v.applyMatrix4(_m); _n.transformDirection(_m);
      if (i === 2) contacts.set(i, _v, _n, 0.36, 0.42, 0.5);
      else contacts.set(i, _v, _n, 0.14 + 0.1 * k, 0.2 + 0.12 * k, Math.pow(1 - k, 1.4) * 0.85 + 0.08);
    }
  };
  return {
    root, mesh: rig.mesh, bones: rig.bones, animator, materials, cloak, contacts, handRLocal: handR,
    update(dt) { animator.update(dt); },
    /** Kept for API compatibility: contact shadows now follow the terrain under each foot via opts.ground. */
    setGroundNormal() {},
  };
}
