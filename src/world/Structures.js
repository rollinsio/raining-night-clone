/**
 * Buildable kits: church(), fort(), ruin(), catacombEntrance(), camp().
 *
 * A Kit collects primitives (boxes, cylinders, cones, gable prisms, wedges, pointed-arch walls) in a
 * stack of local frames and merges them into ONE vertex-coloured flat-shaded mesh (+ one emissive mesh
 * for flames). Vertex colours carry most of the look: per-block tint, height AO, a damp base course, a
 * faint per-vertex mottle so big facets are not dead-flat, a foundation band keyed to the real ground (or a
 * declared built floor), a baked point-based occlusion pass over the merged masonry, and warm light from every
 * flame that fire() registers (carried as a `warm` attribute and rendered as emission). Site dressing
 * (buttresses, stairs, merlons, torches, graves, ...) lives in POI.js and draws into the same kit, so a whole
 * site is still one draw call (+1 for the glows, +1 for the terrain-conforming ground decal when the kit is
 * given a `ground` sampler: trodden tracks, damp halos at every footing, torch pools).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, vertexMat, emissive } from '../render/Style.js';
import * as POI from './POI.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _col = new THREE.Color(), _c2 = new THREE.Color(), _damp = new THREE.Color(PALETTE.terrain.damp), _mud = new THREE.Color(PALETTE.terrain.mud), _UP = new THREE.Vector3(0, 1, 0);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
/** Deterministic mottle in [-1, 1] from a quantised position (shared corners agree, so faces stay continuous). */
function mottle(x, y, z) {
  const h = Math.sin(Math.round(x * 16) * 12.9898 + Math.round(y * 16) * 78.233 + Math.round(z * 16) * 37.719) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}
/** Hash in [-1, 1] from an integer id (per-facet value jitter). */
function fhash(i) { const h = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (h - Math.floor(h)) * 2 - 1; }
/** Hash in [0, 1] from two integers. */
function hash2(i, j) { const h = Math.sin(i * 127.1 + j * 311.7 + 74.7) * 43758.5453; return h - Math.floor(h); }
/** Smooth low-frequency weathering in [-1, 1]: 2-4 m patches of lighter / darker stone, continuous across blocks. */
function weather(x, y, z) {
  return (Math.sin(x * 0.9 + z * 0.45 + 1.7) * Math.sin(y * 0.75 - x * 0.5 + z * 0.8 + 0.4) + Math.sin(x * 1.9 - z * 1.6 + y * 0.3) * Math.sin(y * 1.3 + z * 0.7)) * 0.5;
}
/** Bilinear value noise in [0, 1] over the ground plane (decal edge break-up). */
function vnoise2(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(x0, z0), hash2(x0 + 1, z0), sx), lerp(hash2(x0, z0 + 1), hash2(x0 + 1, z0 + 1), sx), sz);
}
/** Distance from (x, z) to the axis-aligned rectangle [x0, x1] x [z0, z1]. */
function rectDist(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.sqrt(dx * dx + dz * dz);
}
/** Distance from (x, z) to a polyline [[x, z], ...]. */
function polyDist(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t - x, pz = az + dz * t - z;
    best = Math.min(best, px * px + pz * pz);
  }
  return Math.sqrt(best);
}

/**
 * Structure shading hook shared by the masonry material and the ground decal: (1) wrapped direct lighting
 * (wrap 0.42) so faces turned from the moon keep a mid blue-grey fill instead of going black, and (2) the baked
 * torch light carried in the `warm` vertex attribute is added as EMISSION scaled by the albedo — a warm pool
 * that stays warm on the shadow side of a wall instead of an orange albedo tint the moon then cools.
 */
const WRAP = 0.42;
function hookStruct(m, key) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTorch = { value: new THREE.Color(PALETTE.torch) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float warm;\nvarying float vWarm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWarm = warm;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTorch;\nvarying float vWarm;')
      .replace('#include <lights_physical_pars_fragment>',
        THREE.ShaderChunk.lights_physical_pars_fragment.replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
          `float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + ${WRAP.toFixed(2)} ) / ${(1 + WRAP).toFixed(2)} );`))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uTorch * vWarm;');
  };
  m.customProgramCacheKey = () => key;
  return m;
}
let _structMat = null, _decalMat = null;
/** Masonry: the shared vertex-coloured flat material with the structure hook. One program for every kit. */
function structMat() { return _structMat || (_structMat = hookStruct(vertexMat().clone(), 'struct-wrap')); }
/** Ground decal: same look, RGBA vertex colours (alpha fades it into the turf), no depth write, pulled toward the camera. */
function decalMat() {
  if (_decalMat) return _decalMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return (_decalMat = hookStruct(m, 'struct-decal'));
}

/** Triangular prism (gable), ridge along local Z, base on y=0, width w (x), height h, depth d. */
function prismGeo(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, hd, hw, 0, hd, 0, h, hd,                                   // front triangle (+z)
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,                                // back triangle (-z)
    -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd, // left slope
    hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,  // right slope
    -hw, 0, hd, -hw, 0, -hd, hw, 0, -hd, -hw, 0, hd, hw, 0, -hd, hw, 0, hd, // bottom
  ];
  return rawGeo(v);
}
/** Right-triangular prism: vertical face at z=0 (height h) sloping down to z=d; spans x +-w/2 (buttress caps, copings). */
function wedgeGeo(w, d, h) {
  const hw = w / 2;
  const v = [
    hw, 0, 0, hw, h, 0, hw, 0, d,
    -hw, 0, 0, -hw, 0, d, -hw, h, 0,
    -hw, 0, 0, hw, 0, 0, hw, 0, d, -hw, 0, 0, hw, 0, d, -hw, 0, d,
    -hw, 0, 0, -hw, h, 0, hw, h, 0, -hw, 0, 0, hw, h, 0, hw, 0, 0,
    -hw, h, 0, -hw, 0, d, hw, 0, d, -hw, h, 0, hw, 0, d, hw, h, 0,
  ];
  return rawGeo(v);
}
function rawGeo(v) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

export class Kit {
  /**
   * o.ground(lx, lz): terrain height in kit space (0 at the POI centre). With it the foundation band follows the
   * real ground and build() lays a ground decal (tracks, wall-foot halos, torch pools). Without it, footings
   * shade from the current frame's floor and no decal is built.
   */
  constructor(rng, o = {}) {
    this.rng = rng; this.geos = []; this.glows = []; this.spawns = []; this.fires = []; this.bakeFires = []; this.radius = 10;
    this.frame = new THREE.Matrix4(); this.stack = [];
    this.ground = o.ground || null;
    /** Built floor height (kit space) for geometry standing on a plinth / paved floor; null = the terrain. */
    this.floor = null;
    this.feet = [];    // kit-space footprints of geometry rooted in the ground (decal halos)
    this.solids = [];  // kit-space walk-blocking footprints {x, z, hw, hd, yaw | r, y0, y1} (Limveld feeds them to Colliders)
    this.walks = [];   // kit-space walkable platforms {x, z, hw, hd, yaw, y0, y1}: solid:false floors / steps whose flat top is standable
    this.tracks = [];  // trodden-dirt polylines [{pts, w}]
    this.decal = null; // {x0, x1, z0, z1, cell} extent of the ground decal
    /** Shading knobs: gentle massing AO (aoBase at the ground -> 1 at aoTop), foundation band (bandK darker at the
     *  floor, gone bandH up), damp base course (dampW over dampH), weathering amplitude, per-facet value jitter. */
    this.aoBase = 0.8; this.aoTop = 7.0; this.bandK = 0.5; this.bandH = 1.7; this.dampW = 0.5; this.dampH = 1.1; this.weather = 0.09; this.facet = 0.05;
    /** Baked occlusion: emitter reach, darkening at full occlusion, response gain. */
    this.ao = { radius: 1.8, strength: 0.82, gain: 1.25 };
  }
  /** Absolute local frame (translation + yaw) applied to subsequent primitives. */
  setFrame(x, z, ry = 0, y = 0) { _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); this.frame.compose(_p, _q, _s); }
  clearFrame() { this.frame.identity(); this.stack.length = 0; }
  /** Push a child frame (translation + yaw) composed onto the current one; pop() restores the parent. */
  push(x, z, ry = 0, y = 0) {
    this.stack.push(this.frame);
    _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, _s);
    this.frame = new THREE.Matrix4().multiplyMatrices(this.frame, _m);
  }
  pop() { this.frame = this.stack.pop() || new THREE.Matrix4(); }
  /**
   * Register a flame at a frame-local point: build() bakes warm light nearby and (unless o.halo === false)
   * Atmosphere draws a distant glow billboard there — sconces on a facade skip the halo so the stone, not a
   * hovering disc, carries the light.
   */
  fire(x, y, z, o = {}) {
    _p.set(x, y, z).applyMatrix4(this.frame);
    (o.halo === false ? this.bakeFires : this.fires).push({ x: _p.x, y: _p.y, z: _p.z, r: o.r ?? 2.6, i: o.i ?? 2.0 });
  }
  /** Trodden-dirt track for the ground decal: frame-local polyline [[x, z], ...], worn width w (m). */
  track(pts, w = 1.4) {
    this.tracks.push({ w, pts: pts.map(([x, z]) => { _p.set(x, 0, z).applyMatrix4(this.frame); return [_p.x, _p.z]; }) });
  }
  /** Height of the surface this geometry stands on at kit (x, z): the declared built floor, else the terrain, else the frame. */
  floorAt(x, z) { return this.floor ?? (this.ground ? this.ground(x, z) : this.frame.elements[13]); }

  /** Terrain height (kit space) under a point given in the CURRENT frame (0 without a ground sampler). */
  groundLocal(lx, lz) { if (!this.ground) return 0; _p.set(lx, 0, lz).applyMatrix4(this.frame); return this.ground(_p.x, _p.z); }

  /**
   * Add a geometry transformed by (centre, euler) then the frame; bakes vertex colour:
   * tint x mul x massing AO x foundation band x mottle, damp base course. o: {tint, mul, ao:false, glow, dim, rx, ry, rz, seg, foot:false}.
   */
  add(geo, color, cx, cy, cz, rx = 0, ry = 0, rz = 0, o = {}) {
    if (!(Number.isFinite(cx + cy + cz + rx + ry + rz) && Number.isFinite(color))) throw new Error(`Kit.add: non-finite argument (${[color, cx, cy, cz, rx, ry, rz].join(', ')})`);
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(cx, cy, cz); _m.compose(_p, _q, _s).premultiply(this.frame);
    if (geo.index) geo = geo.toNonIndexed();
    // walk-blocking footprint from the local bounds (before the transform) — o.solid:false for floors and steps,
    // which become walkable platforms instead (flat, yaw-only pieces: tilted causeway slabs stay terrain-walked)
    const solid = o.solid !== false && !o.glow && o.ao !== false;
    const walk = o.solid === false && !o.glow && o.ao !== false && rx === 0 && rz === 0;
    let bb = null;
    if (solid || walk) { // plain numbers: applyMatrix4 below would recompute geo.boundingBox in place
      geo.computeBoundingBox(); const b = geo.boundingBox;
      bb = { cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, hw: (b.max.x - b.min.x) / 2, hd: (b.max.z - b.min.z) / 2 };
    }
    geo.applyMatrix4(_m);
    const n = geo.attributes.position.count, pos = geo.attributes.position.array, col = new Float32Array(n * 3), mask = new Float32Array(n), warm = new Float32Array(n);
    _col.setHex(color);
    const tint = (o.tint ?? (0.82 + this.rng.float() * 0.2)) * (o.mul ?? 1), shade = o.ao !== false && !o.glow, dim = o.dim ? 0.3 : 1;
    const facet = o.glow ? 0 : (o.facet ?? this.facet), fseed = (this.geos.length * 7 + 3) * 1.618;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      let k = tint * dim, r = _col.r, g = _col.g, b = _col.b;
      if (shade) {
        const h = y - this.floorAt(x, z);
        k *= (this.aoBase + (1 - this.aoBase) * smoothstep(-0.2, this.aoTop, y)) * (1 + 0.09 * mottle(x, y, z)) * (1 + this.weather * weather(x, y, z));
        k *= 1 - this.bandK * (1 - smoothstep(-0.1, this.bandH, h));
        const w = this.dampW * (1 - smoothstep(-0.4, this.dampH, h));
        if (w > 0) { r += (_damp.r - r) * w; g += (_damp.g - g) * w; b += (_damp.b - b) * w; }
        mask[i] = 1;
      }
      if (facet > 0) k *= 1 + facet * fhash(((i / 6) | 0) + fseed); // one value per quad (6 verts of a non-indexed box face)
      col[i * 3] = r * k; col[i * 3 + 1] = g * k; col[i * 3 + 2] = b * k;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aomask', new THREE.BufferAttribute(mask, 1));
    geo.setAttribute('warm', new THREE.BufferAttribute(warm, 1));
    if (shade && o.foot !== false) this.feet.push({ x0, x1, y0, y1, z0, z1 });
    if (solid) this._solid(bb, rx, rz, x0, x1, y0, y1, z0, z1, o);
    else if (walk) this._walk(bb, y0, y1);
    (o.glow ? this.glows : this.geos).push(geo);
  }
  /**
   * Record a walk-blocking footprint (kit space) for the piece just added: an oriented box for yaw-only pieces
   * (a cylinder for o.round ones), the kit-space AABB for tilted ones. Flat slabs, thin poles and pieces entirely
   * below the knee or above head height are skipped, so copings, ropes, merlons and roof timbers never register.
   */
  _solid(bb, rx, rz, x0, x1, y0, y1, z0, z1, o) {
    if (y1 - y0 < 0.35) return;
    let s;
    if (rx === 0 && rz === 0) {
      const e = _m.elements, yaw = Math.atan2(e[8], e[10]);
      _p.set(bb.cx, 0, bb.cz).applyMatrix4(_m);
      s = o.round ? { x: _p.x, z: _p.z, r: Math.max(bb.hw, bb.hd), y0, y1 } : { x: _p.x, z: _p.z, hw: bb.hw, hd: bb.hd, yaw, y0, y1 };
    } else s = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, yaw: 0, y0, y1 };
    if ((s.r !== undefined ? s.r * 2 : Math.max(s.hw, s.hd) * 2) < 0.22) return;
    const floor = this.floorAt(s.x, s.z);
    if (y1 < floor + 0.55 || y0 > floor + 2.2) return;
    this.solids.push(s);
  }
  /**
   * Record a walkable platform (kit space) for the piece just added (declared solid:false, yaw-only): an oriented
   * box whose flat top is standable and whose sides block below it, so plinths and stair steps are real floors.
   * No knee/head filter — a 0.2 m step must register — but slivers are skipped.
   */
  _walk(bb, y0, y1) {
    if (Math.min(bb.hw, bb.hd) < 0.12) return; // keep stair steps (~0.17 m half-depth); drop true slivers
    const e = _m.elements, yaw = Math.atan2(e[8], e[10]);
    _p.set(bb.cx, 0, bb.cz).applyMatrix4(_m);
    this.walks.push({ x: _p.x, z: _p.z, hw: bb.hw, hd: bb.hd, yaw, y0, y1 });
  }
  _boxGeo(w, h, d, seg) { const s = seg ?? 1.5; return new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s)), Math.max(1, Math.round(d / s))); }
  /** Box with its base at y. Faces are subdivided every o.seg metres (default 1.5) so baked light can vary across them. */
  box(w, h, d, x, y, z, color, o = {}) { this.add(this._boxGeo(w, h, d, o.seg), color, x, y + h / 2, z, o.rx || 0, o.ry || 0, o.rz || 0, o); }
  /** Box positioned by centre with arbitrary rotation. */
  boxC(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0, o = {}) { this.add(this._boxGeo(w, h, d, o.seg), color, x, y, z, rx, ry, rz, o); }
  cyl(rt, rb, h, segs, x, y, z, color, o = {}) { this.add(new THREE.CylinderGeometry(rt, rb, h, segs, 1, !!o.open), color, x, y + h / 2, z, o.rx || 0, o.ry || 0, o.rz || 0, { round: true, ...o }); }
  /** Cylinder by centre with rotation (for fallen columns / logs). */
  cylC(rt, rb, h, segs, x, y, z, color, rx = 0, ry = 0, rz = 0, o = {}) { this.add(new THREE.CylinderGeometry(rt, rb, h, segs, 1), color, x, y, z, rx, ry, rz, o); }
  cone(r, h, segs, x, y, z, color, o = {}) { this.add(new THREE.ConeGeometry(r, h, segs), color, x, y + h / 2, z, o.rx || 0, o.ry || 0, o.rz || 0, { round: true, ...o }); }
  prism(w, h, d, x, y, z, color, o = {}) { this.add(prismGeo(w, h, d), color, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o); }
  /** Wedge: vertical face at z (height h) sloping to zero at z + d, spanning x +- w/2 (set-off caps, copings). */
  wedge(w, d, h, x, y, z, color, o = {}) { this.add(wedgeGeo(w, d, h), color, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o); }
  /** Timber / slab between two frame-local points: w thick across the beam, o.d thick along the third axis (default w). */
  beam(ax, ay, az, bx, by, bz, w, color, o = {}) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    _p.set(dx, dy, dz).normalize(); _q.setFromUnitVectors(_UP, _p); _e.setFromQuaternion(_q);
    const rx = _e.x, ry = _e.y, rz = _e.z;
    this.add(this._boxGeo(w, len, o.d ?? w, o.seg ?? 1.5), color, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rx, ry, rz, o);
  }

  /** Masonry filling the pointed head of an opening (x centre, width w, sill, apex) in a wall of thickness t. */
  archHead(x, w, sill, apex, t, color, o = {}) {
    const rectTop = apex - w * 0.62, rise = apex - rectTop, x0 = x - w / 2, x1 = x + w / 2;
    const sideLen = Math.hypot(w / 2, rise), ang = Math.atan2(rise, w / 2);
    const ts = Math.max(0.5, rise * Math.cos(ang) * 1.05), my = (rectTop + apex) / 2, tz = t - 0.04;
    this.boxC(sideLen + 0.1, ts, tz, (x0 + x) / 2 - Math.sin(ang) * ts / 2, my + Math.cos(ang) * ts / 2, 0, color, 0, 0, ang, o);
    this.boxC(sideLen + 0.1, ts, tz, (x1 + x) / 2 + Math.sin(ang) * ts / 2, my + Math.cos(ang) * ts / 2, 0, color, 0, 0, -ang, o);
  }
  /**
   * Wall along local X (length L centred on 0, thickness t centred on z=0, height H from y=0) with
   * pointed-arch openings [{x, w, h, sill}] (h = full opening height including the point). Openings may
   * stack vertically (a lancet above a portal).
   */
  gothicWall(L, H, t, openings, color, o = {}) {
    const ops = openings.slice().sort((a, b) => (a.x - a.w / 2) - (b.x - b.w / 2));
    const cols = [];
    for (const op of ops) {
      const x0 = op.x - op.w / 2, x1 = op.x + op.w / 2, c = cols[cols.length - 1];
      if (c && x0 < c.x1 - 0.01) { c.x1 = Math.max(c.x1, x1); c.ops.push(op); } else cols.push({ x0, x1, ops: [op] });
    }
    let cursor = -L / 2;
    for (const c of cols) {
      if (c.x0 - cursor > 0.01) this.box(c.x0 - cursor, H, t, (cursor + c.x0) / 2, 0, 0, color, o);
      const cw = c.x1 - c.x0, cx = (c.x0 + c.x1) / 2;
      c.ops.sort((a, b) => (a.sill || 0) - (b.sill || 0));
      let y = 0;
      for (const op of c.ops) {
        const sill = op.sill || 0, apex = sill + op.h, ox0 = op.x - op.w / 2, ox1 = op.x + op.w / 2;
        if (sill - y > 0.01) this.box(cw, sill - y, t, cx, y, 0, color, o);
        if (ox0 - c.x0 > 0.01) this.box(ox0 - c.x0, op.h, t, (c.x0 + ox0) / 2, sill, 0, color, o);
        if (c.x1 - ox1 > 0.01) this.box(c.x1 - ox1, op.h, t, (ox1 + c.x1) / 2, sill, 0, color, o);
        this.archHead(op.x, op.w, sill, apex, t, color, o);
        y = apex;
      }
      if (H - y > 0.01) this.box(cw, H - y, t, cx, y, 0, color, o);
      cursor = c.x1;
    }
    if (L / 2 - cursor > 0.01) this.box(L / 2 - cursor, H, t, (cursor + L / 2) / 2, 0, 0, color, o);
  }
  archWall(L, H, t, openings, color) { this.gothicWall(L, H, t, openings, color); }

  /** Warm light from every registered flame into the `warm` attribute of a merged geometry (normal-weighted, quadratic falloff). */
  _bakeWarm(g) {
    if (!this.fires.length && !this.bakeFires.length) return;
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, warm = g.attributes.warm.array, n = g.attributes.position.count;
    for (const f of this.fires.concat(this.bakeFires)) {
      const r = f.r ?? 3, inten = f.i ?? 2, r2 = r * r;
      for (let i = 0; i < n; i++) {
        const dx = f.x - pos[i * 3], dy = f.y - pos[i * 3 + 1], dz = f.z - pos[i * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2), facing = d > 0.01 ? Math.max(0, (nor[i * 3] * dx + nor[i * 3 + 1] * dy + nor[i * 3 + 2] * dz) / d) : 1;
        warm[i] += (1 - d / r) ** 2 * inten * (0.25 + 0.75 * facing);
      }
    }
  }

  /**
   * Point-based occlusion over the merged masonry (Bunnell disc emitters, one per triangle, ONE-sided since every
   * block is solid) multiplied into the vertex colours: inside corners where buttresses meet walls, under arches
   * and cornices, between gravestones, the plinth top along the wall feet. A uniform grid of `radius` cells keeps
   * it to a few million pair tests. Vertices whose `aomask` is 0 (flames, recess slabs, ironwork) receive nothing.
   */
  _bakeAO(g) {
    const { radius: R, strength, gain } = this.ao;
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, col = g.attributes.color.array, mask = g.attributes.aomask.array;
    const n = pos.length / 3, F = n / 3;
    const ec = new Float32Array(F * 3), en = new Float32Array(F * 3), ea = new Float32Array(F);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let f = 0; f < F; f++) {
      const a = f * 9;
      const ax = pos[a + 3] - pos[a], ay = pos[a + 4] - pos[a + 1], az = pos[a + 5] - pos[a + 2];
      const bx = pos[a + 6] - pos[a], by = pos[a + 7] - pos[a + 1], bz = pos[a + 8] - pos[a + 2];
      const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, l = Math.hypot(x, y, z) || 1e-9;
      en[f * 3] = x / l; en[f * 3 + 1] = y / l; en[f * 3 + 2] = z / l; ea[f] = Math.min(l * 0.5, 2.5);
      const cx = (pos[a] + pos[a + 3] + pos[a + 6]) / 3, cy = (pos[a + 1] + pos[a + 4] + pos[a + 7]) / 3, cz = (pos[a + 2] + pos[a + 5] + pos[a + 8]) / 3;
      ec[f * 3] = cx; ec[f * 3 + 1] = cy; ec[f * 3 + 2] = cz;
      if (cx < minX) minX = cx; if (cy < minY) minY = cy; if (cz < minZ) minZ = cz;
      if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy; if (cz > maxZ) maxZ = cz;
    }
    const cell = R, nx = Math.ceil((maxX - minX) / cell) + 1, ny = Math.ceil((maxY - minY) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
    const cx_ = (x) => Math.min(nx - 1, Math.max(0, ((x - minX) / cell) | 0)), cy_ = (y) => Math.min(ny - 1, Math.max(0, ((y - minY) / cell) | 0)), cz_ = (z) => Math.min(nz - 1, Math.max(0, ((z - minZ) / cell) | 0));
    const counts = new Int32Array(nx * ny * nz + 1), fc = new Int32Array(F);
    for (let f = 0; f < F; f++) { fc[f] = (cx_(ec[f * 3]) * ny + cy_(ec[f * 3 + 1])) * nz + cz_(ec[f * 3 + 2]); counts[fc[f] + 1]++; }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    const order = new Int32Array(F), fill = counts.slice();
    for (let f = 0; f < F; f++) order[fill[fc[f]]++] = f;
    const R2 = R * R;
    for (let i = 0; i < n; i++) {
      if (mask[i] === 0) continue;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2], mx = nor[i * 3], my = nor[i * 3 + 1], mz = nor[i * 3 + 2];
      const c0 = cx_(px), c1 = cy_(py), c2 = cz_(pz);
      let occ = 0;
      for (let gx = Math.max(0, c0 - 1); gx <= Math.min(nx - 1, c0 + 1); gx++)
        for (let gy = Math.max(0, c1 - 1); gy <= Math.min(ny - 1, c1 + 1); gy++)
          for (let gz = Math.max(0, c2 - 1); gz <= Math.min(nz - 1, c2 + 1); gz++) {
            const id = (gx * ny + gy) * nz + gz;
            for (let k = counts[id]; k < counts[id + 1]; k++) {
              const f = order[k];
              let vx = ec[f * 3] - px, vy = ec[f * 3 + 1] - py, vz = ec[f * 3 + 2] - pz;
              const d2 = vx * vx + vy * vy + vz * vz;
              if (d2 > R2 || d2 < 1e-6) continue;
              const d = Math.sqrt(d2); vx /= d; vy /= d; vz /= d;
              const cosR = mx * vx + my * vy + mz * vz - 0.04; // coplanar neighbours (the next block along a wall) are not occluders
              if (cosR <= 0) continue;
              const cosE = -(en[f * 3] * vx + en[f * 3 + 1] * vy + en[f * 3 + 2] * vz); // only faces turned toward the receiver
              if (cosE <= 0.02) continue;
              occ += (ea[f] * cosE * cosR) / (Math.PI * (d2 + 1e-3) + ea[f]) * (1 - d2 / R2);
            }
          }
      if (occ <= 0) continue;
      const ao = 1 - strength * Math.min(1, Math.pow(occ * gain, 0.85));
      col[i * 3] *= ao; col[i * 3 + 1] *= ao; col[i * 3 + 2] *= ao;
    }
  }

  /**
   * Terrain-conforming ground decal over this.decal's extent: trodden-dirt tracks (lighter, warmer), damp dark
   * halos around every footing that pokes out of the turf, warm pools under flames. Smooth per-vertex masks with a
   * coarse per-facet value jitter so it reads as more of the same faceted ground, not a sticker. Alpha is 0 where
   * nothing happens, so the turf shows through untouched.
   */
  _buildDecal() {
    if (!this.ground || !this.decal) return null;
    const { x0, x1, z0, z1, cell = 1.0, lift = 0.05 } = this.decal, G = this.ground;
    const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell)), cw = (x1 - x0) / nx, cd = (z1 - z0) / nz;
    const count = nx * nz * 6, pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 4), warm = new Float32Array(count), mask = new Float32Array(count);
    const path = _col.setHex(PALETTE.terrain.path).clone().lerp(_c2.setHex(PALETTE.terrain.sand), 0.3), edge = _c2.setHex(PALETTE.terrain.dirt).clone();
    const HALO = 1.7, feet = this.feet, tracks = this.tracks;
    // per-vertex masks (shared positions agree, so the sheet is continuous)
    const sample = (x, z, out) => {
      const g = G(x, z);
      let tm = 0;
      for (const t of tracks) { const d = polyDist(x, z, t.pts), e = t.w * (0.5 + 0.45 * vnoise2(x * 0.9 + 3, z * 0.9)); tm = Math.max(tm, 1 - smoothstep(e * 0.55, e * 1.25, d)); }
      let fm = 0;
      for (const f of feet) { if (f.y0 > g + 0.45 || f.y1 < g + 0.25) continue; const d = rectDist(x, z, f); if (d < HALO) fm = Math.max(fm, (1 - d / HALO) ** 2); }
      out.g = g; out.tm = tm; out.fm = Math.min(1, fm * (0.85 + 0.3 * vnoise2(x * 1.3, z * 1.3 + 7)));
      return out;
    };
    const s00 = {}, s10 = {}, s01 = {}, s11 = {};
    let p = 0, q = 0, w = 0;
    const emit = (s, x, z, j, nrm) => {
      const at = s.tm * 0.9, ah = s.fm * 0.92, a = at + ah * (1 - at);
      let r = 0, gg = 0, b = 0;
      if (a > 0.002) {
        const rut = s.tm * (1 - s.tm) * 2.2; // darker rim where the worn band meets the turf
        const tr = lerp(path.r, edge.r, rut), tg = lerp(path.g, edge.g, rut), tb = lerp(path.b, edge.b, rut);
        const hk = s.fm; const hr = lerp(_damp.r, _mud.r, hk), hg = lerp(_damp.g, _mud.g, hk), hb = lerp(_damp.b, _mud.b, hk);
        const kt = at * (1 - ah) / a, kh = ah / a;
        r = (tr * kt + hr * kh) * j; gg = (tg * kt + hg * kh) * j; b = (tb * kt + hb * kh) * j;
      }
      pos[p++] = x; pos[p++] = s.g + lift; pos[p++] = z;
      nor[w++] = nrm[0]; nor[w++] = nrm[1]; nor[w++] = nrm[2];
      col[q++] = r; col[q++] = gg; col[q++] = b; col[q++] = a;
    };
    const tri = (a, ax, az, b, bx, bz, c, cx, cz, j) => {
      const ux = bx - ax, uy = b.g - a.g, uz = bz - az, vx = cx - ax, vy = c.g - a.g, vz = cz - az;
      let nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx; const l = Math.hypot(nxx, nyy, nzz) || 1;
      const nrm = [nxx / l, nyy / l, nzz / l];
      emit(a, ax, az, j, nrm); emit(b, bx, bz, j, nrm); emit(c, cx, cz, j, nrm);
    };
    for (let jz = 0; jz < nz; jz++) for (let ix = 0; ix < nx; ix++) {
      const xa = x0 + ix * cw, xb = xa + cw, za = z0 + jz * cd, zb = za + cd;
      sample(xa, za, s00); sample(xb, za, s10); sample(xa, zb, s01); sample(xb, zb, s11);
      if (s00.tm + s10.tm + s01.tm + s11.tm + s00.fm + s10.fm + s01.fm + s11.fm < 0.004) continue; // nothing drawn here: skip the cell
      const coarse = 0.88 * (1 + 0.14 * (hash2(Math.floor(xa / 2.6), Math.floor(za / 2.6)) - 0.5) * 2);
      const j0 = coarse * (1 + 0.05 * (hash2(ix * 2, jz) - 0.5) * 2), j1 = coarse * (1 + 0.05 * (hash2(ix * 2 + 1, jz) - 0.5) * 2);
      if ((ix + jz) & 1) { tri(s00, xa, za, s01, xa, zb, s11, xb, zb, j0); tri(s00, xa, za, s11, xb, zb, s10, xb, za, j1); }
      else { tri(s00, xa, za, s01, xa, zb, s10, xb, za, j0); tri(s10, xb, za, s01, xa, zb, s11, xb, zb, j1); }
    }
    if (p === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, w), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, q), 4));
    g.setAttribute('warm', new THREE.BufferAttribute(warm.subarray(0, p / 3), 1));
    g.setAttribute('aomask', new THREE.BufferAttribute(mask.subarray(0, p / 3), 1));
    this._bakeWarm(g);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, decalMat());
    m.receiveShadow = true; m.castShadow = false; m.renderOrder = -5; m.name = 'groundDecal';
    return m;
  }

  /** Merge everything into a Group (1 masonry mesh + optional 1 glow mesh + optional 1 ground decal). */
  build() {
    const group = new THREE.Group();
    if (this.geos.length) {
      const g = mergeGeometries(this.geos, false);
      const _t0 = performance.now(); this._bakeAO(g); const _t1 = performance.now();
      this._bakeWarm(g);
      console.debug(`[kit] tris ${g.attributes.position.count / 3 | 0} ao ${(_t1 - _t0).toFixed(0)} ms`); // TEMP timing
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, structMat());
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    if (this.glows.length) {
      const g = mergeGeometries(this.glows, false);
      const m = new THREE.Mesh(g, emissive(PALETTE.torch, 2.4, { vertexColors: true }));
      group.add(m);
    }
    const decal = this._buildDecal();
    if (decal) group.add(decal);
    return { group, spawns: this.spawns, fires: this.fires, radius: this.radius, solids: this.solids, walks: this.walks };
  }
}

/** Raised stone platform with a deep footing (so sloping ground never shows a gap) and a pale coping course on top. */
function plinth(k, x0, x1, z0, z1, top, dark, light) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  k.box(w, top - 0.22 + 4, d, cx, -4, cz, dark, { seg: 3, tint: 0.95, solid: false }); // walkable floor
  k.box(w + 0.4, 0.22, d + 0.4, cx, top - 0.22, cz, light, { seg: 3, tint: 0.9, solid: false });
}

/**
 * Stepped stone causeway of width w following a polyline of [z, y] points along x = cx: tilted road slabs,
 * low parapets, and a tall torch post at every other vertex on both sides (for hillside approaches where
 * the terrain falls away from a flat POI footprint; y values come from measuring the real terrain).
 */
function causeway(k, cx, pts, w, o = {}) {
  const { color = PALETTE.stoneDark, trim = PALETTE.stoneLight, posts = true, maxPostZ = Infinity } = o, hw = w / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [z0, y0] = pts[i], [z1, y1] = pts[i + 1], dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy), a = Math.atan2(dy, dz);
    const mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
    k.boxC(w, 1.6, len + 0.3, cx, my - 0.45, mz, color, a, 0, 0, { tint: 0.95, seg: 1.5, solid: false }); // road: walkable
    for (const sx of [-1, 1]) k.boxC(0.6, 1.1, len + 0.3, cx + sx * (hw + 0.3), my + 0.5, mz, trim, a, 0, 0, { tint: 0.85, seg: 1.5 });
  }
  if (!posts) return;
  for (let i = 1; i < pts.length; i += 2) {
    const [z, y] = pts[i];
    if (z > maxPostZ) continue;
    for (const sx of [-1, 1]) {
      const x = cx + sx * (hw + 0.3);
      k.box(0.8, 0.3, 0.8, x, y + 0.95, z, trim, { tint: 0.9 });
      k.cyl(0.14, 0.18, 2.6, 6, x, y + 1.2, z, PALETTE.woodDark, { tint: 0.8 });
      POI.brazier(k, x, y + 3.6, z, { r: 4.0, i: 2.0, halo: false });
    }
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * Church: a roofless Gothic ruin. Nave walls are columns of quantised courses whose tops step down in
 * 3-7 distinct jagged heights (a breach on the camera side, the rear half of the far wall down to ~40 %);
 * lancets survive only where the wall still stands above them. Exposed A-frame rafters stand open to the
 * sky (two snapped, two fallen into the nave) with slates clinging to the rear bays; deep stepped buttresses
 * on every bay; crow-stepped west gable with a great window the sky shows through, over a gabled porch with
 * a two-order pointed arch; a staged west tower with clasping buttresses, blind arcading, belfry lancets,
 * corbel table, broken parapet and the stump of a collapsed spire (its tip lies on the forecourt); lit
 * altar, pews, tumbled ashlar at the wall feet, a paved forecourt with stairs, piers and braziers, a walled
 * graveyard. The building stands 8 m behind the POI centre. `ruined` = the chapel: lower, no slates, short tower.
 */
export function church(rng, { ruined = false, ground = null } = {}) {
  const k = new Kit(rng, { ground });
  const S = PALETTE.stone, SD = PALETTE.stoneDark, SL = PALETTE.stoneLight, RF = PALETTE.roof, RD = PALETTE.roofDark, WD = PALETTE.woodDark, WO = PALETTE.wood, DK = PALETTE.boulderDark;
  const dark = { tint: 0.3, ao: false }, wall = { mul: 0.64, tint: 1 }, trim = { mul: 0.76, tint: 1 };
  const W = 10.5, D = 22, H = 8, G = 5.5, t = 0.8, F = 0.9, hw = W / 2, hd = D / 2, B = 8;
  const TS = 5.6, TX = -hw - TS / 2 + 0.4, TZ = hd - TS / 2, TH = ruined ? 11.2 : 16.6, S1 = 6.4, S2 = 12.4;
  const lo = ruined ? 0.8 : 1; // chapel: every broken height lower

  // --- plinth (nave + tower, one L-shaped slab) and the paved forecourt in front of the facade
  plinth(k, -hw - 1.8, hw + 1.8, -hd - 1.8 - B, hd + 1.8 - B, F, SD, SL);
  plinth(k, TX - TS / 2 - 1.8, -hw - 1.8, TZ - TS / 2 - 1.8 - B, hd + 1.8 - B, F, SD, SL);
  const FC0 = hd + 1.8 - B, FC1 = FC0 + 10.5;
  plinth(k, -9.5, 9.5, FC0, FC1, F, SD, SL);
  k.floor = F; // everything up to the nave's pop() stands on the plinth top
  for (let i = 0; i < 14; i++) k.box(rng.range(1.4, 2.4), 0.05, rng.range(1.0, 1.8), rng.range(-8, 8), F, rng.range(FC0 + 1, FC1 - 1), SL, { ao: false, tint: rng.range(0.45, 0.62), ry: rng.range(-0.2, 0.2) });

  k.push(0, -B, 0, F);
  // --- nave side walls. Wall-top profiles are height vs nave z: +x (camera side) carries a breach, -x drops to ~40 % behind the tower
  const profPx = (z) => lo * (z > 8.2 ? H : z > 4.6 ? 7.35 : z > 3.0 ? 5.6 : z > -0.5 ? 3.15 : z > -1.8 ? 4.55 : z > -5.6 ? 7.35 : z > -7.0 ? H : 6.3);
  const profMx = (z) => lo * (z > 2.0 ? H : z > -2.4 ? 7.35 : z > -6.5 ? 3.5 : 2.8);
  const sideWall = (sx, z0, z1, wins, prof) => {
    const zc = (z0 + z1) / 2, L = z0 - z1, sgn = sx > 0 ? -1 : 1;
    k.push(sx, zc, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    POI.ruinWall(k, L, t, wins.map((z) => ({ x: sgn * (z - zc), w: 1.5, h: 4.6, sill: 2.2 })), (u) => prof(sx > 0 ? z0 - u * L : z1 + u * L), S, { ...wall, full: H });
    k.pop();
  };
  sideWall(hw, hd + t / 2, -hd - t / 2, [6.5, 1.5, -3.5, -8.5], profPx);
  sideWall(-hw, TZ - TS / 2 + 0.1, -hd - t / 2, [0.0, -4.5, -9.0], profMx);
  for (const [sx, z] of [[1, 6.5], [1, -3.5], [-1, 0.0]]) k.box(0.22, 2.9, t + 0.12, sx * hw, 2.2, z, S, { tint: 0.8 }); // mullions in the intact lancets
  for (const sx of [-1, 1]) k.box(0.25, 0.22, D - 2, sx * (hw + t / 2 + 0.05), 2.0, -1, S, { tint: 1, mul: 0.78 }); // sill string course
  // plinth course: a proud dark footing along every wall foot, surviving where the walls above have fallen
  for (const sx of [-1, 1]) k.box(0.16, 0.5, D + t + 0.3, sx * (hw + t / 2 + 0.08), 0, 0, SD, { tint: 1, mul: 0.92, seg: 1.2 });
  for (const sz of [-1, 1]) k.box(W + t + 0.3, 0.5, 0.16, 0, 0, sz * (hd + t / 2 + 0.08), SD, { tint: 1, mul: 0.92, seg: 1.2 });
  k.box(TS + 0.56, 0.5, TS + 0.56, TX, 0, TZ, SD, { tint: 1, mul: 0.92, seg: 1.4 });

  // --- west facade: portal + great west window in one crow-stepped gable whose right shoulder has fallen
  const tri = (u) => H + G * Math.max(0, 1 - Math.abs(u - 0.5) * 2);
  const gableF = (u) => (u < 0.66 ? tri(u) : Math.min(tri(u), H + 0.7 + 0.8 * Math.sin(u * 29)));
  k.push(0, hd, 0);
  POI.ruinWall(k, W, t, [{ x: 0, w: 3.2, h: 6.0, sill: 0 }, { x: 0, w: 2.8, h: 4.8, sill: 6.4 }], gableF, S, { ...wall, full: tri, cw: 0.7 });
  k.box(0.24, 3.1, t + 0.12, 0, 6.4, 0, S, { tint: 0.8 }); // west window mullion
  POI.hoodMould(k, 0, 2.8, 6.4, 11.2, t / 2, SL, { t: 0.22 });
  POI.hoodMould(k, 0, 3.2, 0, 6.0, t / 2, SL, { t: 0.2 });
  for (const sx of [-1, 1]) k.box(W / 2 + 0.25 - 1.5, 0.28, t + 0.3, sx * (1.5 + (W / 2 + 0.25 - 1.5) / 2), H - 0.3, 0, SL, trim); // eaves string course
  if (!ruined) { k.box(0.22, 1.5, 0.22, 0, H + G - 0.1, 0, SL, trim); k.box(0.8, 0.2, 0.22, 0, H + G + 0.85, 0, SL, trim); }
  // gabled porch: side walls, two-order pointed arch, slate roof, corner buttresses, sconces on the facade
  const PW = 5.4, PD = 3.0, PH = 5.0, PG = 2.6, pt = 0.6, pz0 = t / 2;
  for (const sx of [-1, 1]) k.box(pt, PH, PD, sx * (PW / 2 - pt / 2), 0, pz0 + PD / 2, S, { seg: 1.2, ...wall });
  k.box(PW + 0.3, 0.5, PD + 0.3, 0, 0, pz0 + PD / 2 + 0.05, SD, { tint: 1, mul: 0.92, seg: 1.2 }); // porch footing
  k.push(0, pz0 + PD - pt / 2, 0);
  k.gothicWall(PW, PH, pt, [{ x: 0, w: 2.6, h: 4.3, sill: 0 }], S, wall);
  k.prism(PW, PG, pt, 0, PH, 0, S, { mul: 0.74, tint: 1 });
  k.push(0, pt / 2 + 0.16, 0); k.gothicWall(4.4, PH + 0.1, 0.32, [{ x: 0, w: 3.3, h: 4.9, sill: 0 }], SL, { mul: 0.78, tint: 1 }); k.pop();
  POI.hoodMould(k, 0, 3.3, 0, 4.9, pt / 2 + 0.32, SL, { t: 0.22, full: true });
  k.box(0.18, 1.1, 0.18, 0, PH + PG - 0.05, 0, SL, trim); k.box(0.6, 0.16, 0.18, 0, PH + PG + 0.65, 0, SL, trim);
  k.pop();
  if (!ruined) { k.prism(PW + 0.9, PG, PD + 0.3, 0, PH - 0.2, pz0 + PD / 2 - 0.15, RD, { tint: 1, mul: 0.85 }); k.box(0.3, 0.24, PD + 0.3, 0, PH - 0.2 + PG - 0.18, pz0 + PD / 2 - 0.15, RD, { tint: 0.7 }); }
  const pbo = { h1: 2.8, h2: 1.6, w: 0.9, d1: 1.1, d2: 0.6, cap: 0.45 };
  for (const sx of [-1, 1]) { POI.buttress(k, sx * (PW / 2 - 0.5), 0, pz0 + PD, 0, 1, pbo); POI.buttress(k, sx * PW / 2, 0, pz0 + PD - 0.6, sx, 0, pbo); }
  for (const x of [-3.9, 3.9]) POI.torch(k, x, 3.6, t / 2, 0, { r: 5.2, i: 2.2, halo: false });
  k.pop();

  // --- east gable: great east window; apex standing, the +x shoulder fallen
  const gableR = ruined ? (u) => Math.min(tri(u), H - 2 + 2.5 * Math.sin(u * 9)) : (u) => (u < 0.6 ? tri(u) : Math.min(tri(u), H - 1.0 + 1.2 * Math.sin(u * 31)));
  k.push(0, -hd, 0);
  POI.ruinWall(k, W, t, [{ x: 0, w: 3.0, h: 6.0, sill: 2.2 }], gableR, S, { ...wall, full: tri, cw: 0.7 });
  k.box(0.24, 3.6, t + 0.12, 0, 2.2, 0, S, { tint: 0.8 });
  k.pop();

  // --- west tower: stages with set-offs, clasping buttresses, blind arcading, belfry lancets, corbel table, broken parapet, spire stump
  const stage = (y0, y1, s) => k.box(s, y1 - y0, s, TX, y0, TZ, S, { seg: 1.4, ...wall });
  stage(0, S1, TS + 0.4); stage(S1, Math.min(S2, TH), TS); if (TH > S2) stage(S2, TH, TS - 0.3);
  for (const y of [S1, S2]) if (y < TH) k.box(TS + 0.9, 0.3, TS + 0.9, TX, y - 0.15, TZ, SL, trim);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bx = TX + sx * 2.6, bz = TZ + sz * 2.6;
    k.box(1.3, S1, 1.3, bx, 0, bz, S, wall); k.cone(0.92, 0.7, 4, bx, S1, bz, SL, { ry: Math.PI / 4, ...trim });
    k.box(1.46, 0.5, 1.46, bx, 0, bz, SD, { tint: 1, mul: 0.92, seg: 4 });
    if (TH > S2) { const cx = TX + sx * 2.45, cz = TZ + sz * 2.45; k.box(1.0, S2 - S1 - 0.2, 1.0, cx, S1 + 0.15, cz, S, wall); k.cone(0.71, 0.6, 4, cx, S2 - 0.05, cz, SL, { ry: Math.PI / 4, ...trim }); }
  }
  const faces = (half) => [[TX, TZ + half, 0], [TX + half, TZ, Math.PI / 2], [TX, TZ - half, Math.PI], [TX - half, TZ, -Math.PI / 2]];
  for (const [fx, fz, ry] of faces(3.01).slice(0, 2)) POI.lancet(k, 0.6, 2.0, fx, 2.8, fz, ry, DK, dark);
  for (const [fx, fz, ry] of faces(2.81)) POI.blindArcade(k, fx, 7.3, fz, ry, 3, 0.85, 3.6, 1.35, SD, { tint: 0.48, mul: 0.9 });
  if (TH > S2) {
    for (const [fx, fz, ry] of faces(2.66)) {
      k.push(fx, fz, ry, S2 + 0.7);
      for (const dx of [-0.8, 0.8]) POI.lancet(k, 0.85, 2.9, dx, 0, 0, 0, DK, dark);
      k.box(0.22, 2.9, 0.3, 0, 0, 0.02, S, { tint: 0.85 });
      POI.corbelTable(k, TS - 0.9, TH - S2 - 1.7, 0.0, SL, { pitch: 0.62 });
      k.pop();
    }
  }
  const PT = TS + (TH > S2 ? 0.2 : 0.5);
  k.box(PT, 0.45, PT, TX, TH - 0.45, TZ, SL, trim);
  for (const [ry, s] of [[0, -1], [0, 1], [Math.PI / 2, -1], [Math.PI / 2, 1]]) {
    k.push(TX, TZ, ry);
    for (let i = -2; i <= 2; i++) {
      if (rng.chance(0.3)) continue;
      const h = rng.range(0.35, 1.0);
      k.boxC(0.75, h, 0.5, i * 1.25, TH + h / 2, s * (PT / 2 - 0.25), SD, 0, 0, 0, { tint: 1, mul: 0.85, seg: 4 });
    }
    k.pop();
  }
  const sy = TH + 0.1, sh = ruined ? 2.2 : 3.4;
  k.cyl(ruined ? 2.0 : 1.6, PT / 2 - 0.1, sh, 4, TX, sy, TZ, RD, { ry: Math.PI / 4, tint: 1 });
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.3, r = (ruined ? 2.0 : 1.6) * 0.95, hh = rng.range(0.3, 1.1); k.boxC(0.55, hh, 0.55, TX + Math.cos(a) * r, sy + sh + hh / 2 - 0.1, TZ + Math.sin(a) * r, RD, 0, a, 0, { tint: 0.9, seg: 4 }); }
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.6; k.beam(TX + Math.cos(a) * 0.6, sy + sh - 0.4, TZ + Math.sin(a) * 0.6, TX + Math.cos(a) * 1.9, sy + sh + 2.6, TZ + Math.sin(a) * 1.9, 0.2, WD, { tint: 0.8 }); }
  POI.torch(k, TX + 1.7, 4.8, TZ + 3.0, 0, { r: 4.4, i: 2.0, halo: false });

  // --- roof: gone. A-frame rafter pairs stand open to the sky (some snapped, two fallen into the nave);
  //     slates cling to the rear bays over purlins and a sagging ridge
  const ridgeY = H + G - 0.5, topAt = (sx, z) => Math.min(H, sx > 0 ? profPx(z) : (z > 5.4 ? H : profMx(z)));
  const rafter = (sx, z, frac = 1, droop = 0, tint = 1) => {
    const x0 = sx * (hw - 0.15), y0 = topAt(sx, z) - 0.12, x1 = x0 * (1 - frac), y1 = y0 + (ridgeY - y0) * frac - droop;
    k.beam(x0, y0, z, x1, y1, z, 0.34, WO, { d: 0.3, tint: tint * rng.range(0.9, 1.05) });
  };
  const collar = (z, f = 0.55) => k.boxC(W * (1 - f) - 0.2, 0.26, 0.26, 0, H + (ridgeY - H) * f, z, WO, 0, 0, 0, { tint: 0.9 });
  const tie = (z) => k.boxC(W - 0.4, 0.3, 0.3, 0, H + 0.15, z, WO, 0, 0, 0, { tint: 0.95 });
  const pairs = ruined
    ? [[9.0, 1, 0.5, 0], [6.8, 0, 0, 0], [4.6, 0, 0, 0], [2.4, 0.45, 0, 0], [0.2, 0, 0.5, 0], [-2.0, 1, 1, 1], [-4.2, 0, 0, 0], [-6.4, 1, 1, 2], [-8.6, 0.5, 1, 0]]
    : [[9.0, 1, 1, 2], [6.8, 1, 0.5, 0], [4.6, 0, 0, 0], [2.4, 0, 0, 0], [0.2, 0.45, 0, 0], [-2.0, 1, 1, 2], [-4.2, 1, 1, 1], [-6.4, 1, 1, 2], [-8.6, 1, 1, 1]];
  for (const [z, fl, fr, c] of pairs) {
    if (fl > 0) rafter(-1, z, fl, fl < 1 ? 0.6 : 0, fl < 1 ? 0.9 : 1);
    if (fr > 0) rafter(1, z, fr, fr < 1 ? 0.7 : 0, fr < 1 ? 0.9 : 1);
    if (c >= 1) collar(z); if (c === 2) tie(z);
  }
  k.beam(4.6, 0.5, 4.4, -3.2, 1.7, 2.6, 0.34, WO, { d: 0.3, tint: 0.85 });   // fallen rafter lying across the nave on the rubble
  k.beam(-1.2, 0.3, 1.2, -4.9, 6.8, 2.4, 0.34, WO, { d: 0.3, tint: 0.9 });    // one leaning against the far wall
  k.beam(3.8, 0.2, 7.6, 0.4, 0.5, 9.8, 0.3, WO, { d: 0.28, tint: 0.8 });     // broken length by the porch
  k.boxC(0.36, 0.3, 9.6, 0, ridgeY + 0.25, -5.4, WD, 0, 0, 0, { tint: 0.85 }); // ridge over the rear bays
  k.beam(0, ridgeY + 0.25, -0.6, 0.5, ridgeY - 1.6, 2.6, 0.3, WD, { d: 0.3, tint: 0.8 }); // its broken end sagging
  for (const sx of [-1, 1]) for (const f of [0.35, 0.7]) k.boxC(0.22, 0.22, 9.0, sx * hw * (1 - f), H + (ridgeY - H) * f + 0.25, -5.6, WD, 0, 0, 0, { tint: 0.85 });
  k.boxC(0.22, 0.22, 4.2, -hw * 0.65, H + (ridgeY - H) * 0.35 + 0.25, 7.0, WD, 0, 0, 0, { tint: 0.85 });
  const slate = (sx, z0, z1, f0, f1) => k.beam(sx * hw * (1 - f0), H + (ridgeY - H) * f0 + 0.42, (z0 + z1) / 2, sx * hw * (1 - f1), H + (ridgeY - H) * f1 + 0.42, (z0 + z1) / 2, 0.12, RF, { d: z1 - z0, tint: rng.range(0.85, 1.0), seg: 1.0 });
  if (!ruined) {
    slate(-1, -10.6, -4.4, 0.0, 0.72); slate(-1, -4.4, -2.6, 0.0, 0.4); slate(1, -10.6, -7.0, 0.0, 0.55); slate(1, -7.0, -5.2, 0.3, 0.62);
    slate(1, -3.8, -2.2, 0.55, 0.85); slate(-1, -1.6, -0.2, 0.2, 0.5);
  }

  // --- interior: altar with candles, pews (one toppled), the collapse heap under the breach, slates and ashlar
  k.box(4.2, 0.22, 2.6, 0, 0, -hd + 2.6, SD, { tint: 0.9 }); k.box(2.6, 1.1, 1.0, 0, 0.22, -hd + 2.4, SL, { tint: 0.8 });
  for (const x of [-0.8, 0, 0.8]) k.cone(0.1, 0.32, 4, x, 1.32, -hd + 2.4, PALETTE.torch, { glow: true, ao: false });
  k.fire(0, 1.5, -hd + 2.4, { r: 4.5, i: 1.4 });
  for (let i = 0; i < 5; i++) {
    const z = -5.5 + i * 2.0;
    for (const sx of [-1, 1]) {
      if (i === 4 && sx === 1) { k.boxC(1.9, 0.5, 0.45, sx * 1.7 + 0.3, 0.45, z + 0.3, WD, 0, 0.5, 1.3, { tint: 0.85 }); continue; }
      k.box(1.9, 0.5, 0.45, sx * 1.7, 0, z, WD, { tint: 0.85 }); k.box(1.9, 0.95, 0.08, sx * 1.7, 0, z + 0.22, WD, { tint: 0.8 });
    }
  }
  POI.rubble(k, 2.4, 2.6, 3.0, 14, S, { smin: 0.4, smax: 1.0, tilt: 0.2 });
  POI.rubble(k, -1.5, 7.0, 1.8, 5, S, { smin: 0.3, smax: 0.7 });
  for (let i = 0; i < 6; i++) k.boxC(1.2, 0.12, 0.9, rng.range(-3, 3), 0.12, rng.range(1, 6), RF, 0.1, rng.float() * 3, rng.range(-0.1, 0.1), { tint: rng.range(0.8, 1) });

  // --- buttresses (stepped, sloped caps) on every bay; those at the breaches have lost their upper stage
  const bo = { h1: 4.0, h2: 2.6, w: 1.3, d1: 1.5, d2: 0.9, cap: 0.8 }, bro = { ...bo, h1: 3.4, h2: 0.7, cap: 0.5 }, low = { ...bo, h1: 2.4, h2: 1.0, cap: 0.5 };
  const bt = (x, z, dx, dz, o = bo) => POI.buttress(k, x, 0, z, dx, dz, o);
  for (const z of [4.0, -6.0]) bt(hw + t / 2, z, 1, 0);
  bt(hw + t / 2, -1.0, 1, 0, bro);
  bt(hw + t / 2, hd - 0.7, 1, 0); bt(hw - 0.7, hd + t / 2, 0, 1); bt(hw + t / 2, -hd + 0.7, 1, 0); bt(hw - 0.7, -hd - t / 2, 0, -1);
  for (const z of [2.2, -2.8, -7.8]) bt(-hw - t / 2, z, -1, 0, z < -5 ? low : bo);
  bt(-hw - t / 2, -hd + 0.7, -1, 0, low); bt(-hw + 0.7, -hd - t / 2, 0, -1);

  // --- tumbled ashlar at the wall feet (matching stone), slates that slid off the roof
  POI.rubble(k, hw + 2.2, 1.6, 2.8, 9, S, { smin: 0.55, smax: 1.15, tilt: 0.12 });
  POI.rubble(k, hw + 1.8, -8.2, 1.6, 4, S, { smin: 0.5, smax: 0.9, tilt: 0.12 });
  POI.rubble(k, -hw - 2.0, -7.0, 2.2, 6, S, { smin: 0.5, smax: 1.0, tilt: 0.12 });
  for (let i = 0; i < 5; i++) k.boxC(1.3, 0.12, 1.0, hw + 1.2 + rng.range(0, 2.5), 0.1, rng.range(-9, 0), RF, rng.range(-0.15, 0.15), rng.float() * 3, 0, { tint: rng.range(0.8, 1) });
  k.pop();

  // --- the spire's tip lies where it fell at the forecourt edge
  if (!ruined) k.cone(1.4, 3.2, 4, -6.2, F - 1.1, 8.4, RD, { rz: 1.25, ry: 0.4, tint: 1 });
  POI.brazier(k, 8.2, F, FC0 + 1.6, { r: 5.5, i: 2.3, halo: false }); POI.brazier(k, -8.2, F, FC0 + 1.6, { r: 5.5, i: 2.3 });
  k.floor = null; // the rest stands on the turf

  // --- forecourt edge: stairs down to the path, piers, braziers, flagstones toward the approach
  const stairZ = FC1 + 0.2 + 5 * 0.5;
  POI.stairs(k, 0, 0, stairZ, 8.0, 5, F / 5, 0.5, SD, { cheeks: true });
  POI.pier(k, -4.55, 0, stairZ + 0.1, 0.8, 1.3, SD, SL); POI.pier(k, 4.55, 0, stairZ + 0.1, 0.8, 1.3, SD, SL);
  for (let i = 0; i < 7; i++) k.box(rng.range(1.2, 1.8), 0.4, rng.range(0.9, 1.3), rng.range(-0.9, 0.9) + (i % 2 ? 0.9 : -0.9), -0.32, stairZ + 0.8 + i * 1.3, SL, { ry: rng.range(-0.25, 0.25), tint: rng.range(0.5, 0.7) });
  for (const sx of [-1, 1]) { k.push(sx * 9.7, (FC0 + FC1) / 2, Math.PI / 2, -0.5); POI.brokenWall(k, FC1 - FC0, 0.5, 1.1, 1.5, SD, { cw: 1.0, jitter: 0.12, course: 0.2, seed: sx }); k.pop(); }
  POI.rubble(k, hw + 2.6, 1.75 - B, 2.4, 9, SD);
  for (let i = 0; i < 3; i++) k.boxC(1.3, 0.9, 1.1, hw + 2.2 + i * 1.1, 0.35, 3.2 - B + i * 1.4, S, rng.range(-0.3, 0.3), rng.float() * 3, rng.range(-0.25, 0.25), { tint: rng.range(0.9, 1.05) });

  // --- graveyards: walled plot on the near side, open rows beside the approach
  POI.graveyard(k, hw + 4.9, -1, 0, 5, 3, { pitchX: 1.75, pitchZ: 2.15, mix: [0.8, 1.0] });
  const yw = (x, z, ry, L) => { k.push(x, z, ry, -0.9); POI.brokenWall(k, L, 0.5, 1.45, 1.75, SD, { cw: 1.2, jitter: 0.1, course: 0.2, seed: x + z }); k.pop(); };
  yw(13.2, 1, Math.PI / 2, 14); yw(11.35, 8, 0, 3.7); yw(10.25, -6, 0, 5.9);
  POI.pier(k, 13.2, -0.3, 8.2, 0.6, 1.5, SD, SL); POI.pier(k, 13.2, -0.3, -6.2, 0.6, 1.5, SD, SL);
  POI.graveyard(k, -12.5, 14.5, 0.15, 4, 3, { pitchX: 1.8, pitchZ: 2.2, y: -0.15, mix: [0.6, 0.9] });
  // east plot on the grass slope beside the forecourt (ground measured for this seed: rises ~0.12 m per m toward +z)
  const eg = (x, z) => (ground ? ground(x, z) : Math.min(1.3, Math.max(0, 0.12 * (z - 10) + 0.04 * (x - 10)))) - 0.25;
  for (const [x, z, kind] of [[12.2, 9.6, 0], [15.6, 10.2, 1], [17.4, 12.6, 0], [11.4, 16.2, 0], [19.2, 9.8, 0], [10.6, 12.0, 1], [14.6, 9.0, 3], [16.2, 12.2, 3]]) {
    const y = eg(x, z), yaw = rng.range(-0.3, 0.3), lean = rng.range(-0.18, 0.18), tint = rng.range(0.6, 0.8);
    if (kind === 0) { const h = rng.range(0.8, 1.1); k.boxC(0.74, h, 0.2, x, y + h / 2, z, PALETTE.grave, lean, yaw, 0, { tint, seg: 4 }); k.boxC(0.5, 0.26, 0.2, x, y + h + 0.1, z, PALETTE.grave, lean, yaw, 0, { tint, seg: 4 }); POI.graveMound(k, x, y + 0.25, z, yaw); }
    else if (kind === 1) { k.boxC(0.16, 1.5, 0.16, x, y + 0.6, z, SD, lean, yaw, 0, { tint }); k.boxC(0.66, 0.16, 0.16, x, y + 1.0, z, SD, lean, yaw, 0, { tint }); POI.graveMound(k, x, y + 0.25, z, yaw); }
    else if (kind === 2) { k.box(1.0, 0.6, 1.9, x, y, z, SD, { ry: yaw, tint }); k.box(1.1, 0.14, 2.0, x, y + 0.6, z, SL, { ry: yaw, tint: tint * 0.9 }); }
    else k.box(0.9, 0.16, 1.9, x, y + 0.2, z, SD, { ry: yaw, tint: tint * 0.8 }); // flat grave slab flush with the turf
  }
  k.push(16.4, 7.4, 0, eg(16.4, 7.4) - 0.45); POI.brokenWall(k, 5.6, 0.5, 0.9, 1.4, SD, { cw: 0.9, jitter: 0.12, course: 0.2, seed: 4.2 }); k.pop(); // stub of the plot's boundary wall
  for (const [x, z, s] of [[19.6, 13.4, 0.7], [13.2, 8.2, 0.55]]) k.boxC(s, s * 0.6, s * 1.2, x, eg(x, z) + 0.2, z, SD, 0.1, rng.float() * 3, 0.1, { seg: 4 });
  k.boxC(0.16, 1.3, 0.16, 14.2, eg(14.2, 8.6) + 0.12, 8.6, SD, 1.35, 0.7, 0.2, { tint: 0.85 }); // a toppled cross

  // ground: trodden dirt from the grace to the stairs and round the forecourt corner past the east graves; wall-foot halos + torch pools come from the footings / flames
  k.decal = { x0: -24, x1: 27, z0: -23, z1: 33, cell: 1.0 };
  k.track([[0, 30], [0, 21.5]], 1.8);
  k.track([[2.4, 21.0], [6.2, 18.6], [9.8, 16.3], [12.8, 14.2], [16.6, 13.3], [24, 14.6]], 1.5);
  k.spawns.push({ x: 3.5, z: FC1 - 3, type: 'soldier' }, { x: -3.5, z: FC1 - 2, type: 'soldier' });
  k.radius = 16;
  return k.build();
}

/**
 * Fort: curtain walls with corbelled parapets and arrow slits, a gatehouse with twin towers, nested gate
 * arch, half-raised portcullis, machicolation, torches and banners; round corner towers; a tall keep with
 * lit windows and a 38 m tower; road with stakes, gibbet and brazier outside the gate.
 */
export function fort(rng, o = {}) {
  const k = new Kit(rng, o);
  const S = 44, H = 8, t = 1.8, hs = S / 2;
  const ST = PALETTE.stone, SD = PALETTE.stoneDark, SL = PALETTE.stoneLight, RF = PALETTE.roof, RD = PALETTE.roofDark, WD = PALETTE.woodDark, DK = PALETTE.boulderDark, IR = PALETTE.iron, BAN = PALETTE.sparkBlood;
  const dark = { tint: 0.3, ao: false }, fw = { mul: 0.7, tint: 1 };

  // --- curtain walls (gate wall carries the inner gate opening)
  k.push(0, hs, 0); k.gothicWall(S, H, t, [{ x: 0, w: 3.6, h: 5.6, sill: 0 }], ST, fw); k.pop();
  k.box(S, H, t, 0, 0, -hs, ST, fw); k.box(t, H, S, -hs, 0, 0, ST, fw); k.box(t, H, S, hs, 0, 0, ST, fw);
  for (const [x, z, ry] of [[0, hs, 0], [0, -hs, Math.PI], [hs, 0, Math.PI / 2], [-hs, 0, -Math.PI / 2]]) {
    k.push(x, z, ry);
    k.box(S - 7, 0.3, 0.5, 0, H - 0.9, t / 2 + 0.1, SL, { tint: 0.95 });
    POI.merlons(k, S - 8, H, t / 2 - 0.35, 0.7, SD, { w: 1.2, gap: 0.9, h: 1.3 });
    for (let i = -13; i <= 13; i++) k.boxC(0.5, 0.55, 0.5, i * 1.35, H - 0.45, t / 2 + 0.2, SD, 0, 0, 0, { tint: 0.9 });
    for (const sx of [-15, -10, 10, 15]) POI.lancet(k, 0.4, 1.7, sx, 4.0, t / 2 + 0.02, 0, DK, dark);
    k.pop();
  }

  // --- gatehouse
  const GZ = hs + 1.2, GD = 7.2, GH = 14, GW = 5.6, GX = 5.2, gf = GZ + GD / 2;
  for (const sx of [-1, 1]) {
    const x = sx * GX;
    k.box(GW, GH, GD, x, 0, GZ, ST, { seg: 1.4, ...fw });
    k.box(GW + 0.5, 0.3, GD + 0.5, x, 7.2, GZ, SL, { tint: 0.95 });
    for (const dx of [-1.3, 1.3]) POI.lancet(k, 0.45, 1.8, x + dx, 3.4, gf + 0.02, 0, DK, dark);
    POI.lancet(k, 0.45, 1.8, x, 9.0, gf + 0.02, 0, DK, dark);
    POI.lancet(k, 0.45, 1.8, x + sx * (GW / 2 + 0.02), 5.0, GZ + 1.5, sx * Math.PI / 2, DK, dark);
    POI.torch(k, x + sx * 0.3, 5.7, gf, 0);
    POI.banner(k, x - sx * 0.9, 11.4, gf, 0, BAN, { w: 1.3, h: 3.4 });
    k.push(x + sx * (GW / 2), GZ, sx * Math.PI / 2); POI.merlons(k, GD, GH, 0, 0.6, SD, { w: 1.0, gap: 0.7, h: 1.2 }); k.pop();
  }
  k.push(0, gf - 0.35, 0); k.gothicWall(GX * 2 - GW + 0.2, GH, 0.7, [{ x: 0, w: 4.2, h: 6.6, sill: 0 }], ST, fw); k.pop();
  k.push(0, gf + 0.2, 0); k.gothicWall(GX * 2 - GW + 0.2, 7.6, 0.4, [{ x: 0, w: 4.8, h: 7.2, sill: 0 }], SL, { tint: 0.92 }); k.pop();
  for (let i = -3; i <= 3; i++) k.box(0.12, 4.2, 0.12, i * 0.6, 3.2, gf - 0.6, IR, { ao: false, tint: 0.8 });
  for (const y of [3.6, 5.0, 6.4]) k.box(4.0, 0.12, 0.12, 0, y, gf - 0.6, IR, { ao: false, tint: 0.8 });
  k.box(GX * 2 + GW + 0.6, 1.5, 1.1, 0, 12.5, gf + 0.3, ST, { tint: 1 });
  for (let x = -7.5; x <= 7.5; x += 1.25) k.boxC(0.5, 0.7, 0.9, x, 12.2, gf + 0.3, SD, 0, 0, 0, { tint: 0.9 });
  k.push(0, gf + 0.35, 0); POI.merlons(k, GX * 2 + GW + 0.6, GH, 0, 0.7, SD, { w: 1.0, gap: 0.7, h: 1.3 }); k.pop();
  k.push(0, GZ - GD / 2 + 0.3, Math.PI); POI.merlons(k, GX * 2 + GW, GH, 0, 0.6, SD, { w: 1.0, gap: 0.7, h: 1.2 }); k.pop();
  k.box(GX * 2 - GW, 0.5, GD - 1.0, 0, GH - 0.5, GZ, SD, { tint: 0.9 });

  // --- round corner towers
  for (const [x, z] of [[-hs, -hs], [hs, -hs], [-hs, hs], [hs, hs]]) {
    k.cyl(3.7, 4.2, 13, 8, x, 0, z, ST, { ...fw, ry: Math.PI / 8 }); k.cyl(4.15, 4.15, 0.35, 8, x, 8.2, z, SL, { tint: 0.95, ry: Math.PI / 8 });
    k.cyl(4.3, 4.3, 0.5, 8, x, 13, z, SD, { tint: 0.95, ry: Math.PI / 8 }); k.cone(4.6, 4.8, 8, x, 13.5, z, RD, { tint: 1, ry: Math.PI / 8 });
    k.box(0.16, 1.2, 0.16, x, 18.2, z, SL, { ao: false, tint: 1 });
    if (z > 0) { POI.lancet(k, 0.4, 1.7, x, 4.6, z + 3.68, 0, DK, dark); POI.lancet(k, 0.4, 1.7, x, 10.0, z + 3.52, 0, DK, dark); }
  }

  // --- keep with lit lancets and a tall tower
  const kz = -6, KW = 18, KD = 15, KH = 20, kf = kz + KD / 2 + 0.01;
  // (collision builder) the keep is solid now: a pointed doorway and a 3 m recess in its front face hold the keep chest
  const DW = 3.4, DH = 5.4, DD = 3.0, FT = 1.0;
  k.push(0, kf - FT / 2, 0); k.gothicWall(KW, KH, FT, [{ x: 0, w: DW, h: DH, sill: 0 }], ST, { seg: 2, ...fw }); k.pop();
  for (const sx of [-1, 1]) k.box((KW - DW) / 2, KH, DD, sx * (DW + (KW - DW) / 2) / 2, 0, kf - FT - DD / 2, ST, { seg: 2, ...fw });
  k.box(DW, KH - DH, DD, 0, DH, kf - FT - DD / 2, ST, { seg: 2, ...fw });
  k.box(KW, KH, KD - FT - DD, 0, 0, kz - (FT + DD) / 2, ST, { seg: 2, ...fw });
  for (const y of [7, 14]) k.box(KW + 0.5, 0.3, KD + 0.5, 0, y, kz, SL, { tint: 0.95 });
  k.prism(KW + 1.2, 5.5, KD + 1.0, 0, KH - 0.2, kz, RF);
  k.box(0.36, 0.3, KD + 1.0, 0, KH - 0.2 + 5.5 - 0.2, kz, RD, { tint: 0.9 });
  for (const x of [-5.5, -2, 2, 5.5]) for (const y of [9.5, 15.5]) { POI.lancet(k, 0.9, 2.6, x, y, kf, 0, DK, dark); POI.litWindow(k, 0.6, 1.7, x, y + 0.15, kf + 0.1, 0); }
  k.box(7, 31, 7, 5, 0, kz - 3, ST, { seg: 2, ...fw }); k.box(7.6, 0.4, 7.6, 5, 30.6, kz - 3, SL, { tint: 0.95 });
  for (const y of [12, 22]) k.box(7.4, 0.3, 7.4, 5, y, kz - 3, SL, { tint: 0.95 });
  for (const ry of [0, Math.PI / 2]) { k.push(5, kz - 3, ry); for (const s of [-1, 1]) POI.merlons(k, 7.6, 31, s * 3.6, 0.6, SD, { w: 0.9, gap: 0.7, h: 1.1 }); k.pop(); }
  k.cone(4.6, 6.5, 4, 5, 31.2, kz - 3, RD, { ry: Math.PI / 4 });
  k.box(0.14, 4.2, 0.14, 5, 37.6, kz - 3, WD, { ao: false }); k.box(1.7, 0.9, 0.06, 5.9, 40.7, kz - 3, BAN, { ao: false, tint: 0.6 });
  POI.lancet(k, 0.8, 2.4, 5, 26, kz - 3 + 3.51, 0, DK, dark); POI.litWindow(k, 0.5, 1.5, 5, 26.2, kz - 3 + 3.6, 0);

  // --- courtyard clutter
  for (let i = 0; i < 5; i++) k.box(0.9, 0.9, 0.9, rng.range(-14, 14), 0, rng.range(8, 16), PALETTE.wood, { ry: rng.float() });

  // --- outside the gate: flagstone road, stakes, gibbet, brazier, tumbled stone
  POI.path(k, 0, 0, hs + 5.5, 7);
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) {
    const z = hs + 7 + i * 1.6 + rng.range(-0.3, 0.3), x = sx * (4.2 + rng.range(0, 0.6));
    k.boxC(0.18, 2.8, 0.18, x, 0.6, z, WD, 0.8 + rng.range(-0.15, 0.15), rng.range(-0.3, 0.3), sx * rng.range(-0.1, 0.25), { tint: rng.range(0.7, 0.9) });
  }
  k.cyl(0.16, 0.2, 5.8, 6, 8.5, 0, hs + 10, WD, { tint: 0.8 }); k.box(2.4, 0.2, 0.2, 9.5, 5.5, hs + 10, WD, { tint: 0.8 });
  k.box(0.06, 0.7, 0.06, 10.4, 4.5, hs + 10, IR, { ao: false }); k.box(0.55, 1.3, 0.55, 10.4, 3.2, hs + 10, IR, { ao: false, tint: 0.7 });
  POI.rubble(k, 14, hs + 3.5, 3.5, 7); POI.rubble(k, -13, hs + 3, 3, 6);
  for (const x of [-15, 15]) POI.torch(k, x, 6.0, hs + t / 2, 0, { r: 3.2, i: 2.0, halo: false });
  // the hill falls ~9 m over the last 25 m of the approach (measured): a stepped causeway carries the road down
  causeway(k, -3.5, [[34, 0.1], [38, -0.3], [42, -1.3], [46, -3.2], [50, -5.3], [54, -7.4], [58, -9.4], [62, -11.4]], 5.2, { maxPostZ: 47 });
  // wayside campfire left of the approach (ground there is ~5 m below the plateau)
  POI.campfire(k, -12, -5.4, 48, { r: 5.0, i: 2.2 });
  for (let i = 0; i < 4; i++) k.boxC(0.16, 2.4, 0.16, -(9.5 + i * 1.3), -4.9 + i * 0.1, 45.5 + i * 0.4, WD, 0.6, rng.range(-0.4, 0.4), -0.3, { tint: 0.8 });

  k.decal = { x0: -26, x1: 26, z0: 14, z1: 62, cell: 1.25 };
  k.track([[0, hs + 2.5], [0, 34.5]], 2.6);
  k.track([[-6.4, 43.5], [-9.4, 46.4], [-11.6, 48]], 1.2);
  k.spawns.push({ x: -7, z: 10, type: 'soldier' }, { x: 7, z: 12, type: 'soldier' }, { x: 0, z: 16, type: 'soldier' }, { x: -12, z: 2, type: 'soldier' }, { x: 2, z: hs + 6, type: 'soldier' });
  k.radius = 38;
  return k.build();
}

/**
 * Ruin: a roofless abbey on a raised floor — jagged gable wall with a great lancet, a diminishing arcade of
 * pointed arches, two rows of broken columns, a tower stub, sarcophagus and a brazier in the nave.
 */
export function ruin(rng, o = {}) {
  const k = new Kit(rng, o);
  const S = PALETTE.stone, SD = PALETTE.stoneDark, SL = PALETTE.stoneLight, DK = PALETTE.boulderDark;
  const dark = { tint: 0.3, ao: false }, F = 0.6, rw = { mul: 0.66, tint: 1 };
  plinth(k, -10, 10, -12, 10, F, SD, SL);
  POI.stairs(k, 0, 0, 10.2 + 3 * 0.6, 6.5, 3, F / 3, 0.6, SD, { cheeks: true });
  k.push(0, 0, 0, F); k.floor = F;
  // gable wall (far side, facing the camera): great lancet with mullion, side door, jagged peak
  k.push(0, -9.5, 0);
  const gtri = (u) => 8.5 + 4.2 * Math.max(0, 1 - Math.abs(u - 0.5) * 2.4), gprof = (u) => (u < 0.64 ? gtri(u) : Math.min(gtri(u), 7.0 + 1.0 * Math.sin(u * 33)));
  POI.ruinWall(k, 13, 1.0, [{ x: 0, w: 3.4, h: 6.4, sill: 1.8 }, { x: -4.3, w: 1.7, h: 3.6, sill: 0 }], gprof, S, { ...rw, full: gtri, cw: 0.72 });
  k.box(0.26, 3.6, 1.12, 0, 1.8, 0, S, { tint: 0.8 });
  k.pop();
  for (const sx of [-1, 1]) POI.buttress(k, sx * 6.5, 0, -9.5, sx, 0, { h1: 4.0, h2: 2.6 });
  for (const x of [-2.9, 2.9, 6.0]) POI.buttress(k, x, 0, -10.0, 0, -1, { h1: 3.6, h2: 2.2, w: 1.2, d1: 1.4, d2: 0.8 });
  POI.rubble(k, 1.5, -11.2, 2.2, 7, S, { smin: 0.5, smax: 1.0, tilt: 0.12, y: -0.1 }); POI.rubble(k, -5.5, -11.0, 1.4, 4, S, { smin: 0.45, smax: 0.9, tilt: 0.12, y: -0.1 });
  // arcade (+x) — taller toward the gable, front bays collapsed to piers
  k.push(6.5, -3.5, Math.PI / 2);
  k.gothicWall(12, 5.2, 0.9, [-4.5, -1.5, 1.5, 4.5].map((x) => ({ x, w: 2.1, h: 4.3, sill: 0 })), S, rw);
  POI.brokenWall(k, 12, 0.9, 0, 0, S, { y: 5.2, cw: 0.8, seed: 2.0, mul: rw.mul, profile: (u) => 0.3 + 2.6 * u });
  k.pop();
  k.box(1.0, 3.2, 1.0, 6.5, 0, 4.5, S, rw); k.box(1.0, 1.6, 1.0, 6.5, 0, 7.5, S, rw);
  k.boxC(1.8, 0.6, 0.9, 4.6, 0.35, 6.2, S, 0.2, 0.6, 0.1, { tint: 0.95 });
  // low broken wall (-x) with one arched opening and a pier
  k.push(-6.5, -6, -Math.PI / 2); k.gothicWall(4, 4.6, 0.9, [{ x: 0, w: 1.8, h: 3.8, sill: 0.6 }], S, rw); POI.brokenWall(k, 4, 0.9, 0.3, 1.5, S, { y: 4.6, cw: 0.8, seed: 1.1, mul: rw.mul }); k.pop();
  k.push(-6.5, 0.5, -Math.PI / 2); POI.brokenWall(k, 9, 0.9, 0.8, 3.2, S, { seed: 0.7, cw: 0.8, mul: rw.mul }); k.pop();
  k.box(1.1, 4.8, 1.1, -6.5, 0, 5.2, S, rw); k.box(1.3, 0.3, 1.3, -6.5, 4.8, 5.2, SL, { tint: 0.95 });
  // nave columns: alternating standing and broken, capitals, fallen drums
  const colH = [4.6, 1.4, 5.0, 2.2];
  for (const sx of [-1, 1]) colH.forEach((h, i) => {
    const z = -6.5 + i * 3.2, hh = h + (sx > 0 ? 0.3 : 0);
    k.cyl(0.42, 0.5, hh, 8, sx * 2.8, 0, z, S, { tint: 1, mul: 0.72 }); k.box(1.25, 0.3, 1.25, sx * 2.8, hh, z, SL, { tint: 0.85 });
  });
  k.cylC(0.4, 0.45, 3.4, 8, 1.0, 0.42, 1.8, S, 0, 0.9, Math.PI / 2); k.cylC(0.4, 0.45, 2.2, 8, -1.6, 0.42, 4.2, S, 0, -0.5, Math.PI / 2);
  // tower stub (back-left) with a jagged top
  k.box(4.6, 6.5, 4.6, -8.2, 0, -8.5, S, { seg: 1.4, ...rw });
  for (const [sx, sz, h] of [[-1, -1, 1.6], [1, -1, 0.8], [-1, 1, 2.2], [1, 1, 0.5]]) k.box(1.3, h, 1.3, -8.2 + sx * 1.65, 6.5, -8.5 + sz * 1.65, S, rw);
  POI.lancet(k, 0.6, 1.8, -8.2, 2.8, -8.5 + 2.31, 0, DK, dark);
  // furnishings: brazier, sarcophagus, rubble
  POI.brazier(k, 2.2, 0, -7.0); POI.brazier(k, 5.2, 0, 1.5, { r: 3.5, i: 2.0 });
  for (let i = 0; i < 16; i++) k.box(rng.range(1.2, 2.2), 0.05, rng.range(0.9, 1.6), rng.range(-5, 5), 0, rng.range(-8.5, 8.5), SL, { ao: false, tint: rng.range(0.6, 0.8), ry: rng.range(-0.2, 0.2) });
  k.box(1.1, 0.8, 2.3, -2.6, 0, -4.5, SD, { tint: 0.9 }); k.box(1.25, 0.18, 2.45, -2.6, 0.8, -4.5, SL, { tint: 0.9 });
  POI.rubble(k, 3, -1, 3.5, 10, SD); POI.rubble(k, -3.5, 5, 2.5, 6, S, { smin: 0.3, smax: 0.7 });
  k.pop(); k.floor = null;
  // outside: a ruined doorway at the front-left corner, tumbled stone
  k.push(-8.5, 8, 0.4, -0.3); k.gothicWall(3.6, 4.2, 0.9, [{ x: 0, w: 1.6, h: 3.4, sill: 0 }], S, rw); POI.brokenWall(k, 3.6, 0.9, 0.3, 1.6, S, { y: 4.2, cw: 0.7, seed: 3.1, mul: rw.mul }); k.pop();
  POI.rubble(k, 11, 5, 3, 7, SD); POI.rubble(k, -11, 2, 2.5, 5, SD);
  for (let i = 0; i < 4; i++) k.boxC(1.4, 0.8, 1.0, rng.range(-9, 9), 0.3, 12 + rng.range(0, 2.5), S, rng.range(-0.3, 0.3), rng.float() * 3, rng.range(-0.2, 0.2), { tint: rng.range(0.9, 1.05) });
  k.decal = { x0: -17, x1: 17, z0: -17, z1: 27, cell: 1.0 };
  k.track([[0, 12.6], [0.4, 19]], 1.8);
  k.spawns.push({ x: 2, z: 1, type: 'soldier' }, { x: -3, z: -3, type: 'soldier' });
  k.radius = 14;
  return k.build();
}

export function catacombEntrance(rng, o = {}) {
  const k = new Kit(rng, o);
  const S = PALETTE.stone, SD = PALETTE.stoneDark, DK = PALETTE.boulderDark;
  k.box(8, 0.9, 5, 0, 0, -1.0, SD, { solid: false }); // threshold slab: walkable
  k.setFrame(0, 0, 0, 0.9); k.gothicWall(7.4, 5.4, 1.4, [{ x: 0, w: 3.2, h: 4.8, sill: 0 }], S); k.clearFrame();
  k.box(8.4, 1.2, 2.0, 0, 6.3, 0, SD); k.prism(8.4, 1.7, 2.0, 0, 7.5, 0, S);
  k.box(1.2, 5.4, 1.6, -3.7, 0.9, 0.2, SD); k.box(1.2, 5.4, 1.6, 3.7, 0.9, 0.2, SD);
  k.box(3.1, 4.6, 4.5, 0, 0.9, -2.9, DK, { ao: false, tint: 0.2 }); // dark recess
  k.box(2.2, 3.2, 3.0, 0, 0.9, -5.0, DK, { ao: false, tint: 0.1 });
  k.box(4.5, 3.6, 1.1, -6.2, 0.6, -0.8, SD, { ry: 0.5 }); k.box(4.5, 3.6, 1.1, 6.2, 0.6, -0.8, SD, { ry: -0.5 });
  for (let i = 0; i < 3; i++) k.box(4.6 + i * 0.8, 0.3, 1.1, 0, 0.6 - i * 0.3, 1.6 + i * 1.0, SD);
  for (const x of [-3.2, 3.2]) {
    k.cyl(0.36, 0.22, 1.0, 6, x, 0.9, 1.6, PALETTE.iron);
    k.cone(0.3, 0.6, 5, x, 1.9, 1.6, PALETTE.ember, { glow: true, ao: false });
    k.fire(x, 2.1, 1.6, { r: 2.6, i: 1.8 });
  }
  k.decal = { x0: -12, x1: 12, z0: -4, z1: 14, cell: 1.0 };
  k.track([[0, 2.5], [0, 12]], 1.8);
  k.spawns.push({ x: 3, z: 6, type: 'soldier' }, { x: -4, z: 7, type: 'soldier' });
  k.radius = 10;
  return k.build();
}

export function camp(rng, o = {}) {
  const k = new Kit(rng, o);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; k.boxC(0.36, 0.3, 0.36, Math.cos(a) * 1.0, 0.15, Math.sin(a) * 1.0, PALETTE.rockProp, 0, a, 0); }
  k.cylC(0.09, 0.09, 1.3, 5, 0, 0.14, 0, PALETTE.woodDark, 0, 0.6, Math.PI / 2, { tint: 0.8 }); k.cylC(0.09, 0.09, 1.3, 5, 0, 0.14, 0, PALETTE.woodDark, 0, -0.7, Math.PI / 2, { tint: 0.7 });
  k.cone(0.38, 0.9, 6, 0, 0.1, 0, PALETTE.ember, { glow: true, ao: false }); k.cone(0.2, 1.2, 5, 0, 0.15, 0, PALETTE.torch, { glow: true, ao: false });
  k.fires.push({ x: 0, y: 0.9, z: 0 });
  const a0 = rng.float() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const a = a0 + i * 2.1 + rng.range(-0.3, 0.3), r = 5.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    k.setFrame(x, z, Math.atan2(-x, -z));
    k.prism(3.2, 2.4, 3.6, 0, 0, 0, PALETTE.tent);
    k.prism(1.6, 1.5, 0.3, 0, 0, 1.75, PALETTE.tentDark, { tint: 0.6 });
    // (combat builder) two-tone canvas: patched panel on each slope, ridge + end poles, guy ropes to pegs; banded crate
    for (const s of [-1, 1]) k.boxC(0.05, 0.8, 1.1, s * 0.88, 1.14, -0.35 + s * 0.3, PALETTE.tentDark, 0, 0, s * 0.59, { tint: 0.85 });
    k.cylC(0.05, 0.05, 4.3, 5, 0, 2.42, 0, PALETTE.woodDark, Math.PI / 2, 0, 0);
    for (const zz of [-1.85, 1.85]) {
      k.cyl(0.05, 0.06, 2.7, 5, 0, 0, zz, PALETTE.woodDark);
      for (const s of [-1, 1]) {
        const ex = s * 2.05, ez = zz + Math.sign(zz) * 0.95;
        _p.set(ex, -2.7, ez).normalize(); _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _p); _e.setFromQuaternion(_q);
        k.cylC(0.012, 0.012, Math.hypot(ex, 2.7, ez - zz), 3, ex / 2, 1.35, (zz + ez) / 2, PALETTE.stoneLight, _e.x, _e.y, _e.z, { ao: false });
        k.cone(0.05, 0.3, 4, ex, 0, ez, PALETTE.woodDark);
      }
    }
    k.box(0.8, 0.8, 0.8, 2.2, 0, 0.6, PALETTE.wood, { ry: 0.4 });
    for (const h of [0.25, 0.52]) k.box(0.84, 0.05, 0.84, 2.2, h, 0.6, PALETTE.woodDark, { ry: 0.4 });
    k.clearFrame();
  }
  k.cyl(0.42, 0.42, 0.95, 8, -2.4, 0, 2.2, PALETTE.woodDark);
  const p0 = a0 + 1.0;
  for (let i = 0; i < 13; i++) {
    const a = p0 + (i / 12) * Math.PI * 1.1, r = 9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = rng.range(2.0, 2.6);
    k.cyl(0.13, 0.16, h, 5, x, 0, z, PALETTE.wood); k.cone(0.14, 0.45, 5, x, h, z, PALETTE.woodDark);
  }
  k.cyl(0.05, 0.07, 3.4, 5, 2.2, 0, -3.2, PALETTE.woodDark); k.box(0.75, 1.3, 0.05, 2.6, 2.0, -3.2, PALETTE.sparkBlood, { ao: false, tint: 0.5 });
  for (let i = 0; i < 4; i++) { const a = a0 + 0.6 + i * 1.5, r = 3.2; k.spawns.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, type: 'soldier' }); }
  k.radius = 12;
  return k.build();
}
