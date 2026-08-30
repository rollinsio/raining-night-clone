/**
 * Player inventory: the weapons carried this expedition (run-scoped — a new Player starts empty) and which one is
 * in hand. Weapons are plain objects from run/Loot.js makeWeapon() ({ id, name, visual, moveset, dmg, rarity, skill… }).
 * Capped at INVENTORY_MAX; adding to a full inventory replaces the equipped weapon (the one you chose to hold is
 * the one you are trading away), never a stowed one.
 */
export const INVENTORY_MAX = 6;

export class Inventory {
  constructor(max = INVENTORY_MAX) { this.max = max; this.weapons = []; this.equipped = -1; }

  get current() { return this.weapons[this.equipped] || null; }
  get count() { return this.weapons.length; }
  get full() { return this.weapons.length >= this.max; }

  /** Add a weapon. Returns { index, replaced } — `replaced` is the weapon dropped to make room (null if none). */
  add(w) {
    if (this.full) {
      const i = this.equipped >= 0 ? this.equipped : this.weapons.length - 1;
      const replaced = this.weapons[i];
      this.weapons[i] = w;
      return { index: i, replaced };
    }
    this.weapons.push(w);
    return { index: this.weapons.length - 1, replaced: null };
  }

  /** Make slot i the held weapon; returns it (null for a bad index). */
  equip(i) {
    if (i < 0 || i >= this.weapons.length) return null;
    this.equipped = i;
    return this.current;
  }

  /** Step to the next (dir +1) / previous (−1) weapon; null when there is nothing to switch to. */
  cycle(dir = 1) {
    const n = this.weapons.length;
    if (n < 2) return null;
    this.equipped = (((this.equipped + dir) % n) + n) % n;
    return this.current;
  }

  /** Drop slot i (never the last weapon). Returns the removed weapon, or null. */
  remove(i) {
    if (this.weapons.length < 2 || i < 0 || i >= this.weapons.length) return null;
    const [w] = this.weapons.splice(i, 1);
    if (this.equipped > i || this.equipped >= this.weapons.length) this.equipped--;
    if (this.equipped < 0) this.equipped = 0;
    return w;
  }
}
