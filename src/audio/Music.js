/**
 * Music: the two "Blackened Cathedral" tracks (audio/tracks, bundled by Vite) as the score.
 * Hub and expedition: the two tracks rotate (II → III → II …) crossfading over the last seconds of each, the hub
 * mixed quieter; a boss pulls Cathedral III in and loops it until the boss dies; death ducks the score down,
 * the results screen fades it out; pause / inventory / map duck it. Plain <audio> elements — no WebAudio graph,
 * so the Capacitor WebView and every browser treat it the same. Browsers only let audio start after a user
 * gesture: playback is (re)tried on every key / pointer / touch until it takes, so a game started before the
 * first click just begins its music on the first input. The volume setting (off / low / full) persists in
 * localStorage.
 */
import cathedral2 from './tracks/blackened-cathedral-2.mp3?url';
import cathedral3 from './tracks/blackened-cathedral-3.mp3?url';

const URLS = { cathedral2, cathedral3 };
const ROTATION = ['cathedral2', 'cathedral3'];
const BOSS_TRACK = 'cathedral3';
const KEY = 'nightreign.music.v1';
export const MUSIC_LEVELS = { off: 0, low: 0.4, full: 1 };
const BASE = 0.6;       // element volume at "full" — the mixes are hot, keep headroom
const HUB_MIX = 0.55;   // hub score relative to the expedition
const DUCK = 0.35;      // menus / map / death
const XFADE = 6;        // s, track-to-track crossfade (starts this long before the current track ends)
const FADE = 1.5;       // s, full-scale fade for start / stop / duck moves
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Music {
  constructor(game) {
    this.game = game;
    this.level = Music.loadLevel();
    this.mode = 'off';            // off | hub | explore | boss
    this.cur = null;              // name of the track carrying the score
    this.master = 0;              // smoothed overall gain
    this._now = 0;                // wall clock of the last update (fades run in real time whatever the frame rate)
    this.unlocked = false;        // a play() has succeeded (the browser accepted a gesture)
    this.tracks = {};
    for (const name of Object.keys(URLS)) {
      const el = new Audio(URLS[name]);
      el.preload = 'auto'; el.loop = false; el.volume = 0;
      const t = { name, el, gain: 0, target: 0, playing: false };
      el.addEventListener('ended', () => { t.playing = false; t.gain = 0; t.target = 0; if (this.cur === name && this.mode !== 'off') this.advance(); });
      this.tracks[name] = t;
    }
    // any gesture may be the one the browser accepts; keep trying until a play() resolves
    const kick = () => { if (!this.unlocked) this._start(); };
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, kick, { passive: true });
    const ev = game.events;
    ev.on('run:start', () => this.enter('explore'));
    ev.on('boss:start', () => this.enter('boss'));
    ev.on('boss:died', () => { if (this.mode === 'boss') this.enter('explore'); });
    ev.on('run:won', () => this.enter('off'));
    ev.on('run:lost', () => this.enter('off'));
  }

  static loadLevel() {
    try { const s = window.localStorage.getItem(KEY); return s && s in MUSIC_LEVELS ? s : 'full'; } catch { return 'full'; }
  }

  /** off | low | full; persisted. */
  setLevel(level) {
    if (!(level in MUSIC_LEVELS)) return;
    this.level = level;
    try { window.localStorage.setItem(KEY, level); } catch { /* private mode: setting lives for the session */ }
    if (level !== 'off') this._start();
  }

  /** Switch the score's mode; picks the track the mode wants and crossfades to it. */
  enter(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'off') { this.cur = null; for (const t of Object.values(this.tracks)) t.target = 0; }
    else if (mode === 'boss') this.play(BOSS_TRACK, { restart: this.cur !== BOSS_TRACK });
    else if (!this.cur || !this.tracks[this.cur].playing) this.play(ROTATION[0], { restart: true }); // hub / explore: whatever is playing carries on
    for (const t of Object.values(this.tracks)) t.el.loop = mode === 'boss' && t.name === BOSS_TRACK;
  }

  /** Make `name` the score: fade it in (from the top when restart) and fade everything else out. */
  play(name, { restart = false } = {}) {
    const t = this.tracks[name];
    if (!t) return;
    this.cur = name;
    if (restart || !t.playing) { try { t.el.currentTime = 0; } catch { /* not loaded yet: starts at 0 anyway */ } }
    t.target = 1;
    for (const o of Object.values(this.tracks)) if (o !== t) o.target = 0;
    this._start();
  }

  /** Next track of the rotation (the boss loop never gets here: its element loops). */
  advance() {
    const i = ROTATION.indexOf(this.cur);
    this.play(ROTATION[(i + 1) % ROTATION.length], { restart: true });
  }

  /** Try to get every track that wants to be heard actually playing; resolves `unlocked` once one does. */
  _start() {
    if (this.level === 'off' || this.mode === 'off') return;
    for (const t of Object.values(this.tracks)) {
      if (t.target <= 0 || t.playing) continue;
      const p = t.el.play();
      t.playing = true;
      if (p && p.then) p.then(() => { this.unlocked = true; }, () => { t.playing = false; });
    }
  }

  /** Overall gain the current game state asks for (before the smoothing). */
  _wantMaster() {
    if (this.level === 'off' || this.mode === 'off') return 0;
    let m = MUSIC_LEVELS[this.level] * BASE;
    if (this.mode === 'hub') m *= HUB_MIX;
    const g = this.game;
    if (g.menus.isOpen() || (g.map && g.map.isOpen) || (g.player && !g.player.alive)) m *= DUCK;
    return m;
  }

  update() {
    const g = this.game, now = performance.now() / 1000;
    const dt = this._now ? Math.min(0.25, now - this._now) : 0; this._now = now;
    if (g.state === 'HUB' && this.mode !== 'hub') this.enter('hub');
    // rotation: start the next track XFADE seconds before this one ends so the two overlap
    if ((this.mode === 'explore' || this.mode === 'hub') && this.cur) {
      const t = this.tracks[this.cur], d = t.el.duration, at = t.el.currentTime;
      if (t.playing && d > 0 && isFinite(d) && at > XFADE && d - at < XFADE) this.advance(); // the old one plays out under it
    }
    const want = this._wantMaster();
    this.master += Math.sign(want - this.master) * Math.min(Math.abs(want - this.master), dt / FADE);
    for (const t of Object.values(this.tracks)) {
      const rate = t.target > t.gain && this.mode === 'boss' ? FADE : XFADE; // the boss track cuts in fast, the rotation eases
      t.gain += Math.sign(t.target - t.gain) * Math.min(Math.abs(t.target - t.gain), dt / rate);
      const vol = clamp01(t.gain * this.master);
      if (t.el.volume !== vol) t.el.volume = vol;
      if (t.playing && t.gain <= 0 && t.target <= 0 && this.cur !== t.name) { t.el.pause(); t.playing = false; }
      if (t.playing && this.master <= 0 && want <= 0) { t.el.pause(); t.playing = false; t.gain = 0; }
    }
  }
}
