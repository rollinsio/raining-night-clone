/**
 * Shared helpers for boss rigs: geometry shorthands, seeded vertex roughing, curved horn / chain
 * builders, tuft rings (manes), the character rim + fill lighting hook (cool moon rim and sky fill so
 * a dark hulk stays readable against dark ground), the three-material set every boss uses
 * ([flat body, smooth head, emissive ember for the telegraph heat]), an armour set with a real specular
 * plate material and a warm torch rim keyed to a world direction, and a soft contact-shadow disc.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../render/Style.js';

export const TAU = Math.PI * 2;
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

export const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
export const rot = (g, rx, ry, rz) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); return g; };
export const scaled = (g, x, y, z) => { g.scale(x, y, z); return g; };
export const cyl = (rt, rb, h, seg = 7, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const sph = (r, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cone = (r, h, seg = 5) => new THREE.ConeGeometry(r, h, seg);

/** Attack phase helper shared by boss clips: p = 0 windup / 1 active / 2 recover / 3 done, k = 0..1 within it. */
const PH = { p: 0, k: 0 };
export function phase(t, ctx) {
  if (t < ctx.windup) { PH.p = 0; PH.k = t / ctx.windup; return PH; }
  t -= ctx.windup; if (t < ctx.active) { PH.p = 1; PH.k = t / ctx.active; return PH; }
  t -= ctx.active; if (t < ctx.recover) { PH.p = 2; PH.k = t / ctx.recover; return PH; }
  PH.p = 3; PH.k = 1; return PH;
}

const hash3 = (x, y, z, s) => { const t = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453; return t - Math.floor(t); };

/** Displace vertices by a position hash (welded seams move together) for chipped stone / knotted hide. */
export function rough(g, amount, seed = 1) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x * 50) / 50, l = Math.round(y * 50) / 50, m = Math.round(z * 50) / 50;
    p.setXYZ(i, x + (hash3(k, l, m, seed) - 0.5) * amount, y + (hash3(k, l, m, seed + 1) - 0.5) * amount, z + (hash3(k, l, m, seed + 2) - 0.5) * amount);
  }
  g.computeVertexNormals();
  return g;
}

const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
const nonIdx = (g) => (g.index ? g.toNonIndexed() : g);

/** Chain of tapered cylinders; segs: [{ len, r0, r1, dir(Vector3 unit) }] laid head to tail from the origin. */
export function chainGeo(segs, radial = 5) {
  const parts = []; _p.set(0, 0, 0);
  for (const s of segs) {
    const g = new THREE.CylinderGeometry(s.r1, s.r0, s.len, radial);
    g.translate(0, s.len / 2, 0);
    _q.setFromUnitVectors(_up, s.dir);
    g.applyQuaternion(_q);
    g.translate(_p.x, _p.y, _p.z);
    parts.push(nonIdx(g));
    _p.addScaledVector(s.dir, s.len);
  }
  const m = mergeGeometries(parts, false);
  m.computeVertexNormals();
  return m;
}

/**
 * Curved horn from the origin: starts along `dir`, each segment bends `bendZ` rad about Z (outward → up → inward)
 * and `bendX` rad about X (tips come forward). n segments of `segLen`, base radius r0 to a sharp tip.
 */
export function hornGeo(dir, n, segLen, r0, bendZ, bendX, radial = 5) {
  const d = dir.clone().normalize(), segs = [];
  const az = new THREE.Vector3(0, 0, 1), ax = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const r0i = r0 * (1 - i / n), r1i = r0 * (1 - (i + 1) / n) * 0.85 + 0.012;
    segs.push({ len: segLen * (1 - i * 0.06), r0: r0i, r1: r1i, dir: d.clone() });
    d.applyAxisAngle(az, bendZ).applyAxisAngle(ax, bendX).normalize();
  }
  return chainGeo(segs, radial);
}

/** Ring of cones around (cx,cy,cz) at radius r, leaning outward by `tilt` rad and up; n tufts of `len` (+ jitter). */
export function tuftRing(cx, cy, cz, r, n, len, rBase, tilt, seed = 0, squashY = 1) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + seed, j = 0.75 + 0.5 * hash3(i, seed, 0, 3);
    const g = new THREE.ConeGeometry(rBase * (0.8 + 0.4 * j), len * j, 4);
    g.translate(0, len * j * 0.5, 0);
    g.rotateX(-tilt); g.rotateY(a);
    g.translate(cx + Math.sin(a) * r, cy + Math.cos(a) * r * (squashY - 1) * 0.5, cz + Math.cos(a) * r);
    parts.push(nonIdx(g));
  }
  const m = mergeGeometries(parts, false);
  m.computeVertexNormals();
  return m;
}

// ------------------------------------------------------------------------------------------- lighting hook

const RIM = { value: 1.15 };
const RIM_COLOR = { value: new THREE.Color(PALETTE.moonLight) };
const FILL = { value: 0.36 };
const FILL_COLOR = { value: new THREE.Color(PALETTE.hemiSky) };
const WRAP = { value: 0.3 };

/** Cool fresnel rim + sky fill + key-light wrap folded into indirect diffuse (matte). Same idea as the hero's. */
export function rimHook(sh) {
  if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return;
  sh.uniforms.uRim = RIM; sh.uniforms.uRimColor = RIM_COLOR; sh.uniforms.uFill = FILL; sh.uniforms.uFillColor = FILL_COLOR; sh.uniforms.uWrap = WRAP;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uRim; uniform vec3 uRimColor; uniform float uFill; uniform vec3 uFillColor; uniform float uWrap;')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 2.6 );
        vec3 fill = uFill * uFillColor;
        #if NUM_DIR_LIGHTS > 0
          float wr = dot( normal, directionalLights[ 0 ].direction ) * 0.5 + 0.5;
          fill += uWrap * wr * wr * directionalLights[ 0 ].color;
        #endif
        reflectedLight.indirectDiffuse += fill * diffuseColor.rgb;
        reflectedLight.indirectDiffuse += uRim * rimF * uRimColor * ( 0.35 + 0.65 * diffuseColor.rgb );
      }`);
}

/** [flat body, smooth head, ember (emissive telegraph material; vertex colour = cold crack colour)]. */
export function bossMats() {
  const body = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: false, roughness: 0.8, metalness: 0.0 });
  const ember = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.0, emissive: 0x000000 });
  body.onBeforeCompile = rimHook; head.onBeforeCompile = rimHook;
  return [body, head, ember];
}

// ------------------------------------------------------------------------------------------- armour set

const LIT_PARS = 'uniform float uRim; uniform vec3 uRimColor; uniform float uFill; uniform vec3 uFillColor; uniform float uWrap; uniform vec3 uWarmDir; uniform vec3 uWarmColor; uniform float uWarm;';
const LIT_BODY = `#include <lights_fragment_end>
      {
        vec3 V = normalize( vViewPosition );
        float rimF = pow( 1.0 - saturate( dot( normal, V ) ), 2.4 );
        vec3 fill = uFill * uFillColor;
        float moonW = 1.0;
        #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[ 0 ].direction;
          float wr = dot( normal, L ) * 0.5 + 0.5;
          fill += uWrap * wr * wr * directionalLights[ 0 ].color;
          // the cool rim is a moon backlight: strongest on edges whose normals lean toward the moon (the top and
          // moon-side outline of a backlit figure), fading to a whisper on the far side so it carves, not outlines
          moonW = saturate( dot( normal, L ) * 0.85 + 0.5 );
        #endif
        // warm torch rim: fresnel edge weighted toward the brazier side, plus a soft warm fill on that side
        vec3 wd = normalize( ( viewMatrix * vec4( uWarmDir, 0.0 ) ).xyz );
        float warmF = saturate( dot( normal, wd ) * 0.8 + 0.2 );
        reflectedLight.indirectDiffuse += fill * diffuseColor.rgb;
        reflectedLight.indirectDiffuse += uRim * rimF * ( 0.12 + 0.88 * moonW ) * uRimColor * ( 0.4 + 0.6 * diffuseColor.rgb );
        reflectedLight.indirectDiffuse += uWarm * ( rimF * 0.8 + 0.07 * warmF ) * warmF * uWarmColor * ( 0.3 + 0.7 * diffuseColor.rgb );
      }`;

/** Per-material cool rim + sky fill + key wrap + warm torch rim (uniforms in material.userData.u). */
function litHook(sh) {
  if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return;
  Object.assign(sh.uniforms, this.userData.u);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + LIT_PARS)
    .replace('#include <lights_fragment_end>', LIT_BODY);
}

/**
 * Armour material set: [cloth / leather / wood (matte flat), hide (matte smooth), ember (telegraph heat),
 * plate (flat facets with a real specular lobe so moon and brazier highlights land per facet)]. Every
 * material carries its own rim / fill / warm-rim uniforms; `warm` sets the torch rim strength and
 * `setWarmDir(v)` on the returned set points the warm rim (world direction from the boss to the fire).
 */
export function armourMats({ warm = 0.9 } = {}) {
  const warmDir = new THREE.Vector3(0, 0.3, 1).normalize();
  const uni = (rim, fill, wrap, w) => ({
    uRim: { value: rim }, uRimColor: { value: new THREE.Color(PALETTE.moonLight) }, uFill: { value: fill }, uFillColor: { value: new THREE.Color(PALETTE.hemiSky) },
    uWrap: { value: wrap }, uWarmDir: { value: warmDir }, uWarmColor: { value: new THREE.Color(PALETTE.torch) }, uWarm: { value: w },
  });
  const mk = (opts, u, key) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, ...opts });
    m.userData.u = u; m.onBeforeCompile = litHook; m.customProgramCacheKey = () => key;
    return m;
  };
  const cloth = mk({ flatShading: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }, uni(1.2, 0.3, 0.28, warm * 0.5), 'bossCloth');
  // near-black hide: the moon rim is what draws its outline, so it carries the strongest rim of the set
  const hide = mk({ flatShading: false, roughness: 0.82, metalness: 0 }, uni(1.9, 0.32, 0.3, warm * 0.8), 'bossHide');
  const ember = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.45, metalness: 0.0, emissive: 0x000000 });
  // plate: low metalness (no environment map, so a metallic surface only reflects black) with a tight specular
  // lobe — the pale diffuse carries the value, the lobe adds moon / brazier glints per facet
  const plate = mk({ flatShading: true, roughness: 0.46, metalness: 0.22, side: THREE.DoubleSide }, uni(0.75, 0.5, 0.5, warm * 1.4), 'bossPlate');
  const set = [cloth, hide, ember, plate];
  set.setWarmDir = (v) => { warmDir.copy(v).normalize(); };
  return set;
}

// ------------------------------------------------------------------------------------------- contact shadow

const BLOB_GEO = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })();
const BLOB_MAT = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0.62 } }]),
  vertexShader: `varying vec2 vUv; varying float vDepth;
    void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uOpacity; uniform float fogDensity; varying vec2 vUv; varying float vDepth;
    void main() {
      vec2 q = (vUv - 0.5) * 2.0; float d = length(q);
      float a = smoothstep(1.0, 0.15, d); a *= a;
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
      gl_FragColor = vec4(0.02, 0.02, 0.03, a * uOpacity * (1.0 - fogF));
    }`,
  transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

/** Soft dark disc under a boss (diameter in metres). */
export function contactShadow(diameter) {
  const m = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
  m.scale.set(diameter, 1, diameter * 0.9); m.position.y = 0.03; m.renderOrder = 1;
  return m;
}
