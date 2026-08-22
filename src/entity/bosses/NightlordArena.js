/**
 * Nightlord arena: the night-3 realm the Nightlord drags the expedition into. While active it overrides the
 * world atmosphere (near-black zenith, a magenta-red horizon glow, pale ash haze, the moon swallowed to a
 * ghost, ash-bounce lighting), lays a pale wind-rippled ash plain over the terrain (one terrain-conforming
 * polar decal with ripples, drifts, cinders and a scorched ring round the beast that cracks open with ember
 * light in phase 2), raises a hot horizon glow behind the far ridge (additive billboard, occluded by hills
 * and trees), plants dead trees as silhouettes against it, strews cinder rocks, and drifts ash flakes
 * through the air. Everything eases in on enter() and back out on exit(); setPhase(2) heats the glow.
 * Built once per arena and cached. Draw calls: floor, stone, glow, motes (4).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat, mixHex } from '../../render/Style.js';
import { ParticleSystem } from '../../render/Particles.js';
import { TAU, sm, lerp, rough, chainGeo } from './BossRig.js';

const _c = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3();
const MOON = new THREE.Vector3(-0.5, 0.3, -0.6).normalize(); // Atmosphere MOON_DIR
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const hex = (c) => c.getHex();
const dim = (h, k) => hex(_c.setHex(h).multiplyScalar(k));

/** The realm's look (palette-derived; no new hex outside this table). */
const LOOK = {
  zenith: 0x05060c, horizon: hex(mixHex(PALETTE.sparkBlood, PALETTE.ringGlow, 0.28).multiplyScalar(0.62)), horizonHot: hex(mixHex(PALETTE.sparkBlood, PALETTE.ember, 0.35).multiplyScalar(0.85)),
  cloud: hex(mixHex(PALETTE.cloud, PALETTE.ringGlow, 0.3).multiplyScalar(0.55)), tint: 1.3,
  fog: hex(mixHex(PALETTE.terrain.snow, PALETTE.fog, 0.35)), fogDensity: 0.0042,
  hemiSky: hex(mixHex(PALETTE.hemiSky, PALETTE.ringGlow, 0.3).multiplyScalar(0.62)), hemiGround: hex(mixHex(PALETTE.terrain.snow, PALETTE.stone, 0.4).multiplyScalar(0.9)),
  moonLight: hex(mixHex(PALETTE.moonLight, PALETTE.mist, 0.4)), fill: hex(mixHex(PALETTE.fill, PALETTE.ringGlow, 0.25)),
  ash: hex(mixHex(PALETTE.terrain.snow, PALETTE.stoneLight, 0.35).multiplyScalar(0.92)), ashDark: PALETTE.terrain.rockDark,
  scorch: hex(mixHex(PALETTE.terrain.mud, PALETTE.stoneDark, 0.5)), ember: PALETTE.ember, glowA: hex(mixHex(PALETTE.sparkBlood, PALETTE.ringGlow, 0.2)), glowB: hex(mixHex(PALETTE.ember, PALETTE.grace, 0.4)),
  tree: dim(PALETTE.treeDark, 0.55), treeLight: dim(PALETTE.tree, 0.6), rock: dim(PALETTE.rockPropDark, 0.6), rockLight: dim(PALETTE.rockProp, 0.55),
};

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

// ------------------------------------------------------------------------------------------------- ash floor

const ASH_PARS = /* glsl */`
uniform vec3 uCenter; uniform float uRadius; uniform vec3 uAsh; uniform vec3 uAshDark; uniform vec3 uScorch; uniform vec3 uEmber; uniform vec2 uWind; uniform float uHeat; uniform float uK;
varying vec3 vWPos;
float gRipC; vec2 gAcross;
float ah21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float avn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ah21(i), ah21(i + vec2(1.0, 0.0)), f.x), mix(ah21(i + vec2(0.0, 1.0)), ah21(i + vec2(1.0, 1.0)), f.x), f.y); }
float afbm(vec2 p){ return avn(p) * 0.5 + avn(p * 2.07 + 1.3) * 0.25 + avn(p * 4.3 + 2.9) * 0.125 + avn(p * 8.9 + 4.1) * 0.0625; }`;

const ASH_COLOR = /* glsl */`
{
  vec2 wp = vWPos.xz; vec2 rel = wp - uCenter.xz; float rr = length(rel); float nrm = rr / uRadius;
  float m1 = afbm(wp * 0.035 + 3.0), m2 = afbm(wp * 0.22 + 11.0), m3 = avn(wp * 2.6 + 5.0);
  vec3 alb = uAsh * (0.82 + 0.34 * m1) * (0.9 + 0.2 * m2) * (0.95 + 0.1 * m3);
  // wind ripples: ridges across the wind, phase broken by low-frequency noise (shaded through the normal too)
  vec2 acrossDir = vec2(-uWind.y, uWind.x);
  float along = dot(wp, uWind), across = dot(wp, acrossDir);
  float ph = across * 2.4 + afbm(wp * 0.3 + 7.0) * 10.0 + along * 0.12;
  float rip = sin(ph);
  gRipC = cos(ph) * smoothstep(0.25, 0.6, afbm(wp * 0.12 + 9.0)); gAcross = acrossDir;
  alb *= 0.95 + 0.06 * rip;
  // pale drifts: long streaks along the wind
  float drift = smoothstep(0.52, 0.78, afbm(vec2(along * 0.07, across * 0.55) + 19.0));
  alb = mix(alb, uAsh * 1.14, drift * 0.5);
  // cinders and clinker: sparse dark specks, denser toward the beast
  float cin = step(0.958 - 0.03 * smoothstep(30.0, 8.0, rr), avn(wp * 5.5 + 31.0)) * (0.55 + 0.45 * avn(wp * 37.0));
  alb = mix(alb, uAshDark * 0.55, cin);
  // scorched, trampled ground round the beast; cracks glow with ember light as it burns (phase 2)
  float sc = smoothstep(19.0, 4.0, rr) * smoothstep(0.3, 0.72, afbm(wp * 0.42 + 23.0));
  alb = mix(alb, uScorch, sc * 0.78);
  float crack = smoothstep(0.03, 0.0, abs(afbm(wp * 1.1 + 41.0) - 0.5)) * sc;
  totalEmissiveRadiance += uEmber * crack * uHeat * 0.35;
  diffuseColor.rgb *= alb;
  float edge = 1.0 - smoothstep(0.76, 1.0, nrm + (afbm(wp * 0.08 + 3.0) - 0.5) * 0.35);
  diffuseColor.a *= edge * uK;
}`;

const ASH_NORMAL = /* glsl */`
{
  vec3 t = vec3(gAcross.x, 0.0, gAcross.y) * gRipC * 0.22;
  normal = normalize(normal + (viewMatrix * vec4(t, 0.0)).xyz);
}`;

function ashHook(sh) {
  Object.assign(sh.uniforms, this.userData.u);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + ASH_PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + ASH_COLOR)
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + ASH_NORMAL);
}

/**
 * Terrain-conforming ash plain: a polar grid (ring spacing grows from 0.7 m at the beast to 6 m at the rim)
 * so it follows the ground closely where the camera stands and still reaches the haze. Transparent decal
 * that draws first, no depth write; receives the moon shadow.
 */
function ashFloor(terrain, cx, cz, R) {
  const radii = []; let r = 0, step = 0.7;
  while (r < R) { radii.push(r); r += step; step = Math.min(6, step * 1.08); }
  radii.push(R);
  const NA = 96, pos = [], nor = [];
  for (let i = 0; i < radii.length; i++) for (let j = 0; j < NA; j++) {
    const a = (j / NA) * TAU, x = cx + Math.sin(a) * radii[i], z = cz + Math.cos(a) * radii[i];
    pos.push(x, terrain.getHeight(x, z) + 0.04, z);
    terrain.getNormal(x, z, _v); nor.push(_v.x, _v.y, _v.z);
  }
  const index = [];
  for (let i = 0; i < radii.length - 1; i++) for (let j = 0; j < NA; j++) {
    const j1 = (j + 1) % NA, a = i * NA + j, b = i * NA + j1, c = (i + 1) * NA + j, d = (i + 1) * NA + j1;
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const col = (h, k = 1) => ({ value: new THREE.Color(h).multiplyScalar(k) });
  mat.userData.u = {
    uCenter: { value: new THREE.Vector3(cx, 0, cz) }, uRadius: { value: R }, uAsh: col(LOOK.ash), uAshDark: col(LOOK.ashDark), uScorch: col(LOOK.scorch), uEmber: col(LOOK.ember),
    uWind: { value: new THREE.Vector2(0.83, 0.56) }, uHeat: { value: 0 }, uK: { value: 1 },
  };
  mat.onBeforeCompile = ashHook;
  mat.customProgramCacheKey = () => 'nightlordAsh';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.renderOrder = -2; mesh.frustumCulled = true;
  return mesh;
}

// ------------------------------------------------------------------------------------------------- dressing

/** Dead tree: bent tapered trunk, a few bare limbs with snapped twigs. Origin at the foot. */
function deadTree(rng, h, seed) {
  const parts = [];
  const dir = new THREE.Vector3(rng.range(-0.1, 0.1), 1, rng.range(-0.1, 0.1)).normalize();
  const ax = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize();
  const n = 4, segs = [], r0 = 0.03 * h;
  for (let i = 0; i < n; i++) {
    segs.push({ len: h / n, r0: r0 * (1 - i / n * 0.75), r1: r0 * (1 - (i + 1) / n * 0.75) + 0.02, dir: dir.clone() });
    dir.applyAxisAngle(ax, rng.range(-0.14, 0.14)).normalize();
  }
  const trunk = rough(chainGeo(segs, 6), 0.06, seed); parts.push(colorize(trunk, LOOK.tree, LOOK.treeLight, 0, h * 1.2, 0.9 + rng.float() * 0.2));
  // limbs from the upper half, reaching out and up, each with a snapped twig
  const nb = 3 + rng.int(0, 3);
  let p = new THREE.Vector3(), d = new THREE.Vector3();
  for (let b = 0; b < nb; b++) {
    const k = 0.42 + 0.5 * (b / nb) + rng.range(0, 0.08);
    p.set(0, 0, 0); d.copy(segs[0].dir);
    for (let i = 0; i < n; i++) { const f = Math.min(1, Math.max(0, k * n - i)); p.addScaledVector(segs[i].dir, segs[i].len * f); }
    const a = rng.float() * TAU, up = rng.range(0.35, 0.9), L = h * rng.range(0.22, 0.4);
    const bd = new THREE.Vector3(Math.sin(a), up, Math.cos(a)).normalize();
    const bd2 = bd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(-0.5, 0.5)).setY(bd.y + rng.range(0.1, 0.5)).normalize();
    const limb = chainGeo([{ len: L * 0.55, r0: r0 * 0.42, r1: r0 * 0.26, dir: bd }, { len: L * 0.45, r0: r0 * 0.26, r1: 0.02, dir: bd2 }], 5);
    limb.translate(p.x, p.y, p.z); parts.push(colorize(limb, LOOK.tree, LOOK.treeLight, 0, h * 1.2, 0.85));
    const tw = chainGeo([{ len: L * 0.3, r0: r0 * 0.16, r1: 0.012, dir: bd.clone().setY(bd.y + 1.2).normalize() }], 4);
    const tp = p.clone().addScaledVector(bd, L * 0.4); tw.translate(tp.x, tp.y, tp.z); parts.push(colorize(tw, LOOK.tree, LOOK.treeLight, 0, h * 1.2, 0.8));
  }
  return mergeGeometries(parts, false);
}

/** Cinder rock: dark clinker, half sunk in the ash. */
function cinder(rng, r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 0); rough(g, r * 0.5, seed);
  g.rotateY(rng.float() * TAU); g.scale(1.3, 0.75, 1); g.translate(0, r * 0.35, 0);
  return colorize(g, LOOK.rock, LOOK.rockLight, -r * 0.3, r * 1.1, 0.9 + rng.float() * 0.2);
}

const GLOW_VERT = `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLOW_FRAG = `
  uniform vec3 uA; uniform vec3 uB; uniform float uK; varying vec2 vUv;
  void main(){
    float d = length(vUv * vec2(1.0, 1.7));
    float a = pow(max(1.0 - d, 0.0), 1.7);
    float core = pow(max(1.0 - length(vUv * vec2(1.9, 3.4)), 0.0), 2.0);
    float low = smoothstep(-1.0, -0.15, vUv.y);
    gl_FragColor = vec4((uA * a * 0.95 + uB * core * 1.1) * low * uK, 1.0);
  }`;

const cache = new Map();

export class NightlordArena {
  /** Realm dressing for an arena ({x, z, r, name}); built once and kept (hidden until enter()). */
  static get(game, arena) {
    let a = cache.get(arena.name);
    if (!a || a.game !== game) { a = new NightlordArena(game, arena); cache.set(arena.name, a); }
    return a;
  }

  constructor(game, arena) {
    this.game = game; this.arena = arena;
    const T = game.terrain, rng = game.rng.fork(1300 + hash(arena.name));
    const cx = arena.x, cz = arena.z;
    this.cx = cx; this.cz = cz;
    /** Horizontal bearing of the horizon glow: toward the moon, so the beast is backlit against it. */
    this.bearing = Math.atan2(MOON.x, MOON.z);
    const stone = [];
    const put = (g, x, z, ry, sink = 0) => { g.rotateY(ry); g.translate(x, T.getHeight(x, z) - sink, z); stone.push(g); };
    // dead trees: a thin wood against the glow, a few strays elsewhere
    for (let i = 0; i < 14; i++) {
      const a = this.bearing + rng.range(-0.95, 0.95), r = rng.range(48, 150), h = rng.range(9, 17);
      put(deadTree(rng, h, 50 + i * 7), cx + Math.sin(a) * r, cz + Math.cos(a) * r, rng.float() * TAU, 0.3);
    }
    for (let i = 0; i < 7; i++) {
      const a = this.bearing + Math.PI + rng.range(-1.6, 1.6), r = rng.range(40, 130), h = rng.range(7, 14);
      put(deadTree(rng, h, 150 + i * 7), cx + Math.sin(a) * r, cz + Math.cos(a) * r, rng.float() * TAU, 0.3);
    }
    // cinder rocks, kept off the fight line
    for (let i = 0; i < 22; i++) {
      const a = rng.float() * TAU, r = rng.range(11, 60), rr = rng.range(0.35, 1.5);
      const dFight = Math.abs(Math.atan2(Math.sin(a - this.bearing), Math.cos(a - this.bearing)));
      if (dFight < 0.3 && r < 30) continue;
      put(cinder(rng, rr, 300 + i), cx + Math.sin(a) * r, cz + Math.cos(a) * r, 0, rr * 0.2);
    }
    const group = new THREE.Group(); group.name = 'nightlordArena:' + arena.name;
    this.floor = ashFloor(T, cx, cz, 260);
    const stoneMesh = new THREE.Mesh(mergeGeometries(stone, false), vertexMat());
    stoneMesh.castShadow = true; stoneMesh.receiveShadow = true;
    // horizon glow: a hot, flattened additive billboard far out along the bearing, low behind the ridge
    const gx = cx + Math.sin(this.bearing) * 420, gz = cz + Math.cos(this.bearing) * 420;
    this.glowU = { uA: { value: new THREE.Color(LOOK.glowA) }, uB: { value: new THREE.Color(LOOK.glowB) }, uK: { value: 0 } };
    const glowMat = new THREE.ShaderMaterial({ uniforms: this.glowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat);
    this.glow.scale.set(260, 70, 1);
    this.glow.position.set(gx, T.getHeight(gx, gz) + 16, gz);
    this.glow.lookAt(cx, T.getHeight(cx, cz) + 2, cz);
    this.glow.renderOrder = 3; this.glow.frustumCulled = false;
    // drifting ash flakes: looping orbit motes, pale, denser near the ground
    this.motes = new ParticleSystem({ max: 520, mode: 'orbit' });
    const ps = this.motes;
    for (let i = 0; i < ps.max; i++) {
      const a = rng.float() * TAU, r = Math.sqrt(rng.float()) * 46, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      const hgt = 0.3 + Math.pow(rng.float(), 1.6) * 9, life = rng.range(7, 15), tone = rng.range(0.7, 1.0);
      ps.spawn(x, T.getHeight(x, z) + hgt, z, rng.range(0.3, 1.8), -rng.range(1.5, 4.5), rng.range(0.35, 1.1), life, rng.range(0.022, 0.055), 0.7 * tone, 0.7 * tone, 0.74 * tone, rng.float());
      const birth = -rng.float() * life; for (let v = 0; v < 4; v++) ps.info[(i * 4 + v) * 4] = birth;
    }
    ps.material.uniforms.uTime.value = 0;
    group.add(this.floor, stoneMesh, this.glow, ps.mesh);
    group.visible = false;
    game.scene.add(group);
    this.group = group;
    this.k = 0; this.target = 0; this.heat = 0; this.phase = 1; this.time = 0; this.active = false;
    this.saved = null;
  }

  /** Bring the realm in (eases over ~1.5 s); pushes the night ring out so the plain reads clean to the haze. */
  enter() {
    if (this.active) return;
    this.active = true; this.target = 1; this.group.visible = true;
    this._save();
    const old = this.game.scene.getObjectByName('bossArena:' + this.arena.name);
    if (old) { old.visible = false; this._hidden = old; }
    const ring = this.game.run && this.game.run.ring;
    if (ring && ring.setImmediate) ring.setImmediate({ x: this.cx, z: this.cz }, 600);
  }

  /** Fade the realm out (the atmosphere eases back to the world's night). */
  exit() { if (!this.active) return; this.active = false; this.target = 0; }

  setPhase(n) { this.phase = n; }

  /** Snapshot the world atmosphere so exit() can restore it exactly. */
  _save() {
    if (this.saved) return;
    const atm = this.game.atmosphere, u = atm.skyMat.uniforms, fog = this.game.scene.fog, pf = this.game.postfx;
    this.saved = {
      zenith: u.uZenith.value.clone(), horizon: u.uHorizon.value.clone(), cloud: u.uCloud.value.clone(), moon: u.uMoonColor.value.clone(), tint: u.uTint.value,
      fog: atm.fogColor.clone(), density: fog ? fog.density : 0,
      hemiSky: atm.hemi.color.clone(), hemiGround: atm.hemi.groundColor.clone(), hemiI: atm.hemi.intensity, ambI: atm.ambient.intensity,
      sun: atm.sun.color.clone(), sunI: atm.sun.intensity, fill: atm.fill ? atm.fill.color.clone() : null, fillI: atm.fill ? atm.fill.intensity : 0,
      pfMoon: pf && pf.vignette ? pf.vignette.uniforms.uMoonColor.value.clone() : null,
    };
  }

  /** Blend the atmosphere between the saved night and the realm by k (0..1), heat = phase-2 intensity. */
  _apply(k, heat) {
    const s = this.saved; if (!s) return;
    const atm = this.game.atmosphere, u = atm.skyMat.uniforms, fog = this.game.scene.fog, pf = this.game.postfx;
    u.uZenith.value.copy(s.zenith).lerp(_c.setHex(LOOK.zenith), k);
    u.uHorizon.value.copy(s.horizon).lerp(_c.setHex(LOOK.horizon).lerp(_c2.setHex(LOOK.horizonHot), heat * 0.6), k);
    u.uCloud.value.copy(s.cloud).lerp(_c.setHex(LOOK.cloud), k);
    u.uMoonColor.value.copy(s.moon).lerp(_c.copy(s.moon).multiplyScalar(0.12), k);
    u.uTint.value = lerp(s.tint, LOOK.tint, k);
    atm.fogColor.copy(s.fog).lerp(_c.setHex(LOOK.fog), k);
    if (fog) { fog.color.copy(atm.fogColor); fog.density = lerp(s.density, LOOK.fogDensity, k); }
    this.game.renderer.setClearColor(atm.fogColor, 1);
    atm.hemi.color.copy(s.hemiSky).lerp(_c.setHex(LOOK.hemiSky), k);
    atm.hemi.groundColor.copy(s.hemiGround).lerp(_c.setHex(LOOK.hemiGround), k);
    atm.hemi.intensity = lerp(s.hemiI, 1.0, k); atm.ambient.intensity = lerp(s.ambI, 0.3, k);
    atm.sun.color.copy(s.sun).lerp(_c.setHex(LOOK.moonLight), k); atm.sun.intensity = lerp(s.sunI, 2.3, k);
    if (atm.fill && s.fill) { atm.fill.color.copy(s.fill).lerp(_c.setHex(LOOK.fill), k); atm.fill.intensity = lerp(s.fillI, 0.8, k); }
    if (pf && pf.vignette && s.pfMoon) pf.vignette.uniforms.uMoonColor.value.copy(s.pfMoon).multiplyScalar(lerp(1, 0.15, k));
    this.glowU.uK.value = k * (0.55 + 0.6 * heat);
    this.floor.material.userData.u.uK.value = k;
    this.floor.material.userData.u.uHeat.value = heat * k;
  }

  update(dt) {
    if (this.target === 0 && this.k === 0) return;
    this.time += dt;
    const rate = 1 - Math.exp(-(this.target ? 1.4 : 0.5) * dt);
    this.k += (this.target - this.k) * rate;
    if (this.target === 0 && this.k < 0.01) this.k = 0;
    const heatT = this.phase > 1 ? 1 : 0;
    this.heat += (heatT - this.heat) * (1 - Math.exp(-1.1 * dt));
    this._apply(this.k, this.heat);
    this.motes.update(this.time);
    if (this.k === 0) { this.group.visible = false; if (this._hidden) { this._hidden.visible = true; this._hidden = null; } this.saved = null; }
  }

  /** Pose helper: jump straight to the settled realm (k = 1, phase heat settled). */
  settle() { this.k = 1; this.heat = this.phase > 1 ? 1 : 0; this.time = 3.7; this._apply(1, this.heat); this.motes.update(this.time); }
}
