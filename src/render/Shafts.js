/**
 * Light shafts: a few long, soft beams of moonlit haze laid across the valley so the sky's light visibly
 * reaches the ground (Ashen's diagonal shafts). Each beam is a quad that billboards around its own axis
 * (foot -> head toward the moon), fading across its width and at both ends. One additive draw call, no fog,
 * depth-tested (near hills and trees occlude it), a slow breathing flicker in the vertex shader.
 */
import * as THREE from 'three';

const VERT = `
  attribute vec3 head; attribute vec2 corner; attribute float width; attribute float strength; attribute float seed;
  uniform float uTime;
  varying vec2 vUv; varying float vStr;
  void main(){
    vec3 a = position, b = head;
    vec3 p = mix(a, b, corner.y);
    vec3 axis = normalize(b - a);
    vec3 side = normalize(cross(axis, cameraPosition - p));
    float w = width * (0.55 + 0.65 * corner.y); // beams widen toward the sky end
    p += side * corner.x * w;
    vUv = corner;
    vStr = strength * (0.82 + 0.18 * sin(uTime * 0.31 + seed * 11.0));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FRAG = `
  uniform vec3 uColor;
  varying vec2 vUv; varying float vStr;
  void main(){
    float x = 1.0 - vUv.x * vUv.x;
    float y = vUv.y;
    float a = x * x * x * smoothstep(0.0, 0.4, y) * (1.0 - smoothstep(0.62, 1.0, y));
    gl_FragColor = vec4(uColor * a * vStr, 1.0);
  }`;

export class Shafts {
  /** beams: [{x, y, z (foot), dir (unit Vector3 toward the light), len, width, strength}] */
  constructor(beams, colorHex) {
    const n = beams.length;
    const pos = new Float32Array(n * 12), head = new Float32Array(n * 12), corner = new Float32Array(n * 8);
    const width = new Float32Array(n * 4), strength = new Float32Array(n * 4), seed = new Float32Array(n * 4);
    const idx = new Uint16Array(n * 6);
    const corners = [-1, 0, 1, 0, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      const b = beams[i];
      const hx = b.x + b.dir.x * b.len, hy = b.y + b.dir.y * b.len, hz = b.z + b.dir.z * b.len;
      for (let k = 0; k < 4; k++) {
        pos.set([b.x, b.y, b.z], (i * 4 + k) * 3);
        head.set([hx, hy, hz], (i * 4 + k) * 3);
        corner.set([corners[k * 2], corners[k * 2 + 1]], (i * 4 + k) * 2);
        width[i * 4 + k] = b.width; strength[i * 4 + k] = b.strength; seed[i * 4 + k] = (i * 0.618) % 1;
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('head', new THREE.BufferAttribute(head, 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('width', new THREE.BufferAttribute(width, 1));
    geo.setAttribute('strength', new THREE.BufferAttribute(strength, 1));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(colorHex) } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  update(dt) { this.uniforms.uTime.value += dt; }
}
