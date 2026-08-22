/**
 * Nightfarer roster (STUB for the slice): stats + starting weapon. Skills/ultimates are shared
 * placeholders in combat/Weapons.js (SKILLS) until the nightfarers builder fills this in.
 */
export const NIGHTFARERS = [
  { id: 'Wylder', name: 'Wylder', hp: 420, fp: 80, stamina: 110, weapon: 'greatsword', desc: 'A knight-errant of balanced talents. Greatsword and grappling claw.' },
  { id: 'Guardian', name: 'Guardian', hp: 540, fp: 60, stamina: 100, weapon: 'halberd', desc: 'Stalwart bird-knight who shields the party. Halberd and greatshield.' },
  { id: 'Ironeye', name: 'Ironeye', hp: 360, fp: 90, stamina: 125, weapon: 'bow', desc: 'A keen-eyed scout who marks weak points. Bow (melee stub for now).' },
  { id: 'Raider', name: 'Raider', hp: 500, fp: 50, stamina: 120, weapon: 'axe', desc: 'A brawler who trades blows with giants. Great axe.' },
  { id: 'Recluse', name: 'Recluse', hp: 300, fp: 160, stamina: 90, weapon: 'staff', desc: 'A sorceress who harvests affinities. Glintstone staff.' },
  { id: 'Executor', name: 'Executor', hp: 380, fp: 90, stamina: 115, weapon: 'katana', desc: 'A cursed swordsman who parries all. Katana.' },
  { id: 'Duchess', name: 'Duchess', hp: 320, fp: 120, stamina: 130, weapon: 'daggers', desc: 'A swift assassin who restages wounds. Twin daggers.' },
  { id: 'Revenant', name: 'Revenant', hp: 340, fp: 140, stamina: 95, weapon: 'staff', desc: 'A summoner bound to restless spirits. Staff.' },
];

export function getNightfarer(id) { return NIGHTFARERS.find((n) => n.id === id || n.name === id) || NIGHTFARERS[0]; }
