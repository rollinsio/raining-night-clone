/**
 * Procedural parchment for the Roundtable: the great map of Limveld painted on a canvas from the live
 * world layout (relief hachures sampled from the heightfield, the lake, POIs with inked glyphs and labels,
 * Sites of Grace, the rain-of-night rings) plus small letter sheets. Canvas → CanvasTexture; no image
 * assets, every colour derived from the palette.
 */
import * as THREE from 'three';
import { PALETTE } from '../render/Style.js';

const TAU = Math.PI * 2;
/** hex → [r,g,b] in sRGB bytes (no colour management: these feed a CSS canvas). */
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c, a = 1, mul = 1) => `rgba(${Math.round(Math.min(255, c[0] * mul))},${Math.round(Math.min(255, c[1] * mul))},${Math.round(Math.min(255, c[2] * mul))},${a})`;

const PARCH = mixRgb(rgb(PALETTE.skin), rgb(PALETTE.terrain.straw), 0.45);
const PARCH_DARK = mixRgb(PARCH, rgb(PALETTE.leather), 0.55);
const INK = mixRgb(rgb(PALETTE.woodDark), rgb(PALETTE.clothDark), 0.3);
const BLUE = mixRgb(rgb(PALETTE.ring), rgb(PALETTE.clothDark), 0.5);
const WATER = mixRgb(rgb(PALETTE.water), PARCH, 0.45);
const GOLD = rgb(PALETTE.gold);
const WAX = rgb(PALETTE.sparkBlood);

/** Seeded helper so the parchment mottle is stable between boots. */
function rngOf(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Parchment ground: warm base, blotchy mottle, fibres, darkened edges. */
function parchment(ctx, w, h, rnd, edge = 0.45) {
  ctx.fillStyle = css(PARCH); ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.6;
    g.addColorStop(0, css(dark ? PARCH_DARK : rgb(PALETTE.moon), 0.05 + rnd() * 0.09)); g.addColorStop(1, css(PARCH, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.strokeStyle = css(PARCH_DARK, 0.06); ctx.lineWidth = 1;
  for (let i = 0; i < 140; i++) { const x = rnd() * w, y = rnd() * h, l = 10 + rnd() * 60, a = (rnd() - 0.5) * 0.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, css(PARCH_DARK, 0)); v.addColorStop(1, css(rgb(PALETTE.woodDark), edge));
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}

/** Small mountain glyph: a peak with a hatched right flank. */
function peak(ctx, x, y, s) {
  ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x, y - s); ctx.lineTo(x + s, y + s * 0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.35, y + s * 0.6); ctx.stroke();
  for (let k = 1; k <= 3; k++) { const t = k / 4; ctx.beginPath(); ctx.moveTo(x + s * 0.35 * t, y - s + s * 1.6 * t); ctx.lineTo(x + s * t, y - s + s * 1.6 * t + s * 0.1); ctx.stroke(); }
}

/** Inked POI glyphs. */
const GLYPHS = {
  church(ctx, x, y) { ctx.strokeRect(x - 7, y - 2, 14, 9); ctx.beginPath(); ctx.moveTo(x - 7, y - 2); ctx.lineTo(x, y - 9); ctx.lineTo(x + 7, y - 2); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 15); ctx.moveTo(x - 3, y - 13); ctx.lineTo(x + 3, y - 13); ctx.stroke(); },
  fort(ctx, x, y) { ctx.strokeRect(x - 9, y - 4, 18, 10); for (let k = -1; k <= 1; k++) ctx.strokeRect(x + k * 6 - 2, y - 8, 4, 4); },
  ruin(ctx, x, y) { for (const [dx, hh] of [[-7, 9], [-2, 5], [4, 11]]) { ctx.beginPath(); ctx.moveTo(x + dx, y + 4); ctx.lineTo(x + dx, y + 4 - hh); ctx.moveTo(x + dx - 2, y + 4 - hh); ctx.lineTo(x + dx + 2, y + 4 - hh); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(x - 10, y + 4); ctx.lineTo(x + 10, y + 4); ctx.stroke(); },
  catacomb(ctx, x, y) { ctx.beginPath(); ctx.moveTo(x - 7, y + 5); ctx.lineTo(x - 7, y - 2); ctx.arc(x, y - 2, 7, Math.PI, 0); ctx.lineTo(x + 7, y + 5); ctx.stroke(); ctx.fillRect(x - 3, y - 2, 6, 7); },
  camp(ctx, x, y) { ctx.beginPath(); ctx.moveTo(x - 8, y + 5); ctx.lineTo(x, y - 7); ctx.lineTo(x + 8, y + 5); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 5); ctx.stroke(); },
};

/**
 * Paint the Limveld map. `world` = { terrain (getHeight, lake), limveld (pois, graces) } — any part may be
 * missing; the map degrades to parchment + rings + a cartouche.
 */
export function paintMap(world, w = 1024, h = 768) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rnd = rngOf(1337);
  parchment(ctx, w, h, rnd, 0.5);
  const T = world && world.terrain, L = world && world.limveld;
  const M = 64, span = 1300; // world metres shown across the inner rectangle
  const sx = (w - 2 * M) / span, sz = (h - 2 * M) / span;
  const X = (x) => w / 2 + x * sx, Y = (z) => h / 2 + z * sz;

  // relief: tint by height, hachure the slopes, mountain glyphs on local peaks (the rim mountains frame the map)
  if (T && T.getHeight) {
    const cols = 100, rows = 76, hs = new Float32Array(cols * rows);
    let hmax = 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i / (cols - 1) - 0.5) * span, z = (j / (rows - 1) - 0.5) * span;
      const hh = T.getHeight(x, z); hs[j * cols + i] = hh; if (hh > hmax) hmax = hh;
    }
    const cw = (w - 2 * M) / (cols - 1), ch = (h - 2 * M) / (rows - 1);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const hh = hs[j * cols + i], px = M + i * cw, py = M + j * ch;
      const k = Math.max(0, hh / hmax);
      if (k > 0.08) { ctx.fillStyle = css(PARCH_DARK, Math.min(0.5, k * 0.75)); ctx.fillRect(px - cw / 2, py - ch / 2, cw + 1, ch + 1); }
    }
    ctx.strokeStyle = css(INK, 0.5); ctx.lineWidth = 1;
    for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
      const gx = (hs[j * cols + i + 1] - hs[j * cols + i - 1]) / (2 * span / cols), gz = (hs[(j + 1) * cols + i] - hs[(j - 1) * cols + i]) / (2 * span / rows);
      const s = Math.hypot(gx, gz);
      if (s < 0.1 || rnd() > 0.55) continue;
      const px = M + i * cw + (rnd() - 0.5) * cw, py = M + j * ch + (rnd() - 0.5) * ch, l = 3 + Math.min(6, s * 14);
      const a = Math.atan2(gz, gx) + Math.PI / 2; // stroke across the slope
      ctx.globalAlpha = Math.min(0.75, s * 1.8);
      ctx.beginPath(); ctx.moveTo(px - Math.cos(a) * l, py - Math.sin(a) * l); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css(INK, 0.85); ctx.lineWidth = 1.2;
    for (let j = 2; j < rows - 2; j += 2) for (let i = 2; i < cols - 2; i += 2) {
      const hh = hs[j * cols + i]; if (hh < hmax * 0.42) continue;
      let top = true; for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) if (hs[(j + dj) * cols + i + di] > hh) { top = false; break; }
      if (top) peak(ctx, M + i * cw, M + j * ch, 5 + (hh / hmax) * 7);
    }
  }

  // the lake: wobbly wash with a double ink shore and ripples
  const lake = T && T.lake;
  if (lake) {
    const r = lake.r * 0.74, pts = [];
    for (let k = 0; k < 40; k++) { const a = (k / 40) * TAU, rr = r * (0.86 + 0.14 * Math.sin(a * 3 + 1.3) + 0.06 * Math.sin(a * 7)); pts.push([X(lake.x + Math.cos(a) * rr), Y(lake.z + Math.sin(a) * rr)]); }
    const path = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
    path(); ctx.fillStyle = css(WATER, 0.85); ctx.fill();
    path(); ctx.strokeStyle = css(INK, 0.9); ctx.lineWidth = 1.6; ctx.stroke();
    ctx.save(); path(); ctx.clip();
    ctx.strokeStyle = css(INK, 0.35); ctx.lineWidth = 1;
    for (let k = 0; k < 9; k++) { const y = Y(lake.z) - r * sz * 0.8 + k * r * sz * 0.2; ctx.beginPath(); for (let x = X(lake.x) - r * sx; x <= X(lake.x) + r * sx; x += 6) ctx.lineTo(x, y + Math.sin(x * 0.12 + k) * 1.5); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = css(INK, 0.8); ctx.font = 'italic 15px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('the Mere', X(lake.x), Y(lake.z) + 4);
  }

  // rain-of-night rings (blue ink, dashed) closing on the central plain
  ctx.setLineDash([7, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = css(BLUE, 0.75);
  for (const rr of [370, 150]) { ctx.beginPath(); ctx.arc(X(0), Y(0), rr * sx, 0, TAU); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle = css(BLUE, 0.35); ctx.lineWidth = 1;
  for (let k = 0; k < 28; k++) { const a = (k / 28) * TAU; ctx.beginPath(); ctx.moveTo(X(Math.cos(a) * 372), Y(Math.sin(a) * 372)); ctx.lineTo(X(Math.cos(a) * 392), Y(Math.sin(a) * 392)); ctx.stroke(); }
  ctx.fillStyle = css(BLUE, 0.85); ctx.font = 'italic 13px Georgia, serif'; ctx.textAlign = 'left';
  ctx.fillText('the night\'s reach', X(372 * 0.72) + 4, Y(-372 * 0.72) - 4);

  // POIs + labels, graces
  ctx.strokeStyle = css(INK, 0.95); ctx.fillStyle = css(INK, 0.95); ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  if (L && L.pois) for (const p of L.pois) {
    const g = GLYPHS[p.type]; if (!g) continue;
    const px = X(p.x), py = Y(p.z);
    g(ctx, px, py);
    ctx.font = '15px Georgia, serif'; ctx.textAlign = 'left';
    ctx.fillText(p.name, px + 14, py + 5);
  }
  if (L && L.graces) for (const g of L.graces) {
    const px = X(g.x), py = Y(g.z);
    const rg = ctx.createRadialGradient(px, py, 0, px, py, 13);
    rg.addColorStop(0, css(GOLD, 0.9)); rg.addColorStop(0.35, css(GOLD, 0.45)); rg.addColorStop(1, css(GOLD, 0));
    ctx.fillStyle = rg; ctx.fillRect(px - 13, py - 13, 26, 26);
    ctx.fillStyle = css(mixRgb(GOLD, rgb(PALETTE.moon), 0.4)); ctx.beginPath(); ctx.arc(px, py, 3.2, 0, TAU); ctx.fill();
  }

  // cartouche + compass rose + creases + a scorched corner
  ctx.strokeStyle = css(INK, 0.9); ctx.lineWidth = 2; ctx.strokeRect(M * 0.55, M * 0.55, 250, 84); ctx.lineWidth = 1; ctx.strokeRect(M * 0.55 + 5, M * 0.55 + 5, 240, 74);
  ctx.fillStyle = css(INK); ctx.font = 'small-caps 34px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('Limveld', M * 0.55 + 125, M * 0.55 + 44);
  ctx.font = 'italic 13px Georgia, serif'; ctx.fillText('as surveyed by the Roundtable', M * 0.55 + 125, M * 0.55 + 66);
  { const cx = w - 96, cy = h - 96; ctx.strokeStyle = css(INK, 0.9); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, 34, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 28, 0, TAU); ctx.stroke();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, l = k % 2 ? 22 : 40; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.lineTo(cx + Math.cos(a + 0.25) * l * 0.3, cy + Math.sin(a + 0.25) * l * 0.3); ctx.closePath(); if (k % 2 === 0) ctx.fill(); else ctx.stroke(); }
    ctx.font = 'bold 14px Georgia, serif'; ctx.fillText('N', cx, cy - 44); }
  ctx.strokeStyle = css(rgb(PALETTE.woodDark), 0.18); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2 + 6, 0); ctx.lineTo(w / 2 - 4, h); ctx.stroke();
  ctx.strokeStyle = css(rgb(PALETTE.moon), 0.18); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w / 2 + 9, 0); ctx.lineTo(w / 2 - 1, h); ctx.stroke();
  ctx.strokeStyle = css(rgb(PALETTE.woodDark), 0.14); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, h / 2 - 5); ctx.lineTo(w, h / 2 + 3); ctx.stroke();
  { const g = ctx.createRadialGradient(w - 30, 20, 0, w - 30, 20, 150); g.addColorStop(0, css(rgb(PALETTE.treeDark), 0.95)); g.addColorStop(0.45, css(rgb(PALETTE.woodDark), 0.6)); g.addColorStop(1, css(rgb(PALETTE.woodDark), 0)); ctx.fillStyle = g; ctx.fillRect(w - 180, 0, 180, 170); }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A letter / page: inked dash "words", a heading, optionally a wax seal. */
export function paintSheet(seed = 1, w = 256, h = 352, { seal = false, heading = true } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rnd = rngOf(seed * 977 + 11);
  parchment(ctx, w, h, rnd, 0.3);
  ctx.strokeStyle = css(INK, 0.82); ctx.lineCap = 'round';
  let y = 42;
  if (heading) { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.3, y); ctx.lineTo(w * 0.7, y); ctx.stroke(); y += 26; }
  ctx.lineWidth = 2;
  while (y < h - 40) {
    let x = 28 + rnd() * 10; const end = w - 28 - rnd() * 40;
    while (x < end) { const l = 8 + rnd() * 26; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(Math.min(x + l, end), y); ctx.stroke(); x += l + 6 + rnd() * 6; }
    y += 14 + (rnd() < 0.15 ? 12 : 0);
  }
  if (seal) { const cx = w - 52, cy = h - 56; ctx.fillStyle = css(WAX, 0.95); ctx.beginPath(); ctx.arc(cx, cy, 19, 0, TAU); ctx.fill(); ctx.strokeStyle = css(mixRgb(WAX, rgb(PALETTE.woodDark), 0.5)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, TAU); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
