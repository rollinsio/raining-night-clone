/**
 * Atmosphere: art-directed night sky + fog + lights.
 *  - Sky dome shader: a real gradient (luminous pale horizon band -> deep navy zenith), a large soft moon
 *    that is the brightest thing in the frame (HDR disc + three-stage halo), sparse stars, a few thin
 *    streaky cloud banks low in the sky (3-octave value noise, sky pixels only).
 *  - Fog: the built-in three fog chunks are overridden once (at import) with a height + distance model
 *    whose colour matches the sky horizon and brightens toward the moon. Applies to every material with
 *    fog enabled (terrain, props, structures, characters) — no per-material plumbing.
 *  - Lights: cool hemisphere + low ambient + cool moon directional with one 2048 shadow map that re-centres
 *    on the player, a shadowless cool fill from behind the vista camera so camera-facing facets step apart,
 *    and one roaming warm point light (nearest grace / campfire).
 *  - Light shafts across the misty valley (render/Shafts.js) and distant warm glows (render/Glows.js);
 *    the moon's screen position is handed to Postfx each frame for its soft halo.
 */
import * as THREE from 'three';
import { PALETTE } from './Style.js';
import { Glows } from './Glows.js';
import { Shafts } from './Shafts.js';
import { LightPool } from './Lights.js';

// Fixed art-direction constants shared by the sky shader and the fog override (Terrain bakes its facet steps
// toward the same moon; exported so nothing else hardcodes the vector).
export const MOON_DIR = new THREE.Vector3(-0.5, 0.30, -0.6).normalize();
const FILL_DIR = new THREE.Vector3(0.42, 0.40, 0.82).normalize(); // behind / left of the vista camera, low
const FOG_BASE = -4.0;      // height (m) where the mist layer is densest
const FOG_FALLOFF = 0.085;  // 1/m — mist density halves every ~8 m of altitude (ridge crests stay clear)
const FOG_MIST = 0.016;     // mist density at FOG_BASE
const FOG_DIST = 0.00245;   // distance haze coefficient (1/m); scene.fog.density carries it
// haze = 1 - exp(-(d * FOG_DIST)^2): ~6 % at 100 m, 21 % at 200 m, 41 % at 300 m, 70 % at 450 m, 88 % at 600 m —
// four readable value bands (near ridge / mid ridge / far wall / backdrop) rather than one smooth wash.

/** Moonlight shafts laid across the misty valley below the overlook (foot positions; heads run toward the moon). */
const SHAFTS = [
  { x: 74, z: 186, len: 150, width: 9, strength: 0.11 },
  { x: 56, z: 186, len: 170, width: 12, strength: 0.15 },
  { x: 26, z: 179, len: 190, width: 16, strength: 0.13 },
  { x: -16, z: 171, len: 210, width: 20, strength: 0.1 },
];

/** GLSL: replace three's fog with height + distance fog tinted like the horizon sky. */
function installFogOverride() {
  if (THREE.ShaderChunk.__nightFog) return;
  THREE.ShaderChunk.__nightFog = true;
  const md = `vec3(${MOON_DIR.x.toFixed(4)}, ${MOON_DIR.y.toFixed(4)}, ${MOON_DIR.z.toFixed(4)})`;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world position from the view-space position (rigid view matrix: inverse rotation = transpose)
  vFogWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  {
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    vec3 fogDir = fogRay / max( fogDist, 0.001 );
    // mist pooled in valleys: analytic integral of an exponential density along the ray
    float fb = ${FOG_FALLOFF.toFixed(4)};
    float camH = cameraPosition.y - ( ${FOG_BASE.toFixed(2)} );
    float ry = fogDir.y;
    float fi = abs( ry ) < 0.001 ? fogDist : ( 1.0 - exp( - fogDist * ry * fb ) ) / ( ry * fb );
    float mist = 1.0 - exp( - ${FOG_MIST.toFixed(4)} * exp( - camH * fb ) * fi );
    #ifdef FOG_EXP2
      float haze = 1.0 - exp( - pow( fogDist * fogDensity, 2.0 ) );
    #else
      float haze = smoothstep( fogNear, fogFar, fogDist );
    #endif
    float fogFactor = clamp( 1.0 - ( 1.0 - mist ) * ( 1.0 - haze ), 0.0, 1.0 );
    // colour follows the sky gradient in the view direction (pale band at the horizon, darker + bluer with
    // elevation) so fogged silhouettes dissolve into the sky behind them; brighter toward the moon (in-scatter),
    // slightly darker when looking down into mist
    float toMoon = max( dot( fogDir, ${md} ), 0.0 );
    float skyT = pow( smoothstep( -0.04, 0.55, ry ), 0.78 );
    float band = exp( - max( ry, 0.0 ) * 7.5 ) * smoothstep( -0.12, 0.0, ry );
    vec3 fc = fogColor * ( mix( 1.0, 0.3, skyT ) + band * ( 0.22 + 0.3 * toMoon ) ) * mix( vec3( 1.0 ), vec3( 0.86, 0.92, 1.08 ), skyT );
    fc *= ( 1.0 + 0.35 * pow( toMoon, 5.0 ) + 0.06 * toMoon ) * ( 1.0 - 0.2 * clamp( - ry * 3.0, 0.0, 1.0 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fc, fogFactor );
  }
#endif`;
}
installFogOverride();

const SKY_VERT = `
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }`;
const SKY_FRAG = `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uCloud; uniform vec3 uMoonDir; uniform vec3 uMoonColor; uniform float uTime; uniform float uTint;
  varying vec3 vDir;
  float hash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    float m = dot(d, uMoonDir);
    // gradient: luminous pale horizon band rising into a deep zenith (three stops: band / mid / zenith)
    float t = pow(smoothstep(-0.04, 0.55, h), 0.78);
    vec3 col = mix(uHorizon, uZenith, t);
    // the band itself: brightest right at the horizon, warmer and brighter on the moon's side
    float band = exp(-max(h, 0.0) * 7.5) * smoothstep(-0.2, 0.0, h);
    col += uHorizon * band * (0.28 + 0.3 * max(m, 0.0));
    // faint violet cast low in the sky (night-ring tint, grows on later days)
    col += vec3(0.05, 0.02, 0.09) * uTint * exp(-abs(h - 0.10) * 7.0);
    // moon: large soft disc (HDR, so it tone-maps to white and blooms) + a three-stage halo that also lights the haze
    float disc = smoothstep(0.99745, 0.99800, m);
    float limb = 0.62 + 0.38 * smoothstep(0.99745, 0.9999, m);
    vec3 md = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), mu = cross(md, uMoonDir);
    vec2 mp = vec2(dot(d, md), dot(d, mu)) * 120.0;
    float maria = 0.78 + 0.22 * smoothstep(0.3, 0.72, vnoise(mp * 0.9 + 2.0) * 0.6 + vnoise(mp * 2.1) * 0.4);
    disc *= limb * maria;
    float glow = pow(max(m, 0.0), 700.0) * 0.5 + pow(max(m, 0.0), 90.0) * 0.26 + pow(max(m, 0.0), 12.0) * 0.09 + pow(max(m, 0.0), 3.0) * 0.025;
    // streaky clouds: planar projection, stretched horizontally, 3 octaves; thin banks low in the sky only
    vec2 cp = d.xz / (abs(h) + 0.22);
    cp = vec2(cp.x * 0.55 - cp.y * 0.2, cp.y * 0.9 + cp.x * 0.3) * 1.7 + vec2(uTime * 0.004, 0.0);
    float cn = vnoise(cp) * 0.55 + vnoise(cp * 2.1 + 3.7) * 0.3 + vnoise(cp * 4.3 + 9.1) * 0.15;
    float cloud = smoothstep(0.56, 0.8, cn) * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.22, 0.5, h));
    vec3 cloudCol = mix(uCloud, uHorizon * 1.25, pow(max(m, 0.0), 10.0) * 0.85 + 0.2);
    col = mix(col, cloudCol, cloud * 0.6);
    col += uMoonColor * (disc * 1.2 + glow * (1.0 - cloud * 0.5));
    // stars: hashed cells, sparse, varied brightness, hidden by cloud / haze / the moon's halo
    vec3 cell = floor(d * 90.0);
    float r = hash3(cell);
    vec3 sp = (cell + 0.5 + (vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) - 0.5) * 0.7) / 90.0;
    float sd = length(d - normalize(sp));
    float tw = 0.75 + 0.25 * sin(uTime * 1.2 + r * 40.0);
    float big = step(0.996, r);
    float star = (1.0 - smoothstep(0.0, 0.0016 + big * 0.0014, sd)) * step(0.984, r) * tw;
    star *= smoothstep(0.08, 0.4, h) * (1.0 - cloud) * (1.0 - smoothstep(0.95, 0.998, m));
    col += vec3(0.78, 0.82, 0.9) * star * (0.2 + big * 0.4 + (r - 0.984) * 12.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Atmosphere {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.moonDir = MOON_DIR.clone();

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(PALETTE.skyZenith) }, uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) }, uCloud: { value: new THREE.Color(PALETTE.cloud) },
        uMoonDir: { value: this.moonDir.clone() }, uMoonColor: { value: new THREE.Color(PALETTE.moon) }, uTime: { value: 0 }, uTint: { value: 0.4 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -100;
    scene.add(this.sky);

    // fog (density is the linear haze coefficient of the override above)
    this.fogColor = new THREE.Color(PALETTE.fog);
    scene.fog = new THREE.FogExp2(this.fogColor.getHex(), FOG_DIST);
    game.renderer.setClearColor(this.fogColor, 1);

    // lights
    this.hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.05);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(PALETTE.ambient, 0.22);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(PALETTE.moonLight, 2.5);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.left = -42; s.camera.right = 42; s.camera.top = 42; s.camera.bottom = -42;
    s.camera.near = 1; s.camera.far = 320;
    // normalBias is in metres: the old 0.6 lifted every receiver 0.6 m off the ground, which detached shadows from
    // the feet and swallowed anything under ~0.6 m tall (grass, stones, a kneeling figure) — keep it at a few cm
    s.bias = -0.0008; s.normalBias = 0.05; s.radius = 2.5;
    scene.add(this.sun); scene.add(this.sun.target);
    this.shadowAnchor = new THREE.Vector3(1e9, 0, 1e9);
    // shadowless cool fill from behind the vista camera: camera-facing facets of rocks / ground step apart instead
    // of sharing one backlit value (the moon sits ahead of the overlook camera)
    this.fill = new THREE.DirectionalLight(PALETTE.fill, 0.55);
    this.fill.position.copy(FILL_DIR).multiplyScalar(200);
    this.fill.target.position.set(0, 0, 0);
    scene.add(this.fill); scene.add(this.fill.target);

    // warm point-light pool: the six nearest graces / fires light terrain, props AND characters (real N·L, real
    // falloff); the nearest grace's slot carries a small shadow map. Sources are rebuilt whenever the world's fire
    // list changes (boss arenas register their braziers at runtime).
    this.lights = new LightPool(scene, { count: 6, shadowSlot: true });
    this.warm = this.lights.lights[this.lights.lights.length - 1]; // legacy handle (setWarmLight)
    this._fireCount = -1;

    // distant warm glows for every fire and grace (one additive draw call)
    this.glows = null;
    const L = game.limveld, T = game.terrain;
    if (L) {
      const list = [];
      for (const f of L.fires) list.push({ x: f.x, y: f.y + 0.6, z: f.z, color: PALETTE.torch, size: 4.0 });
      for (const g of L.graces) list.push({ x: g.x, y: T.getHeight(g.x, g.z) + 0.9, z: g.z, color: PALETTE.grace, size: 2.6 });
      if (list.length) { this.glows = new Glows(list); scene.add(this.glows.mesh); }
    }

    // moonlight shafts over the misty valley (one additive draw call)
    this.shafts = null;
    if (T) {
      const beams = SHAFTS.map((b) => ({ x: b.x, y: T.getHeight(b.x, b.z) - 6, z: b.z, dir: this.moonDir, len: b.len, width: b.width, strength: b.strength }));
      this.shafts = new Shafts(beams, PALETTE.shaft);
      scene.add(this.shafts.mesh);
    }

    this.time = 0;
    this._tmp = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /** Re-centre shadow camera when the anchor moved more than 2 m; sky follows the camera; moon -> post halo. */
  update(dt) {
    this.time += dt;
    this.skyMat.uniforms.uTime.value = this.time;
    if (this.glows) this.glows.update(dt);
    if (this.shafts) this.shafts.update(dt);
    const cam = this.game.camera;
    this.sky.position.copy(cam.position);
    const p = this.game.player ? this.game.player.pos : cam.position;
    // warm lights: refresh the source list when fires were added, then hand the pool to the nearest sources
    const L = this.game.limveld;
    if (L && L.fires.length !== this._fireCount) this._rebuildSources();
    this.lights.update(dt, p);
    if (this.shadowAnchor.distanceToSquared(p) > 4) {
      this.shadowAnchor.copy(p);
      this.sun.target.position.set(p.x, p.y, p.z);
      this.sun.position.copy(this.moonDir).multiplyScalar(150).add(p);
      this.sun.target.updateMatrixWorld();
    }
    // moon screen position for the post halo (fades out as the moon leaves the frame or goes behind the camera)
    const pf = this.game.postfx;
    if (pf && pf.setMoon) {
      const v = this._tmp.copy(this.moonDir).multiplyScalar(900).add(cam.position).project(cam);
      const inFront = v.z < 1 ? 1 : 0;
      const k = inFront * (1 - Math.min(1, Math.max(0, (Math.max(Math.abs(v.x), Math.abs(v.y)) - 1.0) / 0.5)));
      pf.setMoon(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, k);
    }
  }

  /** Gather every grace and flame in the world as a pool source (graces pulse gold, fires flicker orange). */
  _rebuildSources() {
    const L = this.game.limveld, T = this.game.terrain, list = [];
    if (!L) return;
    this._fireCount = L.fires.length;
    L.graces.forEach((g, i) => list.push({ x: g.x, y: T.getHeight(g.x, g.z) + 2.4, z: g.z, color: PALETTE.grace, intensity: 14, range: 24, decay: 1.6, kind: 'grace', seed: i * 0.37 + 0.1 }));
    L.fires.forEach((f, i) => list.push({ x: f.x, y: f.y + 0.35, z: f.z, color: PALETTE.torch, intensity: 24, range: 22, decay: 1.7, kind: 'fire', seed: i * 0.61 + 0.3 }));
    this.lights.setSources(list);
  }

  /** Legacy single warm light: overrides the pool's last slot (intensity 0 clears it). Graces / fires no longer need this. */
  setWarmLight(pos, intensity, colorHex) {
    if (!intensity || !pos) { this.lights.override = null; return; }
    const o = this.lights.override || (this.lights.override = { pos: new THREE.Vector3(), intensity: 0, color: PALETTE.grace });
    o.pos.copy(pos); o.intensity = intensity; if (colorHex !== undefined) o.color = colorHex;
  }

  /** Day tint: later days get a colder, more violet sky and fog. t01 = progress through the day. */
  setTime(day, t01) {
    const k = Math.min(1, (day - 1) / 2) * 0.6 + t01 * 0.25;
    this.skyMat.uniforms.uTint.value = 0.4 + k * 0.8;
    const horizon = this.skyMat.uniforms.uHorizon.value;
    horizon.setHex(PALETTE.skyHorizon).lerp(this._c.setHex(0x4a4660), k * 0.45);
    this.fogColor.setHex(PALETTE.fog).lerp(this._c.setHex(0x3e3a52), k * 0.45);
    this.game.scene.fog.color.copy(this.fogColor);
    this.game.renderer.setClearColor(this.fogColor, 1);
  }

  /** Detail tier (a ui/Settings.js DETAIL entry, or a bare tier id): sun shadow on/off and map size. */
  setQuality(q) {
    const d = typeof q === 'string' ? { shadows: q !== 'low', shadowMap: q === 'high' ? 2048 : 1024 } : q;
    this.sun.castShadow = d.shadows;
    this.sun.shadow.mapSize.set(d.shadowMap, d.shadowMap);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }
}
