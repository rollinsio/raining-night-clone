/**
 * On-page detail control: a small always-present panel pinned to the bottom-right of the *page*
 * (its own #panel layer, outside the in-world HUD) holding the three detail tiers and a live fps
 * readout, so the cost of a tier is visible while you pick it.
 *
 * The tier ladder itself lives here as DETAIL — Game.setQuality() and the pause menu both read it,
 * so there is one definition of what "high / medium / low" mean. The choice is persisted in
 * localStorage and re-applied at boot.
 *
 * The panel dims and stops taking clicks while the pointer is locked (there is no cursor to click
 * it with), and fades back in the moment you Esc out or open a menu.
 */
import { UI, FONT, TEXT_SHADOW, alpha, shade, chamfer } from './Theme.js';

const KEY = 'nightreign.settings.v1';

/**
 * Detail tiers, richest first. Each entry is the whole definition of the tier:
 *   postfx    — run the composer (bloom + grade + vignette + moon halo) or render straight to canvas
 *   shadows   — sun shadow map on/off
 *   shadowMap — sun shadow map resolution when on
 */
export const DETAIL = [
  { id: 'high', label: 'High', note: 'Bloom, colour grade, 2048 shadows', postfx: true, shadows: true, shadowMap: 2048 },
  { id: 'medium', label: 'Medium', note: 'Bloom, colour grade, 1024 shadows', postfx: true, shadows: true, shadowMap: 1024 },
  { id: 'low', label: 'Low', note: 'No post pass, no sun shadows', postfx: false, shadows: false, shadowMap: 1024 },
];

/** Tier by id; unknown ids fall back to High (so an old saved value can never brick the boot). */
export function getDetail(id) { return DETAIL.find((d) => d.id === id) || DETAIL[0]; }

/** Saved tier id, or 'high' when nothing is stored / storage is unavailable. */
export function loadDetail() {
  try { const s = window.localStorage.getItem(KEY); return s ? getDetail(JSON.parse(s).detail).id : 'high'; } catch { return 'high'; }
}

export function saveDetail(id) {
  try { window.localStorage.setItem(KEY, JSON.stringify({ detail: id })); return true; } catch { return false; }
}

const CSS = `
#panel { font-family: ${FONT}; color: ${UI.text}; text-shadow: ${TEXT_SHADOW}; }
.s-panel { position: absolute; right: 44px; bottom: 26px; display: flex; align-items: center; gap: 14px;
  padding: 9px 16px; box-sizing: border-box; clip-path: ${chamfer(7)};
  background: linear-gradient(168deg, rgba(22,26,40,0.62), rgba(8,10,16,0.82));
  box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.45);
  opacity: 1; transition: opacity 0.45s ease; }
.s-panel::before { content: ''; position: absolute; inset: 0; clip-path: ${chamfer(7)};
  background: linear-gradient(168deg, ${alpha(UI.gold, 0.3)}, ${alpha(UI.gold, 0.06)} 45%, transparent);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; padding: 1px; pointer-events: none; }
.s-panel.s-idle { opacity: 0.22; pointer-events: none; }
.s-panel.s-off { display: none; }
.s-cap { font-size: 10.5px; letter-spacing: 0.28em; text-indent: 0.28em; text-transform: uppercase; color: ${UI.dim}; }
.s-seg { display: flex; align-items: stretch; border: 1px solid ${alpha(UI.text, 0.22)}; }
.s-btn { background: transparent; border: 0; border-left: 1px solid ${alpha(UI.text, 0.16)}; color: ${UI.dim};
  font: inherit; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; text-shadow: inherit;
  padding: 5px 13px; cursor: pointer; transition: background 0.15s, color 0.15s; }
.s-btn:first-child { border-left: 0; }
.s-btn:hover { background: ${alpha(UI.gold, 0.08)}; color: ${shade(UI.text, 1.1)}; }
.s-btn.sel { background: ${alpha(UI.gold, 0.16)}; color: ${shade(UI.gold, 1.35)}; box-shadow: inset 0 0 0 1px ${alpha(UI.gold, 0.5)}; }
.s-fps { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: ${UI.dim}; font-variant-numeric: tabular-nums; min-width: 62px; text-align: right; }
.s-fps b { color: ${shade(UI.text, 1.1)}; font-weight: normal; font-size: 14px; }
.s-note { position: absolute; right: 0; bottom: calc(100% + 7px); white-space: nowrap; font-size: 10.5px;
  letter-spacing: 0.16em; text-transform: uppercase; color: ${alpha(UI.dim, 0.85)}; opacity: 0; transition: opacity 0.25s; }
.s-panel.s-hint .s-note { opacity: 1; }
`;

export class Settings {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('panel');
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

    const el = document.createElement('div');
    el.className = 's-panel';
    el.innerHTML = `<div class="s-note"></div><div class="s-cap">Detail</div>
      <div class="s-seg">${DETAIL.map((d) => `<button class="s-btn" data-d="${d.id}">${d.label}</button>`).join('')}</div>
      <div class="s-fps"><b>--</b> fps</div>`;
    this.root.appendChild(el);
    this.el = el;
    this.note = el.querySelector('.s-note');
    this.fpsEl = el.querySelector('.s-fps b');
    this.buttons = [...el.querySelectorAll('.s-btn')];

    for (const b of this.buttons) {
      b.addEventListener('click', () => { game.setQuality(b.dataset.d); b.blur(); });
      b.addEventListener('mouseenter', () => this._hint(getDetail(b.dataset.d).note));
    }
    // the note is driven from JS rather than :hover so it also survives a click and a re-render
    el.addEventListener('mouseenter', () => this._hint(getDetail(game.quality).note));
    el.addEventListener('mouseleave', () => { el.classList.remove('s-hint'); });

    game.events.on('quality:changed', () => this.sync());
    this._fpsT = 0; this._idle = null;
    this.sync();
  }

  /** Show what a tier turns on, above the panel. */
  _hint(text) { this.note.textContent = text; this.el.classList.add('s-hint'); }

  /** Hide the panel entirely (screenshot poses capture the page, and the control is not part of the frame). */
  setVisible(v) { this.el.classList.toggle('s-off', !v); }

  /** Reflect game.quality onto the segmented control (also called when the pause menu changes it). */
  sync() {
    const q = this.game.quality;
    for (const b of this.buttons) b.classList.toggle('sel', b.dataset.d === q);
    if (!this.el.matches(':hover')) this.note.textContent = getDetail(q).note;
  }

  update(dt) {
    // dim to a hint while the pointer is locked — there's no cursor to click it with mid-run
    const idle = this.game.input.locked;
    if (idle !== this._idle) { this._idle = idle; this.el.classList.toggle('s-idle', idle); if (idle) this.el.classList.remove('s-hint'); }
    this._fpsT -= dt;
    if (this._fpsT <= 0) { this._fpsT = 0.25; this.fpsEl.textContent = Math.round(this.game.fps) || '--'; }
  }
}
