/** Seeded mulberry32 PRNG. Deterministic world generation depends on call order. */
export class Rng {
  constructor(seed = 1) { this.seed = (seed >>> 0) || 1; this.s = this.seed; }

  /** Uniform float in [0,1). */
  float() {
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [a,b] inclusive. */
  int(a, b) { return a + Math.floor(this.float() * (b - a + 1)); }
  /** Float in [a,b). */
  range(a, b) { return a + this.float() * (b - a); }
  pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }
  chance(p) { return this.float() < p; }
  /** Independent child stream derived from this seed and a salt. */
  fork(salt) { return new Rng((this.seed ^ Math.imul((salt | 0) + 1, 0x9E3779B9)) >>> 0); }
}
