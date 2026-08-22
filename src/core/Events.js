/** Tiny pub/sub bus. Event names are listed in ARCHITECTURE.md. */
export class Events {
  constructor() { this._m = new Map(); }

  /** Subscribe; returns an unsubscribe function. */
  on(name, fn) {
    let s = this._m.get(name);
    if (!s) { s = new Set(); this._m.set(name, s); }
    s.add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) { const s = this._m.get(name); if (s) s.delete(fn); }

  emit(name, payload) {
    const s = this._m.get(name);
    if (!s) return;
    for (const fn of s) fn(payload);
  }
}
