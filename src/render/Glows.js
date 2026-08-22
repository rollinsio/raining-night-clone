/**
 * Distant warm glows: one additive billboard per fire / grace so warm accents read across the vista
 * (the single dynamic point light only covers the nearest one). One merged mesh, one draw call,
 * billboarding + flicker done in the vertex shader; depth-tested so hills occlude them.
 */
import * as THREE from 'three';

const VERT = `
  attribute vec2 corner; attribute vec3 glowColor; attribute float size; attribute float seed;
  uniform float uTime;
  varying vec2 vUv; varying vec3 vColor; varying float vFade;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float flick = 1.0 + 0.10 * sin(uTime * 7.3 + seed * 17.0) + 0.06 * sin(uTime * 13.1 + seed * 5.0);
    float dist = -mv.z;
    // grow a little with distance so far glows stay a soft blob instead of a pixel
    float s = size * flick * (1.0 + dist * 0.0025);
    mv.xy += corner * s;
    vUv = corner; vColor = glowColor;
    // distant accents only: up close the real point lights do the work and a 4 m additive disc would blow out a quadrant
    vFade = mix(1.0, 0.55, clamp(dist / 500.0, 0.0, 1.0)) * smoothstep(7.0, 26.0, dist);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  varying vec2 vUv; varying vec3 vColor; varying float vFade;
  void main(){
    float r = length(vUv);
    float a = pow(max(1.0 - r, 0.0), 2.6);
    float core = pow(max(1.0 - r * 2.2, 0.0), 2.0);
    gl_FragColor = vec4(vColor * (a * 0.9 + core * 1.6) * vFade, 1.0);
  }`;

export class Glows {
  /** glows: [{x, y, z, color (hex), size (m)}] */
  constructor(glows) {
    const n = glows.length;
    const pos = new Float32Array(n * 12), corner = new Float32Array(n * 8), col = new Float32Array(n * 12), size = new Float32Array(n * 4), seed = new Float32Array(n * 4);
    const idx = new Uint16Array(n * 6);
    const c = new THREE.Color();
    const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      const g = glows[i];
      c.setHex(g.color);
      for (let k = 0; k < 4; k++) {
        pos.set([g.x, g.y, g.z], (i * 4 + k) * 3);
        corner.set([corners[k * 2], corners[k * 2 + 1]], (i * 4 + k) * 2);
        col.set([c.r, c.g, c.b], (i * 4 + k) * 3);
        size[i * 4 + k] = g.size; seed[i * 4 + k] = (i * 0.618) % 1;
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('glowColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  update(dt) { this.uniforms.uTime.value += dt; }
}
