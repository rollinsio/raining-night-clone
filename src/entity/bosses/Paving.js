/**
 * Continuous paved arena floor: one terrain-conforming decal mesh whose fragment shader lays jittered
 * running-bond flagstones — grout lines with occlusion in the joints, per-slab value / temperature jitter,
 * a slight per-slab normal tilt so every stone catches the moon and the braziers differently, polished
 * centres and worn edges, damp hollows, lichen, hairline cracks, a few missing slabs showing packed dirt,
 * and a ragged fade into the earth at the rim. Lit and shadowed like terrain (receives the moon shadow of
 * whoever stands on it). One draw call, nothing per frame.
 */
import * as THREE from 'three';
import { PALETTE } from '../../render/Style.js';

const _c = new THREE.Color(), _d = new THREE.Vector3();

const PARS = /* glsl */`
uniform vec3 uCenter; uniform float uRadius;
uniform vec3 uStone; uniform vec3 uStoneDark; uniform vec3 uStoneLight; uniform vec3 uGrout; uniform vec3 uDirt; uniform vec3 uLichen;
varying vec3 vWPos;
vec2 gSlab; float gMiss;
float ph21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph21(i), ph21(i + vec2(1.0, 0.0)), f.x), mix(ph21(i + vec2(0.0, 1.0)), ph21(i + vec2(1.0, 1.0)), f.x), f.y); }
float pfbm(vec2 p){ return pvn(p) * 0.5 + pvn(p * 2.07 + 1.3) * 0.25 + pvn(p * 4.3 + 2.9) * 0.125 + pvn(p * 8.9 + 4.1) * 0.0625; }
// running-bond slabs: rows along z, each row shifted along x, joints jittered per slab so no grid shows.
// returns (slab id, distance to the nearest joint in metres)
vec3 slabs(vec2 wp, float sx, float sz) {
  float row = floor(wp.y / sz);
  float xx = wp.x + ph21(vec2(row, 3.0)) * sx;
  float col = floor(xx / sx);
  vec2 id = vec2(col, row);
  float fx = fract(xx / sx), fz = fract(wp.y / sz);
  float jl = (ph21(id + 1.7) - 0.5) * 0.1, jr = (ph21(id + vec2(1.0, 0.0) + 1.7) - 0.5) * 0.1;
  float jb = (ph21(vec2(row, 5.0)) - 0.5) * 0.05, jt = (ph21(vec2(row + 1.0, 5.0)) - 0.5) * 0.05;
  float dx = min(fx - jl, 1.0 + jr - fx) * sx;
  float dz = min(fz - jb, 1.0 + jt - fz) * sz;
  return vec3(id, min(dx, dz));
}`;

const COLOR = /* glsl */`
{
  vec2 wp = vWPos.xz, rel = wp - uCenter.xz; float rr = length(rel), nrm = rr / uRadius;
  vec3 s = slabs(wp, 1.32, 1.02);
  vec2 id = s.xy; float j = s.z;
  float h = ph21(id), h2 = ph21(id + 9.1), h3 = ph21(id + 4.2);
  // per-slab tone: value jitter plus a warm / cool drift so neighbours never match
  vec3 tone = mix(uStoneDark, uStoneLight, 0.05 + 0.95 * h * h * h);
  tone = mix(tone, tone * vec3(1.1, 1.0, 0.86), (h2 - 0.5) * 0.8);
  tone = mix(tone, uStone, 0.25);
  // breakup inside the slab: broad mottle, fine grit
  tone *= 0.78 + 0.4 * pfbm(wp * 1.7 + id * 0.37);
  tone *= 0.93 + 0.14 * pvn(wp * 15.0);
  // joints: dark occluded gap, edges of each slab darker and chipped, centres polished by feet
  float ao = smoothstep(0.0, 0.24, j);
  tone *= 0.6 + 0.4 * ao;
  float chip = smoothstep(0.62, 0.8, pvn(wp * 9.0 + id)) * (1.0 - smoothstep(0.04, 0.12, j));
  tone *= 1.0 - 0.25 * chip;
  // damp hollows, lichen and dust
  float damp = smoothstep(0.55, 0.8, pfbm(wp * 0.23 + 17.0));
  tone = mix(tone, uStoneDark * 0.55, damp * 0.7);
  float lich = smoothstep(0.6, 0.76, pfbm(wp * 0.9 + 41.0)) * (0.3 + 0.7 * h3);
  tone = mix(tone, uLichen, lich * 0.4);
  float dust = smoothstep(0.6, 0.8, pfbm(wp * 0.4 + 77.0));
  tone = mix(tone, uStoneLight * 1.05, dust * 0.3);
  // hairline cracks across a third of the slabs
  float crk = pfbm(wp * 3.1 + id * 1.3);
  float crack = smoothstep(0.014, 0.0, abs(crk - 0.5)) * step(0.62, h3);
  tone *= 1.0 - 0.5 * crack;
  // grout
  float grout = 1.0 - smoothstep(0.02, 0.05, j);
  vec3 alb = mix(tone, uGrout * (0.7 + 0.5 * pvn(wp * 9.0)), grout);
  // missing slabs show packed dirt (more of them toward the rim)
  float miss = step(1.0 - 0.05 - 0.18 * smoothstep(0.5, 1.0, nrm), h);
  vec3 dirt = uDirt * (0.7 + 0.55 * pfbm(wp * 2.3 + 7.0)) * (0.75 + 0.25 * ao);
  alb = mix(alb, dirt, miss);
  gSlab = id; gMiss = miss;
  diffuseColor.rgb *= alb;
  // ragged fade into the earth beyond the paved radius
  float edge = 1.0 - smoothstep(0.82, 1.0, nrm + (pfbm(wp * 0.5 + 3.0) - 0.5) * 0.4);
  diffuseColor.a *= edge;
}`;

// slight per-slab tilt so each stone takes the moon / brazier light at its own value (flat-facet look)
const NORMAL = /* glsl */`
{
  vec2 t = (vec2(ph21(gSlab + 2.3), ph21(gSlab + 6.7)) - 0.5) * 0.16 * (1.0 - gMiss);
  normal = normalize(normal + (viewMatrix * vec4(t.x, 0.0, t.y, 0.0)).xyz);
}`;

function hook(sh) {
  Object.assign(sh.uniforms, this.userData.u);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + COLOR)
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + NORMAL);
}

/** Terrain-conforming paved floor of radius R around (cx, cz). Returns the mesh (transparent decal, draws first). */
export function pavedFloor(terrain, cx, cz, R) {
  const step = 0.6, n = Math.ceil((R * 2) / step) + 1, x0 = cx - R, z0 = cz - R;
  const idx = new Int32Array(n * n).fill(-1), pos = [], nor = [];
  let count = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    if (Math.hypot(x - cx, z - cz) > R + step) continue;
    idx[j * n + i] = count++;
    pos.push(x, terrain.getHeight(x, z) + 0.03, z);
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
    color: 0xffffff, roughness: 0.8, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const col = (hex, k = 1) => ({ value: new THREE.Color(hex).multiplyScalar(k) });
  mat.userData.u = {
    uCenter: { value: new THREE.Vector3(cx, 0, cz) }, uRadius: { value: R },
    uStone: col(PALETTE.stone, 0.68), uStoneDark: col(PALETTE.stoneDark, 0.45), uStoneLight: col(PALETTE.stoneLight, 0.85),
    uGrout: col(PALETTE.monolithDark, 0.35), uDirt: { value: new THREE.Color(PALETTE.terrain.dirt).lerp(_c.setHex(PALETTE.terrain.mud), 0.3) },
    uLichen: { value: new THREE.Color(PALETTE.terrain.damp).lerp(_c.setHex(PALETTE.grassTuftCool), 0.5) },
  };
  mat.onBeforeCompile = hook;
  mat.customProgramCacheKey = () => 'bossPaving';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.renderOrder = -1; mesh.frustumCulled = true;
  return mesh;
}
