/**
 * Knight: heavy plate, great helm with crest and cape, two-handed greatsword. Slow, long telegraphs,
 * high poise, hits hard. Tier-2 field enemy (forts, night patrols).
 */
import { Enemy } from '../Enemy.js';
import { createArmoredRig, ENEMY_COLORS } from './EnemyRig.js';

export class Knight extends Enemy {
  /** o: { x, z, home, patrolR, seed } */
  constructor(game, o) {
    super(game, {
      name: 'Fell Knight', x: o.x, z: o.z, home: o.home, patrolR: o.patrolR ?? 8, seed: o.seed,
      hp: 260, poise: 95, radius: 0.5, runes: 240, aggro: 26, leash: 70,
      walk: 1.9, run: 4.0, weapon: 'knightSword', tier: 2,
    });
    this.scale = 1.15;
    this.object3d.scale.setScalar(this.scale);
    this.damageMult = 1.5;
    this.attackRange = this.weapon.reach * 0.95 * this.scale;
    this.rig = createArmoredRig({ kit: 'knight', colors: ENEMY_COLORS.knight, weapon: 'greatsword', cape: true });
    this.object3d.add(this.rig.root);
    this.materials = this.rig.materials;
    this.bladeMat = this.rig.bladeMat;
    this.anim = this.rig.animator;
    this.glowColor.setHex(0xff5a28);
  }

  pickAttack() {
    const ms = this.moveset;
    if (this.rng.chance(0.45)) { this.comboNext = false; return ms.heavy; }
    this.comboNext = this.rng.chance(0.5);
    return ms.light[0];
  }
}
