/**
 * Stylized combat particle pool: one GPU-animated quad buffer with per-particle shape
 *   0 streak  – hard-edged shard stretched along its screen-space velocity (sparks, chips)
 *   1 glow    – soft radial flash
 *   2 ring    – crisp expanding impact ring
 *   3 puff    – soft dust (use with normal blending)
 * CPU work happens only at spawn (ring-buffer writes); motion, stretch and fade run in the vertex shader.
 */
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute vec3 center; attribute vec3 vel; attribute vec4 info; attribute vec3 pcolor; attribute vec4 shape; attribute vec2 corner;
  uniform float uTime; uniform vec3 uGravity;
  varying float vA; varying vec3 vC; varying vec2 vUv; varying float vShape;
  void main(){
    float birth = info.x, life = max(info.y, 0.001), size = info.z, seed = info.w;
    float kind = shape.x, stretch = shape.y, drag = shape.z, grow = shape.w;
    float age = uTime - birth;
    float alive = step(0.0, age) * step(age, life);
    float k = clamp(age / life, 0.0, 1.0);
    // drag: velocity decays exponentially, gravity keeps pulling
    float dk = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 p = center + vel * dk + 0.5 * uGravity * age * age * (kind < 0.5 ? 1.0 : (kind > 2.5 ? 0.05 : 0.0));
    vec3 v = vel * exp(-drag * age) + uGravity * age * (kind < 0.5 ? 1.0 : 0.0);
    float fade, s;
    if (kind < 0.5)      { fade = 1.0 - k * k * k; s = size * (1.0 - 0.4 * k); }
    else if (kind < 1.5) { fade = (1.0 - k) * (1.0 - k); s = size * (1.0 + grow * k); }
    else if (kind < 2.5) { fade = 1.0 - k; s = size * (0.25 + grow * k); }
    else                 { fade = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.25, 1.0, k)); s = size * (1.0 + grow * k); }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec2 along = vec2(1.0, 0.0), across = vec2(0.0, 1.0);
    float len = s;
    if (kind < 0.5) {
      vec3 vv = (modelViewMatrix * vec4(v, 0.0)).xyz;
      float sp = length(vv.xy);
      if (sp > 1e-4) { along = vv.xy / sp; across = vec2(-along.y, along.x); }
      len = s * (1.0 + min(stretch * sp, 9.0));
    }
    mv.xy += along * corner.x * len + across * corner.y * s;
    gl_Position = projectionMatrix * mv;
    vA = fade * alive; vC = pcolor; vUv = corner; vShape = kind;
  }`;
const FRAG = /* glsl */`
  varying float vA; varying vec3 vC; varying vec2 vUv; varying float vShape;
  void main(){
    float a;
    if (vShape < 0.5) {
      float x = abs(vUv.x), y = abs(vUv.y);
      a = smoothstep(1.0, 0.35, y) * smoothstep(1.0, 0.15, x * x);
    } else if (vShape < 1.5) {
      float d = length(vUv);
      a = pow(smoothstep(1.0, 0.0, d), 2.2);
    } else if (vShape < 2.5) {
      float d = length(vUv);
      a = smoothstep(0.2, 0.04, abs(d - 0.78)) * smoothstep(1.0, 0.92, d);
    } else {
      float d = length(vUv);
      a = smoothstep(1.0, 0.15, d) * 0.5;
    }
    a *= vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vC, a);
  }`;

export class FxPool {
  /** @param {{max:number, gravity?:number, blending?:number}} opts */
  constructor(opts = {}) {
    const max = this.max = opts.max || 512;
    this.cursor = 0; this.time = 0; this.dirty = false;
    const geo = this.geo = new THREE.BufferGeometry();
    this.center = new Float32Array(max * 4 * 3);
    this.vel = new Float32Array(max * 4 * 3);
    this.info = new Float32Array(max * 4 * 4);
    this.color = new Float32Array(max * 4 * 3);
    this.shape = new Float32Array(max * 4 * 4);
    const corner = new Float32Array(max * 4 * 2), index = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      const b = i * 4; index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('center', dyn(this.center, 3));
    geo.setAttribute('vel', dyn(this.vel, 3));
    geo.setAttribute('info', dyn(this.info, 4));
    geo.setAttribute('pcolor', dyn(this.color, 3));
    geo.setAttribute('shape', dyn(this.shape, 4));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uGravity: { value: new THREE.Vector3(0, opts.gravity ?? -12, 0) } },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 11;
  }

  /** Emit one particle. kind 0..3, stretch = streak length per m/s, drag = velocity decay /s, grow = size growth over life. */
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, kind = 0, stretch = 0, drag = 0, grow = 0) {
    const i = this.cursor; this.cursor = (i + 1) % this.max;
    for (let v = 0; v < 4; v++) {
      const o3 = (i * 4 + v) * 3, o4 = (i * 4 + v) * 4;
      this.center[o3] = x; this.center[o3 + 1] = y; this.center[o3 + 2] = z;
      this.vel[o3] = vx; this.vel[o3 + 1] = vy; this.vel[o3 + 2] = vz;
      this.color[o3] = r; this.color[o3 + 1] = g; this.color[o3 + 2] = b;
      this.info[o4] = this.time; this.info[o4 + 1] = life; this.info[o4 + 2] = size; this.info[o4 + 3] = Math.random();
      this.shape[o4] = kind; this.shape[o4 + 1] = stretch; this.shape[o4 + 2] = drag; this.shape[o4 + 3] = grow;
    }
    this.dirty = true;
  }

  /** Advance the shader clock; upload pending spawns. */
  update(time) {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    if (!this.dirty) return;
    const at = this.geo.attributes;
    at.center.needsUpdate = at.vel.needsUpdate = at.info.needsUpdate = at.pcolor.needsUpdate = at.shape.needsUpdate = true;
    this.dirty = false;
  }

  /** Kill every particle (new run). */
  clear() { this.info.fill(-1e9); this.dirty = true; }
}
