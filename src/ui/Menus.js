/**
 * DOM menus: hub (nightfarer select), pause, level-up (grace), death overlay, results.
 * Opening a gameplay menu pauses the sim and releases pointer lock; closing re-enables input.
 */
import { requestLock } from '../core/Input.js';
import { UI, FONT, TEXT_SHADOW, BASE_CSS, alpha } from './Theme.js';
import { weaponSvg, WEAPON_GLYPH } from './HUD.js';
import { RARITIES } from '../run/Loot.js';
import { SKILLS, WEAPON_SKILLS } from '../combat/Weapons.js';
import { CAM_DISTANCES } from '../entity/Camera.js';

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

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
/* inventory: one card per carried weapon (art, name, rarity, stats, the weapon's skill, equip / discard) */
.m-inv { min-width: 640px; max-width: 760px; }
.m-invgrid { display: flex; flex-direction: column; gap: 6px; max-height: 62vh; overflow-y: auto; padding-right: 4px; }
.m-card { display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: center; padding: 8px 12px; border: 1px solid transparent; background: rgba(255,255,255,0.02); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.m-card:hover, .m-card.sel { background: ${alpha(UI.gold, 0.07)}; border-color: ${alpha(UI.gold, 0.4)}; }
.m-card.eq { border-left: 3px solid ${UI.gold}; }
.m-card .art { width: 64px; height: 80px; position: relative; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.8)); }
.m-card .art svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.m-card .nm { font-size: 17px; letter-spacing: 0.16em; text-transform: uppercase; color: #f0e8d0; }
.m-card .nm .held { font-size: 11px; color: ${UI.gold}; letter-spacing: 0.3em; margin-left: 6px; }
.m-card .rar { font-size: 11px; letter-spacing: 0.32em; margin: 2px 0 4px; }
.m-card .st { font-size: 13px; letter-spacing: 0.1em; color: ${UI.dim}; }
.m-card .st b { color: ${UI.text}; font-weight: normal; }
.m-card .sk { font-size: 13px; line-height: 1.5; color: ${UI.dim}; margin-top: 4px; letter-spacing: 0.03em; }
.m-card .sk b { color: ${UI.text}; font-weight: normal; letter-spacing: 0.12em; text-transform: uppercase; }
.m-card .sk .fp { color: ${alpha(UI.fp, 0.9)}; white-space: nowrap; }
.m-card .acts .m-btn { font-size: 12px; padding: 6px 12px; margin: 3px 0; min-width: 96px; }
@media (max-width: 730px), (max-height: 500px) {
  .m-inv { min-width: 0; }
  .m-card { grid-template-columns: 44px 1fr; gap: 8px; padding: 6px 8px; }
  .m-card .art { width: 44px; height: 56px; }
  .m-card .acts { grid-column: 1 / 3; display: flex; gap: 6px; }
  .m-card .acts .m-btn { min-width: 0; flex: 1; }
  .m-card .nm { font-size: 14px; }
  .m-card .sk { font-size: 12px; }
}
/* phone-sized screens (portrait especially): single column, panel fits the viewport and scrolls */
@media (max-width: 730px), (max-height: 500px) {
  .m-panel { min-width: 0; max-width: 92vw; max-height: 88vh; overflow-y: auto; box-sizing: border-box; padding: 20px 22px; }
  .m-h1 { font-size: 22px; }
  .m-h2 { margin-bottom: 14px; }
  .m-hub { grid-template-columns: 1fr; gap: 14px; }
  .m-btn { font-size: 14px; padding: 8px 12px; }
  .m-list .m-btn { font-size: 14px; padding: 6px 12px; }
  .m-desc { min-height: 0; }
  .m-death .t { font-size: 52px; }
}
/* portrait phones: the roster becomes a bottom sheet so the Nightfarer figure has the top half of the screen */
@media (orientation: portrait) and (max-width: 730px) {
  .m-screen.m-hubscreen { align-items: flex-end; }
  .m-hubscreen .m-panel { width: 100vw; max-width: 100vw; max-height: 54vh; padding: 12px 18px 16px; border-left: 0; border-right: 0; }
  .m-hubscreen .m-h1 { font-size: 18px; margin: 0; }
  .m-hubscreen .m-h2 { font-size: 10px; margin-bottom: 8px; }
  .m-hubscreen .m-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
  .m-hubscreen .m-list .m-btn { padding: 5px 10px; margin: 2px 0; font-size: 13px; }
  .m-hubscreen .m-desc { font-size: 12px; line-height: 1.45; }
  .m-hubscreen .m-stats { margin: 6px 0 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  .m-hubscreen .m-row { padding: 2px 0; font-size: 12px; }
  .m-hubscreen .m-small { font-size: 10px; margin-top: 8px; }
}
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

  /** Esc: closes the pause or inventory menu if one is open, else pauses. */
  togglePause() {
    if (this.game.state !== 'EXPEDITION') return;
    if (this.open === 'pause' || this.open === 'inventory') this.resume();
    else if (!this.open) this.openPause();
  }

  toggleInventory() {
    if (this.game.state !== 'EXPEDITION' || !this.game.player) return;
    if (this.open === 'inventory') this.resume();
    else if (!this.open) this.openInventory();
  }

  /** Carried weapons: equip one (Enter / click), discard one (Delete), each card shows the weapon's skill. */
  openInventory() {
    const p = this.game.player, inv = p.inventory;
    const s = this._show('inventory', `
      <div class="m-panel m-inv"><div class="m-h1">INVENTORY</div><div class="m-h2" id="m-invsub"></div>
      <div class="m-invgrid" id="m-invgrid"></div>
      <div class="m-line"></div>
      <div class="m-small">↑ ↓ select · Enter equip · Delete discard · I / Esc close</div></div>`);
    let sel = Math.max(0, inv.equipped);
    const grid = s.querySelector('#m-invgrid');
    const render = () => {
      sel = Math.max(0, Math.min(sel, inv.count - 1));
      s.querySelector('#m-invsub').textContent = `Day ${this.game.run ? this.game.run.day : 1} · ${inv.count} / ${inv.max} weapons · Flasks ${p.flasks} / ${p.maxFlasks}`;
      grid.innerHTML = inv.weapons.map((w, i) => {
        const R = RARITIES[w.rarity] || RARITIES.common, sk = WEAPON_SKILLS[w.skill] || SKILLS.skill, eq = i === inv.equipped;
        return `<div class="m-card${i === sel ? ' sel' : ''}${eq ? ' eq' : ''}" data-i="${i}">
          <div class="art">${weaponSvg(WEAPON_GLYPH[w.visual] || 'sword')}</div>
          <div><div class="nm">${w.name}${eq ? '<span class="held">HELD</span>' : ''}</div>
          <div class="rar" style="color:${hex(R.color)}">${R.label}</div>
          <div class="st">Attack <b>${w.dmg}</b> · Reach <b>${w.reach.toFixed(1)} m</b> · Poise <b>${w.poiseDmg}</b></div>
          <div class="sk"><b>${sk.name}</b> — ${sk.desc} <span class="fp">${sk.cooldown} s cooldown</span></div></div>
          <div class="acts"><button class="m-btn" data-eq="${i}" ${eq ? 'disabled' : ''}>Equip</button><button class="m-btn" data-drop="${i}" ${inv.count < 2 ? 'disabled' : ''}>Discard</button></div>
        </div>`;
      }).join('');
      grid.querySelectorAll('.m-card').forEach((c) => c.addEventListener('mouseenter', () => { sel = +c.dataset.i; grid.querySelectorAll('.m-card').forEach((d) => d.classList.toggle('sel', d === c)); }));
      grid.querySelectorAll('[data-eq]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); equip(+b.dataset.eq); }));
      grid.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); drop(+b.dataset.drop); }));
      grid.querySelectorAll('.m-card').forEach((c) => c.addEventListener('click', () => equip(+c.dataset.i)));
    };
    const equip = (i) => { const w = inv.equip(i); if (w && w !== p.weapon) p.equipWeapon(w); sel = i; render(); };
    const drop = (i) => {
      if (!inv.remove(i)) return;
      if (p.weapon !== inv.current) p.equipWeapon(inv.current);
      render();
    };
    render();
    this._keys = (e) => {
      if (this.open !== 'inventory') return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { sel = (sel + 1) % inv.count; render(); }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') { sel = (sel + inv.count - 1) % inv.count; render(); }
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); equip(sel); }
      else if (e.code === 'Delete' || e.code === 'Backspace') drop(sel);
    };
    window.addEventListener('keydown', this._keys);
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
    s.classList.add('m-hubscreen');
    let sel = 0;
    const show = (i) => {
      sel = i; const n = list[i];
      s.querySelectorAll('.m-list .m-btn').forEach((b, j) => b.classList.toggle('sel', j === i));
      s.querySelector('#m-nfname').textContent = n.name.toUpperCase();
      s.querySelector('#m-nfdesc').textContent = n.desc;
      this.game.hubPreview.show(n);
      s.querySelector('#m-nfstats').innerHTML = `<div class="m-row">Vigour <b>${n.hp}</b></div><div class="m-row">Mind <b>${n.fp}</b></div><div class="m-row">Endurance <b>${n.stamina}</b></div><div class="m-row">Weapon <b>${n.weapon}</b></div>`;
    };
    show(0);
    // touch mode: a tap on a name only previews it (Begin starts). A tap also fires a synthetic
    // mouseenter before its click, so hover-select must be ignored there or every tap launches.
    const touch = () => this.game.touch && this.game.touch.active;
    s.querySelectorAll('.m-list .m-btn').forEach((b) => {
      b.addEventListener('mouseenter', () => { if (!touch()) show(+b.dataset.i); });
      b.addEventListener('click', () => {
        const i = +b.dataset.i;
        show(i);
        if (!touch()) onPick(list[sel]);
      });
    });
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
      <div class="m-quality"><span class="m-row" style="padding:8px 10px">Camera</span><button class="m-btn" data-cam="close">Close</button><button class="m-btn" data-cam="default">Default</button><button class="m-btn" data-cam="far">Far</button></div>
      <div class="m-line"></div>
      <button class="m-btn" id="m-abandon">Abandon Expedition</button>
      <div class="m-small">Esc to resume</div></div>`);
    s.querySelector('#m-resume').addEventListener('click', () => this.resume());
    s.querySelector('#m-abandon').addEventListener('click', () => { this.closeAll(); this.game.run.abandon(); });
    const qb = s.querySelectorAll('[data-q]');
    const mark = () => qb.forEach((b) => b.classList.toggle('sel', b.dataset.q === this.game.quality));
    qb.forEach((b) => b.addEventListener('click', () => { this.game.setQuality(b.dataset.q); mark(); }));
    mark();
    const cam = this.game.cameraCtl, cb = s.querySelectorAll('[data-cam]');
    const markCam = () => cb.forEach((b) => b.classList.toggle('sel', Math.abs(CAM_DISTANCES[b.dataset.cam] - cam.baseDist) < 0.01));
    cb.forEach((b) => b.addEventListener('click', () => { cam.setDistance(CAM_DISTANCES[b.dataset.cam]); markCam(); }));
    markCam();
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
        <div class="m-row">Attack power <b>×${p.baseDamageMult.toFixed(2)} → ×${(1 + 0.055 * p.level).toFixed(2)}</b></div>
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
