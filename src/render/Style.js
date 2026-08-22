/**
 * Visual style contract: the palette every module imports, plus material factories.
 * Ashen-like: flat-shaded facets, desaturated cool night, warm amber accents.
 */
import * as THREE from 'three';

export const PALETTE = {
  // sky / atmosphere — desaturated slate night: pale misty horizon, dark zenith, cool moon
  skyZenith: 0x0a1019, skyHorizon: 0x7e8a9d, fog: 0x6b778b, mist: 0x7e8a9d, cloud: 0x3a4250, moon: 0xf3f1ea, moonLight: 0xb8c4da,
  hemiSky: 0x6c7890, hemiGround: 0x3a2d20, ambient: 0x262a32, fill: 0x8c9cb8, shaft: 0xc6d0e2,
  // accents
  grace: 0xffb347, graceGlow: 0xffd27a, torch: 0xff9a3c, ember: 0xff5a1c,
  ring: 0x4a5cff, ringGlow: 0x9a7bff, ringRain: 0xb8c8ff,
  spark: 0xffd9a0, sparkBlood: 0xb02a2a, rune: 0xffd86a,
  // terrain (vertex colours)
  terrain: {
    grass: 0x66603a, grassDark: 0x3a3a26, grassPale: 0x8e834f, straw: 0xaa955a, dirt: 0x4a3f31, path: 0x6a5a44, mud: 0x262b2e, damp: 0x30352b, sand: 0x5a5a50,
    rock: 0x4c525b, rockDark: 0x2e3238, outcrop: 0x848882, outcropDark: 0x3a3e43, peak: 0x7d848e, snow: 0xaab1ba,
  },
  water: 0x4c5866, waterGlow: 0x2a323c,
  // structures / props
  stone: 0x6e6c68, stoneDark: 0x4c4a48, stoneLight: 0x8b8982, roof: 0x3b3448, roofDark: 0x2a2534, wood: 0x4d3b2b, woodDark: 0x33271c,
  tent: 0x5c4b3b, tentDark: 0x3f332a, iron: 0x3a3d44,
  tree: 0x2e2a2c, treeDark: 0x1f1c1f, treePale: 0x554d4a, rockProp: 0x5e636b, rockPropDark: 0x383d44, boulder: 0x60656c, boulderDark: 0x22262c, crag: 0x646a72, cragDark: 0x22262c,
  grassTuft: 0xa89556, grassTuftDark: 0x3a3822, grassTuftCool: 0x646a48, grassTuftPale: 0xc4b27a, grave: 0x6c6e74, monolith: 0x3f434a, monolithDark: 0x26282d,
  // characters
  skin: 0xcdb59a, skinDark: 0x8a6e58, steel: 0xa9b1bf, steelDark: 0x5a6170, leather: 0x4a3a2e, clothDark: 0x2c2a33, gold: 0xd8b25a,
  wolfFur: 0x3c3a3a, wolfFurDark: 0x26242a, wolfEye: 0xffd040,
  // UI (CSS strings)
  ui: { hp: '#8c1c1c', hpDark: '#4a0e0e', fp: '#2a4c9c', fpDark: '#142548', stamina: '#3c8c3c', staminaDark: '#1d4a1d', gold: '#d8b25a', text: '#d8d4c8', dim: '#8a8577', frame: '#0a0a0d', danger: '#c9302c' },
};

/** Nightfarer colour schemes: primary cloth, secondary cloth, accent, head (skin/hood/helm). */
export const NIGHTFARER_COLORS = {
  Wylder:   { primary: 0x3a4a6a, secondary: 0x2a2f3c, accent: 0xc8a45a, head: 0xcdb59a, hood: false, helm: true },
  Guardian: { primary: 0x5a5c66, secondary: 0x3e3a3c, accent: 0x8aa0b8, head: 0xb9c2cc, hood: false, helm: true },
  Ironeye:  { primary: 0x2f3d33, secondary: 0x23231e, accent: 0x7a9a6a, head: 0xcdb59a, hood: true, helm: false },
  Raider:   { primary: 0x5a3a2e, secondary: 0x3a2a22, accent: 0xa05a3a, head: 0xc49a78, hood: false, helm: false },
  Recluse:  { primary: 0x2a2440, secondary: 0x1c1828, accent: 0x8a6aff, head: 0xd8c8c0, hood: true, helm: false },
  Executor: { primary: 0x2a2a2e, secondary: 0x5a1c1c, accent: 0xd8d0c8, head: 0xcdb59a, hood: false, helm: false },
  Duchess:  { primary: 0x2e2a3a, secondary: 0x4a3040, accent: 0xd8b25a, head: 0xd8c8c0, hood: true, helm: false },
  Revenant: { primary: 0x3a3a48, secondary: 0x2a2a32, accent: 0xa0b8d8, head: 0xe0dcd8, hood: true, helm: false },
};

const cache = new Map();

/** Flat-shaded standard material (shared, cached by key). */
export function flatMat(color, opts = {}) {
  const key = 'f' + color + JSON.stringify(opts);
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0.0, ...opts });
  cache.set(key, m);
  return m;
}

/** Vertex-coloured flat material for terrain / structures / rigs. */
export function vertexMat(opts = {}) {
  const key = 'v' + JSON.stringify(opts);
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.0, ...opts });
  cache.set(key, m);
  return m;
}

/**
 * Grass-blade material: vertex-coloured, smooth (blades carry an up-facing normal so they are lit like the
 * ground they grow from), double-sided WITHOUT three's back-face normal flip — so a blade seen from behind
 * is not a black fin and each blade needs only one winding.
 */
export function grassMat() {
  let m = cache.get('grass');
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: false, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => 'grass-noflip';
  cache.set('grass', m);
  return m;
}

/** Character materials (per-entity clones so the hit flash can tint emissive). Returns [body(flat), head(smooth)]. */
export function charMats() {
  const body = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: false, roughness: 0.8, metalness: 0.0 });
  return [body, head];
}

/** Emissive glow material (grace sword, embers, runes). */
export function emissive(color, intensity = 1.5, opts = {}) {
  const key = 'e' + color + intensity + JSON.stringify(opts);
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0.0, flatShading: true, ...opts });
  cache.set(key, m);
  return m;
}

const _c = new THREE.Color();
/** Write a hex colour (optionally scaled) into a Float32Array at index i (linear space). */
export function writeColor(arr, i, hex, mul = 1) {
  _c.setHex(hex);
  arr[i] = _c.r * mul; arr[i + 1] = _c.g * mul; arr[i + 2] = _c.b * mul;
}
/** Lerp between two hex colours, result written to out (THREE.Color). */
export function mixHex(a, b, t, out = new THREE.Color()) {
  out.setHex(a); _c.setHex(b); out.lerp(_c, t); return out;
}
