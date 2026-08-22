/**
 * Night ring — the "rain of night" weather front.
 *  - wall: two terrain-following shells (outer + inner for parallax). Premultiplied-alpha shader: a deep-navy storm
 *    veil that is thin where it faces the camera and dense where it curves away (fresnel), dissolves in the bottom
 *    few metres so it never cuts the terrain (the fire and the ground pool own the contact), and loses its ragged
 *    top in the sky. On it: tall falling light curtains + mid streaks + fine needles (world-space columns, so they
 *    foreshorten and bunch as the wall recedes), luminous cloud cells drifting upward, a glowing rim band and blue
 *    fire tongues 2-12 m tall at the foot.
 *  - skirts: two ribbons just inside / beyond the wall carrying their own fire tongues (parallax with the wall's)
 *    and a little drifting ground mist, so the contact line is a ragged flame front, never a cut.
 *  - ground pool: terrain-conforming annulus — flickering fire-lit pool and low mist patches either side of the line.
 *  - world light: every MeshStandardMaterial in the scene gets a chained shader hook (ringWorldHook) sampling the
 *    signed distance to the wall: a strong flickering fire band (~0-6 m), a faint fill from the towering wall, and
 *    beyond the wall a darker, colder, desaturated grade sinking into a cold night fog with distance.
 *  - point light: a blue light parked on the nearest wall point at flame height (rim on the player's silhouette).
 *  - rain: ~1100 thin streaks falling in a band a few metres either side of the wall (one draw call) — the player
 *    stands in dry air facing a curtain.
 *  - motes: 600 GPU billboards — sparks rising from the fire, sparkles drifting just inside, a few gold embers.
 *  - fog: the scene fog is pulled toward the ring's cold violet as the player nears / crosses the wall.
 * Eased shrink between phases; distInside()/isOutside() drive the damage tick in Expedition.
 */
import * as THREE from 'three';
import { PALETTE } from '../render/Style.js';
import { ParticleSystem } from '../render/Particles.js';

const SEGS = 256, HEIGHT = 240, SINK = 4, SKIRT_H = 16, SKIRT_SINK = 1.2, SKIRT_OFF = 3.0;
const RIM_ROWS = [-32, -22, -14, -8, -4, -1.5, 0, 1.5, 4, 8, 14, 22, 34];
const MOTES = 600, MOTE_CHECKS = 10, MOTE_RANGE = 70;
const RAIN_N = 1100, RAIN_ARC = 48;   // streaks spread over ±RAIN_ARC m of arc about the player's bearing
const sm = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

const NOISE = `
  float hash1(float n){ return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i), b = hash2(i + vec2(1.0, 0.0)), c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.07 + vec2(17.3, 9.1); a *= 0.5; } return v; }
  // fire gathers in slowly drifting patches along the wall (shared by the wall, the skirts and the world hook)
  float clumpAt(float circ, float t){ return smoothstep(0.36, 0.66, vnoise(vec2(circ * 0.08, t * 0.06)) * 0.65 + vnoise(vec2(circ * 0.21, 3.0 + t * 0.1)) * 0.35); }
  // blue fire at the foot of the wall: x = tongue body, y = hot core, z = soft halo, w = height fraction.
  // soft = edge width (crisp up close, softened with distance so far tongues do not shimmer)
  vec4 fireAt(float circ, float hp, float t, float seed, float soft){
    float clump = clumpAt(circ, t);
    float hmax = 4.5 + 14.0 * clump * clump;     // tongue envelope 4.5-18.5 m (tongues reach ~half of it), tallest in the dense patches
    float yy = hp / hmax;
    // tongue field: two rising fbm groups plus fine licking detail at the edges
    float n1 = fbm(vec2(circ * 0.5 + seed * 7.0, hp * 0.2 - t * 1.0));
    float n2 = fbm(vec2(circ * 1.4 - seed * 3.0, hp * 0.45 - t * 2.0));
    float n3 = vnoise(vec2(circ * 2.8 + seed, hp * 0.9 - t * 3.0)) * 0.6 + vnoise(vec2(circ * 6.0 - seed, hp * 2.0 - t * 5.0)) * 0.4;
    float n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
    float shape = n - yy * 0.75 + 0.2;           // wide at the base, ragged narrowing tips
    float strength = 0.15 + 0.85 * clump;        // dark gaps between the fire patches
    float tongue = smoothstep(0.47 - soft, 0.47 + soft, shape) * strength * (0.55 + 0.45 * n2);   // the base is broken up, never a solid band
    float core = smoothstep(0.62, 0.72, n - yy * 0.5 + 0.05) * strength * (0.6 + 0.8 * n3);   // thin hot core (only the densest filaments, never a solid band at the base)
    float halo = smoothstep(0.32, 0.46, shape) * strength * (1.0 - smoothstep(0.6, 1.2, yy)) * 0.25;
    return vec4(tongue, core, halo, yy);
  }
  // fire radiance: saturated blue body, brightest at the base, thinning to violet at the tips; hot pale-cyan core
  vec3 fireGlow(vec4 fire, vec3 body, vec3 hot, vec3 tip){ float yy = clamp(fire.w, 0.0, 1.0); return mix(body, tip, yy * 0.7) * (fire.x * (0.85 - 0.4 * yy) + fire.z * 0.2) + hot * fire.y * 1.1; }
  // seen from outside the circle, a thin shell would cut a hard vertical silhouette at its tangent; dissolve the
  // wall over a wide band of arc either side of the tangent angle instead (no effect from inside the circle)
  float limbFade(vec2 fragXZ, vec2 centre, float R){
    vec2 cp = cameraPosition.xz - centre; float D = length(cp);
    if (D <= R + 0.5) return 1.0;
    float at = acos(clamp(R / D, 0.0, 1.0));
    float a = acos(clamp(dot(normalize(fragXZ - centre), cp / D), -1.0, 1.0));
    return smoothstep(0.0, 0.7 * at, abs(a - at));
  }
`;

/** Ribbon vertex shader (wall + skirts): unit circle scaled by the mesh, per-column ground height attribute. */
const RIBBON_VERT = `
  attribute float aGround;
  varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying float vGround;
  void main(){
    vUv = uv; vGround = aGround;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const WALL_FRAG = `
  uniform float uTime, uRadius, uSeed, uSpeed, uLayer, uFire, uFogDensity;
  uniform vec3 uColor, uGlow, uRain, uFogColor, uFireA, uFireB; uniform vec2 uCenter;
  varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying float vGround;
  ${NOISE}
  // one layer of falling light: columns colW wide (m), dash length len0..len0+len1 (m), speed sp0..sp0+sp1 (m/s),
  // half-width wm (m), a fraction fill of the columns lit. Bright falling head, tapering tail.
  float streaks(float circ, float h, float t, float colW, float len0, float len1, float sp0, float sp1, float wm, float seed, float fill){
    float cu = circ / colW;
    float col = mod(floor(cu), 4096.0), cf = fract(cu);
    float h1 = hash1(col * 1.7 + seed), h2 = hash1(col * 3.1 + seed * 2.3 + 1.2), h3 = hash1(col * 5.3 + seed * 4.1 + 2.7);
    float len = len0 + h2 * len1;
    float s = fract((h + t * (sp0 + h1 * sp1) + h1 * 97.0) / len);
    float dash = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.08, 0.85, s));
    float w = min(wm / colW, 0.45);
    float thin = smoothstep(0.5 - w, 0.5 - w * 0.35, cf) * (1.0 - smoothstep(0.5 + w * 0.35, 0.5 + w, cf));
    return dash * thin * step(1.0 - fill, h3) * (0.4 + 0.6 * h2);
  }
  void main(){
    float circ = vUv.x * 6.2831853 * uRadius;                   // arc length along the wall (m); shared fire patches
    float h = vWorld.y - vGround;                                // height above the terrain at the wall base (m)
    float hp = max(h, 0.0);
    float t = uTime * uSpeed;
    vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); vec3 vd = toCam / max(dist, 0.001);
    float lod = clamp((dist - 30.0) / 160.0, 0.0, 1.0);         // fine detail averages into haze with distance
    float wm = 0.035 + dist * 0.0009;                           // streak half-width (m): ~2 px at any distance
    // slow body turbulence; luminous cloud cells drifting up the wall; curtains bunching the falling light
    float body = fbm(vec2(circ * 0.02 + uSeed, hp * 0.012 - t * 0.04));
    float nebA = fbm(vec2(circ * 0.03 + uSeed * 2.0, hp * 0.04 - t * 0.06));
    float nebB = fbm(vec2(circ * 0.085 - uSeed, hp * 0.11 - t * 0.12) + 3.0);
    float neb = smoothstep(0.48, 0.78, nebA * 0.6 + nebB * 0.4);
    float curtain = fbm(vec2(circ * 0.045 + uSeed * 3.0, hp * 0.01 - t * 0.22)) * 0.7 + fbm(vec2(circ * 0.16 + uSeed * 5.0, hp * 0.02 - t * 0.45)) * 0.3;
    float sheets = smoothstep(0.3, 0.75, curtain);
    // vertical profile: nothing at the ground (the fire owns the contact), full by ~5 m, ragged top lost in the night
    float footFade = smoothstep(0.0, 3.0 + 3.0 * nebB, hp);
    float top = 1.0 - smoothstep(90.0, 230.0, hp + (body - 0.45) * 160.0);
    // fresnel: thin where the wall faces the camera, dense where it curves away — a surface, not a backdrop
    float facing = abs(dot(vd, normalize(vNormal)));
    float fres = mix(0.84, 0.98, pow(max(1.0 - facing, 0.0), 0.6));
    float veil = 0.88 + 0.12 * exp(-hp * 0.02);
    float edgeFade = limbFade(vWorld.xz, uCenter, uRadius);
    float layer = top * uLayer * edgeFade;
    float haze = clamp(veil * fres * (0.9 + 0.2 * body) * footFade * layer, 0.0, 0.97);
    // blue fire at the foot (uniform branch: the inner shell carries no fire) and the rim glow behind it;
    // the fire fades with distance faster than the body so a far ring is a soft line, not a glitter of cores
    vec4 fire = vec4(0.0); float foot = 0.0;
    if (hp < 22.0) {                                            // the foot: fire tongues + rim glow (skipped for the other ~220 m)
      if (uFire > 0.0) fire = fireAt(circ, hp, uTime, uSeed, 0.015 + dist * 0.0009) * uFire * exp(-dist * 0.004);
      foot = exp(-hp * 0.14) * (0.3 + 0.7 * clumpAt(circ, uTime));
    }
    // falling light: tall curtains, mid streaks, fine needles, a few bloom-bright ones
    float tall = streaks(circ, h, t, 1.4, 10.0, 22.0, 24.0, 18.0, wm, uSeed, 0.08) * (1.0 - lod * 0.7);
    float mid = streaks(circ + 3.3, h, t, 0.6, 3.0, 7.0, 16.0, 14.0, wm * 0.8, uSeed + 5.0, 0.08) * (1.0 - lod * 0.85);
    float fine = streaks(circ + 7.7, h, t, 0.25, 0.8, 1.6, 18.0, 12.0, wm * 0.6, uSeed + 9.0, 0.14) * (1.0 - lod);
    float bright = streaks(circ + 11.1, h, t, 3.1, 6.0, 14.0, 20.0, 16.0, wm * 1.2, uSeed + 13.0, 0.03) * (1.0 - lod);
    float rain = (tall * (0.3 + 0.7 * sheets) + mid * (0.15 + 0.7 * sheets) + fine * 0.2) * footFade;
    vec3 deep = vec3(0.006, 0.009, 0.035);
    vec3 tint = mix(deep, uColor * 0.12, neb * 0.5 + body * 0.1);
    vec3 rainCol = mix(uColor, uRain, 0.65);
    vec3 glow = rainCol * rain * 0.28 + uRain * bright * footFade * 0.9
              + uColor * neb * footFade * (0.03 + 0.25 * exp(-hp * 0.04)) + uGlow * neb * neb * footFade * 0.05
              + fireGlow(fire, uFireA, uFireB, uColor)
              + uFireA * foot * 0.12 * (0.5 + 0.5 * footFade)
              + uColor * (0.003 + 0.008 * body + lod * 0.03 * veil) * footFade;
    glow *= layer;
    // distance: same haze curve as the atmosphere; the far side of the ring fades instead of adding pale fog
    float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.7));
    haze *= 1.0 - fogF * 0.5;
    glow *= 1.0 - fogF * 0.9;
    tint = mix(tint, uFogColor * 0.45, fogF);
    gl_FragColor = vec4(tint * haze + glow, haze);
  }`;

/** Skirt: fire tongues + a little drifting ground mist on a low ribbon just inside / beyond the wall. */
const SKIRT_FRAG = `
  uniform float uTime, uRadius, uSeed, uLayer, uFire, uFogDensity;
  uniform vec3 uColor, uGlow, uRain, uFogColor, uFireA, uFireB; uniform vec2 uCenter;
  varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal; varying float vGround;
  ${NOISE}
  void main(){
    float circ = vUv.x * 6.2831853 * uRadius;
    float h = vWorld.y - vGround, hp = max(h, 0.0);
    float t = uTime;
    float dist = distance(cameraPosition, vWorld);
    vec4 fire = fireAt(circ, hp, t, uSeed, 0.015 + dist * 0.0009) * uFire * exp(-dist * 0.004);
    float clump = clumpAt(circ, t);
    // ground mist: broad, slow, drifting sideways, hugging the terrain, faintly lit by the fire
    float m1 = fbm(vec2(circ * 0.06 + t * 0.25 + uSeed, hp * 0.25 - t * 0.1));
    float m2 = fbm(vec2(circ * 0.16 - t * 0.18 + uSeed * 2.0, hp * 0.4 - t * 0.2));
    float mist = smoothstep(0.45, 0.85, m1 * 0.6 + m2 * 0.4) * exp(-hp * 0.35) * (1.0 - smoothstep(3.0, 7.0, hp));
    float edgeFade = limbFade(vWorld.xz, uCenter, uRadius);      // same soft tangent silhouette as the wall
    float haze = mist * 0.35 * uLayer * edgeFade;
    vec3 tint = vec3(0.02, 0.03, 0.08);
    vec3 glow = (fireGlow(fire, uFireA, uFireB, uColor) + uFireA * mist * (0.04 + 0.12 * clump)) * uLayer * edgeFade;
    float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.7));
    haze *= 1.0 - fogF * 0.7; glow *= 1.0 - fogF * 0.9; tint = mix(tint, uFogColor * 0.45, fogF);
    gl_FragColor = vec4(tint * haze + glow, haze);
  }`;

const RIM_VERT = `
  attribute float aRad; attribute float aArc;
  varying float vRad; varying float vArc; varying vec3 vWorld;
  void main(){
    vRad = aRad; vArc = aArc; vWorld = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }`;

/** Ground pool: flickering fire-lit pool at the contact line + low mist patches lying on the terrain either side. */
const RIM_FRAG = `
  uniform float uTime, uFogDensity;
  uniform vec3 uGlow, uColor, uRain, uFogColor, uFireA;
  varying float vRad; varying float vArc; varying vec3 vWorld;
  ${NOISE}
  void main(){
    float d = vRad, ad = abs(d);                      // metres from the wall line, positive beyond
    float t = uTime;
    float clump = clumpAt(vArc, t);
    float n = fbm(vec2(vArc * 0.05 + t * 0.2, d * 0.12 - t * 0.1));
    float n2 = fbm(vec2(vArc * 0.18 - t * 0.15, d * 0.3 + 5.0));
    // low mist: patches hugging the line, sparse tendrils creeping ~30 m in, a cold pall lying on the ground beyond
    float reach = d < 0.0 ? 1.0 - smoothstep(6.0, 30.0, ad) : 1.0 - smoothstep(4.0, 30.0, ad);
    float mist = smoothstep(0.42, 0.82, n * 0.6 + n2 * 0.4) * reach;
    float pall = d > 0.0 ? smoothstep(2.0, 14.0, ad) * (1.0 - smoothstep(20.0, 34.0, ad)) * (0.5 + 0.5 * n) : 0.0;
    float flick = 0.8 + 0.4 * vnoise(vec2(vArc * 0.5 - t * 0.9, t * 2.2));
    float pool = exp(-ad * 0.45) * (0.25 + clump) * flick * (0.6 + 0.4 * n2);
    vec3 glow = uFireA * pool * 0.18 + mix(uColor, uFireA, 0.5) * mist * (0.06 + 0.1 * exp(-ad * 0.15)) + uColor * pall * 0.02;
    float haze = mist * 0.3 + pall * 0.45;
    vec3 tint = vec3(0.02, 0.03, 0.08);
    float dist = distance(cameraPosition, vWorld);
    float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.7));
    float edge = (d < 0.0 ? 1.0 - smoothstep(24.0, 32.0, ad) : 1.0 - smoothstep(26.0, 34.0, ad)) * (1.0 - fogF);
    gl_FragColor = vec4((tint * haze + glow) * edge, haze * edge);
  }`;

/**
 * Rain curtain: thin screen-aligned streaks falling in a band a few metres either side of the wall, spread over an
 * arc about the player's bearing, wrapping in y. The vertex shader does all the motion.
 */
const RAIN_VERT = `
  attribute vec3 seed; attribute vec2 corner;
  uniform float uTime, uProx, uRadius; uniform vec3 uCenter; uniform vec2 uBearing;   // uCenter: centre x, ground y, centre z; uBearing: angle, half-spread (rad)
  varying float vA;
  void main(){
    float ang = uBearing.x + (seed.x - 0.5) * 2.0 * uBearing.y;
    float u = seed.y * 2.0 - 1.0;
    float off = u * abs(u) * 9.0 + 1.0;                  // radial offset from the wall (m): dense at the line, a thin spill either side
    float r = uRadius + off;
    float speed = 13.0 + seed.z * 9.0;
    float len = 0.9 + seed.z * 2.2;
    float y = uCenter.y + 17.0 - mod(uTime * speed + seed.z * 97.0 + seed.x * 31.0, 22.0);
    vec3 p = vec3(uCenter.x + cos(ang) * r, y, uCenter.z + sin(ang) * r);
    float dist = distance(cameraPosition, p);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);   // camera right axis (screen-aligned streaks)
    float w = 0.006 + dist * 0.0011;                     // ~2 px: rain is thin
    p += right * corner.x * w + vec3(0.0, corner.y * len, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    float near = smoothstep(0.8, 3.0, dist), far = 1.0 - smoothstep(25.0, 60.0, dist);
    vA = uProx * near * far * (0.35 + 0.65 * seed.z) * (0.75 - 0.25 * corner.y);   // brighter falling head
  }`;
const RAIN_FRAG = `
  uniform vec3 uRain; varying float vA;
  void main(){ gl_FragColor = vec4(uRain * vA * 0.22, vA * 0.22); }`;

// ------------------------------------------------------------------------------------------------
// World material hook: light from the wall on terrain / props / structures / characters.

const WORLD_U = {
  uRingC: { value: new THREE.Vector3(0, 600, 0) },         // centre x, radius, centre z
  uRingP: { value: new THREE.Vector4(0, 0, 0.0026, 0) },   // time, strength, fog density, -
  uRingA: { value: new THREE.Color(PALETTE.ringGlow) },
  uRingB: { value: new THREE.Color(PALETTE.ringRain) },
  uRingF: { value: new THREE.Color(PALETTE.ring).offsetHSL(-0.03, 0.05, 0.02) },   // the fire body colour (see Ring constructor)
};
const WORLD_PARS = `
  uniform vec3 uRingC; uniform vec4 uRingP; uniform vec3 uRingA; uniform vec3 uRingB; uniform vec3 uRingF;
  varying vec3 vRingW;
  float ringHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float ringNoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(ringHash(i), ringHash(i + vec2(1.0, 0.0)), f.x), mix(ringHash(i + vec2(0.0, 1.0)), ringHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;
const WORLD_LIGHT = `
  if (uRingP.y > 0.0) {
    vec2 rp = vRingW.xz - uRingC.xz;
    float rl = max(length(rp), 0.001);
    float d = uRingC.y - rl;                          // signed distance to the wall: + safe side, - beyond
    float ad = abs(d);
    if (ad < 70.0) {
      float ang = atan(rp.y, rp.x); ang += ang < 0.0 ? 6.2831853 : 0.0;
      float circ = ang * uRingC.y, t = uRingP.x;
      float clump = smoothstep(0.36, 0.66, ringNoise(vec2(circ * 0.08, t * 0.06)) * 0.65 + ringNoise(vec2(circ * 0.21, 3.0 + t * 0.1)) * 0.35);
      float flick = 0.7 + 0.6 * ringNoise(vec2(circ * 0.5 - t * 0.9, t * 2.2));
      // dappled: the fire light is broken up by the grass and the tongues themselves (world-space noise)
      float dap = 0.55 + 1.1 * ringNoise(vRingW.xz * 0.9 + vec2(t * 0.15, 0.0)) * ringNoise(vRingW.xz * 2.3 - vec2(0.0, t * 0.2));
      float wide = 0.09 * (1.0 - smoothstep(20.0, 60.0, ad)) / (1.0 + ad * 0.06);   // faint fill from the towering wall
      float band = min(exp(-ad * 0.34) * (0.3 + 1.3 * clump) * flick * dap, 1.1);  // the fire: strong, flickering, ~0-7 m (capped: saturated, never white)
      float reach = exp(-ad * 0.12) * 0.36 * (0.5 + 1.0 * ringNoise(vRingW.xz * 0.35 + vec2(0.0, t * 0.08)));   // the glow of the whole fire line reaching ~20 m in
      vec2 dir2 = rp / rl * (d > 0.0 ? 1.0 : -1.0);
      vec3 wdir = normalize(vec3(dir2.x, 0.35, dir2.y));
      float wrap = 0.3 + 0.7 * max(dot(normal, mat3(viewMatrix) * wdir), 0.0);
      float fogK = exp(-distance(cameraPosition, vRingW) * uRingP.z * 1.3);
      vec3 E = (uRingA * wide + mix(uRingF, uRingB, 0.25) * band * 1.0 + mix(uRingA, uRingB, 0.4) * reach) * wrap * uRingP.y * fogK;
      reflectedLight.indirectDiffuse += E * BRDF_Lambert(diffuseColor.rgb);
      // the fire's glow catches the edges of anything standing near the wall (trunks, rocks, the player's hood)
      float upness = saturate(dot(normal, mat3(viewMatrix) * vec3(0.0, 1.0, 0.0)));
      float rimF = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0) * (1.0 - upness * upness);
      vec3 rimE = mix(uRingF, uRingB, 0.5) * rimF * (0.12 + 0.5 * exp(-ad * 0.07)) * uRingP.y * fogK;
      reflectedLight.indirectDiffuse += rimE * (0.4 + 0.6 * diffuseColor.rgb);
      totalEmissiveRadiance += E * 0.03;
      // beyond the wall lies the night: darker, colder, desaturated, sinking into a cold fog with distance
      float beyond = smoothstep(0.0, 6.0, -d) * uRingP.y;
      if (beyond > 0.0) {
        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722), COLD = vec3(0.4, 0.5, 1.0);
        float pall = 1.0 - exp(-max(-d, 0.0) * 0.04);
        vec3 nightFog = (uRingA * 0.04 + vec3(0.004, 0.006, 0.02)) * 0.5;
        vec3 dd = reflectedLight.directDiffuse, id = reflectedLight.indirectDiffuse;
        dd = mix(dd, dot(dd, LUMA) * COLD, 0.8 * beyond) * (1.0 - 0.6 * beyond);
        id = mix(id, dot(id, LUMA) * COLD, 0.8 * beyond) * (1.0 - 0.5 * beyond);
        reflectedLight.directDiffuse = mix(dd, nightFog, pall * beyond);
        reflectedLight.indirectDiffuse = mix(id, nightFog, pall * beyond);
      }
    }
  }`;

/** Shader patch: world position varying + the wall light after the standard lighting. */
function ringWorldHook(sh) {
  if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return; // depth / distance materials
  Object.assign(sh.uniforms, WORLD_U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vRingW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvRingW = cameraPosition + mvPosition.xyz * mat3(viewMatrix);');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + WORLD_PARS)
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + WORLD_LIGHT);
}

const HOOKED = new WeakSet();
/** Chain the world hook onto a standard material, keeping any hook / cache key another module installed. */
function hookMaterial(mat) {
  if (!mat || !mat.isMeshStandardMaterial || HOOKED.has(mat)) return;
  HOOKED.add(mat);
  const own = mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? mat.onBeforeCompile : null;
  const ownKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.onBeforeCompile = own ? function (sh, r) { own.call(this, sh, r); ringWorldHook(sh); } : ringWorldHook;
  mat.customProgramCacheKey = function () { return (ownKey ? ownKey.call(this) : own ? own.toString() : '') + '|nightRing'; };
  mat.needsUpdate = true;
}

/** Premultiplied-alpha blending: rgb = tint*a + additive glow. */
function premultiplied(mat) {
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

export class Ring {
  constructor(game) {
    this.game = game;
    this.center = new THREE.Vector3(0, 0, 0);
    this.radius = 600;
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this.fromR = 600; this.toR = 600; this.shrinkT = 0; this.shrinkDur = 0; this.shrinking = false;
    this.time = 0;
    this.rng = game.rng.fork(77);
    this.group = new THREE.Group();
    this.group.name = 'nightRing';

    // fire colours derived from the palette: the ring blue pulled toward cyan (body), the rain tint pushed to a hot pale cyan (core)
    const fireA = new THREE.Color(PALETTE.ring).offsetHSL(-0.03, 0.05, 0.02);
    const fireB = new THREE.Color(PALETTE.ringRain).offsetHSL(-0.04, 0.2, 0.05);
    const shared = {
      uTime: { value: 0 }, uRadius: { value: 600 }, uFogDensity: { value: 0.0026 },
      uColor: { value: new THREE.Color(PALETTE.ring) }, uGlow: { value: new THREE.Color(PALETTE.ringGlow) },
      uRain: { value: new THREE.Color(PALETTE.ringRain) }, uFogColor: { value: new THREE.Color(PALETTE.fog) },
      uFireA: { value: fireA }, uFireB: { value: fireB }, uCenter: { value: new THREE.Vector2() },
    };
    this.uniforms = shared;
    const ribbonMat = (frag, extra, order) => {
      const mat = premultiplied(new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERT, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
        uniforms: { ...shared, ...extra },
      }));
      const m = new THREE.Mesh(this._buildRibbon(), mat);
      m.frustumCulled = false; m.renderOrder = order;
      this.group.add(m);
      return m;
    };

    // --- wall: two shells (outer carries the fire; inner, 6 m in, is a dimmer parallax layer) ------
    this.wallOuter = ribbonMat(WALL_FRAG, { uSeed: { value: 0.0 }, uSpeed: { value: 1.0 }, uLayer: { value: 1.0 }, uFire: { value: 1.0 } }, 6);
    this.wallInner = ribbonMat(WALL_FRAG, { uSeed: { value: 3.7 }, uSpeed: { value: 0.8 }, uLayer: { value: 0.5 }, uFire: { value: 0.0 } }, 5);
    // --- skirts: fire + ground mist ribbons just inside and just beyond the wall ---------------
    this.skirtIn = ribbonMat(SKIRT_FRAG, { uSeed: { value: 1.0 }, uLayer: { value: 1.0 }, uFire: { value: 0.28 } }, 7);
    this.skirtOut = ribbonMat(SKIRT_FRAG, { uSeed: { value: 2.0 }, uLayer: { value: 0.8 }, uFire: { value: 0.22 } }, 4);
    this.ribbons = [
      { mesh: this.wallOuter, off: 0, sink: SINK, height: HEIGHT, flatTop: true },
      { mesh: this.wallInner, off: -6, sink: SINK, height: HEIGHT, flatTop: true },
      { mesh: this.skirtIn, off: -SKIRT_OFF, sink: SKIRT_SINK, height: SKIRT_H, flatTop: false },
      { mesh: this.skirtOut, off: SKIRT_OFF, sink: SKIRT_SINK, height: SKIRT_H, flatTop: false },
    ];

    // --- ground pool / mist annulus on the terrain ------------------------------------------------
    this.rimGeo = this._buildRimGeometry();
    this.rimPos = this.rimGeo.attributes.position.array;
    const rimMat = premultiplied(new THREE.ShaderMaterial({
      vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uTime: shared.uTime, uFogDensity: shared.uFogDensity, uGlow: shared.uGlow, uColor: shared.uColor, uRain: shared.uRain, uFogColor: shared.uFogColor, uFireA: shared.uFireA },
    }));
    this.rim = new THREE.Mesh(this.rimGeo, rimMat);
    this.rim.frustumCulled = false; this.rim.renderOrder = 3;
    this.group.add(this.rim);

    // --- the fire's light on the player: one point light parked on the nearest wall point ---------
    this.light = new THREE.PointLight(fireA.getHex(), 0, 40, 1.5);
    this.light.color.lerp(fireB, 0.15);
    this.group.add(this.light);

    // --- rain curtain along the wall ---------------------------------------------------------------
    this.rain = this._buildRain(shared);
    this.group.add(this.rain);

    // --- motes near the wall -----------------------------------------------------------------------
    this.motes = new ParticleSystem({ max: MOTES, mode: 'orbit' });
    this.motes.mesh.renderOrder = 10;
    this.group.add(this.motes.mesh);
    this.moteCursor = 0;
    this.cCold = fireB.clone(); this.cViolet = new THREE.Color(PALETTE.ringGlow); this.cBlue = fireA.clone().lerp(this.cCold, 0.4);
    this.cWarm = new THREE.Color(PALETTE.ember).lerp(new THREE.Color(PALETTE.rune), 0.5); this.cMist = new THREE.Color(PALETTE.ring);

    this.fogTint = new THREE.Color(PALETTE.ring).lerp(new THREE.Color(PALETTE.fog), 0.3).multiplyScalar(0.5);
    this._fogK = 0;
    this.proximity = 0;
    this._v = new THREE.Vector3();
    game.scene.add(this.group);
    this.hookObject(game.scene);
    WORLD_U.uRingP.value.y = 1;
    this.apply();
    this._seedMotes();
  }

  /** Give every standard material under `root` the wall-light hook (call for entities spawned after the ring). */
  hookObject(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (Array.isArray(m)) for (const x of m) hookMaterial(x); else hookMaterial(m);
    });
  }

  /** Unit-circle ribbon (x,z scaled by radius; y in metres), two rows, per-column ground height attribute. */
  _buildRibbon() {
    const cols = SEGS + 1;
    const pos = new Float32Array(cols * 2 * 3), nor = new Float32Array(cols * 2 * 3), uv = new Float32Array(cols * 2 * 2), ground = new Float32Array(cols * 2);
    const idx = new Uint16Array(SEGS * 6);
    for (let i = 0; i < cols; i++) {
      const a = (i / SEGS) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let r = 0; r < 2; r++) {
        const v = i * 2 + r;
        pos[v * 3] = c; pos[v * 3 + 1] = r * HEIGHT; pos[v * 3 + 2] = s;
        nor[v * 3] = c; nor[v * 3 + 1] = 0; nor[v * 3 + 2] = s;
        uv[v * 2] = i / SEGS; uv[v * 2 + 1] = r;
      }
    }
    for (let i = 0; i < SEGS; i++) {
      const b = i * 2;
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aGround', new THREE.BufferAttribute(ground, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  /** World-space annulus strip, RIM_ROWS radial offsets x SEGS+1 columns; positions rewritten in apply(). */
  _buildRimGeometry() {
    const cols = SEGS + 1, rows = RIM_ROWS.length;
    const pos = new Float32Array(cols * rows * 3), rad = new Float32Array(cols * rows), arc = new Float32Array(cols * rows);
    const idx = new Uint32Array(SEGS * (rows - 1) * 6);
    let k = 0;
    for (let i = 0; i < SEGS; i++) for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r, b = (i + 1) * rows + r;
      idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
    }
    for (let i = 0; i < cols; i++) for (let r = 0; r < rows; r++) rad[i * rows + r] = RIM_ROWS[r];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRad', new THREE.BufferAttribute(rad, 1));
    geo.setAttribute('aArc', new THREE.BufferAttribute(arc, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  /** RAIN_N streak quads (seed per streak; the vertex shader does all the motion). One additive draw call. */
  _buildRain(shared) {
    const rng = this.rng;
    const seed = new Float32Array(RAIN_N * 4 * 3), corner = new Float32Array(RAIN_N * 4 * 2), idx = new Uint16Array(RAIN_N * 6);
    for (let i = 0; i < RAIN_N; i++) {
      const sx = rng.float(), sy = rng.float(), sz = rng.float();
      for (let v = 0; v < 4; v++) { seed[(i * 4 + v) * 3] = sx; seed[(i * 4 + v) * 3 + 1] = sy; seed[(i * 4 + v) * 3 + 2] = sz; }
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_N * 4 * 3), 3)); // required by three, unused
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.rainU = { uTime: shared.uTime, uRain: shared.uRain, uRadius: shared.uRadius, uProx: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBearing: { value: new THREE.Vector2() } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: this.rainU,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = 9;
    return m;
  }

  setImmediate(center, radius) {
    this.center.set(center.x, 0, center.z); this.radius = radius; this.shrinking = false;
    this.apply();
    this._seedMotes();
  }

  shrinkTo(center, radius, duration) {
    this.from.copy(this.center); this.to.set(center.x, 0, center.z);
    this.fromR = this.radius; this.toR = radius;
    this.shrinkT = 0; this.shrinkDur = duration; this.shrinking = true;
  }

  finishShrink() { if (this.shrinking) { this.center.copy(this.to); this.radius = this.toR; this.shrinking = false; this.apply(); this._seedMotes(); } }

  /** Pose helper: present as mid-shrink (HUD countdown) without moving — from/to are the current circle. */
  holdShrink(remaining = 42, duration = 60) {
    this.from.copy(this.center); this.to.copy(this.center); this.fromR = this.toR = this.radius;
    this.shrinkDur = duration; this.shrinkT = Math.max(0, duration - remaining); this.shrinking = true;
  }

  /** Push centre/radius into the meshes and re-sample the terrain under the ribbons and the pool strip. */
  apply() {
    const T = this.game.terrain, c = this.center, R = this.radius;
    this.uniforms.uRadius.value = R;
    this.uniforms.uCenter.value.set(c.x, c.z);
    WORLD_U.uRingC.value.set(c.x, R, c.z);
    for (const rb of this.ribbons) {
      const r = Math.max(R + rb.off, R * 0.8), geo = rb.mesh.geometry, wp = geo.attributes.position.array, wg = geo.attributes.aGround.array;
      rb.mesh.position.set(c.x, 0, c.z); rb.mesh.scale.set(r, 1, r);
      let maxG = -1e9;
      for (let i = 0; i <= SEGS; i++) {
        const a = (i / SEGS) * Math.PI * 2;
        const g = T ? T.getHeight(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r) : 0;
        if (g > maxG) maxG = g;
        wg[i * 2] = g; wg[i * 2 + 1] = g;
        wp[i * 6 + 1] = g - rb.sink;
        if (!rb.flatTop) wp[i * 6 + 4] = g + rb.height;
      }
      if (rb.flatTop) for (let i = 0; i <= SEGS; i++) wp[i * 6 + 4] = maxG + rb.height;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aGround.needsUpdate = true;
    }
    const rp = this.rimPos, ra = this.rimGeo.attributes.aArc.array, rows = RIM_ROWS.length;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let r = 0; r < rows; r++) {
        const rr = R + RIM_ROWS[r], x = c.x + ca * rr, z = c.z + sa * rr, v = (i * rows + r) * 3;
        rp[v] = x; rp[v + 1] = (T ? T.getHeight(x, z) : 0) + 0.3; rp[v + 2] = z;
        ra[i * rows + r] = a * R;
      }
    }
    this.rimGeo.attributes.position.needsUpdate = true;
    this.rimGeo.attributes.aArc.needsUpdate = true;
  }

  /** Place (or re-place) mote i along the wall arc nearest the camera. */
  _respawnMote(i, randomPhase) {
    const ps = this.motes, rng = this.rng, cam = this.game.camera.position, c = this.center, R = this.radius, T = this.game.terrain;
    const a0 = Math.atan2(cam.z - c.z, cam.x - c.x);
    const spread = Math.min(Math.PI, 45 / R);
    const pick = rng.float();
    let r, y0, col, br, size, life, orbit, rise, spin;
    if (pick < 0.5) {            // sparks rising out of the fire, hugging the wall
      r = R - 3 + rng.float() * 5; y0 = 0.3 + rng.float() ** 2 * 9;
      col = pick < 0.08 ? this.cViolet : pick < 0.2 ? this.cBlue : this.cCold;
      br = 1.2 + rng.float() * 1.2; size = 0.03 + rng.float() ** 2 * 0.06; life = 1.5 + rng.float() * 2.5;
      orbit = 0.1 + rng.float() * 0.5; rise = 2 + rng.float() * 4.0; spin = 0.4 + rng.float() * 1.2;
    } else if (pick < 0.78) {    // slow sparkles drifting through the air just inside the wall
      r = R - 24 + Math.pow(rng.float(), 0.6) * 24; y0 = 0.3 + rng.float() ** 1.5 * 5;
      col = pick < 0.6 ? this.cViolet : pick < 0.7 ? this.cBlue : this.cCold;
      br = 0.4 + rng.float() * 0.7; size = 0.03 + rng.float() ** 2 * 0.06; life = 6 + rng.float() * 8;
      orbit = 0.4 + rng.float() * 1.6; rise = (rng.float() - 0.4) * 1.6; spin = 0.15 + rng.float() * 0.5;
    } else if (pick < 0.93) {    // golden embers carried up off the fire and drifting in
      r = R - 12 + rng.float() * 14; y0 = 0.3 + rng.float() ** 2 * 6;
      col = this.cWarm; br = 2 + rng.float() * 1.6; size = 0.04 + rng.float() ** 2 * 0.07; life = 3 + rng.float() * 4;
      orbit = 0.3 + rng.float() * 1.2; rise = 1 + rng.float() * 3.0; spin = 0.4 + rng.float() * 1.0;
    } else {                     // soft blue mist puff hugging the base
      r = R - 6 + rng.float() * 8; y0 = 0.5 + rng.float() * 1.8;
      col = this.cMist; br = 0.006 + rng.float() * 0.008; size = 4 + rng.float() * 6; life = 8 + rng.float() * 6;
      orbit = 1 + rng.float() * 2.5; rise = (rng.float() - 0.5) * 0.6; spin = 0.08 + rng.float() * 0.2;
    }
    // along the arc nearest the camera, never right in front of the lens (a mote at 0.5 m is a blob)
    let a = a0 + (rng.float() * 2 - 1) * spread, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    for (let k = 0; k < 4 && Math.hypot(x - cam.x, z - cam.z) < 4; k++) { a = a0 + (rng.float() * 2 - 1) * spread; x = c.x + Math.cos(a) * r; z = c.z + Math.sin(a) * r; }
    const y = (T ? T.getHeight(x, z) : 0) + y0;
    ps.cursor = i;
    ps.spawn(x, y, z, orbit, rise, spin, life, size, col.r * br, col.g * br, col.b * br, rng.float());
    if (randomPhase) { const birth = ps.time - rng.float() * life; for (let v = 0; v < 4; v++) ps.info[(i * 4 + v) * 4] = birth; }
  }

  _seedMotes() { for (let i = 0; i < MOTES; i++) this._respawnMote(i, true); }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    WORLD_U.uRingP.value.x = this.time;
    if (this.shrinking) {
      this.shrinkT += dt;
      const k = sm(this.shrinkT / this.shrinkDur);
      this.center.lerpVectors(this.from, this.to, k);
      this.radius = this.fromR + (this.toR - this.fromR) * k;
      if (this.shrinkT >= this.shrinkDur) this.shrinking = false;
      this.apply();
    }
    const game = this.game, scene = game.scene, cam = game.camera.position, c = this.center, R = this.radius, T = game.terrain;
    const p = game.player;
    const d = p ? this.distInside(p.pos) : 1e9;
    if (p) { p.ringDist = d; p.outsideRing = d < 0; }
    this.proximity = d < 0 ? 1 : 1 - sm(d / 70);
    // fog: follow the atmosphere's base colour, pulled toward the ring's cold violet near / beyond the wall
    if (scene.fog) {
      this.uniforms.uFogDensity.value = scene.fog.density;
      WORLD_U.uRingP.value.z = scene.fog.density;
      const atm = game.atmosphere, base = atm && atm.fogColor ? atm.fogColor : null;
      const k = d < 0 ? 0.75 : this.proximity * 0.5;
      if (base && (k > 0 || this._fogK > 0)) scene.fog.color.copy(base).lerp(this.fogTint, k);
      this._fogK = k;
      this.uniforms.uFogColor.value.copy(scene.fog.color);
    }
    if (p) {
      // the fire's light: parked on the wall point nearest the player, at flame height, flickering
      const v = this._v.set(p.pos.x - c.x, 0, p.pos.z - c.z);
      const len = v.length() || 1; v.multiplyScalar(R / len);
      const lx = c.x + v.x, lz = c.z + v.z;
      const bearing = Math.atan2(v.z, v.x);
      this.light.position.set(lx, (T ? T.getHeight(lx, lz) : 0) + 2.4, lz);
      const flick = 0.85 + 0.15 * Math.sin(this.time * 9.1) * Math.sin(this.time * 5.3 + 1.7);
      this.light.intensity = 24 * this.proximity * this.proximity * flick;
      // the rain curtain hangs on the wall arc ahead of the player; it is only drawn once the wall is in reach
      this.rainU.uProx.value = 1 - sm((d - 30) / 60);
      this.rainU.uCenter.value.set(c.x, p.pos.y, c.z);
      this.rainU.uBearing.value.set(bearing, Math.min(Math.PI, RAIN_ARC / R));
    }
    // motes: round-robin re-place the ones that drifted away from the wall or the camera
    const ps = this.motes;
    const camIn = R - Math.hypot(cam.x - c.x, cam.z - c.z);
    if (Math.abs(camIn) < MOTE_RANGE * 1.5) {
      for (let n = 0; n < MOTE_CHECKS; n++) {
        const i = this.moteCursor; this.moteCursor = (i + 1) % MOTES;
        const o = i * 12, x = ps.center[o], z = ps.center[o + 2];
        const dIn = R - Math.hypot(x - c.x, z - c.z);
        if (dIn < -7 || dIn > 40 || Math.hypot(x - cam.x, z - cam.z) > MOTE_RANGE) this._respawnMote(i, true);
      }
    }
    ps.update(this.time);
  }

  /** Signed distance from the wall: positive inside. */
  distInside(p) { return this.radius - Math.hypot(p.x - this.center.x, p.z - this.center.z); }
  isOutside(p) { return this.distInside(p) < 0; }

  dispose() {
    WORLD_U.uRingP.value.y = 0;   // the world hook stays installed; no ring → no light
    this.game.scene.remove(this.group);
    for (const rb of this.ribbons) { rb.mesh.geometry.dispose(); rb.mesh.material.dispose(); }
    this.rimGeo.dispose(); this.rim.material.dispose();
    this.rain.geometry.dispose(); this.rain.material.dispose();
    this.motes.geo.dispose(); this.motes.material.dispose();
  }
}
