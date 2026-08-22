/**
 * Point-light pool. The forward renderer keeps a FIXED set of PointLights in the scene (shader programs compile
 * once, no mid-run recompiles) and each frame hands them to the nearest warm sources around the player: Sites of
 * Grace, campfires, torches and braziers. Every source flickers / pulses on its own phase and fades out over the
 * last metres of its reach, so a source entering or leaving the pool never pops. Slot 0 carries a shadow map and
 * always goes to the nearest grace: a figure resting by a grace casts a soft warm shadow away from it.
 *
 * Sources: { x, y, z, color (hex), intensity, range, decay, kind: 'grace' | 'fire', seed }.
 */
import * as THREE from 'three';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class LightPool {
  constructor(scene, { count = 6, shadowSlot = true } = {}) {
    this.scene = scene;
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 26, 1.6);
      l.position.set(0, -200, 0);
      if (i === 0 && shadowSlot) {
        l.castShadow = true;
        l.shadow.mapSize.set(512, 512);
        l.shadow.camera.near = 0.25;
        l.shadow.bias = -0.004; l.shadow.normalBias = 0.04; l.shadow.radius = 2;
        l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; // render once so the map exists, then only while in use
      }
      scene.add(l);
      this.lights.push(l);
    }
    this.shadowSlot = shadowSlot;
    this.sources = [];
    this.time = 0;
    this._c = new THREE.Color();
    this._assign = new Map(); // source -> light (stable slots between frames)
    this.override = null;      // { pos, intensity, color } legacy single warm light (setWarmLight)
  }

  /** Replace the source list (cheap; called when the world's fire list changes). */
  setSources(list) { this.sources = list; }

  /** Per-source intensity with flicker / pulse. */
  _intensity(s, t) {
    const ph = s.seed * 17.3;
    if (s.kind === 'grace') return s.intensity * (1 + 0.12 * Math.sin(t * 2.3 + ph) + 0.06 * Math.sin(t * 7.7 + ph * 2.1));
    return s.intensity * (0.86 + 0.16 * Math.sin(t * 9.1 + ph) + 0.08 * Math.sin(t * 23 + ph * 3.0) * Math.sin(t * 5.3 + ph));
  }

  /**
   * Pick the nearest sources to `focus` (by distance minus reach), assign them to the lights, fade by reach.
   * Shadow slot: the nearest grace (or the nearest source when no grace is near).
   */
  update(dt, focus) {
    this.time += dt;
    const t = this.time, n = this.lights.length;
    const cand = [];
    for (let i = 0; i < this.sources.length; i++) {
      const s = this.sources[i];
      const dx = s.x - focus.x, dz = s.z - focus.z, d = Math.sqrt(dx * dx + dz * dz);
      const fade = 1 - sm(s.range, s.range + 14, d);
      if (fade <= 0) continue;
      cand.push({ s, score: d - s.range * 0.5, fade });
    }
    cand.sort((a, b) => a.score - b.score);
    // the shadow slot wants a grace: promote the nearest grace into the first position when one is in reach
    if (this.shadowSlot) {
      const gi = cand.findIndex((c) => c.s.kind === 'grace');
      if (gi > 0) { const g = cand.splice(gi, 1)[0]; cand.unshift(g); }
    }
    const used = cand.slice(0, n);
    for (let i = 0; i < n; i++) {
      const l = this.lights[i], c = used[i];
      if (!c) { l.intensity = 0; l.position.y = -200; if (l.castShadow) l.shadow.autoUpdate = false; continue; }
      const s = c.s;
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      l.distance = s.range; l.decay = s.decay ?? 1.6;
      l.intensity = this._intensity(s, t) * c.fade;
      if (l.castShadow) {
        // only the nearest grace pays for a shadow map, and only when it can light the player
        const on = s.kind === 'grace' && c.fade > 0.02 && Math.hypot(s.x - focus.x, s.z - focus.z) < s.range;
        l.shadow.autoUpdate = on;
        if (on) l.shadow.needsUpdate = true;
      }
    }
    if (this.override && this.override.intensity > 0) {
      // legacy override: ride on the last slot
      const l = this.lights[n - 1];
      l.position.copy(this.override.pos); l.intensity = this.override.intensity; l.color.setHex(this.override.color); l.distance = 26; l.decay = 1.6;
    }
  }
}
