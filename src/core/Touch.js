/**
 * Touch controls for phones/tablets (the Android build, portrait-first): a dynamic virtual stick,
 * a camera-look pad (a quick tap toggles lock-on), and labelled action buttons — all feeding the
 * same named actions keyboard/mouse produce in Input, so Player/Camera/Menus need no changes.
 * Dormant until a touch device is detected: a coarse, no-hover primary pointer at boot (phones,
 * the Capacitor WebView) or the first real touchstart on a hybrid. The overlay lives in its own
 * root between #hud and #menu — outside #hud so the phone-size HUD zoom never shrinks hit targets
 * (visibility mirrors the HUD's each frame), under #menu so DOM menus stay tappable above it.
 * Button placement comes from per-orientation tables (portrait screens are ~half as wide) and
 * re-applies on resize. Cancelling pointerdown suppresses the browser's compatibility mouse
 * events, so taps never reach the canvas mousedown path (no stray attacks, no pointer-lock asks).
 */
import { UI, FONT, TEXT_SHADOW, alpha, mix, shade } from '../ui/Theme.js';

const STICK_R = 58;                 // px from stick centre to full deflection
const DEAD = 0.14;                  // stick dead zone (fraction of STICK_R)
const LOOK_GAIN = 2.2;              // touch px -> equivalent mouse px for the orbit camera
const TAP_MS = 220, TAP_PX = 12;    // look-pad tap thresholds (lock-on toggle)

/** Button placement per orientation: [right, bottom|top, size] px; `pad` = left-pad width fraction. */
const LAYOUT = {
  landscape: {
    pad: 0.44,
    atk: [104, 92, 64], hvy: [26, 152, 50], roll: [26, 28, 56], skl: [190, 136, 46], ult: [176, 40, 46],
    spr: [288, 30, 42], use: [140, 232, 46], pause: [12, 8, 34, 'top'], map: [56, 8, 34, 'top'],
  },
  portrait: {
    pad: 0.5,
    atk: [84, 96, 60], hvy: [16, 160, 48], roll: [16, 28, 54], skl: [92, 20, 44], ult: [150, 120, 44],
    spr: [110, 190, 40], use: [24, 236, 44], pause: [8, 62, 32, 'top'], map: [48, 62, 32, 'top'],
  },
};

const LINE = alpha(mix(UI.text, UI.fp, 0.3), 0.4);
const GOLD_L = shade(UI.gold, 1.5);

const CSS = `
.t-ui { position: fixed; inset: 0; font-family: ${FONT}; pointer-events: none; }
.t-pad { position: absolute; top: 0; bottom: 0; pointer-events: auto; touch-action: none; }
.t-pad.l { left: 0; }
.t-pad.r { right: 0; }
.t-stick { position: absolute; width: ${STICK_R * 2}px; height: ${STICK_R * 2}px; margin: -${STICK_R}px 0 0 -${STICK_R}px; border-radius: 50%; border: 1px solid ${alpha(UI.text, 0.35)}; background: radial-gradient(circle, ${alpha(UI.text, 0.04)}, rgba(8,10,16,0.38)); box-shadow: inset 0 0 22px rgba(0,0,0,0.4); display: none; pointer-events: none; }
.t-stick .nub { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; border: 1px solid ${alpha(UI.text, 0.55)}; background: radial-gradient(circle at 38% 30%, ${alpha(UI.text, 0.34)}, rgba(10,12,18,0.85)); box-shadow: 0 2px 8px rgba(0,0,0,0.55); }
.t-btn { position: absolute; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid ${LINE}; background: radial-gradient(circle at 38% 30%, rgba(30,34,48,0.6), rgba(8,10,16,0.74)); color: ${alpha(UI.text, 0.92)}; font-size: 10.5px; letter-spacing: 0.14em; text-indent: 0.14em; text-transform: uppercase; text-shadow: ${TEXT_SHADOW}; box-shadow: 0 2px 10px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.04); pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.t-btn.on { border-color: ${alpha(UI.gold, 0.8)}; color: ${GOLD_L}; background: radial-gradient(circle at 38% 30%, ${alpha(UI.gold, 0.22)}, rgba(10,10,14,0.8)); box-shadow: 0 0 14px ${alpha(UI.gold, 0.35)}, 0 2px 10px rgba(0,0,0,0.45); }
.t-btn.big { font-size: 12px; }
.t-use { border-color: ${alpha(UI.gold, 0.5)}; color: ${GOLD_L}; display: none; }
`;

export class Touch {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.stick = { id: -1, ox: 0, oy: 0 };
    this.look = { id: -1, x: 0, y: 0, t: 0, moved: 0 };
    this.sprintLatch = false;
    this._useShown = false;
    this._shown = null;
    const coarse = matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-hover: hover)').matches;
    if (coarse) this.activate();
    else window.addEventListener('touchstart', () => this.activate(), { once: true, passive: true });
  }

  /** Build the overlay and switch the game into touch mode. Idempotent. */
  activate() {
    if (this.active) return;
    this.active = true;
    const hud = this.game.hud;
    this.game.input.noLock = true;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    this.build();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    // touch-flavoured controls hint; the interact prompt drops its keyboard keycap (a button appears instead)
    hud.el.hint.innerHTML = 'move<b>left pad</b><br>camera<b>right pad</b><br>lock-on<b>tap right pad</b><br>sprint<b>spr (latches)</b><br>dodge roll<b>roll</b><br>light / heavy<b>atk / hvy</b><br>skill / ultimate<b>skl / ult</b>';
    // the desktop hint spot (bottom-right) collides with the day/timer line and buttons on phones
    const hs = hud.el.hint.style;
    hs.top = '126px'; hs.bottom = 'auto'; hs.right = '300px'; hs.fontSize = '12px';
    hud.el.promptK.style.display = 'none';
  }

  press(a) { const i = this.game.input; i.pressed.add(a); i.held.add(a); }
  release(a) { this.game.input.held.delete(a); }
  /** setPointerCapture throws for pointers the browser isn't tracking (synthetic events) — never fatal. */
  static cap(el, e) { try { el.setPointerCapture(e.pointerId); } catch { /* fine: move/up still reach us */ } }

  /** Apply the orientation's placement table to the pads and buttons (runs on build and resize). */
  layout() {
    const L = innerHeight > innerWidth ? LAYOUT.portrait : LAYOUT.landscape;
    this.padL.style.width = `${L.pad * 100}%`;
    this.padR.style.width = `${(1 - L.pad) * 100}%`;
    for (const key in this.btns) {
      const [right, y, size, anchor] = L[key], b = this.btns[key];
      b.style.right = right + 'px';
      if (anchor === 'top') { b.style.top = y + 'px'; b.style.bottom = ''; }
      else { b.style.bottom = y + 'px'; b.style.top = ''; }
      b.style.width = b.style.height = size + 'px';
    }
  }

  build() {
    const ui = this.ui = document.createElement('div');
    ui.className = 't-ui';
    ui.style.display = 'none'; // update() mirrors the HUD's visibility
    document.body.insertBefore(ui, document.getElementById('menu'));

    // ---- pads ------------------------------------------------------------------------------ move
    const padL = this.padL = document.createElement('div'); padL.className = 't-pad l'; ui.appendChild(padL);
    const stick = this.stickEl = document.createElement('div'); stick.className = 't-stick'; stick.innerHTML = '<div class="nub"></div>'; ui.appendChild(stick);
    this.nub = stick.firstChild;
    const axis = this.game.input.touchAxis;
    const setStick = (x, y) => {
      let dx = (x - this.stick.ox) / STICK_R, dy = (y - this.stick.oy) / STICK_R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.nub.style.transform = `translate(${dx * STICK_R * 0.72}px, ${dy * STICK_R * 0.72}px)`;
      const k = len < DEAD ? 0 : Math.min(1, (len - DEAD) / (1 - DEAD)) / (len || 1);
      axis.x = dx * k; axis.y = -dy * k;
    };
    padL.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stick.id !== -1) return;
      this.stick.id = e.pointerId; this.stick.ox = e.clientX; this.stick.oy = e.clientY;
      Touch.cap(padL, e);
      stick.style.display = 'block'; stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
      setStick(e.clientX, e.clientY);
    });
    padL.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) setStick(e.clientX, e.clientY); });
    const endStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1; axis.x = 0; axis.y = 0;
      stick.style.display = 'none'; this.nub.style.transform = '';
      if (this.sprintLatch) this.setSprint(false);
    };
    padL.addEventListener('pointerup', endStick); padL.addEventListener('pointercancel', endStick);

    // ---- look pad -------------------------------------------------------------------------- camera
    const padR = this.padR = document.createElement('div'); padR.className = 't-pad r'; ui.appendChild(padR);
    padR.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.look.id !== -1) return;
      this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY;
      this.look.t = performance.now(); this.look.moved = 0; // handler time, not e.timeStamp — synthesized events carry stale stamps
      Touch.cap(padR, e);
    });
    padR.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.look.id) return;
      const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
      this.look.moved += Math.abs(dx) + Math.abs(dy);
      if (this.game.input.enabled) this.game.input.addLook(dx * LOOK_GAIN, dy * LOOK_GAIN);
    });
    const endLook = (e) => {
      if (e.pointerId !== this.look.id) return;
      this.look.id = -1;
      if (e.type === 'pointerup' && performance.now() - this.look.t < TAP_MS && this.look.moved < TAP_PX) this.game.input.pressed.add('lockOn');
    };
    padR.addEventListener('pointerup', endLook); padR.addEventListener('pointercancel', endLook);

    // ---- buttons --------------------------------------------------------------------------- actions
    this.btns = {};
    this.btn('atk', 'atk', 'light', true);
    this.btn('hvy', 'hvy', 'heavy');
    this.btn('roll', 'roll', 'roll', true);
    this.btn('skl', 'skl', 'skill');
    this.btn('ult', 'ult', 'ult');
    const spr = this.btn('spr', 'spr', null);
    spr.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.setSprint(!this.sprintLatch); });
    this.sprBtn = spr;
    this.useBtn = this.btn('use', 'use', 'interact');
    this.useBtn.classList.add('t-use');
    this.btn('pause', '▮▮', 'pause');
    this.btn('map', 'map', 'map');
  }

  /** A round action button (placed by layout()); `action` null = caller wires its own pointerdown. */
  btn(key, label, action, big = false) {
    const b = document.createElement('div');
    b.className = 't-btn' + (big ? ' big' : '');
    b.textContent = label;
    if (action) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        Touch.cap(b, e);
        this.press(action); b.classList.add('on');
      });
      const end = () => { this.release(action); b.classList.remove('on'); };
      b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
    } else {
      b.addEventListener('pointerup', (e) => e.preventDefault());
    }
    this.ui.appendChild(b);
    this.btns[key] = b;
    return b;
  }

  setSprint(on) {
    this.sprintLatch = on;
    const held = this.game.input.held;
    if (on) held.add('sprint'); else held.delete('sprint');
    this.sprBtn.classList.toggle('on', on);
  }

  /** Per-frame: mirror the HUD's visibility and show the interact button only while a prompt is up. */
  update() {
    if (!this.active) return;
    const vis = !!this.game.hud.visible;
    if (vis !== this._shown) { this._shown = vis; this.ui.style.display = vis ? '' : 'none'; }
    const want = vis && !!this.game.hud.last.prompt && this.game.state === 'EXPEDITION';
    if (want !== this._useShown) { this._useShown = want; this.useBtn.style.display = want ? 'flex' : 'none'; }
  }
}
