/**
 * Ranged attacks: arrows (Ironeye) and glintstone bolts (Recluse / Revenant). A ranged moveset entry carries
 * `ranged: { kind, speed, life, radius }`; the Player fires at the start of its active frames and Combat steps
 * the flight here — each projectile is swept as a segment against enemy cylinders and the terrain, and a hit
 * goes through the same applyHit() as melee so hit-stop, shake, poise and rune payout all match. Meshes use
 * shared per-kind geometry; bolts leave a glow trail and pulse the impact light on release and on contact.
 */
import * as THREE from 'three';
import { PALETTE } from '../render/Style.js';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Color();
const MAX = 24;

const KINDS = {
  arrow:      { radius: 0.18, glow: null },
  glintstone: { radius: 0.32, glow: 0x8a6aff, size: 0.13 },
  comet:      { radius: 0.5, glow: 0x9a7aff, size: 0.24 },
};

export class Projectiles {
  constructor(combat) {
    this.combat = combat; this.game = combat.game;
    this.list = [];
    // shared geometry / materials (an arrow is shaft + head + fletching in one group; bolts are a bright orb)
    const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5); shaft.rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.03, 0.12, 5); head.rotateX(Math.PI / 2); head.translate(0, 0, 0.44);
    const fletch = new THREE.BoxGeometry(0.05, 0.005, 0.09); fletch.translate(0, 0, -0.34);
    const fletch2 = fletch.clone().rotateZ(Math.PI / 2);
    this.geo = { shaft, head, fletch, fletch2, orb: new THREE.SphereGeometry(1, 8, 6) };
    this.mat = {
      wood: new THREE.MeshBasicMaterial({ color: PALETTE.woodDark }),
      steel: new THREE.MeshBasicMaterial({ color: 0xc8ccd4 }),
      fletch: new THREE.MeshBasicMaterial({ color: 0xd8d4c8 }),
      orb: new THREE.MeshBasicMaterial({ color: 0xd8ccff }),
    };
  }

  makeMesh(kind) {
    const K = KINDS[kind] || KINDS.arrow;
    if (!K.glow) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geo.shaft, this.mat.wood), new THREE.Mesh(this.geo.head, this.mat.steel), new THREE.Mesh(this.geo.fletch, this.mat.fletch), new THREE.Mesh(this.geo.fletch2, this.mat.fletch));
      return g;
    }
    const m = new THREE.Mesh(this.geo.orb, this.mat.orb);
    m.scale.setScalar(K.size);
    return m;
  }

  /** Launch `def.ranged` from `origin` along unit `dir` on behalf of `att`. */
  fire(att, def, origin, dir) {
    const R = def.ranged, K = KINDS[R.kind] || KINDS.arrow;
    if (this.list.length >= MAX) this.kill(0);
    const mesh = this.makeMesh(R.kind);
    const pr = { att, def, kind: R.kind, pos: origin.clone(), vel: dir.clone().multiplyScalar(R.speed), life: R.life || 1.8, radius: R.radius || K.radius, mesh, glow: K.glow };
    mesh.position.copy(pr.pos); mesh.lookAt(_p.copy(pr.pos).add(dir));
    this.game.scene.add(mesh); this.list.push(pr);
    if (K.glow) { this.combat.flashLight(origin, K.glow, 1.4); this.puff(pr, 6, 0.6); }
  }

  update(dt) {
    const g = this.game, T = g.terrain, ents = g.entities;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pr = this.list[i];
      _q.copy(pr.pos);
      pr.pos.addScaledVector(pr.vel, dt);
      if (!pr.glow) pr.vel.y -= 5 * dt; // arrows drop a little over range
      pr.life -= dt;
      pr.mesh.position.copy(pr.pos); pr.mesh.lookAt(_p.copy(pr.pos).add(pr.vel));
      if (pr.glow) this.puff(pr, 2, 0.22);
      // swept hit test: closest point on this step's segment to each hostile's body cylinder
      let hit = null;
      _d.subVectors(pr.pos, _q); const L2 = _d.lengthSq() || 1e-6;
      for (let j = 0; j < ents.length; j++) {
        const t = ents[j];
        if (t === pr.att || !t.alive || t.team === pr.att.team) continue;
        const cy = t.pos.y + t.height * t.scale * 0.55, rr = t.radius * t.scale + pr.radius;
        _p.set(t.pos.x, cy, t.pos.z).sub(_q);
        let k = _p.dot(_d) / L2; k = k < 0 ? 0 : k > 1 ? 1 : k;
        _p.copy(_q).addScaledVector(_d, k);
        const dx = _p.x - t.pos.x, dz = _p.z - t.pos.z;
        if (dx * dx + dz * dz <= rr * rr && Math.abs(_p.y - cy) <= t.height * t.scale * 0.6 + pr.radius) { hit = t; break; }
      }
      if (hit) { this.combat.applyHit(pr.att, hit, pr.def); if (pr.glow) this.burst(pr); this.kill(i); continue; }
      const gh = T.getHeight(pr.pos.x, pr.pos.z);
      if (pr.pos.y <= gh + 0.02) {
        pr.pos.y = gh + 0.03;
        if (pr.glow) this.burst(pr); else this.combat.dust(pr.pos.x, gh, pr.pos.z, 4, 0, 0, 0.5, 0.22);
        this.kill(i); continue;
      }
      if (pr.life <= 0) this.kill(i);
    }
  }

  /** Soft glow motes shed along a bolt's path (n particles, spread in m). */
  puff(pr, n, spread) {
    const s = this.combat.sparks; _c.setHex(pr.glow);
    for (let i = 0; i < n; i++) {
      s.spawn(pr.pos.x + (Math.random() - 0.5) * spread * 0.3, pr.pos.y + (Math.random() - 0.5) * spread * 0.3, pr.pos.z + (Math.random() - 0.5) * spread * 0.3,
        (Math.random() - 0.5) * spread, (Math.random() - 0.3) * spread, (Math.random() - 0.5) * spread, 0.2 + Math.random() * 0.2, 0.05 + Math.random() * 0.04,
        _c.r * 1.7, _c.g * 1.7, _c.b * 1.7, 1, 0, 2, 0.6);
    }
  }

  /** A bolt bursting: ring + glow + a spray of motes, and a violet light pulse. */
  burst(pr) {
    const s = this.combat.sparks, p = pr.pos; _c.setHex(pr.glow);
    const big = pr.kind === 'comet' ? 1.8 : 1;
    s.spawn(p.x, p.y, p.z, 0, 0, 0, 0.16, 0.25 * big, _c.r * 1.2, _c.g * 1.2, _c.b * 1.2, 2, 0, 0, 1.4);
    s.spawn(p.x, p.y, p.z, 0, 0, 0, 0.14, 0.3 * big, _c.r * 0.8, _c.g * 0.8, _c.b * 0.8, 1, 0, 0, 0.8);
    this.puff(pr, Math.round(14 * big), 3.2 * big);
    this.combat.flashLight(p, pr.glow, 3 * big);
  }

  kill(i) {
    const pr = this.list[i];
    this.game.scene.remove(pr.mesh);
    this.list[i] = this.list[this.list.length - 1]; this.list.pop();
  }

  clear() { while (this.list.length) this.kill(0); }
}
