/**
 * Fullscreen map (M): heightmap render, POIs, graces, ring (current + next circle), player marker.
 * The sim pauses while the map is open.
 */
import { PALETTE } from '../render/Style.js';

const UI = PALETTE.ui;
const CSS = `
.map-wrap { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(4,5,10,0.72); pointer-events: none; }
.map-wrap.open { display: flex; }
.map-frame { border: 1px solid #3d3a33; box-shadow: 0 0 0 1px #0b0b0d, 0 30px 80px rgba(0,0,0,0.8); background: #0a0b10; padding: 14px; }
.map-title { font-family: Georgia, serif; font-size: 14px; letter-spacing: 0.4em; text-indent: 0.4em; text-align: center; color: ${UI.dim}; margin-bottom: 10px; text-transform: uppercase; }
.map-frame canvas { display: block; width: 720px; height: 720px; }
`;

export class GameMap {
  constructor(game) {
    this.game = game;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    this.wrap = document.createElement('div'); this.wrap.className = 'map-wrap';
    this.wrap.innerHTML = '<div class="map-frame"><div class="map-title">Limveld · M to close</div><canvas width="720" height="720"></canvas></div>';
    document.getElementById('hud').appendChild(this.wrap);
    this.canvas = this.wrap.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.base = null; this.isOpen = false; this.redrawT = 0;
  }

  /** Render the heightfield once into an offscreen canvas. */
  _buildBase() {
    const T = this.game.terrain, N = 240, c = document.createElement('canvas'); c.width = c.height = N;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -T.half + (i + 0.5) / N * T.size, z = -T.half + (j + 0.5) / N * T.size;
      const h = T.getHeight(x, z), n = T.getNormal(x, z);
      let r, g, b;
      if (h < T.waterLevel) { r = 16; g = 26; b = 48; }
      else {
        const t = Math.min(1, Math.max(0, (h - T.waterLevel) / 90));
        r = 40 + t * 120; g = 58 + t * 110; b = 48 + t * 110;
        const slope = 1 - n.y; r += slope * 60; g += slope * 40; b += slope * 30;
      }
      const shade = 0.75 + 0.25 * n.x;
      const o = (j * N + i) * 4;
      img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
  }

  toggle() {
    const game = this.game;
    if (game.state !== 'EXPEDITION' || game.menus.isOpen()) { if (this.isOpen) this.close(); return; }
    if (this.isOpen) this.close(); else { this.isOpen = true; this.wrap.classList.add('open'); game.paused = true; this.redrawT = 0; }
  }
  close() { this.isOpen = false; this.wrap.classList.remove('open'); if (!this.game.menus.isOpen()) this.game.paused = false; }

  update(dt) {
    if (!this.isOpen) return;
    this.redrawT -= dt;
    if (this.redrawT > 0) return;
    this.redrawT = 0.1;
    if (!this.base) this._buildBase();
    const game = this.game, T = game.terrain, c = this.ctx, S = 720, k = S / T.size;
    const px = (x) => (x + T.half) * k, pz = (z) => (z + T.half) * k;
    c.clearRect(0, 0, S, S);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.base, 0, 0, S, S);
    c.font = '11px Georgia'; c.textAlign = 'center';
    for (const p of game.limveld.pois) {
      c.fillStyle = p.type === 'camp' ? '#c96a3a' : '#e0dccd';
      c.beginPath();
      if (p.type === 'church') { c.rect(px(p.x) - 4, pz(p.z) - 4, 8, 8); }
      else if (p.type === 'fort') { c.rect(px(p.x) - 6, pz(p.z) - 6, 12, 12); }
      else { c.arc(px(p.x), pz(p.z), 4, 0, Math.PI * 2); }
      c.fill();
      c.fillStyle = 'rgba(216,212,200,0.8)'; c.fillText(p.name, px(p.x), pz(p.z) + 18);
    }
    for (const g of game.graces.sites) { c.fillStyle = UI.gold; c.beginPath(); c.arc(px(g.x), pz(g.z), 3.5, 0, Math.PI * 2); c.fill(); }
    const ring = game.run.ring;
    c.strokeStyle = 'rgba(110,120,255,0.95)'; c.lineWidth = 2; c.beginPath(); c.arc(px(ring.center.x), pz(ring.center.z), ring.radius * k, 0, Math.PI * 2); c.stroke();
    if (ring.shrinking) { c.setLineDash([4, 5]); c.strokeStyle = 'rgba(170,160,255,0.8)'; c.beginPath(); c.arc(px(ring.to.x), pz(ring.to.z), ring.toR * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    const p = game.player;
    if (p) {
      c.save(); c.translate(px(p.pos.x), pz(p.pos.z)); c.rotate(-p.yaw + Math.PI);
      c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill(); c.restore();
    }
  }
}
