/**
 * Weapon table + movesets. Timings in seconds, arcs in degrees relative to the attacker's facing
 * (negative = attacker's right), motion = damage multiplier, step = root-motion metres during active frames.
 * Also: blade extents per weapon visual (for trails) and bladePoints() to place them in model space.
 */
import * as THREE from 'three';

export const WEAPONS = {
  // player weapons carry a `skill` (WEAPON_SKILLS key): the art bound to the weapon, cast with the skill action
  greatsword:   { name: 'Greatsword', visual: 'greatsword', dmg: 42, reach: 2.8, moveset: 'greatsword', poiseDmg: 30, staminaMul: 1.1, rarity: 'common', skill: 'lionsClaw' },
  sword:        { name: 'Longsword', visual: 'sword', dmg: 30, reach: 2.3, moveset: 'sword', poiseDmg: 18, staminaMul: 1.0, rarity: 'common', skill: 'lunge' },
  katana:       { name: 'Katana', visual: 'katana', dmg: 33, reach: 2.4, moveset: 'sword', poiseDmg: 18, staminaMul: 0.95, rarity: 'common', skill: 'unsheathe' },
  halberd:      { name: 'Halberd', visual: 'halberd', dmg: 38, reach: 3.2, moveset: 'greatsword', poiseDmg: 26, staminaMul: 1.1, rarity: 'common', skill: 'whirlwind' },
  axe:          { name: 'Great Axe', visual: 'axe', dmg: 46, reach: 2.5, moveset: 'greatsword', poiseDmg: 36, staminaMul: 1.2, rarity: 'common', skill: 'warCry' },
  daggers:      { name: 'Daggers', visual: 'dagger', dmg: 21, reach: 1.8, moveset: 'sword', poiseDmg: 10, staminaMul: 0.75, rarity: 'common', skill: 'shadowStep' },
  staff:        { name: 'Glintstone Staff', visual: 'staff', dmg: 27, reach: 2.5, moveset: 'staff', poiseDmg: 14, staminaMul: 0.9, rarity: 'common', skill: 'glintstoneArc' },
  bow:          { name: 'Recurve Bow', visual: 'bow', dmg: 26, reach: 2.1, moveset: 'bow', poiseDmg: 12, staminaMul: 0.9, rarity: 'common', skill: 'barrage' },
  soldierSword: { name: 'Soldier Sword', visual: 'sword', dmg: 17, reach: 2.1, moveset: 'soldier', poiseDmg: 22, staminaMul: 1, rarity: 'common' },
  knightSword:  { name: 'Fell Greatsword', visual: 'greatsword', dmg: 30, reach: 2.9, moveset: 'knight', poiseDmg: 40, staminaMul: 1, rarity: 'common' },
  claws:        { name: 'Fangs', visual: 'none', dmg: 12, reach: 1.7, moveset: 'wolf', poiseDmg: 14, staminaMul: 1, rarity: 'common' },
};

export const MOVESETS = {
  // ranged entries: no arc sweep — the Player releases `ranged` (kind / speed / life / hit radius) at the start of
  // the active frames (combat/Projectiles.js). `fp` is a cast cost; short of it the heavy falls back to the light.
  bow: {
    light: [
      { clip: 'bow', windup: 0.3, active: 0.08, recover: 0.34, motion: 1.0, arcFrom: 0, arcTo: 0, stamina: 9, knock: 1.6, step: 0, ranged: { kind: 'arrow', speed: 46, life: 1.6 } },
      { clip: 'bow', windup: 0.22, active: 0.08, recover: 0.34, motion: 1.0, arcFrom: 0, arcTo: 0, stamina: 9, knock: 1.6, step: 0, ranged: { kind: 'arrow', speed: 46, life: 1.6 } },
      { clip: 'bow', windup: 0.22, active: 0.08, recover: 0.4, motion: 1.15, arcFrom: 0, arcTo: 0, stamina: 10, knock: 2.2, step: 0, ranged: { kind: 'arrow', speed: 48, life: 1.6 } },
    ],
    heavy: { clip: 'bow', windup: 0.78, active: 0.1, recover: 0.5, motion: 2.4, arcFrom: 0, arcTo: 0, stamina: 22, knock: 5, step: 0, poiseMul: 2.2, ranged: { kind: 'arrow', speed: 60, life: 1.9, radius: 0.3 } },
  },
  staff: {
    light: [
      { clip: 'cast', windup: 0.3, active: 0.1, recover: 0.38, motion: 1.0, arcFrom: 0, arcTo: 0, stamina: 6, knock: 1.4, step: 0, ranged: { kind: 'glintstone', speed: 30, life: 2.0 } },
      { clip: 'cast', windup: 0.24, active: 0.1, recover: 0.38, motion: 1.0, arcFrom: 0, arcTo: 0, stamina: 6, knock: 1.4, step: 0, ranged: { kind: 'glintstone', speed: 30, life: 2.0 } },
      { clip: 'cast', windup: 0.26, active: 0.1, recover: 0.44, motion: 1.2, arcFrom: 0, arcTo: 0, stamina: 7, knock: 2.0, step: 0, ranged: { kind: 'glintstone', speed: 32, life: 2.0 } },
    ],
    heavy: { clip: 'cast', windup: 0.72, active: 0.12, recover: 0.6, motion: 2.6, arcFrom: 0, arcTo: 0, stamina: 12, fp: 18, knock: 6, step: 0, poiseMul: 2.4, ranged: { kind: 'comet', speed: 38, life: 2.2 } },
  },
  greatsword: {
    light: [
      { clip: 'light1', windup: 0.24, active: 0.34, recover: 0.25, motion: 1.0, arcFrom: -80, arcTo: 80, stamina: 17, knock: 2.5, step: 1.3 },
      { clip: 'light2', windup: 0.20, active: 0.32, recover: 0.28, motion: 1.05, arcFrom: 80, arcTo: -80, stamina: 17, knock: 2.5, step: 1.3 },
      { clip: 'light3', windup: 0.28, active: 0.32, recover: 0.38, motion: 1.45, arcFrom: -28, arcTo: 28, stamina: 20, knock: 4.5, step: 1.9, poiseMul: 1.5 },
    ],
    heavy: { clip: 'heavy', windup: 0.62, active: 0.34, recover: 0.56, motion: 2.3, arcFrom: -32, arcTo: 32, stamina: 32, knock: 6.5, step: 1.6, poiseMul: 2.2 },
  },
  sword: {
    light: [
      { clip: 'light1', windup: 0.16, active: 0.22, recover: 0.24, motion: 1.0, arcFrom: -75, arcTo: 75, stamina: 12, knock: 1.8, step: 1.0 },
      { clip: 'light2', windup: 0.14, active: 0.21, recover: 0.26, motion: 1.0, arcFrom: 75, arcTo: -75, stamina: 12, knock: 1.8, step: 1.0 },
      { clip: 'light3', windup: 0.2, active: 0.22, recover: 0.34, motion: 1.35, arcFrom: -25, arcTo: 25, stamina: 15, knock: 3.5, step: 1.6, poiseMul: 1.4 },
    ],
    heavy: { clip: 'heavy', windup: 0.5, active: 0.26, recover: 0.52, motion: 2.0, arcFrom: -30, arcTo: 30, stamina: 26, knock: 5, step: 1.4, poiseMul: 2 },
  },
  soldier: {
    light: [
      { clip: 'light1', windup: 0.6, active: 0.26, recover: 0.41, motion: 1.0, arcFrom: -75, arcTo: 75, stamina: 0, knock: 2.2, step: 0.9 },
      { clip: 'light2', windup: 0.38, active: 0.25, recover: 0.56, motion: 1.15, arcFrom: 75, arcTo: -75, stamina: 0, knock: 3.2, step: 1.0 },
    ],
    heavy: { clip: 'heavy', windup: 0.95, active: 0.30, recover: 0.75, motion: 1.9, arcFrom: -28, arcTo: 28, stamina: 0, knock: 5.5, step: 1.2, poiseMul: 2 },
  },
  knight: {
    light: [
      { clip: 'light1', windup: 0.8, active: 0.36, recover: 0.54, motion: 1.0, arcFrom: -85, arcTo: 85, stamina: 0, knock: 3.5, step: 1.2 },
      { clip: 'light2', windup: 0.5, active: 0.34, recover: 0.64, motion: 1.1, arcFrom: 85, arcTo: -85, stamina: 0, knock: 4, step: 1.2 },
    ],
    heavy: { clip: 'heavy', windup: 1.15, active: 0.36, recover: 0.86, motion: 2.0, arcFrom: -30, arcTo: 30, stamina: 0, knock: 7, step: 1.6, poiseMul: 2.5 },
  },
  wolf: {
    light: [
      { clip: 'lunge', windup: 0.5, active: 0.32, recover: 0.7, motion: 1.0, arcFrom: -40, arcTo: 40, stamina: 0, knock: 3.2, step: 6.5 },
    ],
    heavy: { clip: 'lunge', windup: 0.7, active: 0.32, recover: 0.8, motion: 1.4, arcFrom: -40, arcTo: 40, stamina: 0, knock: 4.5, step: 8 },
  },
};

/**
 * Weapon skills (one per weapon type; `WEAPONS[id].skill` names one). Gated by cooldown alone (no FP cost —
 * FP belongs to casts and the ultimate). Each is an attack def plus optional extras the
 * Player understands: `spin` (radians of yaw turned over the active frames), `iframes` (seconds of invulnerability
 * from the first frame), `buff` {mul, dur} (attack multiplier for dur seconds), `radial` (hit test is the arc
 * sector around the body instead of the swept blade — shockwaves), `ranged.count` / `ranged.spread` (a fan of
 * projectiles, spread in radians between neighbours). `desc` is the inventory blurb.
 */
export const WEAPON_SKILLS = {
  lionsClaw:     { name: "Lion's Claw", desc: 'Bound forward and bring the blade down with the whole body behind it.', cooldown: 10,
    def: { clip: 'heavy', windup: 0.34, active: 0.3, recover: 0.5, motion: 2.6, arcFrom: -40, arcTo: 40, stamina: 0, knock: 7, step: 3.4, poiseMul: 3 } },
  lunge:         { name: 'Lunging Strike', desc: 'A long thrust that closes the distance in a blink.', cooldown: 8,
    def: { clip: 'light3', windup: 0.14, active: 0.22, recover: 0.42, motion: 1.9, arcFrom: -45, arcTo: 45, stamina: 0, knock: 5, step: 5.5, poiseMul: 2 } },
  unsheathe:     { name: 'Unsheathe', desc: 'Hold the stance, then cut in a single flash.', cooldown: 9,
    def: { clip: 'light2', windup: 0.55, active: 0.12, recover: 0.4, motion: 2.6, arcFrom: 90, arcTo: -90, stamina: 0, knock: 5, step: 2.4, poiseMul: 2.6 } },
  whirlwind:     { name: 'Spinning Slash', desc: 'Whirl the polearm through everything around you.', cooldown: 11,
    def: { clip: 'spin', windup: 0.3, active: 0.55, recover: 0.45, motion: 1.5, arcFrom: -180, arcTo: 180, stamina: 0, knock: 4.5, step: 2.2, poiseMul: 1.8, spin: Math.PI * 2 } },
  warCry:        { name: 'War Cry', desc: 'A roar that staggers whatever stands near and hardens your blows for a while.', cooldown: 16,
    def: { clip: 'roar', windup: 0.3, active: 0.16, recover: 0.5, motion: 0.5, arcFrom: -180, arcTo: 180, stamina: 0, knock: 6, step: 0, poiseMul: 3, radial: true, reachOverride: 4.2, burst: true, buff: { mul: 1.25, dur: 14 } } },
  shadowStep:    { name: 'Shadow Step', desc: 'Blink through danger and rip out the other side.', cooldown: 7,
    def: { clip: 'light3', windup: 0.06, active: 0.26, recover: 0.36, motion: 2.2, arcFrom: -50, arcTo: 50, stamina: 0, knock: 3.5, step: 5.2, poiseMul: 1.6, iframes: 0.4 } },
  glintstoneArc: { name: 'Glintstone Arc', desc: 'Hurl a fan of three glintstone shards.', cooldown: 8,
    def: { clip: 'cast', windup: 0.3, active: 0.12, recover: 0.46, motion: 1.3, arcFrom: 0, arcTo: 0, stamina: 0, knock: 2.2, step: 0, ranged: { kind: 'glintstone', speed: 34, life: 2.0, count: 3, spread: 0.32 } } },
  barrage:       { name: 'Barrage', desc: 'Loose a spread of five arrows at once.', cooldown: 9,
    def: { clip: 'bow', windup: 0.3, active: 0.1, recover: 0.42, motion: 1.1, arcFrom: 0, arcTo: 0, stamina: 0, knock: 2.5, step: 0, ranged: { kind: 'arrow', speed: 50, life: 1.6, count: 5, spread: 0.2 } } },
};

/** Fallback skill (weapons without one) and the ultimate placeholder (shared by all nightfarers for the slice). */
export const SKILLS = {
  skill: WEAPON_SKILLS.lunge,
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
