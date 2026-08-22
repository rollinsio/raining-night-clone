/**
 * Weapon trail: a max-blended crescent ribbon swept between the blade base and tip. Samples are pushed while an
 * attack is in its active frames; each sample carries its birth time so fading is done on the GPU.
 * Also exposes boneToWorld() for rigid points attached to a skinned bone (works while the sim is frozen).
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _base = new THREE.Vector3(), _tip = new THREE.Vector3();

const VERT = /* glsl */`
  attribute float birth; attribute float across;
  uniform float uTime; uniform float uLife;
  varying float vAge; varying float vAcross;
  void main(){
    vAge = clamp((uTime - birth) / uLife, 0.0, 1.0);
    vAcross = across;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uColor; uniform vec3 uCore;
  varying float vAge; varying float vAcross;
  void main(){
    float life = 1.0 - vAge;
    // a translucent crescent that brightens toward the blade tip, with a crisp hot line along the tip edge;
    // the ribbon draws with MAX blending so overlapping samples (they bunch near the hand) never pile up
    float body = pow(vAcross, 1.4) * 0.42;
    float edge = smoothstep(0.84, 0.97, vAcross) * (1.0 - smoothstep(0.985, 1.0, vAcross) * 0.6);
    float a = (body + edge * 0.8) * life * (0.25 + 0.75 * life);
    vec3 c = mix(uColor, uCore, edge * life * 0.9);
    if (a < 0.004) discard;
    gl_FragColor = vec4(c * a, a);
  }`;

/** World position of a bind-pose model-space point rigidly bound to a skinned bone. */
export function boneToWorld(mesh, bone, localPoint, out) {
  const idx = mesh.skeleton.bones.indexOf(bone);
  _m.multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[idx]);
  return out.copy(localPoint).applyMatrix4(_m);
}

export class WeaponTrail {
  constructor(scene, { samples = 22, life = 0.13, color = 0xc8d8ff, core = 0xfff4e0 } = {}) {
    this.n = samples; this.head = 0; this.count = 0;
    this.owner = null; this.bone = null; this.mesh = null; this.baseLocal = null; this.tipLocal = null;
    this.idle = 1e9;
    const n = samples;
    this.pos = new Float32Array(n * 2 * 3);
    this.birth = new Float32Array(n * 2).fill(-1e9);
    const across = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { across[i * 2] = 0; across[i * 2 + 1] = 1; }
    const index = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 2;
      index.set([a, a + 1, b, a + 1, b + 1, b], i * 6);
    }
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('birth', new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('across', new THREE.BufferAttribute(across, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      // premultiplied colour, MAX equation: brightest sample wins where the ribbon overlaps itself
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uTime: { value: 0 }, uLife: { value: life }, uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(core) } },
    });
    this.ribbon = new THREE.Mesh(geo, this.material);
    this.ribbon.frustumCulled = false; this.ribbon.renderOrder = 9;
    scene.add(this.ribbon);
  }

  get busy() { return !!this.owner; }

  /** Bind to an entity's weapon: skinned mesh, hand bone and blade base / tip in bind-pose model space. */
  attach(owner, mesh, bone, baseLocal, tipLocal, colorHex) {
    this.owner = owner; this.mesh = mesh; this.bone = bone; this.baseLocal = baseLocal; this.tipLocal = tipLocal;
    if (colorHex !== undefined) this.material.uniforms.uColor.value.setHex(colorHex);
    this.idle = 0; this.count = 0;
  }

  /** Sample the current blade pose (call after the owner's matrices are up to date). */
  sample(time) {
    boneToWorld(this.mesh, this.bone, this.baseLocal, _base);
    boneToWorld(this.mesh, this.bone, this.tipLocal, _tip);
    this.pushWorld(_base, _tip, time);
  }

  /** Push a sample by world points. Samples are laid out oldest→newest so the ribbon stays contiguous. */
  pushWorld(base, tip, time) {
    const n = this.n;
    if (this.count < n) this.count++;
    else { this.pos.copyWithin(0, 6, n * 6); this.birth.copyWithin(0, 2, n * 2); }
    const i = this.count - 1, o = i * 6;
    this.pos[o] = base.x; this.pos[o + 1] = base.y; this.pos[o + 2] = base.z;
    this.pos[o + 3] = tip.x; this.pos[o + 4] = tip.y; this.pos[o + 5] = tip.z;
    this.birth[i * 2] = this.birth[i * 2 + 1] = time;
    // unused slots sit on top of the newest sample with a dead birth so they never draw
    for (let j = this.count; j < n; j++) { this.pos.copyWithin(j * 6, o, o + 6); this.birth[j * 2] = this.birth[j * 2 + 1] = -1e9; }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.birth.needsUpdate = true;
    this.idle = 0;
  }

  /** Tick the clock; release the owner once the ribbon has fully faded. */
  update(time, dt) {
    this.material.uniforms.uTime.value = time;
    if (this.owner) { this.idle += dt; if (this.idle > this.material.uniforms.uLife.value + 0.05) this.release(); }
  }

  release() { this.owner = null; this.bone = null; this.mesh = null; }

  clear() { this.birth.fill(-1e9); this.geo.attributes.birth.needsUpdate = true; this.count = 0; this.release(); }
}
