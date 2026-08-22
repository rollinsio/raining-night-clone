/**
 * HallKit: merged vertex-coloured geometry for the Roundtable Hold. Boxes, prisms, lathes and planes are
 * pushed into material buckets (stone / wood / cloth / paper / metal / wax / flame) and merged into one
 * mesh per bucket. Every quad gets its own value jitter, vertices darken toward the floor (height AO) and
 * a world-space `shade(x, y, z, n)` callback bakes occlusion (under the table, inside corners) — the worn,
 * uneven read of old masonry and furniture without a single texture.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat } from '../render/Style.js';

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

/** Flames: HDR vertex colours (bloom) with a per-flame flicker + sway in the vertex shader. */
const FLAME_VERT = `
  attribute vec3 color; attribute vec3 fbase; attribute float fseed;
  uniform float uTime;
  varying vec3 vColor;
  void main(){
    vec3 p = position;
    float t = uTime * 9.0 + fseed * 31.0;
    float h = max(p.y - fbase.y, 0.0);
    float flick = 1.0 + 0.16 * sin(t) * sin(t * 0.37 + fseed) + 0.06 * sin(t * 2.7);
    p.y = fbase.y + h * flick;
    p.x += h * 0.5 * (0.18 * sin(t * 0.73 + fseed * 4.0) + 0.08 * sin(t * 1.9));
    p.z += h * 0.5 * (0.14 * sin(t * 0.61 + fseed * 7.0));
    vColor = color * (0.9 + 0.1 * flick);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FLAME_FRAG = `varying vec3 vColor; void main(){ gl_FragColor = vec4(vColor, 1.0); }`;

export class HallKit {
  constructor(rng) {
    this.rng = rng;
    this.buckets = new Map();
    this.stack = [];
    this.frame = new THREE.Matrix4();
    /** World-space occlusion callback: returns a multiplier (1 = unoccluded). */
    this.shade = null;
    /** Height AO: vertices at the floor are multiplied by aoFloor, rising to 1 at aoHeight. */
    this.aoFloor = 0.55; this.aoHeight = 2.6;
    this.flameTime = { value: 0 };
  }

  // ----------------------------------------------------------------------------------------- frame stack
  push(x, y, z, ry = 0) {
    this.stack.push(this.frame.clone());
    _m.makeRotationY(ry); _m.setPosition(x, y, z);
    this.frame.multiply(_m);
  }
  pop() { this.frame.copy(this.stack.pop()); }

  // ----------------------------------------------------------------------------------------- primitives
  /**
   * Add a geometry in the current frame. o: { mul, jitter (per-quad value ±), quad (jitter per 6 verts),
   * ao (height AO on/off), shade (callback override), tint (hex to lerp toward), tintK, rot:[rx,ry,rz] }
   */
  add(geo, bucket, hex, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (o.rot) { const [rx, ry, rz] = o.rot; if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); }
    if (o.at) g.translate(o.at[0], o.at[1], o.at[2]);
    g.applyMatrix4(this.frame);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const n = pos.count, col = new Float32Array(n * 3);
    const mul = o.mul ?? 1, jit = o.jitter ?? 0.06, per = o.quad === false ? 3 : 6;
    const ao = o.ao !== false, shade = o.shade === undefined ? this.shade : o.shade;
    _c.setHex(hex);
    if (o.tint !== undefined) { const t = new THREE.Color(o.tint); _c.lerp(t, o.tintK ?? 0.5); }
    let fj = 1;
    const objJ = 1 + (this.rng.float() - 0.5) * 2 * (o.objJitter ?? 0.05);
    for (let i = 0; i < n; i++) {
      if (i % per === 0) fj = 1 + (this.rng.float() - 0.5) * 2 * jit;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let k = mul * fj * objJ;
      if (ao) k *= this.aoFloor + (1 - this.aoFloor) * sm(y / this.aoHeight);
      if (shade) { _n.set(nor.getX(i), nor.getY(i), nor.getZ(i)); k *= shade(x, y, z, _n); }
      if (o.shadeFn) { _n.set(nor.getX(i), nor.getY(i), nor.getZ(i)); k *= o.shadeFn(x, y, z, _n); }
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.buckets.get(bucket);
    if (!list) { list = []; this.buckets.set(bucket, list); }
    list.push(g);
    return g;
  }

  box(w, h, d, x, y, z, bucket, hex, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    return this.add(g, bucket, hex, { ...o, at: [x, y, z] });
  }
  /** Cylinder (rt top radius, rb bottom radius) standing on y. */
  cyl(rt, rb, h, seg, x, y, z, bucket, hex, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open);
    return this.add(g, bucket, hex, { ...o, at: [x, y + h / 2, z] });
  }
  cone(r, h, seg, x, y, z, bucket, hex, o = {}) {
    const g = new THREE.ConeGeometry(r, h, seg, 1);
    return this.add(g, bucket, hex, { ...o, at: [x, y + h / 2, z] });
  }
  /** Lathe from a profile of [r, y] pairs (pots, goblets). */
  lathe(profile, seg, x, y, z, bucket, hex, o = {}) {
    const pts = profile.map(([r, py]) => new THREE.Vector2(r, py));
    const g = new THREE.LatheGeometry(pts, seg);
    return this.add(g, bucket, hex, { ...o, at: [x, y, z] });
  }
  /** Flat quad (w × d) lying on the floor at height y, optional yaw and slight tilt. */
  sheet(w, d, x, y, z, bucket, hex, o = {}) {
    const g = new THREE.PlaneGeometry(w, d, o.segs || 1, o.segs || 1);
    g.rotateX(-Math.PI / 2);
    if (o.curl) { // parchment curl: lift the corners
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (w / 2), v = p.getZ(i) / (d / 2); p.setY(i, o.curl * (Math.pow(Math.abs(u), 6) + Math.pow(Math.abs(v), 6)) * 0.5 + o.curl * 0.15 * Math.pow(Math.max(0, u * v), 2)); }
      g.computeVertexNormals();
    }
    return this.add(g, bucket, hex, { ...o, at: [x, y, z] });
  }

  /** A candle flame: teardrop lathe with HDR vertex colours, base at (x, y, z). Height h. */
  flame(x, y, z, h = 0.09, hot = 1) {
    const prof = [[0, 0], [0.3, 0.12], [0.42, 0.3], [0.34, 0.55], [0.17, 0.8], [0.05, 0.95], [0, 1]].map(([r, t]) => new THREE.Vector2(r * h * 0.5, t * h));
    const g = new THREE.LatheGeometry(prof, 6).toNonIndexed();
    g.translate(x, y, z);
    g.applyMatrix4(this.frame);
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3), base = new Float32Array(n * 3), seed = new Float32Array(n);
    _p.set(x, y, z).applyMatrix4(this.frame);
    const s = this.rng.float();
    for (let i = 0; i < n; i++) {
      const t = clamp01((pos.getY(i) - _p.y) / h);
      // white-yellow core low down, orange tip, a hint of blue at the very base
      const r = 2.6 * hot * (1 - t * 0.35), gg = 1.9 * hot * (1 - t * 0.6) * (0.75 + 0.25 * (1 - t)), b = 0.7 * hot * (1 - t) * (1 - t) + 0.35 * (t < 0.1 ? 1 : 0);
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      base[i * 3] = _p.x; base[i * 3 + 1] = _p.y; base[i * 3 + 2] = _p.z; seed[i] = s;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('fbase', new THREE.BufferAttribute(base, 3));
    g.setAttribute('fseed', new THREE.BufferAttribute(seed, 1));
    let list = this.buckets.get('flame');
    if (!list) { list = []; this.buckets.set('flame', list); }
    list.push(g);
    return _p.clone();
  }

  // ----------------------------------------------------------------------------------------- materials
  static materials() {
    return {
      stone: vertexMat({ roughness: 0.96 }),
      wood: vertexMat({ roughness: 0.82 }),
      cloth: vertexMat({ roughness: 1.0, side: THREE.DoubleSide }),
      paper: vertexMat({ roughness: 0.92, side: THREE.DoubleSide }),
      metal: vertexMat({ roughness: 0.42, metalness: 0.55 }),
      wax: vertexMat({ roughness: 0.55, emissive: PALETTE.torch, emissiveIntensity: 0.025 }),
      gold: vertexMat({ roughness: 0.38, metalness: 0.7 }),
    };
  }

  /** Merge every bucket into one mesh; returns { group, meshes, flameUniforms }. */
  build() {
    const mats = HallKit.materials();
    const group = new THREE.Group(); const meshes = {};
    for (const [name, list] of this.buckets) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      geo.computeBoundingSphere();
      let mesh;
      if (name === 'flame') {
        const mat = new THREE.ShaderMaterial({ vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms: { uTime: this.flameTime }, side: THREE.DoubleSide, fog: false, toneMapped: true });
        mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2;
      } else {
        mesh = new THREE.Mesh(geo, mats[name] || mats.stone);
        mesh.castShadow = name !== 'paper'; mesh.receiveShadow = true;
      }
      mesh.matrixAutoUpdate = false;
      group.add(mesh); meshes[name] = mesh;
    }
    return { group, meshes, flameTime: this.flameTime };
  }
}
