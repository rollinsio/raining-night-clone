/**
 * Contact shadow blob: a soft dark disc laid onto the terrain under every entity so figures visibly sit on the
 * ground (the moon shadow gives direction; this gives contact). Darkest in a small core under the feet, a wide
 * soft skirt that fades out, fog-aware so far blobs vanish with the haze. One shared material, one quad per
 * entity, renderOrder 1 (after the terrain and any ground decals, before characters / FX).
 */
import * as THREE from 'three';

const BLOB_GEO = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })();
const CONTACT_MAT = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0.78 } }]),
  vertexShader: `varying vec2 vUv; varying float vDepth;
    void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uOpacity; uniform float fogDensity; varying vec2 vUv; varying float vDepth;
    void main() {
      vec2 q = (vUv - 0.5) * 2.0; float d = length(q);
      // wide soft skirt + a darker core under the feet (two falloffs summed, never past 1)
      float skirt = pow(max(1.0 - d, 0.0), 1.7);
      float core = pow(max(1.0 - d * 2.6, 0.0), 1.4);
      float a = min(skirt * 0.72 + core * 0.5, 1.0);
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 1.4);
      gl_FragColor = vec4(0.012, 0.014, 0.022, a * uOpacity * (1.0 - fogF));
    }`,
  transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

/** Soft contact disc (w x d metres, d along the entity's facing) to parent under an entity root at ground level. */
export function makeContact(w = 1.2, d = 1.1, opacity = 1) {
  const mesh = new THREE.Mesh(BLOB_GEO, opacity === 1 ? CONTACT_MAT : CONTACT_MAT.clone());
  if (opacity !== 1) mesh.material.uniforms.uOpacity.value = CONTACT_MAT.uniforms.uOpacity.value * opacity;
  mesh.scale.set(w, 1, d); mesh.position.y = 0.02; mesh.renderOrder = 1; mesh.frustumCulled = false;
  mesh.name = 'contact';
  return mesh;
}
