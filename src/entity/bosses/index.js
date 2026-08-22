/**
 * Field boss roster: createBoss(game, day, o) builds the day's field boss at (o.x, o.z) for o.arena.
 * Day 1: the Gate Sentinel (mounted knight, halberd). Day 2: the Gravehorn Demon (hulking horned brute).
 * The Nightlord (day 3) stays with the run placeholder until the nightlord piece lands.
 */
import { HornedDemon } from './HornedDemon.js';
import { Sentinel } from './Sentinel.js';

export const FIELD_BOSSES = [
  null,
  { kind: 'sentinel', name: 'Gate Sentinel', hp: 1250, dmg: 0.9, runes: 1800, subtitle: 'NIGHT I · FIELD BOSS' },
  { kind: 'demon', name: 'Gravehorn Demon', hp: 1750, dmg: 1.15, runes: 2800, subtitle: 'NIGHT II · FIELD BOSS' },
];

/** o: { x, z, arena, seed } */
export function createBoss(game, day, o) {
  const cfg = FIELD_BOSSES[Math.min(2, Math.max(1, day | 0))];
  const Cls = cfg.kind === 'sentinel' ? Sentinel : HornedDemon;
  return new Cls(game, { ...o, name: cfg.name, hp: cfg.hp, dmg: cfg.dmg, runes: cfg.runes, subtitle: cfg.subtitle });
}

export { HornedDemon } from './HornedDemon.js';
export { Sentinel } from './Sentinel.js';
export { Boss, bossFx } from './Boss.js';
export { BossArena } from './BossArena.js';
export { composeBossPose } from './Pose.js';
