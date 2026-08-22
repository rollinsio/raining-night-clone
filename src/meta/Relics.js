/**
 * Meta progression persisted in localStorage: relics owned, the three-slot relic vessel of every
 * Nightfarer, and the run history. Relics come in four colours (Burning / Drizzly / Luminous /
 * Tranquil scenes); a vessel slot only accepts a relic of its own colour. Bonuses are applied to the
 * Player at run start (`applyBonuses`) — the only place this module touches gameplay state.
 *
 * Storage: one JSON blob under `nightreign.meta.v1`. Every write goes through `save()`; reads are
 * guarded so a blocked / missing storage (private mode, file URLs) degrades to an in-memory session.
 */
import { PALETTE } from '../render/Style.js';

const KEY = 'nightreign.meta.v1';
const UI = PALETTE.ui;

/** Relic colours: display name, CSS colour (UI) and scene colour (3D gems) — all palette-derived. */
export const RELIC_COLORS = {
  burning:  { name: 'Burning Scene',  css: UI.hp,      hex: PALETTE.ember },
  drizzly:  { name: 'Drizzly Scene',  css: UI.fp,      hex: PALETTE.ring },
  luminous: { name: 'Luminous Scene', css: UI.gold,    hex: PALETTE.rune },
  tranquil: { name: 'Tranquil Scene', css: UI.stamina, hex: PALETTE.terrain.grassPale },
};
export const COLOR_KEYS = Object.keys(RELIC_COLORS);

/**
 * Relic effects. `value` is the tier-1 amount; tiers 2 / 3 scale it by 1.5 / 2. `stat` names the bonus
 * bucket consumed by `bonuses()` / `applyBonuses()`.
 */
export const RELIC_EFFECTS = {
  vigor:    { color: 'burning',  name: 'Ember of Vigour',     stat: 'hp',      value: 40,   fmt: (v) => `+${v} max HP` },
  might:    { color: 'burning',  name: 'Cinder of Might',     stat: 'dmg',     value: 0.06, fmt: (v) => `+${Math.round(v * 100)} % attack power` },
  flask:    { color: 'burning',  name: 'Kindled Flask',       stat: 'flask',   value: 1,    fmt: (v) => `+${v} flask charge` },
  mind:     { color: 'drizzly',  name: 'Rain-Soaked Mind',    stat: 'fp',      value: 30,   fmt: (v) => `+${v} max FP` },
  poise:    { color: 'drizzly',  name: 'Stillwater Poise',    stat: 'poise',   value: 10,   fmt: (v) => `+${v} poise` },
  endure:   { color: 'drizzly',  name: 'Drizzling Endurance', stat: 'stamina', value: 12,   fmt: (v) => `+${v} max stamina` },
  runes:    { color: 'luminous', name: 'Gilded Purse',        stat: 'runes',   value: 1200, fmt: (v) => `start with ${v.toLocaleString('en-US')} runes` },
  level:    { color: 'luminous', name: 'Dawn-Lit Memory',     stat: 'level',   value: 1,    fmt: (v) => `start at level ${1 + v}` },
  stamina:  { color: 'tranquil', name: 'Quiet Breath',        stat: 'stamina', value: 20,   fmt: (v) => `+${v} max stamina` },
  vitality: { color: 'tranquil', name: 'Verdant Vitality',    stat: 'hp',      value: 25,   fmt: (v) => `+${v} max HP` },
};

/** Vessel slot colours per Nightfarer (three slots each). */
export const VESSELS = {
  Wylder:   ['burning', 'luminous', 'drizzly'],
  Guardian: ['tranquil', 'burning', 'drizzly'],
  Ironeye:  ['drizzly', 'luminous', 'tranquil'],
  Raider:   ['burning', 'burning', 'tranquil'],
  Recluse:  ['drizzly', 'drizzly', 'luminous'],
  Executor: ['burning', 'tranquil', 'luminous'],
  Duchess:  ['luminous', 'drizzly', 'burning'],
  Revenant: ['tranquil', 'luminous', 'drizzly'],
};

const TIER_MUL = [1, 1.5, 2];
const TIER_NAME = ['', 'Polished ', 'Grand '];

function readStore() {
  try { const s = window.localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function writeStore(data) {
  try { window.localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

export class Meta {
  constructor() {
    this.relics = [];      // [{ id, effect, tier }]
    this.vessels = {};     // nfId -> [relicId | null, ×3]
    this.history = [];     // [{ nf, result, daysCleared, level, kills, runes, time, date }]
    this.nextId = 1;
    this.load();
  }

  /** Load from storage, or seed a starter collection on first boot (every vessel filled with matching relics). */
  load() {
    const d = readStore();
    if (d && Array.isArray(d.relics)) {
      this.relics = d.relics; this.vessels = d.vessels || {}; this.history = d.history || []; this.nextId = d.nextId || (this.relics.length + 1);
    } else {
      for (const eff of ['vigor', 'might', 'mind', 'endure', 'runes', 'level', 'stamina', 'vitality']) this.grant(eff, 1, false);
      this.save();
    }
    for (const nf of Object.keys(VESSELS)) this.ensureVessel(nf);
  }

  save() { writeStore({ relics: this.relics, vessels: this.vessels, history: this.history, nextId: this.nextId }); }

  /** Make sure a Nightfarer has a vessel; fill empty slots with the best unused relic of the slot colour. */
  ensureVessel(nf) {
    const slots = VESSELS[nf]; if (!slots) return;
    const v = this.vessels[nf] || (this.vessels[nf] = [null, null, null]);
    let changed = false;
    for (let i = 0; i < 3; i++) {
      if (v[i] && this.relic(v[i])) continue;
      const pick = this.relics.filter((r) => RELIC_EFFECTS[r.effect].color === slots[i] && !v.includes(r.id)).sort((a, b) => b.tier - a.tier)[0];
      v[i] = pick ? pick.id : null; changed = true;
    }
    if (changed) this.save();
  }

  relic(id) { return this.relics.find((r) => r.id === id) || null; }
  slotColor(nf, i) { return (VESSELS[nf] || VESSELS.Wylder)[i]; }
  vessel(nf) { this.ensureVessel(nf); return this.vessels[nf]; }

  /** Relics that fit slot i of a Nightfarer (same colour), best tier first. */
  candidates(nf, i) {
    const c = this.slotColor(nf, i);
    return this.relics.filter((r) => RELIC_EFFECTS[r.effect].color === c).sort((a, b) => b.tier - a.tier || a.id - b.id);
  }

  equip(nf, i, relicId) {
    const v = this.vessel(nf), r = this.relic(relicId);
    if (!r || RELIC_EFFECTS[r.effect].color !== this.slotColor(nf, i)) return false;
    v[i] = relicId; this.save(); return true;
  }
  unequip(nf, i) { const v = this.vessel(nf); v[i] = null; this.save(); }

  /** Add a relic to the collection (tier 1..3). */
  grant(effect, tier = 1, save = true) {
    const r = { id: this.nextId++, effect, tier: Math.max(1, Math.min(3, tier)) };
    this.relics.push(r); if (save) this.save(); return r;
  }

  /** Display helpers. */
  describe(r) {
    const e = RELIC_EFFECTS[r.effect];
    return { name: TIER_NAME[r.tier - 1] + e.name, effect: e.fmt(this.value(r)), color: e.color, colorName: RELIC_COLORS[e.color].name, css: RELIC_COLORS[e.color].css, tier: r.tier };
  }
  value(r) { const e = RELIC_EFFECTS[r.effect]; const v = e.value * TIER_MUL[r.tier - 1]; return e.stat === 'dmg' ? v : Math.round(v); }

  /** Sum of the equipped bonuses for a Nightfarer. */
  bonuses(nf) {
    const b = { hp: 0, fp: 0, stamina: 0, poise: 0, dmg: 0, runes: 0, level: 0, flask: 0 };
    for (const id of this.vessel(nf)) { const r = id && this.relic(id); if (r) b[RELIC_EFFECTS[r.effect].stat] += this.value(r); }
    return b;
  }

  /** Apply the equipped bonuses to a freshly created Player (call on run:start). */
  applyBonuses(player, nf) {
    const b = this.bonuses(nf);
    if (!player) return b;
    player.baseHp += b.hp; player.baseStamina += b.stamina; player.baseFp += b.fp;
    player.level = Math.max(1, (player.level || 1) + b.level);
    if (player.applyLevel) player.applyLevel();
    else { player.maxHp += b.hp; player.maxStamina += b.stamina; player.maxFp = (player.maxFp || 0) + b.fp; }
    player.hp = player.maxHp; player.stamina = player.maxStamina; player.fp = player.maxFp;
    player.maxPoise = (player.maxPoise || 0) + b.poise; player.poise = player.maxPoise;
    player.damageMult = (player.damageMult || 1) + b.dmg;
    player.runes = (player.runes || 0) + b.runes;
    if (typeof player.maxFlasks === 'number') { player.maxFlasks += b.flask; player.flasks = player.maxFlasks; }
    return b;
  }

  /** Record a finished run and grant one relic (tier grows with nights survived). Returns the new relic. */
  recordRun({ nf, result, stats, level }) {
    const s = stats || {};
    this.history.push({ nf, result, daysCleared: s.daysCleared || 0, level: level || 1, kills: s.kills || 0, runes: Math.round(s.runesEarned || 0), time: Math.round(s.time || 0), date: Date.now() });
    if (this.history.length > 50) this.history.splice(0, this.history.length - 50);
    const keys = Object.keys(RELIC_EFFECTS);
    const effect = keys[(this.history.length * 7 + (s.kills || 0)) % keys.length];
    const tier = 1 + Math.min(2, s.daysCleared || 0) + (result === 'won' ? 1 : 0);
    return this.grant(effect, Math.min(3, tier));
  }

  /** Summary line for the hub ("3 expeditions · best 2 nights"). */
  summary() {
    const n = this.history.length;
    if (!n) return 'No expeditions yet';
    const best = this.history.reduce((m, h) => Math.max(m, h.daysCleared + (h.result === 'won' ? 1 : 0)), 0);
    const wins = this.history.filter((h) => h.result === 'won').length;
    return `${n} expedition${n === 1 ? '' : 's'} · best ${best} night${best === 1 ? '' : 's'}${wins ? ` · ${wins} Nightlord${wins === 1 ? '' : 's'} felled` : ''}`;
  }
}
