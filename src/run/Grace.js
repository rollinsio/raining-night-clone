/**
 * Sites of Grace: a golden branching sword-hilt planted in the ground, a tall soft beam of light
 * (streaky, cylindrical-billboard shader), a base flare, a terrain-conforming warm ground glow,
 * two layers of rising gold motes, the roaming warm light (nearest grace or campfire), and rest /
 * level-up / respawn. Also hosts the LootSystem so the "sacred + loot" layer lives in run/.
 *
 * Draw calls: hilts (1) + ground glow (1) + beams & flares (1) + motes (1). No per-frame allocations.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../render/Style.js';
import { ParticleSystem } from '../render/Particles.js';
import { LootSystem } from './Loot.js';

const _v = new THREE.Vector3();
const _c = new THREE.Color();

// ------------------------------------------------------------------------------------ light pillars

const PILLAR_VERT = `
  attribute vec3 center; attribute vec2 corner; attribute vec3 pcolor; attribute vec4 dims; // halfWidth, height, seed, kind
  varying vec2 vUv; varying vec3 vColor; varying vec4 vDims;
  void main(){
    vUv = corner; vColor = pcolor; vDims = dims;
    if (dims.w < 0.5) {
      // cylindrical billboard: quad stands on its base, turns about Y to face the camera
      vec3 toCam = cameraPosition - center; toCam.y = 0.0;
      float l = max(length(toCam), 1e-4);
      vec3 right = vec3(toCam.z, 0.0, -toCam.x) / l;
      vec3 p = center + right * (corner.x * dims.x) + vec3(0.0, (corner.y * 0.5 + 0.5) * dims.y, 0.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    } else {
      // spherical billboard flare
      vec4 mv = modelViewMatrix * vec4(center, 1.0);
      mv.xy += corner * dims.x;
      gl_Position = projectionMatrix * mv;
    }
  }`;
const PILLAR_FRAG = `
  uniform float uTime;
  varying vec2 vUv; varying vec3 vColor; varying vec4 vDims;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 1.7) + 0.125 * vnoise(p * 4.01 + 3.1); }
  void main(){
    float seed = vDims.z, t = uTime;
    if (vDims.w > 0.5) {
      float d = length(vUv);
      float a = pow(max(0.0, 1.0 - d), 2.4) * (0.86 + 0.14 * sin(t * 3.1 + seed * 20.0));
      gl_FragColor = vec4(vColor * a, 1.0); return;
    }
    float x = vUv.x, y = vUv.y * 0.5 + 0.5;
    // vertically elongated streaks flowing upward (two scales); the axis sways more with height
    float n1 = fbm(vec2(x * 5.5 + seed * 13.0, y * 2.0 - t * 0.5));
    float n2 = fbm(vec2(x * 9.0 - seed * 7.0, y * 6.5 - t * 1.6));
    // flame-like width: narrow base, widest about a third up, tapering top
    float w = 0.42 + 0.78 * sin(3.14159 * pow(y, 0.65));
    float ax = abs(x + (n1 - 0.44) * 0.6 * y) / w;
    float core = exp(-ax * ax * 12.0);
    float halo = exp(-ax * ax * 2.0);
    // brightest band about a third of the way up (the foot stays gold instead of blowing out)
    float env = smoothstep(0.0, 0.3, y) * pow(1.0 - y, 1.8) + 0.25 * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.0, 0.3, y));
    // thin bright filaments (ridged n1) over a softer body
    float streak = 0.3 + 1.3 * pow(min(n1 * 1.15, 1.0), 2.0) + 0.45 * n2;
    // the column breaks into separate wisps toward the top
    float wisp = smoothstep(0.15, 0.55, n2 + 0.5 * (1.0 - y) + 0.15);
    float a = (core * 0.65 + halo * 0.27 * (0.4 + n1)) * env * streak * wisp;
    a *= smoothstep(1.3, 0.5, ax + (n2 - 0.44) * 1.0);
    a *= 1.0 - smoothstep(0.7, 1.0, abs(x));
    a *= 0.93 + 0.07 * sin(t * 6.3 + seed * 30.0);
    vec3 col = mix(vColor, vec3(1.0, 0.95, 0.72), clamp(core * 0.25, 0.0, 1.0));
    gl_FragColor = vec4(col * a, 1.0);
  }`;

/** A batch of additive light pillars / flares drawn in one call. kind 0 = pillar, 1 = flare. */
export class LightPillars {
  constructor(max) {
    this.max = max; this.count = 0;
    const geo = this.geo = new THREE.BufferGeometry();
    this.center = new Float32Array(max * 4 * 3);
    this.color = new Float32Array(max * 4 * 3);
    this.dims = new Float32Array(max * 4 * 4);
    const corner = new Float32Array(max * 4 * 2), index = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) { corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8); const b = i * 4; index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6); }
    geo.setAttribute('center', new THREE.BufferAttribute(this.center, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('dims', new THREE.BufferAttribute(this.dims, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PILLAR_VERT, fragmentShader: PILLAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 9;
  }

  /** Add a pillar (kind 0: halfWidth, height) or flare (kind 1: radius). Returns its index. */
  add(x, y, z, { halfWidth = 1, height = 6, color = 0xffffff, seed = 0, kind = 0, intensity = 1 }) {
    const i = this.count++;
    _c.setHex(color);
    for (let v = 0; v < 4; v++) {
      const o3 = (i * 4 + v) * 3, o4 = (i * 4 + v) * 4;
      this.center[o3] = x; this.center[o3 + 1] = y; this.center[o3 + 2] = z;
      this.color[o3] = _c.r * intensity; this.color[o3 + 1] = _c.g * intensity; this.color[o3 + 2] = _c.b * intensity;
      this.dims[o4] = halfWidth; this.dims[o4 + 1] = height; this.dims[o4 + 2] = seed; this.dims[o4 + 3] = kind;
    }
    this.geo.setDrawRange(0, this.count * 6);
    this.geo.attributes.center.needsUpdate = true; this.geo.attributes.pcolor.needsUpdate = true; this.geo.attributes.dims.needsUpdate = true;
    return i;
  }

  /** Recolour one entry (rarity re-rolls). */
  setColor(i, hex, intensity = 1) {
    _c.setHex(hex);
    for (let v = 0; v < 4; v++) { const o3 = (i * 4 + v) * 3; this.color[o3] = _c.r * intensity; this.color[o3 + 1] = _c.g * intensity; this.color[o3 + 2] = _c.b * intensity; }
    this.geo.attributes.pcolor.needsUpdate = true;
  }

  /** Resize one entry (halfWidth / radius and height; 0,0 hides it). */
  setSize(i, halfWidth, height) {
    for (let v = 0; v < 4; v++) { const o4 = (i * 4 + v) * 4; this.dims[o4] = halfWidth; this.dims[o4 + 1] = height; }
    this.geo.attributes.dims.needsUpdate = true;
  }

  update(time) { this.material.uniforms.uTime.value = time; }
}

// ------------------------------------------------------------------------------------ ground glow

/**
 * Terrain-conforming additive glow disc with a real radial falloff (several rings, so the gradient is
 * not a single linear fan). falloff(r01) returns the brightness multiplier at normalised radius.
 */
export function softDisc(terrain, x, z, radius, hex, strength, falloff = (r) => Math.pow(1 - r, 2.6)) {
  const rings = [0.1, 0.22, 0.38, 0.56, 0.76, 1.0], segs = 24;
  const pos = [], col = [];
  _c.setHex(hex);
  const vert = (r01, a) => {
    const px = x + Math.cos(a) * r01 * radius, pz = z + Math.sin(a) * r01 * radius;
    pos.push(px, terrain.getHeight(px, pz) + 0.05, pz);
    const k = strength * falloff(Math.min(1, r01));
    col.push(_c.r * k, _c.g * k, _c.b * k);
  };
  let prev = 0;
  for (const r of rings) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      if (prev === 0) { vert(0, 0); vert(r, a1); vert(r, a0); }
      else { vert(prev, a0); vert(r, a1); vert(r, a0); vert(prev, a0); vert(prev, a1); vert(r, a1); }
    }
    prev = r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Shared additive vertex-colour material for ground glows. */
export function glowMaterial() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
}

// ------------------------------------------------------------------------------------ the hilt

/** Golden grace hilt: tapered blade (part buried), two branching guard arms with twigs, wrapped grip, knotted pommel. */
function graceHilt() {
  const parts = [];
  const add = (g) => parts.push(g.toNonIndexed());
  const blade = new THREE.CylinderGeometry(0.034, 0.006, 1.3, 4, 1); blade.scale(1.7, 1, 0.5); blade.translate(0, 0.24, 0); add(blade);
  const guardY = 0.9;
  for (const side of [1, -1]) {
    const pts = [new THREE.Vector3(0, guardY - 0.02, 0), new THREE.Vector3(side * 0.11, guardY, 0.01), new THREE.Vector3(side * 0.22, guardY + 0.05, 0.03), new THREE.Vector3(side * 0.3, guardY + 0.16, 0.05), new THREE.Vector3(side * 0.33, guardY + 0.3, 0.06)];
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.018, 4, false); add(tube);
    const twigA = new THREE.ConeGeometry(0.011, 0.16, 4); twigA.translate(0, 0.08, 0); twigA.rotateZ(-side * 0.9); twigA.translate(side * 0.2, guardY + 0.06, 0.03); add(twigA);
    const twigB = new THREE.ConeGeometry(0.009, 0.12, 4); twigB.translate(0, 0.06, 0); twigB.rotateZ(side * 0.35); twigB.rotateX(0.5); twigB.translate(side * 0.3, guardY + 0.2, 0.05); add(twigB);
  }
  const grip = new THREE.CylinderGeometry(0.026, 0.03, 0.32, 6); grip.translate(0, guardY + 0.16, 0); add(grip);
  for (const y of [0.06, 0.15, 0.24]) { const ring = new THREE.TorusGeometry(0.034, 0.007, 4, 8); ring.rotateX(Math.PI / 2); ring.translate(0, guardY + y, 0); add(ring); }
  const pommel = new THREE.SphereGeometry(0.046, 6, 5); pommel.translate(0, guardY + 0.36, 0); add(pommel);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const spike = new THREE.ConeGeometry(0.011, 0.12, 4); spike.translate(0, 0.06, 0); spike.rotateX(0.55); spike.rotateY(a); spike.translate(0, guardY + 0.38, 0); add(spike);
  }
  const g = mergeGeometries(parts, false);
  g.rotateZ(0.07); g.rotateX(-0.05);
  return g;
}

/** Golden roots creeping out from the hilt along the ground (terrain-conforming, tapering in two steps). */
function graceRoots(terrain, x, z, rng) {
  const parts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3), L = rng.range(0.7, 1.5), ph = rng.float() * 6.28, wob = rng.range(0.05, 0.12);
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const s = k / 5, r = 0.05 + s * L, w = Math.sin(s * Math.PI * 2 + ph) * wob * s;
      const px = x + Math.cos(a) * r - Math.sin(a) * w, pz = z + Math.sin(a) * r + Math.cos(a) * w;
      pts.push(new THREE.Vector3(px, terrain.getHeight(px, pz) + 0.025 + (1 - s) * 0.06, pz));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const thick = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve.getPoints(8).slice(0, 5)), 6, 0.024, 4, false);
    const thin = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve.getPoints(8).slice(4)), 6, 0.013, 4, false);
    parts.push(thick.toNonIndexed(), thin.toNonIndexed());
  }
  return mergeGeometries(parts, false);
}

// ------------------------------------------------------------------------------------ the system

export class GraceSystem {
  constructor(game, limveld) {
    this.game = game; this.limveld = limveld;
    const T = game.terrain;
    this.sites = limveld.graces.map((g, i) => { const y = T.getHeight(g.x, g.z); return { x: g.x, z: g.z, y, name: g.name, index: i, pos: new THREE.Vector3(g.x, y, g.z) }; });
    this.group = new THREE.Group(); this.group.name = 'graces';
    const rng = game.rng.fork(77);

    // hilts (one merged mesh)
    const hilt = graceHilt(), hilts = [];
    hilt.scale(1.15, 1.15, 1.15);
    for (const s of this.sites) { const g = hilt.clone(); g.translate(s.x, s.y - 0.02, s.z); hilts.push(g, graceRoots(T, s.x, s.z, rng)); }
    // bronze-gold hilt that reads as a silhouette inside the beam rather than a second light source
    this.swordMat = new THREE.MeshStandardMaterial({ color: PALETTE.gold, emissive: PALETTE.grace, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.4, flatShading: true });
    this.swordMesh = new THREE.Mesh(mergeGeometries(hilts, false), this.swordMat);
    this.swordMesh.castShadow = true;

    // ground glow: wide warm wash + tight hot centre
    const discs = [];
    for (const s of this.sites) {
      discs.push(softDisc(T, s.x, s.z, 5.2, PALETTE.graceGlow, 0.16, (r) => Math.pow(1 - r, 2.2)));
      discs.push(softDisc(T, s.x, s.z, 1.5, PALETTE.grace, 0.3, (r) => Math.pow(1 - r, 1.6)));
    }
    this.discMesh = new THREE.Mesh(mergeGeometries(discs, false), glowMaterial());
    this.discMesh.renderOrder = 2;

    // per site: wide beam, bright inner column, base flare, and a big faint haze glow that warms the mist
    this.pillars = new LightPillars(this.sites.length * 4);
    for (const s of this.sites) {
      this.pillars.add(s.x, s.y + 0.15, s.z, { halfWidth: 1.5, height: 7.6, color: PALETTE.graceGlow, seed: rng.float(), kind: 0, intensity: 1.0 });
      this.pillars.add(s.x, s.y + 0.15, s.z, { halfWidth: 0.6, height: 3.4, color: PALETTE.grace, seed: rng.float(), kind: 0, intensity: 0.22 });
      this.pillars.add(s.x, s.y + 0.8, s.z, { halfWidth: 1.5, color: PALETTE.grace, seed: rng.float(), kind: 1, intensity: 0.12 });
      this.pillars.add(s.x, s.y + 2.4, s.z, { halfWidth: 4.2, color: PALETTE.grace, seed: rng.float(), kind: 1, intensity: 0.09 });
    }

    // motes: tight rising spiral + wide slow drift near the ground + a dissipating crown where the beam breaks up
    const SPIRAL = 72, DRIFT = 34, CROWN = 44, PER = SPIRAL + DRIFT + CROWN;
    this.particles = new ParticleSystem({ max: this.sites.length * PER, mode: 'orbit' });
    _c.setHex(PALETTE.graceGlow);
    for (const s of this.sites) {
      for (let i = 0; i < SPIRAL; i++) {
        const r = 0.08 + Math.pow(rng.float(), 1.6) * 0.9, rise = 2.5 + rng.float() * 6.0, life = 2.6 + rng.float() * 3.4;
        this.particles.spawn(s.x, s.y + 0.05 + rng.float() * 0.8, s.z, r, rise, 0.8 + rng.float() * 2.2, life, 0.022 + rng.float() * 0.04, _c.r * 2.2, _c.g * 1.9, _c.b * 1.2, rng.float());
      }
      for (let i = 0; i < DRIFT; i++) {
        const r = 0.9 + rng.float() * 2.6, rise = 0.4 + rng.float() * 2.6, life = 5 + rng.float() * 5;
        this.particles.spawn(s.x, s.y + 0.1 + rng.float() * 1.2, s.z, r, rise, 0.15 + rng.float() * 0.5, life, 0.028 + rng.float() * 0.035, _c.r * 1.1, _c.g * 0.85, _c.b * 0.45, rng.float());
      }
      for (let i = 0; i < CROWN; i++) {
        const r = 0.3 + rng.float() * 1.9, rise = 0.8 + rng.float() * 2.4, life = 2 + rng.float() * 3;
        this.particles.spawn(s.x, s.y + 3.0 + rng.float() * 3.2, s.z, r, rise, 0.3 + rng.float() * 1.2, life, 0.02 + rng.float() * 0.035, _c.r * 1.9, _c.g * 1.6, _c.b * 0.9, rng.float());
      }
    }
    for (let i = 0; i < this.particles.max; i++) { const birth = -rng.float() * 10; for (let v = 0; v < 4; v++) this.particles.info[(i * 4 + v) * 4] = birth; }

    this.group.add(this.swordMesh, this.discMesh, this.pillars.mesh, this.particles.mesh);
    game.scene.add(this.group);
    this.current = null; this.pulse = 0; this.promptShown = false;

    // loot lives alongside the graces (chests at POIs, weapon pickups, rarity glows)
    this.loot = new LootSystem(game, limveld);
    game.loot = this.loot;
  }

  /** Nearest site to p; also leaves the distance in this.nearestDist (no per-frame allocation). */
  nearest(p) {
    let best = null, bd = Infinity;
    for (const s of this.sites) { const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2; if (d < bd) { bd = d; best = s; } }
    this.nearestDist = Math.sqrt(bd);
    return best;
  }

  update(dt) {
    const game = this.game, p = game.player;
    this.pulse += dt;
    this.swordMat.emissiveIntensity = 0.85 + 0.2 * Math.sin(this.pulse * 2.3);
    this.particles.update(game.time);
    this.pillars.update(game.time);
    this.loot.update(dt);
    if (!p) return;
    const site = this.nearest(p.pos), dist = this.nearestDist;
    // the warm light itself now comes from Atmosphere's point-light pool (every grace and fire within reach, the
    // nearest grace with a shadow map); nothing to park here any more
    this.current = dist < 3.2 ? site : null;
    const canRest = this.current && p.alive && p.state !== 'rest' && p.state !== 'attack' && p.state !== 'roll';
    if (canRest) {
      game.hud.setPrompt('Rest at Site of Grace', 'E'); this.promptShown = true;
      if (game.input.wasPressed('interact')) this.rest(this.current);
    } else if (this.promptShown) { game.hud.setPrompt(null); this.promptShown = false; }
  }

  rest(site) {
    const game = this.game, p = game.player;
    p.rest(site);
    p.yaw = Math.atan2(site.x - p.pos.x, site.z - p.pos.z);
    game.hud.setPrompt(null); this.promptShown = false;
    game.events.emit('grace:rest', site);
    game.menus.openLevelUp();
  }
}
