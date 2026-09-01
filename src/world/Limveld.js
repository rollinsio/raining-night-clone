/**
 * Limveld map generation: picks POI / grace / spawn / arena positions (seeded), flattens terrain
 * footprints, builds structures and records enemy spawn tables and warm light sources.
 */
import * as THREE from 'three';
import * as Structures from './Structures.js';

export class Limveld {
  constructor(game, terrain, rng) {
    this.game = game; this.terrain = terrain; this.rng = rng;
    this.pois = [];       // {type, x, z, yaw, r, name}
    this.graces = [];     // {x, z, name}
    this.arenas = [];     // {x, z, r, name}
    this.enemySpawns = []; // {type, x, z, home:{x,z}, patrolR, tier}
    this.fires = [];      // world positions of flames (Vector3)
    this.braziers = [];   // {x, z} free-standing iron braziers (Props builds them; their flames join `fires`)
    this.landmarks = [];  // {type, x, z, s, ry} explicit hero props (Props builds them)
    this.meadows = [];    // {x, z, r} zones with denser grass / rocks
    this.clearings = [];  // {x, z, r} keep-out zones for all props (camera room at the overlook)
    this.trampled = [];   // {x, z, r} grass-only soft clearings (turf worn bare where the player stands in the vista)
    this.spawn = { x: 30, z: 360 };
    this.group = new THREE.Group(); this.group.name = 'limveld';
  }

  /** Decide positions and stamp the terrain. Must run before Terrain.build(). */
  plan() {
    const T = this.terrain, j = (v) => v + this.rng.range(-6, 6);
    const P = this.pois;
    P.push({ type: 'church', x: j(250), z: j(250), yaw: 0.6 + Math.PI, r: 14, name: 'Church of Limveld', ruined: false }); // facade toward the moon
    P.push({ type: 'church', x: j(-130), z: j(-330), yaw: -0.4, r: 14, name: 'Ruined Chapel', ruined: true });
    P.push({ type: 'ruin', x: j(-300), z: j(230), yaw: 0.3, r: 13, name: 'Lakeside Ruins' });
    P.push({ type: 'ruin', x: j(-410), z: j(-130), yaw: -1.1, r: 13, name: 'Western Ruins' });
    P.push({ type: 'fort', x: j(330), z: j(-100), yaw: 0.15, r: 36, name: 'Fort of the Hill' });
    P.push({ type: 'catacomb', x: 150, z: -390, yaw: Math.atan2(-150, 390), r: 10, name: 'Catacomb' });
    P.push({ type: 'camp', x: j(150), z: j(120), yaw: 0, r: 12, name: 'Soldier Camp' });
    P.push({ type: 'camp', x: j(-330), z: j(-150), yaw: 0, r: 12, name: 'Western Camp' });
    // ridge-top ruin in the overlook's sightline (pushed last so poi(type, i) indices above stay stable)
    P.push({ type: 'ruin', x: -30, z: 135, yaw: 0.55, r: 13, name: 'Overlook Ruins' });
    this.braziers.push({ x: -30 + 4, z: 135 + 9 }, { x: -30 - 9, z: 135 - 2 });
    // hero trees framing the overlook vista, standing stones on the ridge
    this.landmarks.push(
      { type: 'heroTree', x: 131, z: 212, s: 1.5, ry: 0.8 },
      { type: 'heroTree', x: 128, z: 161, s: 1.1, ry: 2.4 },
      { type: 'heroTree', x: 5, z: 112, s: 1.25, ry: 1.3 },
      { type: 'monolith', x: -58, z: 165, s: 1.4, ry: 0.4 },
      { type: 'monolith', x: -70, z: 177, s: 1.1, ry: 1.9 },
    );
    this.meadows.push({ x: 150, z: 210, r: 48, density: 1.25 }, { x: 10, z: 24, r: 40 }, { x: 250, z: 250, r: 35 });
    this.clearings.push({ x: 157, z: 214.3, r: 0.8 });
    // grass-only soft clearings: trampled turf where the player stands in the vista and under the camera
    this.trampled.push({ x: 150, z: 210, r: 1.7 });
    // valley floor below the overlook: dead trees and boulders strung along the track so the misty basin has
    // receding silhouettes (scale cues between the player and the Overlook Ruins)
    const valley = [[128, 186, 1.6, 0], [112, 196, 1.3, 1], [100, 178, 1.9, 0], [84, 188, 1.2, 1], [76, 170, 1.7, 0], [60, 176, 1.4, 1], [50, 158, 2.0, 0], [40, 166, 1.2, 1], [26, 146, 1.8, 0], [14, 156, 1.5, 1], [-2, 150, 1.3, 0], [90, 162, 1.5, 1], [64, 150, 1.8, 0]];
    for (const [x, z, s, v] of valley) this.landmarks.push({ type: 'tree', x, z, s, v, ry: this.rng.float() * 6.28 });
    this.landmarks.push({ type: 'boulder', x: 106, z: 184, s: 2.4, ry: 0.5 }, { type: 'boulder', x: 70, z: 162, s: 2.8, ry: 1.7 }, { type: 'boulder', x: 44, z: 156, s: 2.2, ry: 2.6 }, { type: 'boulder', x: 88, z: 176, s: 1.8, ry: 0.9 }, { type: 'boulder', x: 20, z: 150, s: 2.6, ry: 1.1 });
    // dead-tree lines along the ridge crests in the overlook's sightline: scale cues at each fog depth
    // (mid ridge carrying the Overlook Ruins ~200 m out, the near spur ~100 m out, the far cliff band ~280 m)
    const treeLine = (pts, s0, s1) => { for (const [x, z] of pts) this.landmarks.push({ type: 'tree', x, z, s: s0 + this.rng.float() * (s1 - s0), v: this.rng.chance(0.6) ? 0 : 1, ry: this.rng.float() * 6.28 }); };
    treeLine([[-62, 150], [-52, 158], [-44, 142], [-42, 126], [-18, 124], [-8, 118], [4, 126], [-70, 168], [-78, 158], [12, 118]], 1.5, 2.4);
    treeLine([[112, 138], [108, 120], [118, 104], [96, 142], [124, 116]], 1.3, 2.0);
    treeLine([[-128, 140], [-140, 156], [-150, 172], [-112, 128], [-104, 148], [-136, 170]], 2.2, 3.2);
    this.landmarks.push({ type: 'rock', x: 149, z: 203, s: 1.4, ry: 0.7 }, { type: 'rock', x: 151.8, z: 200.8, s: 0.8, ry: 2.1 }, { type: 'rock', x: 144.5, z: 214.5, s: 1.1, ry: 1.2 });
    // worn track: enters the vista frame bottom-right, passes 4 m beside the player (the camera line stays turf),
    // then runs down through the valley and up to the Overlook Ruins as a leading line to the brazier
    T.paths.push({ w: 0.85, pts: [[202, 244], [180, 226], [165.5, 214], [153.5, 204], [139.5, 196], [119, 188], [95, 178], [67, 165], [35, 151], [6, 143], [-16, 138]] });
    T.paths.push({ w: 0.9, pts: [[165.5, 214], [167, 236], [154, 266], [100, 308], [48, 344], [34, 356]] });
    // foreground litter: dark stones in the vista camera's near field (2-10 m ahead of the camera at (157,214),
    // which looks along (-0.85,-0.53)) for scale and ground texture between the grass clumps
    for (let i = 0; i < 20; i++) {
      const f = 2 + this.rng.float() * 8, r = this.rng.range(-4.5, 4.5);
      const x = 157 - 0.85 * f + 0.53 * r, z = 214 - 0.53 * f - 0.85 * r;
      if (Math.hypot(x - 150, z - 210) < 1.3 || Math.hypot(x - 157, z - 214) < 1.6) continue;
      const u = this.rng.float();
      this.landmarks.push({ type: 'rock', x, z, s: 0.2 + u * u * 0.45, ry: this.rng.float() * 6.28 });
    }
    // foreground grass: a jittered grid of clumps across the vista camera's visible wedge 1.6-6 m ahead (half-width
    // 0.9 x distance at this fov) — random scatter cannot centre clumps this close to the camera clearing, which
    // left the bottom of the frame bare
    for (const f of [1.6, 2.3, 3.1, 4.0, 5.2, 6.6, 8.2]) {
      const w = 0.9 * f + 0.4;
      for (let r = -w; r <= w; r += 1.3) {
        if (this.rng.chance(0.3)) continue;
        const ff = f + this.rng.range(-0.4, 0.4), rr = r + this.rng.range(-0.5, 0.5);
        const x = 157 - 0.85 * ff + 0.53 * rr, z = 214 - 0.53 * ff - 0.85 * rr;
        if (Math.hypot(x - 150, z - 210) < 1.5) continue;
        this.landmarks.push({ type: 'grass', x, z, r: 0.25 + this.rng.float() * 0.3, k: 3 + this.rng.int(0, 2), warm: this.rng.float() });
      }
    }
    // foreground: faceted rock outcrops at both frame edges (dark slab silhouettes for scale), big boulders down
    // the near slope; mid-ground: a sheer cliff band along the spur crest (~100 m) and a taller one on the far
    // cliff band (~300 m) so each fog depth carries faceted rock, plus crag piles where the cliffs end
    this.landmarks.push(
      { type: 'boulder', x: 152.2, z: 214.9, s: 1.7, ry: 0.6 }, { type: 'boulder', x: 154.3, z: 206.1, s: 1.6, ry: 2.2 },
      { type: 'boulder', x: 140, z: 207, s: 2.3, ry: 1.4 }, { type: 'boulder', x: 124, z: 207, s: 1.5, ry: 3.0 }, { type: 'boulder', x: 137, z: 191, s: 1.9, ry: 0.2 },
      { type: 'boulder', x: 114, z: 195, s: 2.6, ry: 1.9 }, { type: 'boulder', x: 149, z: 196, s: 1.4, ry: 0.9 }, { type: 'boulder', x: 143, z: 215.5, s: 1.6, ry: 2.7 },
      { type: 'boulder', x: 130, z: 152, s: 3.0, ry: 0.7 }, { type: 'boulder', x: 139, z: 171, s: 2.6, ry: 2.1 }, { type: 'boulder', x: 121, z: 166, s: 3.2, ry: 1.3 },
      { type: 'crag', x: 72, z: 198, s: 1.3, ry: 0.4, v: 0 }, { type: 'crag', x: 62, z: 206, s: 0.9, ry: 2.0, v: 1 }, { type: 'crag', x: 84, z: 190, s: 0.8, ry: 1.1, v: 1 },
      { type: 'cliff', x: 104, z: 154, s: 1.1, ry: 1.17, v: 0 }, { type: 'cliff', x: 110, z: 140.5, s: 1.3, ry: 1.0, v: 0 }, { type: 'cliff', x: 115.7, z: 126.6, s: 1.0, ry: 1.3, v: 1 },
      { type: 'cliff', x: 121.7, z: 112.6, s: 1.25, ry: 1.1, v: 0 }, { type: 'cliff', x: 127.7, z: 98.6, s: 0.9, ry: 1.2, v: 1 }, { type: 'crag', x: 98, z: 164, s: 1.0, ry: 2.8, v: 1 },
      { type: 'cliff', x: -141, z: 195, s: 2.4, ry: 1.01, v: 0 }, { type: 'cliff', x: -128, z: 174, s: 2.6, ry: 0.9, v: 0 }, { type: 'cliff', x: -115, z: 153, s: 2.2, ry: 1.1, v: 1 },
      { type: 'cliff', x: -102, z: 132, s: 2.5, ry: 1.0, v: 0 }, { type: 'cliff', x: -88, z: 110, s: 2.0, ry: 1.15, v: 1 },
      { type: 'crag', x: -140, z: 186, s: 1.6, ry: 1.9, v: 0 }, { type: 'crag', x: -92, z: 120, s: 1.7, ry: 2.5, v: 1 }, { type: 'crag', x: -48, z: 118, s: 1.1, ry: 0.3, v: 1 },
      // ruin fragments on the spur crest and the far band: silhouettes at every depth between the player and the Overlook Ruins
      { type: 'ruinBit', sub: 'arch', x: 108, z: 146, ry: 2.74, s: 1.2 }, { type: 'ruinBit', sub: 'colTall', x: 103, z: 157, ry: 1.17 }, { type: 'ruinBit', sub: 'colTall', x: 113, z: 134, ry: 1.3 },
      { type: 'ruinBit', sub: 'wall', x: 100, z: 160, ry: 1.17 }, { type: 'ruinBit', sub: 'colShort', x: 118, z: 120, ry: 0.4 },
      { type: 'ruinBit', sub: 'colTall', x: -112, z: 158, ry: 1.0, s: 1.6 }, { type: 'ruinBit', sub: 'colTall', x: -107, z: 150, ry: 1.2, s: 1.5 }, { type: 'ruinBit', sub: 'arch', x: -124, z: 170, ry: 2.58, s: 1.8 },
      { type: 'ruinBit', sub: 'wall', x: -96, z: 140, ry: 1.01, s: 1.6 },
    );
    this.arenas.push({ x: 0, z: 0, r: 42, name: 'Central Plain' }, { x: -40, z: -200, r: 42, name: 'Southern Field' }, { x: 200, z: -20, r: 42, name: 'Eastern Meadow' });
    // graces near each POI + spawn + centre
    const byType = (t, i = 0) => P.filter((p) => p.type === t)[i];
    const off = (p, d) => ({ x: p.x + Math.sin(p.yaw) * d, z: p.z + Math.cos(p.yaw) * d });
    const g = (pt, name) => this.graces.push({ x: pt.x, z: pt.z, name });
    g({ x: this.spawn.x + 8, z: this.spawn.z - 14 }, 'Limveld Overlook');
    g(off(byType('church', 0), 24), 'Church of Limveld');
    g(off(byType('church', 1), 24), 'Ruined Chapel');
    g(off(byType('ruin', 0), 20), 'Lakeside Ruins');
    g(off(byType('ruin', 1), 20), 'Western Ruins');
    g(off(byType('fort'), 50), 'Fort Gate');
    g(off(byType('catacomb'), 18), 'Catacomb Entrance');
    g({ x: 10, z: 24 }, 'Heart of Limveld');
    // wolf dens
    this.dens = [{ x: 10, z: 230 }, { x: 280, z: 40 }, { x: -330, z: -320 }, { x: 60, z: -120 }];
    // stamp terrain
    for (const p of P) {
      if (p.type === 'catacomb') {
        const h = T.flattenDisk(p.x, p.z, 8, 7);
        const bx = p.x - Math.sin(p.yaw) * 11, bz = p.z - Math.cos(p.yaw) * 11;
        T.raiseDome(bx, bz, 17, 9);
        T.flattenDisk(p.x, p.z, 6, 3, h);
      } else {
        const h = T.flattenDisk(p.x, p.z, p.r, p.r * 0.7);
        // churches: the forecourt + stairs reach ~20 m out in FRONT of the centre, past the disc's feather, and a
        // hillside chapel's turf can fall away faster than a stair flight descends — a small apron at the plinth's
        // height keeps the flight's foot on ground it can meet within a few lead steps
        if (p.type === 'church') T.flattenDisk(p.x + Math.sin(p.yaw) * 16, p.z + Math.cos(p.yaw) * 16, 7, 8, h);
      }
    }
    for (const a of this.arenas) T.flattenDisk(a.x, a.z, a.r, 30);
    for (const gr of this.graces) T.flattenDisk(gr.x, gr.z, 3.5, 4);
    T.flattenDisk(this.spawn.x, this.spawn.z, 6, 6);
    T.shaveDisk(153, 212, 9, 6); // overlook: nothing pokes above the player's feet (camera clearance), hollows keep the facets
    for (const d of this.dens) T.flattenDisk(d.x, d.z, 5, 6);
    for (const b of this.braziers) T.flattenDisk(b.x, b.z, 1.2, 2);
  }

  /** Build structure meshes at their terrain heights; gather spawns and fires. */
  build() {
    const T = this.terrain;
    for (const p of this.pois) {
      let kit;
      const y = T.getHeight(p.x, p.z), cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      // (architecture builder) kit-local terrain sampler so footings and ground decals conform beyond the flat disc
      const ground = (lx, lz) => T.getHeight(p.x + lx * cs + lz * sn, p.z - lx * sn + lz * cs) - y;
      switch (p.type) {
        case 'church': kit = Structures.church(this.rng, { ruined: p.ruined, ground }); break;
        case 'fort': kit = Structures.fort(this.rng, { ground }); break;
        case 'ruin': kit = Structures.ruin(this.rng, { ground }); break;
        case 'catacomb': kit = Structures.catacombEntrance(this.rng, { ground }); break;
        case 'camp': kit = Structures.camp(this.rng, { ground }); break;
      }
      kit.group.position.set(p.x, y, p.z);
      kit.group.rotation.y = p.yaw;
      kit.group.updateMatrixWorld(true);
      this.group.add(kit.group);
      p.y = y; p.group = kit.group;
      // kit solids (walls, piers, towers, tents) into the world collider grid, rotated with the kit
      const C = this.game.colliders;
      if (C && kit.solids) for (const s of kit.solids) {
        const x = p.x + s.x * cs + s.z * sn, z = p.z - s.x * sn + s.z * cs;
        if (s.r !== undefined) C.add(x, z, s.r, 'struct', y + s.y0, y + s.y1);
        else C.addBox(x, z, s.hw, s.hd, s.yaw + p.yaw, 'struct', y + s.y0, y + s.y1);
      }
      // kit floors / steps as walkable platforms: block from below, standable on top (church plinths, stairs)
      if (C && kit.walks) for (const s of kit.walks) {
        const x = p.x + s.x * cs + s.z * sn, z = p.z - s.x * sn + s.z * cs;
        C.addWalkBox(x, z, s.hw, s.hd, s.yaw + p.yaw, y + s.y0, y + s.y1);
      }
      for (const s of kit.spawns) {
        const x = p.x + s.x * cs + s.z * sn, z = p.z - s.x * sn + s.z * cs;
        this.enemySpawns.push({ type: s.type, x, z, home: { x: p.x, z: p.z }, patrolR: p.type === 'camp' ? 7 : 9, tier: p.type === 'fort' ? 2 : 1 });
      }
      for (const f of kit.fires) {
        const x = p.x + f.x * cs + f.z * sn, z = p.z - f.x * sn + f.z * cs;
        this.fires.push(new THREE.Vector3(x, y + f.y, z));
      }
    }
    for (const b of this.braziers) this.fires.push(new THREE.Vector3(b.x, T.getHeight(b.x, b.z) + 1.35, b.z));
    for (const d of this.dens) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        this.enemySpawns.push({ type: 'wolf', x: d.x + Math.cos(a) * 3, z: d.z + Math.sin(a) * 3, home: d, patrolR: 14, tier: 1, pack: d });
      }
    }
    this.game.scene.add(this.group);
  }

  /** True when (x,z) is outside every POI / grace / arena-centre footprint (+margin). */
  isClear(x, z, margin = 0) {
    for (const p of this.pois) { const r = p.r + margin; if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return false; }
    for (const g of this.graces) { const r = 5 + margin; if ((g.x - x) ** 2 + (g.z - z) ** 2 < r * r) return false; }
    for (const a of this.arenas) { const r = 14 + margin; if ((a.x - x) ** 2 + (a.z - z) ** 2 < r * r) return false; }
    for (const d of this.dens) { const r = 6 + margin; if ((d.x - x) ** 2 + (d.z - z) ** 2 < r * r) return false; }
    const s = this.spawn; if ((s.x - x) ** 2 + (s.z - z) ** 2 < (8 + margin) ** 2) return false;
    for (const c of this.clearings) { const r = c.r + margin; if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) return false; }
    return true;
  }

  poi(type, i = 0) { return this.pois.filter((p) => p.type === type)[i]; }

  /** 0..1 how trampled the turf is at (x,z): 1 at the centre of a trampled zone, feathering to 0 at its edge. */
  trampledAt(x, z) {
    let t = 0;
    for (const c of this.trampled) { const d = Math.hypot(c.x - x, c.z - z) / c.r; if (d < 1) t = Math.max(t, 1 - d * d); }
    return t;
  }

  /** 0..1 extra vegetation density at (x,z) from the meadow zones. */
  meadowBoost(x, z) {
    let b = 0;
    for (const m of this.meadows) { const d = Math.hypot(m.x - x, m.z - z) / m.r; if (d < 1) b = Math.max(b, 1 - d * d); }
    return b;
  }

  /** Nearest flame position to p within maxDist, or null. */
  nearestFire(p, maxDist = 30) {
    let best = null, bd = maxDist * maxDist;
    for (const f of this.fires) { const d = f.distanceToSquared(p); if (d < bd) { bd = d; best = f; } }
    return best;
  }
}
