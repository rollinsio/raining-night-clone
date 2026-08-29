/**
 * Static world colliders: vertical cylinders (tree trunks, later boulders / posts) in a uniform grid over the
 * map so an entity only tests the handful of solids in its own and neighbouring cells. Entities are circles
 * on the XZ plane; `resolve` pushes a position out of every overlapping cylinder (sliding, not stopping).
 */
export class Colliders {
  constructor(terrain, cell = 8) {
    this.half = terrain.half; this.cell = cell;
    this.n = Math.ceil(terrain.size / cell) + 1;
    this.cells = new Map(); // cell index -> [{x, z, r, kind}]
    this.count = 0;
  }

  _key(x, z) {
    const n = this.n;
    const cx = Math.min(n - 1, Math.max(0, Math.floor((x + this.half) / this.cell)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor((z + this.half) / this.cell)));
    return cz * n + cx;
  }

  /** Register a solid cylinder of radius r at (x,z). Large solids spill into every cell they overlap. */
  add(x, z, r, kind = 'solid') {
    const c = { x, z, r, kind };
    const x0 = this._key(x - r, 0) % this.n, x1 = this._key(x + r, 0) % this.n;
    const z0 = Math.floor(this._key(0, z - r) / this.n), z1 = Math.floor(this._key(0, z + r) / this.n);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const k = cz * this.n + cx;
      let list = this.cells.get(k);
      if (!list) { list = []; this.cells.set(k, list); }
      list.push(c);
    }
    this.count++;
    return c;
  }

  /** Call fn(collider) for every solid whose cell range overlaps the circle (x,z,r). May repeat spilled solids. */
  forEachNear(x, z, r, fn) {
    const x0 = this._key(x - r, 0) % this.n, x1 = this._key(x + r, 0) % this.n;
    const z0 = Math.floor(this._key(0, z - r) / this.n), z1 = Math.floor(this._key(0, z + r) / this.n);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const list = this.cells.get(cz * this.n + cx);
      if (list) for (let i = 0; i < list.length; i++) fn(list[i]);
    }
  }

  /**
   * Push `pos` (Vector3, XZ used) out of every cylinder it overlaps with the given circle radius.
   * Two passes so a body wedged between neighbours settles. Returns true if anything moved it.
   */
  resolve(pos, radius) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      this.forEachNear(pos.x, pos.z, radius, (c) => {
        const dx = pos.x - c.x, dz = pos.z - c.z, min = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) return;
        const d = Math.sqrt(d2);
        if (d < 1e-4) { pos.x = c.x + min; return; } // dead centre: pick a side
        const push = (min - d) / d;
        pos.x += dx * push; pos.z += dz * push;
        moved = true;
      });
      hit = hit || moved;
      if (!moved) break;
    }
    return hit;
  }

  /** True if the circle (x,z,r) overlaps any solid (placement / spawn checks). */
  overlaps(x, z, r) {
    let hit = false;
    this.forEachNear(x, z, r, (c) => { if (!hit) { const m = c.r + r; hit = (c.x - x) ** 2 + (c.z - z) ** 2 < m * m; } });
    return hit;
  }
}
