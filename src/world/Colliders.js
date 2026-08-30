/**
 * Static world colliders in a uniform grid over the map so an entity only tests the handful of solids in its own
 * and neighbouring cells. Two shapes, both vertical prisms with an optional height band [y0, y1]:
 *   - cylinders (tree trunks, columns, towers, braziers)
 *   - convex polygons (boulders / crags / cliffs from their mesh footprint, every wall and pier of a structure kit)
 * Entities are circles on the XZ plane; `resolve` pushes a position out of every overlapping solid (sliding, not
 * stopping). The band lets merlons, corbels and roof timbers sit in the grid without blocking anyone below them,
 * and lets a knee-high step stay walkable.
 */

/** Andrew's monotone chain: convex hull of [[x,z],...] points, counter-clockwise (x right, z up), no repeats. */
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = [];
  for (const p of pts) { const q = uniq[uniq.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) uniq.push(p); }
  if (uniq.length < 3) return uniq;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) { const p = uniq[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Footprint of a geometry: convex hull (local XZ) of its vertices with yMin <= y <= yMax. Null if fewer than 3. */
export function footprint(geo, yMin = -Infinity, yMax = Infinity) {
  const p = geo.attributes.position, pts = [];
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= yMin && y <= yMax) pts.push([p.getX(i), p.getZ(i)]); }
  const hull = convexHull(pts);
  return hull.length >= 3 ? hull : null;
}

const KNEE = 0.55;   // solids whose top is below this (above the entity's feet) are stepped over
const HEAD = 0.85;   // fraction of the entity height a solid's bottom must be below to block it

export class Colliders {
  constructor(terrain, cell = 8) {
    this.half = terrain.half; this.cell = cell;
    this.n = Math.ceil(terrain.size / cell) + 1;
    this.cells = new Map(); // cell index -> [solid]
    this.count = 0;
    this.kinds = {};        // kind -> count (debug / smoke)
  }

  _cx(x) { return Math.min(this.n - 1, Math.max(0, Math.floor((x + this.half) / this.cell))); }

  _insert(c, x0, x1, z0, z1) {
    const cx0 = this._cx(x0), cx1 = this._cx(x1), cz0 = this._cx(z0), cz1 = this._cx(z1);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cz * this.n + cx;
      let list = this.cells.get(k);
      if (!list) { list = []; this.cells.set(k, list); }
      list.push(c);
    }
    this.count++;
    this.kinds[c.kind] = (this.kinds[c.kind] || 0) + 1;
    return c;
  }

  /** Register a solid cylinder of radius r at (x,z). Large solids spill into every cell they overlap. */
  add(x, z, r, kind = 'solid', y0 = -Infinity, y1 = Infinity) {
    return this._insert({ shape: 0, kind, x, z, r, y0, y1 }, x - r, x + r, z - r, z + r);
  }

  /** Register a convex polygon [[x,z],...] (any winding; must be convex). Degenerate input (< 3 points) is ignored. */
  addPoly(points, kind = 'solid', y0 = -Infinity, y1 = Infinity) {
    const n = points.length;
    if (n < 3) return null;
    // enforce counter-clockwise (positive signed area) so edge normals point outward
    let area = 0;
    for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const pts = area < 0 ? points.slice().reverse() : points;
    const v = new Float32Array(n * 2), nrm = new Float32Array(n * 2);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i]; v[i * 2] = x; v[i * 2 + 1] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, dx = v[j * 2] - v[i * 2], dz = v[j * 2 + 1] - v[i * 2 + 1], len = Math.hypot(dx, dz) || 1;
      nrm[i * 2] = dz / len; nrm[i * 2 + 1] = -dx / len; // outward for CCW in (x, z)
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let rad = 0;
    for (let i = 0; i < n; i++) rad = Math.max(rad, Math.hypot(v[i * 2] - cx, v[i * 2 + 1] - cz));
    return this._insert({ shape: 1, kind, x: cx, z: cz, r: rad, n, v, nrm, y0, y1 }, x0, x1, z0, z1);
  }

  /** Register an oriented box: centre (x,z), half extents (hw along local x, hd along local z), yaw about Y. */
  addBox(x, z, hw, hd, yaw = 0, kind = 'solid', y0 = -Infinity, y1 = Infinity) {
    const c = Math.cos(yaw), s = Math.sin(yaw), pts = [];
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) pts.push([x + lx * c + lz * s, z - lx * s + lz * c]);
    return this.addPoly(pts, kind, y0, y1);
  }

  /** Call fn(solid) for every solid whose cell range overlaps the circle (x,z,r). May repeat spilled solids. */
  forEachNear(x, z, r, fn) {
    const cx0 = this._cx(x - r), cx1 = this._cx(x + r), cz0 = this._cx(z - r), cz1 = this._cx(z + r);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const list = this.cells.get(cz * this.n + cx);
      if (list) for (let i = 0; i < list.length; i++) fn(list[i]);
    }
  }

  /**
   * Push `pos` (Vector3, XZ used) out of every solid it overlaps with the given circle radius. `height` (entity
   * height) selects the solids in the band: a solid blocks only if its top is above the knee and its bottom below
   * the head. Two passes so a body wedged between neighbours settles. Returns true if anything moved it.
   */
  resolve(pos, radius, height = 1.8, y = pos.y) {
    let hit = false;
    const yLo = y + KNEE, yHi = y + height * HEAD;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      this.forEachNear(pos.x, pos.z, radius, (c) => {
        if (c.y1 < yLo || c.y0 > yHi) return;
        if (c.shape === 0 ? this._pushCyl(c, pos, radius) : this._pushPoly(c, pos, radius)) moved = true;
      });
      hit = hit || moved;
      if (!moved) break;
    }
    return hit;
  }

  _pushCyl(c, pos, radius) {
    const dx = pos.x - c.x, dz = pos.z - c.z, min = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-4) { pos.x = c.x + min; return true; } // dead centre: pick a side
    const push = (min - d) / d;
    pos.x += dx * push; pos.z += dz * push;
    return true;
  }

  _pushPoly(c, pos, radius) {
    const dx = pos.x - c.x, dz = pos.z - c.z, reach = c.r + radius;
    if (dx * dx + dz * dz >= reach * reach) return false;
    const { n, v, nrm } = c, px = pos.x, pz = pos.z;
    // deepest edge: the largest signed distance to an edge line (all <= 0 means the centre is inside)
    let maxD = -Infinity, maxI = 0;
    for (let i = 0; i < n; i++) {
      const d = (px - v[i * 2]) * nrm[i * 2] + (pz - v[i * 2 + 1]) * nrm[i * 2 + 1];
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD <= 0) { // inside: leave through the nearest face
      const push = radius - maxD;
      pos.x += nrm[maxI * 2] * push; pos.z += nrm[maxI * 2 + 1] * push;
      return true;
    }
    if (maxD >= radius) return false; // cheap reject: farther than the radius from the deepest edge line
    // outside: nearest point on the boundary
    let best = Infinity, bx = 0, bz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = v[i * 2], az = v[i * 2 + 1], ex = v[j * 2] - ax, ez = v[j * 2 + 1] - az;
      const l2 = ex * ex + ez * ez || 1;
      let t = ((px - ax) * ex + (pz - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qz = az + ez * t, d2 = (px - qx) ** 2 + (pz - qz) ** 2;
      if (d2 < best) { best = d2; bx = qx; bz = qz; }
    }
    if (best >= radius * radius) return false;
    const d = Math.sqrt(best);
    if (d < 1e-5) { pos.x += nrm[maxI * 2] * radius; pos.z += nrm[maxI * 2 + 1] * radius; return true; }
    const push = (radius - d) / d;
    pos.x += (px - bx) * push; pos.z += (pz - bz) * push;
    return true;
  }

  /** True if the circle (x,z,r) at ground height y overlaps any solid (placement / spawn / reachability checks). */
  overlaps(x, z, r, y = -Infinity, height = 1.8) {
    let hit = false;
    const yLo = y + KNEE, yHi = y === -Infinity ? Infinity : y + height * HEAD;
    const p = { x, z };
    this.forEachNear(x, z, r, (c) => {
      if (hit || c.y1 < yLo || c.y0 > yHi) return;
      p.x = x; p.z = z;
      hit = c.shape === 0 ? this._pushCyl(c, p, r) : this._pushPoly(c, p, r);
    });
    return hit;
  }
}
