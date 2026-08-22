/**
 * Weapon table + movesets. Timings in seconds, arcs in degrees relative to the attacker's facing
 * (negative = attacker's right), motion = damage multiplier, step = root-motion metres during active frames.
 * Also: blade extents per weapon visual (for trails) and bladePoints() to place them in model space.
 */
import * as THREE from 'three';

export const WEAPONS = {
  greatsword:   { name: 'Greatsword', visual: 'greatsword', dmg: 42, reach: 2.8, moveset: 'greatsword', poiseDmg: 30, staminaMul: 1.1, rarity: 'common' },
  sword:        { name: 'Longsword', visual: 'sword', dmg: 30, reach: 2.3, moveset: 'sword', poiseDmg: 18, staminaMul: 1.0, rarity: 'common' },
  katana:       { name: 'Katana', visual: 'katana', dmg: 33, reach: 2.4, moveset: 'sword', poiseDmg: 18, staminaMul: 0.95, rarity: 'common' },
  halberd:      { name: 'Halberd', visual: 'halberd', dmg: 38, reach: 3.2, moveset: 'greatsword', poiseDmg: 26, staminaMul: 1.1, rarity: 'common' },
  axe:          { name: 'Great Axe', visual: 'axe', dmg: 46, reach: 2.5, moveset: 'greatsword', poiseDmg: 36, staminaMul: 1.2, rarity: 'common' },
  daggers:      { name: 'Daggers', visual: 'dagger', dmg: 21, reach: 1.8, moveset: 'sword', poiseDmg: 10, staminaMul: 0.75, rarity: 'common' },
  staff:        { name: 'Glintstone Staff', visual: 'staff', dmg: 27, reach: 2.5, moveset: 'sword', poiseDmg: 14, staminaMul: 0.9, rarity: 'common' },
  bow:          { name: 'Bow (melee stub)', visual: 'bow', dmg: 24, reach: 2.1, moveset: 'sword', poiseDmg: 12, staminaMul: 0.9, rarity: 'common' },
  soldierSword: { name: 'Soldier Sword', visual: 'sword', dmg: 17, reach: 2.1, moveset: 'soldier', poiseDmg: 22, staminaMul: 1, rarity: 'common' },
  knightSword:  { name: 'Fell Greatsword', visual: 'greatsword', dmg: 30, reach: 2.9, moveset: 'knight', poiseDmg: 40, staminaMul: 1, rarity: 'common' },
  claws:        { name: 'Fangs', visual: 'none', dmg: 12, reach: 1.7, moveset: 'wolf', poiseDmg: 14, staminaMul: 1, rarity: 'common' },
};

export const MOVESETS = {
  greatsword: {
    light: [
      { clip: 'light1', windup: 0.24, active: 0.17, recover: 0.42, motion: 1.0, arcFrom: -80, arcTo: 80, stamina: 17, knock: 2.5, step: 1.3 },
      { clip: 'light2', windup: 0.20, active: 0.16, recover: 0.44, motion: 1.05, arcFrom: 80, arcTo: -80, stamina: 17, knock: 2.5, step: 1.3 },
      { clip: 'light3', windup: 0.28, active: 0.15, recover: 0.55, motion: 1.45, arcFrom: -28, arcTo: 28, stamina: 20, knock: 4.5, step: 1.9, poiseMul: 1.5 },
    ],
    heavy: { clip: 'heavy', windup: 0.62, active: 0.2, recover: 0.7, motion: 2.3, arcFrom: -32, arcTo: 32, stamina: 32, knock: 6.5, step: 1.6, poiseMul: 2.2 },
  },
  sword: {
    light: [
      { clip: 'light1', windup: 0.16, active: 0.14, recover: 0.32, motion: 1.0, arcFrom: -75, arcTo: 75, stamina: 12, knock: 1.8, step: 1.0 },
      { clip: 'light2', windup: 0.14, active: 0.13, recover: 0.34, motion: 1.0, arcFrom: 75, arcTo: -75, stamina: 12, knock: 1.8, step: 1.0 },
      { clip: 'light3', windup: 0.2, active: 0.14, recover: 0.42, motion: 1.35, arcFrom: -25, arcTo: 25, stamina: 15, knock: 3.5, step: 1.6, poiseMul: 1.4 },
    ],
    heavy: { clip: 'heavy', windup: 0.5, active: 0.18, recover: 0.6, motion: 2.0, arcFrom: -30, arcTo: 30, stamina: 26, knock: 5, step: 1.4, poiseMul: 2 },
  },
  soldier: {
    light: [
      { clip: 'light1', windup: 0.6, active: 0.17, recover: 0.5, motion: 1.0, arcFrom: -75, arcTo: 75, stamina: 0, knock: 2.2, step: 0.9 },
      { clip: 'light2', windup: 0.38, active: 0.16, recover: 0.65, motion: 1.15, arcFrom: 75, arcTo: -75, stamina: 0, knock: 3.2, step: 1.0 },
    ],
    heavy: { clip: 'heavy', windup: 0.95, active: 0.2, recover: 0.85, motion: 1.9, arcFrom: -28, arcTo: 28, stamina: 0, knock: 5.5, step: 1.2, poiseMul: 2 },
  },
  knight: {
    light: [
      { clip: 'light1', windup: 0.8, active: 0.2, recover: 0.7, motion: 1.0, arcFrom: -85, arcTo: 85, stamina: 0, knock: 3.5, step: 1.2 },
      { clip: 'light2', windup: 0.5, active: 0.18, recover: 0.8, motion: 1.1, arcFrom: 85, arcTo: -85, stamina: 0, knock: 4, step: 1.2 },
    ],
    heavy: { clip: 'heavy', windup: 1.15, active: 0.22, recover: 1.0, motion: 2.0, arcFrom: -30, arcTo: 30, stamina: 0, knock: 7, step: 1.6, poiseMul: 2.5 },
  },
  wolf: {
    light: [
      { clip: 'lunge', windup: 0.5, active: 0.32, recover: 0.7, motion: 1.0, arcFrom: -40, arcTo: 40, stamina: 0, knock: 3.2, step: 6.5 },
    ],
    heavy: { clip: 'lunge', windup: 0.7, active: 0.32, recover: 0.8, motion: 1.4, arcFrom: -40, arcTo: 40, stamina: 0, knock: 4.5, step: 8 },
  },
};

/** Player skill / ultimate placeholders (shared by all nightfarers for the slice). */
export const SKILLS = {
  skill: { name: 'Lunging Strike', fp: 20, cooldown: 9, def: { clip: 'light3', windup: 0.14, active: 0.22, recover: 0.42, motion: 1.9, arcFrom: -45, arcTo: 45, stamina: 0, knock: 5, step: 5.5, poiseMul: 2 } },
  ult: { name: 'Ashen Burst', fp: 55, cooldown: 45, radius: 6.5, motion: 3.2, knock: 9 },
};

/** Trail extents [inner, tip] in metres from the palm along the weapon (outer part of the blade), per visual; null = no trail. */
export const TRAIL_SPAN = {
  greatsword: [0.5, 1.56], sword: [0.35, 1.02], katana: [0.35, 1.0], halberd: [1.35, 2.0], axe: [0.6, 0.98],
  dagger: [0.2, 0.55], staff: [0.85, 1.3], spear: [1.85, 2.28], bow: null, none: null,
};

/** Blade base/tip in bind-pose model space for a palm position (blade runs along -Y, tilted 0.35 rad forward). */
export function bladePoints(visual, handR, out = { base: new THREE.Vector3(), tip: new THREE.Vector3() }) {
  const s = TRAIL_SPAN[visual];
  if (!s) return null;
  const c = Math.cos(0.35), sn = Math.sin(0.35);
  out.base.set(handR.x, handR.y - s[0] * c, handR.z + s[0] * sn);
  out.tip.set(handR.x, handR.y - s[1] * c, handR.z + s[1] * sn);
  return out;
}
