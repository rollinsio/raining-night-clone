/**
 * Shared UI theme for HUD / Menus / Map: colour helpers derived from PALETTE.ui (so no hex lives here),
 * the serif stack, text shadow, chamfer clip-path and a few common CSS classes (keycap, hairline ornament).
 */
import { PALETTE } from '../render/Style.js';

export const UI = PALETTE.ui;
export const FONT = `Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, 'Times New Roman', serif`;
export const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)';

/** '#rrggbb' → [r, g, b]. */
export function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)'. */
export function alpha(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }

/** Mix two hex colours (t = 0 → a, 1 → b) → '#rrggbb'. */
export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Lighten (k > 1, towards a warm white) or darken (k < 1, towards black) a hex colour. */
export function shade(hex, k) { return k >= 1 ? mix(hex, '#fff4e0', Math.min(1, (k - 1) * 0.8)) : mix(hex, '#000000', 1 - k); }

/** Octagonal chamfer clip-path with the given corner size in px. */
export const chamfer = (px) => `polygon(${px}px 0,calc(100% - ${px}px) 0,100% ${px}px,100% calc(100% - ${px}px),calc(100% - ${px}px) 100%,${px}px 100%,0 calc(100% - ${px}px),0 ${px}px)`;

/** Common classes: keycap, hairline ornament with a centre diamond. */
export const BASE_CSS = `
.u-key { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 20px; padding: 0 6px; box-sizing: border-box; border: 1px solid ${alpha(UI.gold, 0.55)}; border-radius: 3px; background: linear-gradient(#1c1b21, #09090c); color: ${shade(UI.gold, 1.3)}; font-size: 12px; letter-spacing: 0.04em; text-shadow: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 0 #000, 0 0 0 1px rgba(0,0,0,0.6); }
.u-orn { position: relative; height: 1px; background: linear-gradient(90deg, transparent, ${alpha(UI.gold, 0.85)} 30%, ${alpha(UI.gold, 0.85)} 70%, transparent); }
.u-orn::after { content: ''; position: absolute; left: 50%; top: -3px; width: 6px; height: 6px; margin-left: -3px; transform: rotate(45deg); background: ${UI.gold}; box-shadow: 0 0 6px ${alpha(UI.gold, 0.8)}; }
`;
