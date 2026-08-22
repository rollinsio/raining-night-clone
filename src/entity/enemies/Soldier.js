/**
 * Soldier: sword + round shield in gambeson and half-plate with a crested kettle hat. Patrols its
 * camp, telegraphed 2-hit combo, occasional guard. Tier 2 (Fort Guard) is darker with ochre trim.
 * Also used (scaled, re-coloured, caped) as the placeholder field boss / Nightlord.
 */
import { Enemy } from '../Enemy.js';
import { createArmoredRig, ENEMY_COLORS } from './EnemyRig.js';

export class Soldier extends Enemy {
  /** o: { x, z, home, patrolR, tier, boss?: {name, scale, hp, dmg, runes}, seed } */
  constructor(game, o) {
    const boss = o.boss || null, tier = o.tier || 1;
    const scale = boss ? boss.scale : 1;
    super(game, {
      name: boss ? boss.name : (tier === 2 ? 'Fort Guard' : 'Soldier'),
      x: o.x, z: o.z, home: o.home, patrolR: o.patrolR, seed: o.seed,
      hp: boss ? boss.hp : (tier === 2 ? 170 : 120),
      poise: boss ? 140 : (tier === 2 ? 55 : 40),
      radius: 0.45, runes: boss ? boss.runes : (tier === 2 ? 150 : 85),
      aggro: boss ? 80 : 24, leash: boss ? 1e9 : 60,
      walk: 2.2, run: boss ? 4.2 : 4.6, weapon: 'soldierSword', tier, boss: !!boss,
    });
    this.scale = scale;
    this.object3d.scale.setScalar(scale);
    this.damageMult = boss ? boss.dmg : (tier === 2 ? 1.3 : 1);
    this.attackRange = this.weapon.reach * 0.95 * scale;
    const colors = boss ? ENEMY_COLORS.boss : (tier === 2 ? ENEMY_COLORS.guard : ENEMY_COLORS.soldier);
    this.rig = createArmoredRig({ kit: boss ? 'knight' : 'soldier', colors, weapon: boss ? 'greatsword' : 'sword', shield: !boss, cape: !!boss });
    this.object3d.add(this.rig.root);
    this.materials = this.rig.materials;
    this.bladeMat = this.rig.bladeMat;
    this.anim = this.rig.animator;
    this.guardChance = boss ? 0 : 0.7;
    if (boss) this.glowColor.setHex(0xffb040);
  }

  considerGuard(player, dist) {
    if (!this.guardChance || dist > 4.5) return false;
    const pa = player.attack;
    return pa && pa.phase === 'windup' && this.rng.float() < this.guardChance * 0.05;
  }
}
