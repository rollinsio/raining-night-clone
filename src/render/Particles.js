/**
 * GPU-animated billboard particles. CPU work only at spawn time (ring buffer writes);
 * motion, fade and homing are evaluated in the vertex shader from uTime.
 * modes: 'burst' (ballistic, gravity), 'home' (drift then fly to uTarget), 'orbit' (looping orbit around center).
 */
import * as THREE from 'three';

const VERT = `
  attribute vec3 center; attribute vec3 vel; attribute vec4 info; attribute vec3 pcolor; attribute vec2 corner;
  uniform float uTime; uniform vec3 uGravity; uniform vec3 uTarget; uniform float uMode; uniform float uPixel;
  varying float vA; varying vec3 vC; varying vec2 vUv;
  void main(){
    float birth = info.x; float life = max(info.y, 0.001);
    float age = uTime - birth;
    if (uMode > 1.5) { age = mod(age, life); }
    float k = clamp(age / life, 0.0, 1.0);
    float alive = step(0.0, age) * step(age, life);
    vec3 p;
    if (uMode < 0.5) {
      p = center + vel * age + 0.5 * uGravity * age * age;
    } else if (uMode < 1.5) {
      vec3 drift = center + vel * age * (1.0 - k);
      float h = k * k * (3.0 - 2.0 * k);
      p = mix(drift, uTarget, h * h);
    } else {
      float a = info.w * 6.2831853 + age * vel.z;
      float rr = vel.x * (0.6 + 0.4 * sin(age * 0.7 + info.w * 7.0));
      p = center + vec3(cos(a) * rr, vel.y * k + 0.15 * sin(age * 2.0 + info.w * 9.0), sin(a) * rr);
    }
    float fade = (uMode > 1.5) ? sin(k * 3.14159) : (1.0 - k * k);
    float size = info.z * (uMode < 0.5 ? (1.0 - k * 0.5) : 1.0) * alive;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += corner * size;
    gl_Position = projectionMatrix * mv;
    vA = fade * alive; vC = pcolor; vUv = corner;
  }`;
const FRAG = `
  varying float vA; varying vec3 vC; varying vec2 vUv;
  void main(){
    float d = length(vUv);
    float a = smoothstep(1.0, 0.25, d) * vA;
    gl_FragColor = vec4(vC * a, a);
  }`;

export class ParticleSystem {
  /** @param {{max:number, mode?:'burst'|'home'|'orbit', gravity?:number, blending?:number}} opts */
  constructor(opts = {}) {
    const max = this.max = opts.max || 256;
    this.mode = opts.mode || 'burst';
    this.cursor = 0;
    const geo = this.geo = new THREE.BufferGeometry();
    this.center = new Float32Array(max * 4 * 3);
    this.vel = new Float32Array(max * 4 * 3);
    this.info = new Float32Array(max * 4 * 4);
    this.color = new Float32Array(max * 4 * 3);
    const corner = new Float32Array(max * 4 * 2);
    const index = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      const b = i * 4;
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    geo.setAttribute('center', new THREE.BufferAttribute(this.center, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('vel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('info', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3)); // required by three, unused
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const modeIdx = { burst: 0, home: 1, orbit: 2 }[this.mode];
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uGravity: { value: new THREE.Vector3(0, opts.gravity ?? -9, 0) }, uTarget: { value: new THREE.Vector3() }, uMode: { value: modeIdx }, uPixel: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.dirty = false;
    this.time = 0;
  }

  /** Emit one particle. */
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, seed = Math.random()) {
    const i = this.cursor; this.cursor = (i + 1) % this.max;
    for (let v = 0; v < 4; v++) {
      const o3 = (i * 4 + v) * 3, o4 = (i * 4 + v) * 4;
      this.center[o3] = x; this.center[o3 + 1] = y; this.center[o3 + 2] = z;
      this.vel[o3] = vx; this.vel[o3 + 1] = vy; this.vel[o3 + 2] = vz;
      this.color[o3] = r; this.color[o3 + 1] = g; this.color[o3 + 2] = b;
      this.info[o4] = this.time; this.info[o4 + 1] = life; this.info[o4 + 2] = size; this.info[o4 + 3] = seed;
    }
    this.dirty = true;
  }

  /** Advance the shader clock and push any pending spawns to the GPU. */
  update(time) {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    if (this.dirty) {
      this.geo.attributes.center.needsUpdate = true;
      this.geo.attributes.vel.needsUpdate = true;
      this.geo.attributes.info.needsUpdate = true;
      this.geo.attributes.pcolor.needsUpdate = true;
      this.dirty = false;
    }
  }

  setTarget(v) { this.material.uniforms.uTarget.value.copy(v); }
}
