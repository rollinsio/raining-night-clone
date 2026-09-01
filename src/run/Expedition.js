/**
 * Run state: 3 days, each ~4.5 min split into explore -> ring1 -> explore -> ring2 -> boss.
 * Spawns the world's enemies, drives the ring schedule, placeholder bosses (scaled Soldiers),
 * player respawn, day advance and win/abandon.
 */
import * as THREE from 'three';
import { Ring } from './Ring.js';
import { Soldier } from '../entity/enemies/Soldier.js';
import { Wolf } from '../entity/enemies/Wolf.js';
import { createBoss } from '../entity/bosses/index.js';

export const DAY_LENGTH = 270;
const SCHEDULE = [
  { at: 0, phase: 'explore' }, { at: 60, phase: 'ring1' }, { at: 120, phase: 'explore2' }, { at: 180, phase: 'ring2' }, { at: 240, phase: 'boss' },
];
const BOSSES = [
  null,
  { name: 'Sentinel Knight', scale: 1.6, hp: 900, dmg: 1.7, runes: 1400 },
  { name: 'Hunter of the Bell', scale: 1.85, hp: 1500, dmg: 2.1, runes: 2600 },
  { name: 'Nightlord (Placeholder)', scale: 2.4, hp: 2700, dmg: 2.6, runes: 6000 },
];
export const ROMAN = ['', 'I', 'II', 'III'];
const RING_R = [0, 560, 270, 115];
/**
 * Peak speed of the ring's edge toward a fleeing player (m/s): radius shrink + centre travel, times the
 * smoothstep easing's 1.5× mid-shrink peak. Held under walk speed (5.8) so the night can always be outwalked.
 */
const RING_EDGE_SPEED = 4.6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Expedition {
  constructor(game, nf) {
    this.game = game; this.nf = nf;
    this.day = 1; this.t = 0; this.phase = 'explore'; this.phaseIdx = 0;
    this.ring = new Ring(game);
    this.boss = null; this.bossActive = false; this.bossDefeatedT = -1; this.dayEndT = -1;
    this.respawnT = -1; this.won = false; this.ended = false; this.tintT = 0;
    this.stats = { kills: 0, runesEarned: 0, deaths: 0, time: 0, daysCleared: 0 };
    this.rng = game.rng.fork(500);
    this.ringCenters = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.arena = null; this.lastArena = -1;
    this._unsubs = [];
  }

  start() {
    const game = this.game, L = game.limveld, p = game.player, ev = game.events;
    p.teleport(L.spawn.x, L.spawn.z);
    p.yaw = Math.atan2(-L.spawn.x, -L.spawn.z);
    p.respawnPoint.set(L.spawn.x, 0, L.spawn.z); p.respawnName = 'Limveld Overlook';
    game.cameraCtl.follow();
    game.cameraCtl.setOrbit(Math.atan2(L.spawn.x, L.spawn.z), 0.28, game.cameraCtl.baseDist);
    game.cameraCtl.snap();
    this.populate();
    this._unsubs.push(
      ev.on('enemy:died', (e) => { this.stats.kills++; this.stats.runesEarned += e.runes; }),
      ev.on('boss:died', (b) => this.onBossDied(b)),
      ev.on('player:died', () => { this.stats.deaths++; this.respawnT = 3.2; }),
    );
    this.startDay(1);
  }

  /** Spawn the map's enemy population. */
  populate() {
    const game = this.game, packs = new Map();
    game.limveld.enemySpawns.forEach((s, i) => {
      let e;
      if (s.type === 'wolf') {
        let pack = packs.get(s.pack); if (!pack) { pack = { alert: false }; packs.set(s.pack, pack); }
        e = new Wolf(game, { x: s.x, z: s.z, home: s.home, patrolR: s.patrolR, seed: i, pack });
      } else {
        e = new Soldier(game, { x: s.x, z: s.z, home: s.home, patrolR: s.patrolR, tier: s.tier, seed: i });
      }
      game.addEntity(e);
      this.ring.hookObject(e.object3d); // wall light on the rig materials
    });
  }

  startDay(day) {
    const game = this.game;
    this.day = day; this.t = 0; this.phaseIdx = 0; this.phase = 'explore';
    this.boss = null; this.bossActive = false; this.dayEndT = -1;
    // choose an arena (not the same as last day) and nest the ring circles around it
    const arenas = game.limveld.arenas;
    let ai = this.rng.int(0, arenas.length - 1);
    if (ai === this.lastArena) ai = (ai + 1) % arenas.length;
    this.lastArena = ai; this.arena = arenas[ai];
    const c2 = this.ringCenters[2].set(this.arena.x, 0, this.arena.z);
    const a1 = this.rng.float() * Math.PI * 2, d1 = this.rng.range(40, RING_R[2] - RING_R[3] - 10);
    const c1 = this.ringCenters[1].set(clamp(c2.x + Math.cos(a1) * d1, -300, 300), 0, clamp(c2.z + Math.sin(a1) * d1, -300, 300));
    const a0 = this.rng.float() * Math.PI * 2, d0 = this.rng.range(60, RING_R[1] - RING_R[2] - 20);
    const c0 = this.ringCenters[0].set(clamp(c1.x + Math.cos(a0) * d0, -200, 200), 0, clamp(c1.z + Math.sin(a0) * d0, -200, 200));
    this.ring.setImmediate(c0, RING_R[1]);
    game.atmosphere.setTime(day, 0);
    game.events.emit('day:changed', { day, arena: this.arena.name });
    game.hud.showTitle('DAY ' + ROMAN[day], day === 3 ? 'THE NIGHTLORD STIRS' : 'NIGHT FALLS ON LIMVELD');
  }

  enterPhase(phase) {
    this.phase = phase;
    this.game.events.emit('ring:phase', { phase, day: this.day });
    if (phase === 'ring1') { this.startShrink(this.ringCenters[1], RING_R[2]); this.game.hud.showTitle('', 'THE NIGHT CLOSES IN'); }
    else if (phase === 'ring2') { this.startShrink(this.ringCenters[2], RING_R[3]); this.game.hud.showTitle('', 'THE NIGHT CLOSES IN'); }
    else if (phase === 'boss') this.spawnBoss();
  }

  /**
   * Shrink with a duration derived from how far the edge actually travels (radius delta + centre travel),
   * so its peak speed stays at RING_EDGE_SPEED. A long first shrink may still be closing when the next phase
   * starts; shrinkTo just re-aims from wherever the ring is.
   */
  startShrink(center, toR) {
    const r = this.ring;
    const travel = Math.max(0, r.radius - toR) + Math.hypot(center.x - r.center.x, center.z - r.center.z);
    r.shrinkTo(center, toR, Math.max(20, Math.ceil((1.5 * travel) / RING_EDGE_SPEED)));
  }

  spawnBoss() {
    const game = this.game, b = BOSSES[this.day], a = this.arena;
    // days 1-2: real field bosses from entity/bosses (own rigs, phases, arena dressing); day 3: Nightlord placeholder
    const boss = this.day < 3
      ? createBoss(game, this.day, { x: a.x + 6, z: a.z + 6, arena: a, seed: this.day * 7 })
      : new Soldier(game, { x: a.x + 4, z: a.z + 4, home: a, patrolR: 10, tier: 2, boss: b, seed: this.day * 7 });
    boss.setAggro();
    game.addEntity(boss);
    this.ring.hookObject(boss.object3d);
    this.boss = boss; this.bossActive = true;
    game.events.emit('boss:start', boss);
    game.hud.showTitle(boss.name, this.day === 3 ? 'NIGHTLORD' : boss.subtitle || 'NIGHT ' + ROMAN[this.day] + ' · FIELD BOSS');
  }

  onBossDied(b) {
    if (b !== this.boss) return;
    this.stats.daysCleared++;
    this.bossActive = false; this.dayEndT = 4.5;
    this.game.hud.showTitle(this.day === 3 ? 'NIGHTLORD FELLED' : 'NIGHT ' + ROMAN[this.day] + ' SURVIVED', this.day === 3 ? 'THE DAWN RETURNS' : 'A NEW DAY BEGINS');
  }

  update(dt) {
    if (this.ended) return;
    const game = this.game, p = game.player;
    this.t += dt; this.stats.time += dt;
    const next = SCHEDULE[this.phaseIdx + 1];
    if (next && this.t >= next.at && !this.bossActive && this.dayEndT < 0) { this.phaseIdx++; this.enterPhase(next.phase); }
    this.ring.update(dt); // also writes p.ringDist / p.outsideRing and tints the fog by proximity
    if (p && p.alive && p.outsideRing) p.takeRawDamage(p.maxHp * 0.02 * dt);
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.respawnT = -1; p.respawn();
        for (const e of game.entities) if (e !== p && e.alive && !e.isBoss) { e.aggro = false; if (e.state !== 'idle') e.setState('idle'); }
      }
    }
    if (this.dayEndT > 0) {
      this.dayEndT -= dt;
      if (this.dayEndT <= 0) { this.dayEndT = -1; if (this.day < 3) this.startDay(this.day + 1); else this.win(); }
    }
    this.tintT -= dt;
    if (this.tintT <= 0) { this.tintT = 2; game.atmosphere.setTime(this.day, clamp(this.t / 240, 0, 1)); }
  }

  /** Seconds until the next scheduled phase (0 when none). */
  timeToNext() { const n = SCHEDULE[this.phaseIdx + 1]; return n ? Math.max(0, n.at - this.t) : 0; }

  win() { this.won = true; this.ended = true; this.game.events.emit('run:won', this.stats); this.game.endExpedition('won'); }
  abandon() { this.ended = true; this.game.events.emit('run:lost', this.stats); this.game.endExpedition('lost'); }

  /** Debug: jump to a day and a fraction of it (phases applied, shrinks completed). */
  setTime(day, t01) {
    if (this.boss) { this.boss.remove = true; this.boss.alive = false; }
    this.startDay(clamp(day | 0, 1, 3));
    this.t = clamp(t01, 0, 1) * 240;
    for (let i = 1; i < SCHEDULE.length && SCHEDULE[i].at <= this.t + 0.5; i++) { this.phaseIdx = i; this.enterPhase(SCHEDULE[i].phase); this.ring.finishShrink(); }
  }

  /** Debug: spawn an enemy next to the player. */
  spawnDebug(type = 'soldier') {
    const game = this.game, p = game.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const x = p.pos.x + fx * 5, z = p.pos.z + fz * 5, seed = (Math.random() * 1e6) | 0;
    let e;
    if (type === 'wolf') e = new Wolf(game, { x, z, home: { x, z }, patrolR: 8, seed, pack: { alert: false } });
    else if (type === 'boss') e = createBoss(game, this.day, { x, z, arena: this.arena, seed });
    else if (type === 'nightlord') e = new Soldier(game, { x, z, home: { x, z }, patrolR: 10, tier: 2, boss: BOSSES[3], seed });
    else e = new Soldier(game, { x, z, home: { x, z }, patrolR: 8, tier: type === 'guard' ? 2 : 1, seed });
    game.addEntity(e);
    this.ring.hookObject(e.object3d);
    return e;
  }

  results(result) {
    const p = this.game.player;
    return { result, day: this.day, nightfarer: this.nf.name, level: p ? p.level : 1, runes: p ? p.runes : 0, ...this.stats };
  }

  dispose() { for (const u of this._unsubs) u(); this._unsubs.length = 0; this.ring.dispose(); }
}
