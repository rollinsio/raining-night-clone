/**
 * DOM menus: hub (nightfarer select), pause, level-up (grace), death overlay, results.
 * Opening a gameplay menu pauses the sim and releases pointer lock; closing re-enables input.
 */
import { requestLock } from '../core/Input.js';
import { UI, FONT, TEXT_SHADOW, BASE_CSS, alpha } from './Theme.js';

const CSS = BASE_CSS + `
#menu { font-family: ${FONT}; color: ${UI.text}; text-shadow: ${TEXT_SHADOW}; }
.m-screen { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.m-dim { background: radial-gradient(ellipse at center, rgba(5,6,12,0.55), rgba(5,6,12,0.88)); }
.m-panel { background: linear-gradient(rgba(12,12,17,0.94), rgba(6,6,9,0.96)); border: 1px solid ${alpha(UI.text, 0.3)}; box-shadow: 0 0 0 1px rgba(0,0,0,0.8), inset 0 0 0 1px ${alpha(UI.gold, 0.12)}, 0 30px 80px rgba(0,0,0,0.8); padding: 34px 44px; min-width: 420px; }
.m-h1 { font-size: 30px; letter-spacing: 0.42em; text-indent: 0.42em; text-align: center; margin: 0 0 6px; }
.m-h2 { font-size: 12px; letter-spacing: 0.36em; text-indent: 0.36em; text-align: center; color: ${UI.dim}; text-transform: uppercase; margin-bottom: 24px; }
.m-line { position: relative; height: 1px; background: linear-gradient(90deg, transparent, ${alpha(UI.gold, 0.8)} 30%, ${alpha(UI.gold, 0.8)} 70%, transparent); margin: 14px 0 22px; }
.m-line::after { content: ''; position: absolute; left: 50%; top: -3px; width: 6px; height: 6px; margin-left: -3px; transform: rotate(45deg); background: ${UI.gold}; box-shadow: 0 0 6px ${alpha(UI.gold, 0.8)}; }
.m-btn { display: block; width: 100%; box-sizing: border-box; background: transparent; color: ${UI.text}; border: 1px solid transparent; font: inherit; font-size: 17px; letter-spacing: 0.22em; text-transform: uppercase; padding: 10px 18px; margin: 4px 0; cursor: pointer; text-align: center; transition: background 0.15s, border-color 0.15s; }
.m-btn:hover, .m-btn.sel { background: ${alpha(UI.gold, 0.09)}; border-color: ${alpha(UI.gold, 0.45)}; color: #f0e8d0; }
.m-btn:disabled { color: #55524a; cursor: default; background: transparent; border-color: transparent; }
.m-row { display: flex; justify-content: space-between; font-size: 14px; letter-spacing: 0.12em; padding: 5px 0; color: ${UI.dim}; }
.m-row b { color: ${UI.text}; font-weight: normal; }
.m-gold { color: ${UI.gold}; }
.m-hub { display: grid; grid-template-columns: 300px 420px; gap: 34px; }
.m-list .m-btn { text-align: left; font-size: 16px; }
.m-desc { font-size: 14px; line-height: 1.7; color: ${UI.dim}; letter-spacing: 0.04em; min-height: 70px; }
.m-stats { margin: 16px 0 22px; }
.m-death { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.75) 45%, rgba(0,0,0,0.75) 55%, transparent 70%); opacity: 0; transition: opacity 1.2s ease; pointer-events: none; }
.m-death .t { font-size: 96px; letter-spacing: 0.3em; text-indent: 0.3em; color: #a81e1e; text-shadow: 0 0 30px rgba(168,30,30,0.7), 0 2px 8px #000; transform: scaleY(1.15); }
.m-small { font-size: 12px; letter-spacing: 0.18em; color: ${UI.dim}; text-align: center; margin-top: 16px; text-transform: uppercase; }
.m-quality { display: flex; gap: 6px; justify-content: center; margin: 8px 0; }
.m-quality .m-btn { width: auto; font-size: 13px; padding: 6px 14px; }
`;

export class Menus {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('menu');
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    this.open = null; this.paused = false;
  }

  isOpen() { return !!this.open; }

  _show(kind, html, { dim = true, pause = true } = {}) {
    this.closeAll();
    const screen = document.createElement('div');
    screen.className = 'm-screen' + (dim ? ' m-dim' : '');
    screen.innerHTML = html;
    this.root.appendChild(screen);
    this.open = kind; this.screen = screen;
    if (pause) { this.game.paused = true; this.paused = true; }
    this.game.input.enabled = false;
    this.game.input.exitLock();
    return screen;
  }

  closeAll() {
    if (this.screen) { this.screen.remove(); this.screen = null; }
    if (this._keys) { window.removeEventListener('keydown', this._keys); this._keys = null; }
    this.open = null;
    if (this.paused) { this.game.paused = false; this.paused = false; }
    this.game.input.enabled = true;
  }

  /** Close and re-acquire pointer lock (must be called from a user gesture). */
  resume() {
    this.closeAll();
    if (this.game.state === 'EXPEDITION' && this.game.input.wantLock && !this.game.input.noLock) requestLock(this.game.canvas);
  }

  togglePause() {
    if (this.game.state !== 'EXPEDITION') return;
    if (this.open === 'pause') this.resume();
    else if (!this.open) this.openPause();
  }

  // ---------------------------------------------------------------------------------------------

  openHub(list, onPick) {
    const items = list.map((n, i) => `<button class="m-btn${i === 0 ? ' sel' : ''}" data-i="${i}">${n.name}</button>`).join('');
    const s = this._show('hub', `
      <div class="m-panel"><div class="m-h1">NIGHTREIGN</div><div class="m-h2">Roundtable Hold · Choose your Nightfarer</div>
      <div class="m-hub"><div class="m-list">${items}</div>
      <div><div class="m-h2" style="text-align:left;text-indent:0" id="m-nfname"></div><div class="m-desc" id="m-nfdesc"></div>
      <div class="m-stats" id="m-nfstats"></div><button class="m-btn" id="m-begin" style="border-color:#6b5a33">Begin Expedition</button>
      <div class="m-small">Limveld · 3 nights · 8 sites of grace</div></div></div></div>`, { dim: false, pause: false });
    let sel = 0;
    const show = (i) => {
      sel = i; const n = list[i];
      s.querySelectorAll('.m-list .m-btn').forEach((b, j) => b.classList.toggle('sel', j === i));
      s.querySelector('#m-nfname').textContent = n.name.toUpperCase();
      s.querySelector('#m-nfdesc').textContent = n.desc;
      s.querySelector('#m-nfstats').innerHTML = `<div class="m-row">Vigour <b>${n.hp}</b></div><div class="m-row">Mind <b>${n.fp}</b></div><div class="m-row">Endurance <b>${n.stamina}</b></div><div class="m-row">Weapon <b>${n.weapon}</b></div>`;
    };
    show(0);
    s.querySelectorAll('.m-list .m-btn').forEach((b) => { b.addEventListener('mouseenter', () => show(+b.dataset.i)); b.addEventListener('click', () => { show(+b.dataset.i); onPick(list[sel]); }); });
    s.querySelector('#m-begin').addEventListener('click', () => onPick(list[sel]));
    this._keys = (e) => {
      if (this.open !== 'hub') return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') show((sel + 1) % list.length);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') show((sel + list.length - 1) % list.length);
      else if (e.code === 'Enter' || e.code === 'Space') onPick(list[sel]);
    };
    window.addEventListener('keydown', this._keys);
  }

  openPause() {
    const s = this._show('pause', `
      <div class="m-panel"><div class="m-h1">PAUSED</div><div class="m-h2">Expedition · Day ${this.game.run ? this.game.run.day : 1}</div>
      <button class="m-btn" id="m-resume">Resume</button>
      <div class="m-quality"><span class="m-row" style="padding:8px 10px">Quality</span><button class="m-btn" data-q="high">High</button><button class="m-btn" data-q="low">Low</button></div>
      <div class="m-line"></div>
      <button class="m-btn" id="m-abandon">Abandon Expedition</button>
      <div class="m-small">Esc to resume</div></div>`);
    s.querySelector('#m-resume').addEventListener('click', () => this.resume());
    s.querySelector('#m-abandon').addEventListener('click', () => { this.closeAll(); this.game.run.abandon(); });
    const qb = s.querySelectorAll('[data-q]');
    const mark = () => qb.forEach((b) => b.classList.toggle('sel', b.dataset.q === this.game.quality));
    qb.forEach((b) => b.addEventListener('click', () => { this.game.setQuality(b.dataset.q); mark(); }));
    mark();
  }

  /** Level cost curve. */
  static cost(level) { return Math.floor(90 + 70 * Math.pow(level, 1.55)); }

  openLevelUp() {
    const p = this.game.player;
    const s = this._show('levelup', `<div class="m-panel"><div class="m-h1">SITE OF GRACE</div><div class="m-h2" id="m-gname"></div><div id="m-body"></div></div>`);
    const render = () => {
      const cost = Menus.cost(p.level), can = p.runes >= cost;
      s.querySelector('#m-gname').textContent = p.respawnName;
      s.querySelector('#m-body').innerHTML = `
        <div class="m-row">Level <b>${p.level}</b></div>
        <div class="m-row">Runes held <b class="m-gold">${p.runes.toLocaleString('en-US')}</b></div>
        <div class="m-row">Runes to next level <b class="${can ? 'm-gold' : ''}">${cost.toLocaleString('en-US')}</b></div>
        <div class="m-line"></div>
        <div class="m-row">Vigour (HP) <b>${p.maxHp} → ${Math.round(p.baseHp * (1 + 0.065 * p.level))}</b></div>
        <div class="m-row">Endurance <b>${p.maxStamina} → ${p.baseStamina + 3 * p.level}</b></div>
        <div class="m-row">Attack power <b>×${p.damageMult.toFixed(2)} → ×${(1 + 0.055 * p.level).toFixed(2)}</b></div>
        <div class="m-line"></div>
        <button class="m-btn" id="m-lvl" ${can ? '' : 'disabled'}>Level Up</button>
        <button class="m-btn" id="m-leave">Leave</button>`;
      s.querySelector('#m-lvl').addEventListener('click', () => {
        if (p.runes < cost) return;
        p.runes -= cost; p.level++; p.applyLevel(); p.hp = p.maxHp; p.stamina = p.maxStamina; p.fp = p.maxFp;
        this.game.events.emit('levelup', p.level); this.game.events.emit('runes:changed', p.runes);
        render();
      });
      s.querySelector('#m-leave').addEventListener('click', () => this.resume());
    };
    render();
  }

  showDeath() {
    const d = document.createElement('div');
    d.className = 'm-death'; d.innerHTML = '<div class="t">YOU DIED</div>';
    this.root.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; });
    setTimeout(() => { d.style.opacity = '0'; }, 2600);
    setTimeout(() => d.remove(), 4000);
  }

  showResults(r, onReturn) {
    const won = r.result === 'won';
    const s = this._show('results', `
      <div class="m-panel"><div class="m-h1">${won ? 'NIGHTLORD FELLED' : 'EXPEDITION ABANDONED'}</div><div class="m-h2">${won ? 'The dawn returns to Limveld' : 'The night endures'}</div>
      <div class="m-row">Nightfarer <b>${r.nightfarer}</b></div>
      <div class="m-row">Nights survived <b>${r.daysCleared} / 3</b></div>
      <div class="m-row">Level reached <b>${r.level}</b></div>
      <div class="m-row">Enemies felled <b>${r.kills}</b></div>
      <div class="m-row">Runes earned <b class="m-gold">${Math.round(r.runesEarned).toLocaleString('en-US')}</b></div>
      <div class="m-row">Deaths <b>${r.deaths}</b></div>
      <div class="m-row">Time <b>${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}</b></div>
      <div class="m-line"></div>
      <button class="m-btn" id="m-return">Return to Roundtable</button></div>`, { pause: false });
    s.querySelector('#m-return').addEventListener('click', () => { this.closeAll(); onReturn(); });
  }
}
