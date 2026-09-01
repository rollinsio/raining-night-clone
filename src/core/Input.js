/**
 * Keyboard / mouse / gamepad -> named actions.
 * Held actions: up/down/left/right/sprint. Pressed (edge) actions are cleared by endFrame().
 * Mouse look deltas accumulate while pointer-locked and are reset each frame.
 */
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'roll', KeyE: 'interact', KeyQ: 'lockOn',
  Digit1: 'skill', Digit2: 'ult', KeyC: 'flask', KeyM: 'map', Escape: 'pause', KeyF: 'light', KeyR: 'heavy', Tab: 'lockOn',
  KeyX: 'swapWeapon', KeyI: 'inventory', KeyV: 'jump',
};
const MOUSEMAP = { 0: 'light', 1: 'lockOn', 2: 'heavy' };

/** Pointer lock can reject (headless, iframes, no gesture) — never let that surface as an error. */
export function requestLock(canvas) {
  try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* unsupported */ }
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.pressed = new Set();
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.enabled = true;          // false while menus are open (movement/attacks ignored)
    this.sensitivity = 0.0022;
    this.move = { x: 0, y: 0 };    // normalised, y = forward
    this.wantLock = true;
    this.noLock = false;           // touch mode: never request pointer lock (Touch.js sets this)
    this.touchAxis = { x: 0, y: 0 }; // virtual stick (Touch.js writes, merged like the gamepad axis)
    this.gamepad = null;

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) { this.pressed.add(a); }
      this.held.add(a);
    });
    window.addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) this.held.delete(a); });
    window.addEventListener('blur', () => { this.held.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked && this.wantLock && !this.noLock) requestLock(canvas);
      const a = MOUSEMAP[e.button];
      if (a) { this.pressed.add(a); this.held.add(a); }
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { const a = MOUSEMAP[e.button]; if (a) this.held.delete(a); });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0; this.dy += e.movementY || 0;
    });
    window.addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad.index; });
  }

  /** Poll gamepad + compute the movement axis. Call once per frame before systems. */
  update() {
    let x = 0, y = 0;
    if (this.enabled) {
      if (this.held.has('left')) x -= 1;
      if (this.held.has('right')) x += 1;
      if (this.held.has('up')) y += 1;
      if (this.held.has('down')) y -= 1;
      x += this.touchAxis.x; y += this.touchAxis.y;
    }
    if (this.gamepad !== null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.gamepad];
      if (gp && this.enabled) {
        const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
        x += dz(gp.axes[0] || 0); y -= dz(gp.axes[1] || 0);
        this.dx += dz(gp.axes[2] || 0) * 18; this.dy += dz(gp.axes[3] || 0) * 18;
        const b = gp.buttons;
        const edge = (i, a) => { const d = !!(b[i] && b[i].pressed); const k = 'gp' + i; if (d && !this[k]) this.pressed.add(a); if (d) this.held.add(a); else this.held.delete(a); this[k] = d; };
        edge(0, 'roll'); edge(2, 'light'); edge(5, 'light'); edge(7, 'heavy'); edge(3, 'interact'); edge(11, 'lockOn'); edge(4, 'skill'); edge(6, 'ult'); edge(9, 'pause');
        edge(15, 'swapWeapon'); edge(8, 'inventory'); edge(1, 'jump'); // d-pad right / select / B
        if (b[10] && b[10].pressed) this.held.add('sprint');
      }
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x; this.move.y = y;
  }

  /** Touch look-pad deltas (same units as mouse movement px; bypasses the pointer-lock gate). */
  addLook(dx, dy) { this.dx += dx; this.dy += dy; }

  isHeld(a) { return this.enabled && this.held.has(a); }
  /** Edge-triggered: true only on the frame the action was pressed. */
  wasPressed(a) { return this.pressed.has(a) && (this.enabled || a === 'pause' || a === 'map' || a === 'inventory'); }
  consume(a) { this.pressed.delete(a); }

  endFrame() { this.pressed.clear(); this.dx = 0; this.dy = 0; }

  exitLock() { if (this.locked) document.exitPointerLock?.(); }
}
