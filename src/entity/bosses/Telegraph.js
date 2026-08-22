/**
 * Ground telegraph for boss slams: one additive terrain-conforming disc drawn as a thin soft-edged rim
 * (~2.5 % of the radius) with sparse rotating ticks, a whisper of fill whose thin leading edge creeps out to
 * the rim during the wind-up, then a short flash on impact. Sits 0.1 m up so it lies on arena paving.
 * Shared by every boss; one draw call, no per-frame allocations.
 */
import * as THREE from 'three';
import { PALETTE } from '../../render/Style.js';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
  uniform float uT; uniform float uTime; uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv;
  void main() {
    vec2 q = (vUv - 0.5) * 2.0; float r = length(q); float ang = atan(q.y, q.x);
    // thin soft rim (~2.5 % of the radius) with a faint wider halo so it reads as light on the stone, not paint
    float rim = smoothstep(0.022, 0.0, abs(r - 0.965)) * 0.8 + smoothstep(0.045, 0.0, abs(r - 0.965)) * 0.1;
    // eight short rotating ticks just inside the rim
    float ticks = step(0.86, fract(ang * 8.0 / 6.2832 - uTime * 0.12));
    float dash = smoothstep(0.01, 0.0, abs(r - 0.92)) * ticks * 0.35;
    float t = clamp(uT, 0.0, 1.0);
    // the fill that creeps out to the rim during the wind-up stays a whisper; its leading edge is a thin line
    float fill = smoothstep(t, t - 0.3, r) * (0.012 + 0.03 * t);
    float edge = smoothstep(0.022, 0.0, abs(r - t)) * (0.18 + 0.35 * t) * step(0.02, t) * smoothstep(1.0, 0.78, t); // merges into the rim on impact
    float flash = max(0.0, uT - 1.0) * 1.6 * smoothstep(1.0, 0.3, r);
    float a = (rim + dash + fill + edge + flash) * smoothstep(1.0, 0.985, r);
    gl_FragColor = vec4(uColor * a * uAlpha, 1.0);
  }`;

const SEG = 14;

export class TelegraphRing {
  constructor(game) {
    this.game = game;
    const geo = new THREE.PlaneGeometry(2, 2, SEG, SEG); geo.rotateX(-Math.PI / 2);
    this.uniforms = { uT: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 1.0 }, uColor: { value: new THREE.Color(PALETTE.ember) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false; this.mesh.renderOrder = 6; this.mesh.frustumCulled = false;
    this.radius = 1;
    game.scene.add(this.mesh);
  }

  /** Show at (x,z) with a world radius; conforms to the terrain. alpha scales the whole disc (keep it subtle). */
  show(x, z, radius, colorHex, alpha = 1) {
    this.radius = radius;
    this.mesh.scale.set(radius, 1, radius);
    if (colorHex !== undefined) this.uniforms.uColor.value.setHex(colorHex);
    this.uniforms.uAlpha.value = alpha;
    this.uniforms.uT.value = 0;
    this.place(x, z);
    this.mesh.visible = true;
  }

  /** Move the disc (re-conforms the 15x15 grid to the heightfield; cheap). */
  place(x, z) {
    const T = this.game.terrain, m = this.mesh, r = this.radius;
    const y = T.getHeight(x, z) + 0.1;
    m.position.set(x, y, z);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      pos.setY(i, T.getHeight(x + lx * r, z + lz * r) + 0.1 - y);
    }
    pos.needsUpdate = true;
  }

  /** 0..1 = fill progress during the wind-up; > 1 = impact flash. */
  set(t) { this.uniforms.uT.value = t; }
  hide() { this.mesh.visible = false; }
  update(dt) { this.uniforms.uTime.value += dt; }
}
