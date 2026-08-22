/**
 * Battle-arena dressing so fights read as happening *somewhere*:
 *  - TrampledGround: one terrain-conforming decal per camp fire — dark trodden dirt with value breakup,
 *    radial scuff streaks, two staggered grids of boot-pair imprints, a soot ring + pale ash scatter and
 *    flickering ember specks near the fire (procedural, in the fragment shader; lit + shadowed like terrain).
 *  - camp clutter: cooking tripod + pot over the fire, log benches, weapon rack with spears, barrels,
 *    sacks, bedroll, firewood, a dropped shield / broken spear, small stones — one merged vertex-coloured mesh.
 *  - contact blobs: soft ground-AO discs for enemies (the hero has its own in Humanoid.js).
 * Everything is built once at boot (Combat owns an Arena) and costs 2 draw calls per camp.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat } from '../render/Style.js';

const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------ ground decal

const GROUND_PARS = /* glsl */`
uniform vec3 uCenter; uniform float uRadius; uniform float uTime;
uniform vec3 uDirt; uniform vec3 uDirtDark; uniform vec3 uAsh; uniform vec3 uEmber;
varying vec3 vWPos;
float gh21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh21(i), gh21(i + vec2(1.0, 0.0)), f.x), mix(gh21(i + vec2(0.0, 1.0)), gh21(i + vec2(1.0, 1.0)), f.x), f.y); }
float gfbm(vec2 p){ return gvn(p) * 0.5 + gvn(p * 2.03 + 1.7) * 0.25 + gvn(p * 4.1 + 3.3) * 0.125 + gvn(p * 8.3 + 5.1) * 0.0625; }
// one boot imprint per cell (p in cell units): x = pressed dirt, y = displaced rim. Prints are sparse
// and jittered in size / rotation so they never read as a tiled pattern.
vec2 gprints(vec2 p, float dens, float seed){
  vec2 cell = floor(p), f = fract(p) - 0.5;
  float r = gh21(cell + seed);
  if (r > dens) return vec2(0.0);
  float ang = gh21(cell + seed + 7.3) * 6.2831;
  float sz = 0.8 + 0.4 * gh21(cell + seed + 9.9);
  vec2 o = (vec2(gh21(cell + seed + 1.1), gh21(cell + seed + 2.2)) - 0.5) * 0.4;
  vec2 q = f - o; float c = cos(ang), s = sin(ang); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) / sz;
  vec2 a = vec2(q.x, q.y * 0.52) / 0.11;         // heel-to-toe oval, slightly wider at the ball
  float d = length(a) * (1.0 - 0.12 * clamp(q.y * 6.0, -1.0, 1.0));
  return vec2(smoothstep(1.0, 0.6, d), smoothstep(1.45, 1.0, d) * (1.0 - smoothstep(1.0, 0.8, d)));
}`;

const GROUND_COLOR = /* glsl */`
{
  vec2 wp = vWPos.xz, rel = wp - uCenter.xz;
  float rr = length(rel), nrm = rr / uRadius;
  // base: trodden earth with three scales of breakup (damp dark patches, dry paler dust, fine grit)
  float n1 = gfbm(wp * 0.9), n2 = gfbm(wp * 0.22 + 13.0), n3 = gvn(wp * 0.07 + 31.0);
  vec3 alb = mix(uDirtDark, uDirt, clamp(n1 * 0.7 + n2 * 0.6 - 0.2, 0.0, 1.0));
  alb = mix(alb, uDirtDark * 0.75, smoothstep(0.5, 0.8, n3) * 0.55);                       // damp hollows
  alb = mix(alb, mix(uDirt, uAsh, 0.45) * 1.15, smoothstep(0.58, 0.78, gfbm(wp * 0.16 + 51.0)) * 0.65); // dry dusty crowns
  alb *= 0.88 + 0.24 * gvn(wp * 6.0);                                                        // grit
  // radial scuffs dragged out from the fire
  float ang = atan(rel.y, rel.x);
  float streak = gvn(vec2(ang * 11.0, rr * 1.3 + 2.0)) * 0.6 + gvn(vec2(ang * 23.0 + 5.0, rr * 2.6)) * 0.4;
  alb *= 1.0 - 0.16 * smoothstep(0.5, 0.78, streak) * smoothstep(0.9, 0.3, nrm);
  // boot prints: sparse, clustered along a trodden band around the fire and where people fight
  float path = smoothstep(0.35, 0.7, gfbm(wp * 0.3 + 77.0)) * 0.7 + 0.3;
  float dens = mix(0.38, 0.1, smoothstep(0.2, 0.95, nrm)) * path;
  vec2 fp = gprints(wp / 0.55, dens, 0.0) + gprints((wp + vec2(0.27, 0.19)) * mat2(0.94, 0.34, -0.34, 0.94) / 0.55, dens * 0.5, 31.0);
  alb *= 1.0 - 0.38 * clamp(fp.x, 0.0, 1.0);
  alb += uDirt * 0.12 * clamp(fp.y, 0.0, 1.0);
  // soot around the fire, drifts of pale ash blown outward (soft patches + a few flakes)
  float soot = 1.0 - smoothstep(0.7, 2.3, rr);
  alb = mix(alb, uDirtDark * 0.45, soot * 0.85);
  float ashBand = smoothstep(0.9, 1.6, rr) * (1.0 - smoothstep(2.4, 5.5, rr));
  float drift = smoothstep(0.52, 0.72, gfbm(wp * 1.6 + 5.0) + 0.2 * ashBand) * ashBand;
  alb = mix(alb, uAsh, drift * 0.62);
  float flakeN = gvn(wp * 23.0) * 0.55 + gvn(wp * 47.0 + 4.0) * 0.45;
  float flake = smoothstep(0.8, 0.86, flakeN) * (ashBand * 0.8 + 0.08 * (1.0 - smoothstep(5.0, 9.0, rr)));
  alb = mix(alb, uAsh, flake * 0.75);
  float stone = step(0.972, gh21(floor(wp * 6.0) + 2.0)) * smoothstep(0.42, 0.2, length(fract(wp * 6.0) - 0.5));
  alb = mix(alb, uDirtDark * 0.55, stone * 0.9);
  diffuseColor.rgb *= alb;
  // ragged edge into the grass
  float edge = 1.0 - smoothstep(0.66, 0.98, nrm + (gfbm(wp * 0.45 + 7.0) - 0.5) * 0.5);
  diffuseColor.a *= edge;
}`;

const GROUND_EMISSIVE = /* glsl */`
{
  vec2 wp = vWPos.xz, rel = wp - uCenter.xz; float rr = length(rel);
  float eband = smoothstep(0.5, 0.9, rr) * (1.0 - smoothstep(1.5, 2.9, rr));
  vec2 ec = floor(wp * 9.0); float eh = gh21(ec + 9.1);
  float e = step(1.0 - 0.05 * eband - 0.002, eh);
  vec2 off = (vec2(gh21(ec + 3.3), gh21(ec + 4.4)) - 0.5) * 0.3;
  float ed = smoothstep(0.3, 0.08, length(fract(wp * 9.0) - 0.5 - off));
  float flick = 0.5 + 0.5 * sin(uTime * 5.0 + eh * 60.0);
  totalEmissiveRadiance += uEmber * e * ed * (0.6 + flick) * 2.2;
}`;

function groundHook(sh) {
  const u = this.userData.u;
  Object.assign(sh.uniforms, u);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + GROUND_PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_COLOR)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + GROUND_EMISSIVE);
}

/** Terrain-conforming trampled-dirt decal of radius R around (cx, cz). */
function buildGround(terrain, cx, cz, R, uTime) {
  const step = 0.36, n = Math.ceil((R * 2) / step) + 1, x0 = cx - R, z0 = cz - R;
  const idx = new Int32Array(n * n).fill(-1), pos = [], nor = [];
  let count = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    if (Math.hypot(x - cx, z - cz) > R + step) continue;
    idx[j * n + i] = count++;
    pos.push(x, terrain.getHeight(x, z) + 0.035, z);
    terrain.getNormal(x, z, _d); nor.push(_d.x, _d.y, _d.z);
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = idx[j * n + i], b = idx[j * n + i + 1], c = idx[(j + 1) * n + i], d = idx[(j + 1) * n + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  mat.userData.u = {
    uCenter: { value: new THREE.Vector3(cx, 0, cz) }, uRadius: { value: R }, uTime,
    // trodden earth sits a step lighter than the raw terrain so prints / patches read under moonlight
    uDirt: { value: new THREE.Color(PALETTE.terrain.path).lerp(_c.setHex(PALETTE.terrain.sand), 0.35).multiplyScalar(1.35) },
    uDirtDark: { value: new THREE.Color(PALETTE.terrain.dirt).lerp(_c.setHex(PALETTE.terrain.mud), 0.4).multiplyScalar(0.95) },
    uAsh: { value: new THREE.Color(PALETTE.terrain.sand).lerp(_c.setHex(PALETTE.moon), 0.5).multiplyScalar(1.1) },
    uEmber: { value: new THREE.Color(PALETTE.ember) },
  };
  mat.onBeforeCompile = groundHook;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.renderOrder = 0;
  return mesh;
}

// ------------------------------------------------------------------------------------------ clutter kit

/** Tiny merge kit: vertex colours with baked height AO; add() by centre + euler, addDir() between two points. */
class Kit {
  constructor(rng) { this.rng = rng; this.geos = []; }
  add(geo, color, x, y, z, rx = 0, ry = 0, rz = 0, shade = 1, ao = true) {
    if (geo.index) geo = geo.toNonIndexed();
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, _s); geo.applyMatrix4(_m);
    this._paint(geo, color, shade, ao);
  }
  addDir(geo, color, ax, ay, az, bx, by, bz, shade = 1) {
    if (geo.index) geo = geo.toNonIndexed();
    _d.set(bx - ax, by - ay, bz - az); _q.setFromUnitVectors(UP, _d.normalize()); _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _m.compose(_p, _q, _s); geo.applyMatrix4(_m);
    this._paint(geo, color, shade, true);
  }
  _paint(geo, color, shade, ao) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.position.count, pa = geo.attributes.position.array, na = geo.attributes.normal.array, col = new Float32Array(n * 3);
    _c.setHex(color).multiplyScalar(shade * (0.92 + this.rng.float() * 0.16));
    _c2.setHex(PALETTE.hemiSky);
    for (let i = 0; i < n; i++) {
      const k = ao ? 0.55 + 0.45 * smoothstep(-0.05, 1.1, pa[i * 3 + 1]) : 1;
      // two-tone facets: faces that look up take a cool sky fill, faces that look down sit in their own shadow
      const ny = na[i * 3 + 1], up = Math.max(0, ny), down = Math.max(0, -ny);
      const f = (1 + 0.35 * up - 0.3 * down) * k, sky = 0.18 * up;
      col[i * 3] = _c.r * f + _c2.r * sky; col[i * 3 + 1] = _c.g * f + _c2.g * sky; col[i * 3 + 2] = _c.b * f + _c2.b * sky;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.geos.push(geo);
  }
  build() {
    const g = mergeGeometries(this.geos, false); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, vertexMat()); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}
const cyl = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Round shield centred at (x,y,z) with its face pointing along the unit normal (nx,ny,nz). */
function shieldGeo(k, x, y, z, nx, ny, nz, face, rim, emblem) {
  const part = (geo, color, lift, shade) => k.addDir(geo, color, x + nx * (lift - 0.01), y + ny * (lift - 0.01), z + nz * (lift - 0.01), x + nx * (lift + 0.01), y + ny * (lift + 0.01), z + nz * (lift + 0.01), shade);
  part(cyl(0.34, 0.34, 0.035, 8), face, 0, 0.9);
  part(cyl(0.355, 0.355, 0.02, 8), rim, 0, 0.8);
  part(new THREE.SphereGeometry(0.07, 6, 4), rim, 0.02, 1.1);
  part(box(0.04, 0.02, 0.5), emblem, 0.025, 0.9); part(box(0.5, 0.02, 0.04), emblem, 0.025, 0.9);
}

/**
 * Camp clutter in the fire's local frame. a0 = the camp kit's tent phase (tents at a0 + i*2.1, r 5.5;
 * gaps between them at a0 + 1.05 / 3.15 / 5.25 — the combat pose fights in the last one, kept clear).
 */
function buildClutter(rng, a0) {
  const k = new Kit(rng);
  const W = PALETTE.wood, WD = PALETTE.woodDark, IR = PALETTE.iron, ST = PALETTE.steel, SD = PALETTE.steelDark, LE = PALETTE.leather, TN = PALETTE.tent, TD = PALETTE.tentDark, RK = PALETTE.rockProp, RD = PALETTE.rockPropDark;
  const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
  // cooking tripod + hanging pot over the fire
  for (let i = 0; i < 3; i++) { const [fx, fz] = polar(a0 + 0.4 + i * 2.09, 0.95); k.addDir(cyl(0.028, 0.034, 2.35, 5), WD, fx, 0, fz, 0, 2.15, 0, 0.9); }
  k.add(new THREE.SphereGeometry(0.07, 6, 4), LE, 0, 2.12, 0, 0, 0, 0, 0.8);
  k.add(cyl(0.012, 0.012, 0.55, 4), IR, 0, 1.82, 0, 0, 0, 0, 0.8);
  k.add(cyl(0.2, 0.16, 0.24, 8), IR, 0, 1.44, 0, 0, 0, 0, 0.75);
  k.add(cyl(0.215, 0.215, 0.035, 8), IR, 0, 1.56, 0, 0, 0, 0, 1.0);
  k.add(new THREE.TorusGeometry(0.2, 0.014, 4, 8, Math.PI), IR, 0, 1.58, 0, 0, 0, 0, 0.9);
  // log benches in the two quiet gaps, bedroll by one of them
  for (const ga of [a0 + 1.05, a0 + 3.15]) {
    const [bx, bz] = polar(ga, 2.35);
    k.add(cyl(0.19, 0.21, 2.1, 7), WD, bx, 0.2, bz, Math.PI / 2, 0, 0, 1.0);
    k.add(cyl(0.2, 0.2, 0.04, 7), W, bx, 0.2, bz, Math.PI / 2, 0, 0, 1.15);
    // rotate the log to lie tangent to the fire
    const last = k.geos[k.geos.length - 2], cap = k.geos[k.geos.length - 1];
    for (const g of [last, cap]) { g.translate(-bx, 0, -bz); g.rotateY(-ga); g.translate(bx, 0, bz); }
  }
  { const [rx, rz] = polar(a0 + 3.15, 3.4); k.add(cyl(0.17, 0.17, 1.6, 7), TD, rx, 0.17, rz, Math.PI / 2, 0, 0, 1.3); k.add(box(0.06, 0.36, 0.06), LE, rx, 0.17, rz, 0, 0.4, 0, 0.9); }
  // weapon rack in front of tent 1: posts, crossbar, three spears, hung shield
  { const ra = a0 + 2.1, [cx, cz] = polar(ra, 3.0), tx = -Math.sin(ra), tz = Math.cos(ra);
    for (const s of [-0.65, 0.65]) k.add(cyl(0.04, 0.05, 1.35, 5), WD, cx + tx * s, 0.675, cz + tz * s, 0, 0, 0, 0.95);
    k.add(box(1.5, 0.06, 0.08), W, cx, 1.2, cz, 0, ra, 0, 1.05);
    for (const s of [-0.4, -0.05, 0.35]) {
      const px = cx + tx * s, pz = cz + tz * s, lean = 0.22, ox = Math.cos(ra) * lean, oz = Math.sin(ra) * lean;
      k.addDir(cyl(0.018, 0.022, 2.2, 5), WD, px - ox, 0, pz - oz, px + ox * 0.3, 2.18, pz + oz * 0.3, 0.95);
      k.addDir(new THREE.ConeGeometry(0.05, 0.36, 4), ST, px + ox * 0.3, 2.18, pz + oz * 0.3, px + ox * 0.38, 2.54, pz + oz * 0.38, 1.1);
    }
    shieldGeo(k, cx + tx * 0.65 - Math.cos(ra) * 0.1, 0.78, cz + tz * 0.65 - Math.sin(ra) * 0.1, -Math.cos(ra) * 0.97, 0.24, -Math.sin(ra) * 0.97, TD, SD, LE);
  }
  // barrels + firewood in front of tent 0
  { const ba = a0 + 0.0, [bx, bz] = polar(ba, 3.1), tx = -Math.sin(ba), tz = Math.cos(ba);
    const barrel = (x, z, rx, ry, rz, y) => {
      k.add(cyl(0.28, 0.3, 0.86, 8), W, x, y, z, rx, ry, rz, 1.0);
      for (const h of [-0.3, 0.3]) { const g = cyl(0.305, 0.305, 0.05, 8); g.translate(0, h, 0); k.add(g, IR, x, y, z, rx, ry, rz, 0.9); }
      const lid = cyl(0.25, 0.25, 0.03, 8); lid.translate(0, 0.44, 0); k.add(lid, WD, x, y, z, rx, ry, rz, 0.9);
    };
    barrel(bx + tx * 0.5, bz + tz * 0.5, 0, 0.3, 0, 0.43);
    barrel(bx - tx * 0.5, bz - tz * 0.5, Math.PI / 2, 0, ba + 0.35, 0.3);
    for (let i = 0; i < 6; i++) { const row = i < 3 ? 0 : 1, j = i % 3 - (row ? 0.5 : 1); if (row && i === 5) break;
      k.add(cyl(0.075, 0.085, 0.75, 5), WD, bx + tx * 1.3 + Math.cos(ba) * j * 0.17, 0.08 + row * 0.14, bz + tz * 1.3 + Math.sin(ba) * j * 0.17, Math.PI / 2, ba + Math.PI / 2, 0, 1.1); }
  }
  // sacks + crate in front of tent 2
  { const sa = a0 + 4.2, [sx, sz] = polar(sa, 3.0), tx = -Math.sin(sa), tz = Math.cos(sa);
    for (let i = 0; i < 3; i++) {
      const s = 0.34 + 0.06 * (i % 2), x = sx + tx * (i - 1) * 0.62 + Math.cos(sa) * (i === 1 ? -0.35 : 0), z = sz + tz * (i - 1) * 0.62 + Math.sin(sa) * (i === 1 ? -0.35 : 0);
      const g = new THREE.SphereGeometry(s, 7, 5); g.scale(1, 0.72, 1); k.add(g, TN, x, s * 0.6, z, 0, i * 1.1, 0, 1.25);
      k.add(new THREE.ConeGeometry(0.1, 0.16, 5), TD, x, s * 1.28, z, 0, 0, 0, 1.1);
    }
  }
  // the fight gap: a dropped shield and a broken spear on the ground, an ale cup by the fire
  { const fa = a0 + 5.25, [gx, gz] = polar(fa, 3.05);
    shieldGeo(k, gx, 0.04, gz, 0.1, 0.99, 0.08, TD, SD, LE);
    const [px, pz] = polar(fa + 0.35, 3.9);
    k.add(cyl(0.02, 0.024, 1.15, 5), WD, px, 0.03, pz, Math.PI / 2, fa + 1.2, 0, 0.8);
    k.addDir(new THREE.ConeGeometry(0.05, 0.34, 4), ST, px + Math.sin(fa + 1.2) * 0.57, 0.03, pz + Math.cos(fa + 1.2) * 0.57, px + Math.sin(fa + 1.2) * 0.9, 0.04, pz + Math.cos(fa + 1.2) * 0.9, 1.0);
  }
  // ground scatter: stones around the fire pit and across the camp, charcoal chunks, straw stalks, bones
  for (let i = 0; i < 44; i++) {
    const a = rng.float() * TAU, r = i < 8 ? 1.25 + rng.float() * 0.3 : 2.2 + rng.float() * 10.0, s = i < 8 ? 0.1 + rng.float() * 0.12 : 0.05 + rng.float() * 0.14;
    k.add(box(s * 1.3, s * 0.8, s), i % 3 ? RK : RD, Math.cos(a) * r, s * 0.3, Math.sin(a) * r, rng.float() * 0.4, rng.float() * TAU, rng.float() * 0.4, 0.9 + rng.float() * 0.3);
  }
  for (let i = 0; i < 14; i++) { // charcoal kicked out of the pit
    const a = rng.float() * TAU, r = 1.1 + rng.float() * 1.6, s = 0.05 + rng.float() * 0.07;
    k.add(box(s * 1.6, s * 0.6, s), 0x141210, Math.cos(a) * r, s * 0.25, Math.sin(a) * r, 0, rng.float() * TAU, 0, 0.8 + rng.float() * 0.3, false);
  }
  for (let i = 0; i < 70; i++) { // straw stalks trodden into the dirt (pale, catch the fire light)
    const a = rng.float() * TAU, r = 2.0 + rng.float() * 10.5, ry = rng.float() * TAU, len = 0.3 + rng.float() * 0.45;
    k.add(box(0.03, 0.02, len), PALETTE.grassTuft, Math.cos(a) * r, 0.012, Math.sin(a) * r, 0, ry, 0, 1.1 + rng.float() * 0.6, false);
  }
  for (let i = 0; i < 3; i++) { // a few gnawed bones near the wolves' side of the camp
    const a = a0 + 5.25 + rng.range(-0.9, 0.4), r = 4.0 + rng.float() * 3.0, ry = rng.float() * TAU;
    k.add(cyl(0.022, 0.026, 0.34, 5), PALETTE.moon, Math.cos(a) * r, 0.03, Math.sin(a) * r, Math.PI / 2, ry, 0, 0.55, false);
    for (const e of [-0.17, 0.17]) k.add(new THREE.SphereGeometry(0.035, 5, 4), PALETTE.moon, Math.cos(a) * r + Math.sin(ry) * e, 0.035, Math.sin(a) * r + Math.cos(ry) * e, 0, 0, 0, 0.5, false);
  }
  return k.build();
}

// ------------------------------------------------------------------------------------------ contact blobs

const BLOB_GEO = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })();
const BLOB_MAT = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0.62 } }]),
  vertexShader: `varying vec2 vUv; varying float vDepth;
    void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uOpacity; uniform float fogDensity; varying vec2 vUv; varying float vDepth;
    void main() {
      vec2 q = (vUv - 0.5) * 2.0; float d = length(q);
      float a = smoothstep(1.0, 0.12, d); a *= a * (0.75 + 0.45 * (1.0 - d));
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
      gl_FragColor = vec4(0.015, 0.015, 0.025, min(a, 1.0) * uOpacity * (1.0 - fogF));
    }`,
  transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

/** Soft contact-AO disc (w × d metres) to parent under an entity root; call setGroundNormal() to lay it on slopes. */
export function makeContactBlob(w = 1.0, d = 0.95, opacity = 1) {
  const mesh = new THREE.Mesh(BLOB_GEO.clone(), opacity === 1 ? BLOB_MAT : BLOB_MAT.clone());
  if (opacity !== 1) mesh.material.uniforms.uOpacity.value = BLOB_MAT.uniforms.uOpacity.value * opacity;
  mesh.scale.set(w, 1, d); mesh.position.y = 0.02; mesh.renderOrder = 1; mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------------------------------ Arena

export class Arena {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group(); this.group.name = 'arena';
    this.uTime = { value: 0 };
    this.camps = [];
    const L = game.limveld, T = game.terrain;
    if (!L) return;
    const rng = game.rng.fork(4242);
    for (const p of L.pois) {
      if (p.type !== 'camp') continue;
      const sp = L.enemySpawns.find((s) => s.home && s.home.x === p.x && s.home.z === p.z);
      const a0 = sp ? Math.atan2(sp.z - p.z, sp.x - p.x) - 0.6 : 0; // camp kit tent phase (see Structures.camp)
      const ground = buildGround(T, p.x, p.z, 13.5, this.uTime);
      const clutter = buildClutter(rng, a0);
      clutter.position.set(p.x, T.getHeight(p.x, p.z), p.z);
      this.group.add(ground, clutter);
      this.camps.push({ x: p.x, z: p.z, a0 });
    }
    game.scene.add(this.group);
  }

  /** Advance the ember flicker clock. */
  update(time) { this.uTime.value = time; }
}
