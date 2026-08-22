/**
 * Cheap post chain: scene -> (bloom) -> grade/vignette/moon halo -> output (tone map + sRGB).
 * 'low' quality bypasses the composer entirely and renders straight to the canvas.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE } from './Style.js';

/**
 * Grade + vignette + damage flash + moon halo. Runs in linear HDR before tone mapping.
 * The halo is a soft screen-space glow around the moon's projected position (uMoon.xy in uv, .z = visibility)
 * with a faint fan of downward rays: the cheap stand-in for scattered moonlight tying sky and ground together.
 */
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null }, uStrength: { value: 0.4 }, uDamage: { value: 0 },
    uMoon: { value: new THREE.Vector3(0.5, 0.5, 0) }, uAspect: { value: 1.78 }, uMoonColor: { value: new THREE.Color(PALETTE.moon) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uStrength; uniform float uDamage; uniform vec3 uMoon; uniform float uAspect; uniform vec3 uMoonColor;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // grade: a touch of contrast around the mids, lift the blacks with a cool slate tint, desaturate slightly
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, vec3(l), 0.05);
      c.rgb = (c.rgb - 0.09) * 1.06 + 0.09;
      c.rgb = max(c.rgb, 0.0) * 0.97 + vec3(0.006, 0.007, 0.0095);
      // moon halo + downward ray fan (screen space, aspect-corrected)
      vec2 q = (vUv - uMoon.xy) * vec2(uAspect, 1.0);
      float dm = length(q);
      float halo = pow(max(1.0 - dm / 0.5, 0.0), 2.2) * 0.06;
      float ang = atan(q.y, q.x);
      float fan = pow(0.5 + 0.5 * sin(ang * 11.0 + 0.7), 3.0) * pow(0.5 + 0.5 * sin(ang * 5.0 - 1.9), 2.0);
      float down = smoothstep(0.1, 0.75, -q.y / max(dm, 0.001));
      halo += fan * down * pow(max(1.0 - dm / 1.25, 0.0), 1.6) * smoothstep(0.0, 0.12, dm) * 0.05;
      c.rgb += uMoonColor * halo * uMoon.z;
      vec2 p = vUv * 2.0 - 1.0;
      float r = dot(p, p);
      float v = 1.0 - uStrength * smoothstep(0.35, 1.9, r);
      c.rgb *= v;
      // red pulse at the edges when hurt
      c.rgb = mix(c.rgb, vec3(0.45, 0.02, 0.02), uDamage * smoothstep(0.2, 1.6, r));
      gl_FragColor = c;
    }`,
};

export class Postfx {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.enabled = true;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    // bloom: higher threshold (only HDR sources — the moon disc, flame cores, grace cores — cross it) and a cap on
    // how bright a pixel may enter the blur, so one hot source near the frame edge can no longer flood a quadrant
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x >> 1, size.y >> 1), 0.24, 0.42, 1.18);
    const hp = this.bloom.materialHighPassFilter;
    hp.uniforms.uBloomCap = { value: 2.4 };
    hp.fragmentShader = hp.fragmentShader
      .replace('uniform float smoothWidth;', 'uniform float smoothWidth; uniform float uBloomCap;')
      .replace('float v = luminance( texel.xyz );', 'float v = luminance( texel.xyz );\n\t\t\ttexel.rgb *= min( 1.0, uBloomCap / max( v, 1e-4 ) );\n\t\t\tv = min( v, uBloomCap );');
    hp.needsUpdate = true;
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.uAspect.value = size.x / Math.max(1, size.y);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.vignette);
    this.composer.addPass(this.output);
    this.damage = 0;
  }

  setSize(w, h) { this.composer.setSize(w, h); this.bloom.setSize(w >> 1, h >> 1); this.vignette.uniforms.uAspect.value = w / Math.max(1, h); }

  /** 0..1 red edge flash, decays in update(). */
  flashDamage(v) { this.damage = Math.min(1, this.damage + v); }

  /** Moon screen position (uv) and visibility 0..1 for the halo; Atmosphere feeds this every frame. */
  setMoon(u, v, k) { this.vignette.uniforms.uMoon.value.set(u, v, k); }

  update(dt) { this.damage = Math.max(0, this.damage - dt * 1.6); this.vignette.uniforms.uDamage.value = this.damage; }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
