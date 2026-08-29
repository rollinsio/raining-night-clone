/**
 * Nightreign-style DOM HUD over the live scene — restrained, thin, proportioned for 1920×1080.
 *   top-left      level roundel (glowing sigil + level) on a faint panel and three thin bars whose frame
 *                 length scales with the max stat: HP (brick red), FP (teal), stamina (moss green), each with
 *                 a cream tip; delayed lag trails — cream for HP damage, yellow for stamina drain, pale blue
 *                 for FP spend; under the bars the golden flask with its count and the ultimate-charge square
 *   top-right     rune count with a spoked rune-wheel glyph on a hairline-framed band (diamond end caps);
 *                 a quiet day / phase line under it
 *   top-centre    very faint compass strip (hidden while a boss is active)
 *   bottom-left   item slots in the Nightreign arrangement: weapon, raised flask slot with count, fire-pot
 *                 sub-slot, off-hand ghost
 *   bottom-centre skill (crescent slash) + ultimate (sword with rays) art circles with cooldown sweeps; thin
 *                 boss bar with a small left-aligned name above and a sigil below; boss reveal; prompt
 *   centre        lock-on reticle, title cards, ring warning, timed controls hint (bottom-right)
 * Pure DOM/CSS plus one tiny compass canvas redrawn at 10 Hz; styles are written only when a value changes.
 * Lag trails freeze while `game.posing`; `settleTrails()` snaps them to a short lag for screenshot poses.
 */
import * as THREE from 'three';
import { ROMAN } from '../run/Expedition.js';
import { SKILLS } from '../combat/Weapons.js';
import { UI, FONT, TEXT_SHADOW, BASE_CSS, alpha, mix, shade } from './Theme.js';

const HOLD = 0.6;                   // seconds a damage trail waits after the last hit before draining
const DRAIN = 0.5;                  // base trail drain speed (fraction of the bar per second)
const COMPASS_W = 560, COMPASS_H = 26, COMPASS_FOV = 140; // degrees spanned by the strip

// palette-derived tints (no hex outside Style.js)
const PALE = shade(UI.gold, 1.9);                  // HP damage-trail cream (pale, not gold)
const YELLOW = shade(UI.gold, 1.15);               // stamina drain trail (Nightreign's yellow lag)
const RING_BLUE = mix(UI.fp, UI.text, 0.5);        // ring / arts pale blue
const FP_TRAIL = mix(RING_BLUE, UI.text, 0.55);    // FP spend trail (pale blue-white)
const ART_INK = mix(UI.fp, UI.text, 0.66);         // art glyph stroke
const FRAME_LINE = alpha(mix(UI.text, UI.fp, 0.3), 0.34); // slot / panel hairlines (cool grey)
// bar fills: muted brick / teal / moss bases that brighten toward the tip (gradient relative to the fill)
const TEAL = mix(UI.fp, UI.stamina, 0.38);
const BRICK = mix(UI.hp, UI.dim, 0.14); // brick red: crimson knocked back toward the warm grey
const HP_LO = mix(BRICK, UI.hpDark, 0.3), HP_MID = mix(BRICK, UI.gold, 0.14), HP_HI = mix(BRICK, UI.gold, 0.36);
const FP_LO = mix(TEAL, UI.fpDark, 0.2), FP_MID = mix(TEAL, UI.text, 0.16), FP_HI = mix(TEAL, UI.text, 0.5);
const ST_LO = mix(UI.stamina, UI.staminaDark, 0.28), ST_MID = mix(UI.stamina, UI.gold, 0.14), ST_HI = mix(UI.stamina, UI.gold, 0.42);
const STEEL = UI.text, STEEL_L = shade(UI.text, 1.3), STEEL_D = shade(UI.text, 0.55);
const GOLD_L = shade(UI.gold, 1.3), GOLD_D = shade(UI.gold, 0.6), GOLD_DD = shade(UI.gold, 0.35);
const GRIP = shade(UI.dim, 0.35), GRIP_D = shade(UI.dim, 0.2), WOOD = shade(UI.dim, 0.5);
const CLAY = mix(UI.hp, UI.gold, 0.3), CLAY_D = shade(CLAY, 0.55); // fire-pot ceramic
const INK = shade(UI.text, 1.25);                  // near-white serif text
const CAP = shade(UI.gold, 1.85);                  // cream tip at the end of a fill
// bar track: a dark neutral well inside a light hairline (the fill sits inside the hairline)
const BAR_FRAME = `background: rgba(14,15,19,0.66); border: 1px solid rgba(168,172,186,0.36); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.65);`;
const FILL = `position: absolute; left: 0; top: 0; bottom: 0; box-shadow: inset 0 -2px 2px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.2);`;
const FILL_CAP = `content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(90deg, ${alpha(CAP, 0.35)}, ${alpha(CAP, 0.95)}); box-shadow: 0 0 4px ${alpha(CAP, 0.7)};`;
const TRAIL = `position: absolute; left: 0; top: 0; bottom: 0; width: 100%;`;
const SLOT = `position: absolute; background: linear-gradient(168deg, rgba(22,26,40,0.58), rgba(8,10,16,0.76)); border: 1px solid ${FRAME_LINE}; box-shadow: 0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.035), inset 0 0 20px rgba(0,0,0,0.35), 0 3px 8px rgba(0,0,0,0.35);`;

const CSS = `
#hud { font-family: ${FONT}; color: ${UI.text}; text-shadow: ${TEXT_SHADOW}; }
#hud.h-hidden > *:not(.map-wrap) { display: none !important; }
#hud canvas { display: block; }
#hud .k { opacity: 0; }
#hud.h-keys .k { opacity: 1; transition: opacity 0.6s; }
.h-tl { position: absolute; left: 50px; top: 17px; width: 580px; height: 84px; background: linear-gradient(90deg, rgba(6,8,14,0.56), rgba(6,8,14,0.42) 35%, rgba(6,8,14,0.22) 70%, transparent); border-left: 1px solid ${alpha(UI.text, 0.3)}; }
.h-tl::before { content: ''; position: absolute; left: 0; top: 0; width: 100%; height: 1px; background: linear-gradient(90deg, ${alpha(UI.text, 0.38)}, ${alpha(UI.text, 0.24)} 45%, transparent); }
.h-lvl { position: absolute; left: 61px; top: 17px; width: 88px; height: 88px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7)); }
.h-lvl svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.h-lvl .sig { filter: drop-shadow(0 0 4px ${alpha(RING_BLUE, 0.95)}); }
.h-lvl .v { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 23px; color: ${INK}; text-shadow: 0 0 9px ${alpha(RING_BLUE, 0.95)}, 0 0 2px ${alpha(RING_BLUE, 0.9)}, 0 1px 2px #000; }
.h-bar { position: absolute; left: 165px; height: 7px; ${BAR_FRAME} }
.h-hp { top: 41px; height: 8px; }
.h-fp { top: 59px; }
.h-st { top: 76px; }
.h-bar .tr { ${TRAIL} background: ${alpha(PALE, 0.92)}; }
.h-fp .tr { background: ${alpha(FP_TRAIL, 0.8)}; }
.h-st .tr { background: ${alpha(YELLOW, 0.92)}; }
.h-bar .f { ${FILL} width: 100%; }
.h-bar .f::after { ${FILL_CAP} }
.h-hp .f { background: linear-gradient(90deg, ${HP_LO}, ${HP_MID} 55%, ${HP_HI}); }
.h-fp .f { background: linear-gradient(90deg, ${FP_LO}, ${FP_MID} 55%, ${FP_HI}); }
.h-st .f { background: linear-gradient(90deg, ${ST_LO}, ${ST_MID} 55%, ${ST_HI}); }
.h-sub { position: absolute; left: 170px; top: 94px; display: flex; align-items: center; gap: 9px; height: 32px; }
.h-sub .flask { display: none; align-items: center; gap: 8px; font-size: 19px; color: ${INK}; }
.h-sub .flask svg { width: 24px; height: 30px; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.85)) drop-shadow(0 0 5px ${alpha(UI.gold, 0.35)}); }
.h-sub .flask.out svg { opacity: 0.3; filter: none; }
.h-sub .sep { width: 1px; height: 20px; background: ${alpha(UI.text, 0.38)}; display: none; }
.h-sub .art { ${SLOT} position: relative; width: 32px; height: 32px; border-color: ${alpha(mix(UI.text, UI.fp, 0.3), 0.42)}; box-shadow: 0 0 0 1px rgba(0,0,0,0.65), inset 0 0 10px rgba(0,0,0,0.4); }
.h-sub .art svg { position: absolute; inset: 4px; width: 24px; height: 24px; fill: none; stroke: ${ART_INK}; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.35; }
.h-sub .art.on svg { opacity: 1; stroke: ${mix(ART_INK, INK, 0.5)}; filter: drop-shadow(0 0 3px ${alpha(RING_BLUE, 0.95)}); }
.h-runes { position: absolute; right: 44px; top: 46px; width: 230px; height: 44px; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; padding: 0 22px 0 28px; background: linear-gradient(90deg, transparent, rgba(6,8,14,0.5) 24%, rgba(6,8,14,0.6)); }
.h-runes::before, .h-runes::after { content: ''; position: absolute; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, ${alpha(UI.text, 0.28)} 26%, ${alpha(UI.text, 0.4)}); }
.h-runes::before { top: 0; } .h-runes::after { bottom: 0; }
.h-runes .o { position: absolute; right: -2px; width: 4px; height: 4px; transform: rotate(45deg); background: ${alpha(UI.text, 0.5)}; box-shadow: 0 0 3px rgba(0,0,0,0.8); }
.h-runes .o.t { top: -1.5px; } .h-runes .o.b { bottom: -1.5px; }
.h-runes .o.l { display: none; }
.h-runes svg { width: 22px; height: 22px; fill: none; stroke: ${shade(UI.text, 1.15)}; stroke-width: 0.9; stroke-linecap: round; filter: drop-shadow(0 0 3px rgba(0,0,0,0.9)); }
.h-runes .v { font-size: 23px; letter-spacing: 0.01em; color: ${INK}; font-variant-numeric: tabular-nums; }
.h-day { position: absolute; right: 66px; top: 96px; font-size: 10.5px; letter-spacing: 0.28em; color: ${alpha(UI.dim, 0.9)}; text-transform: uppercase; white-space: nowrap; text-align: right; }
.h-day .t1 { color: ${alpha(UI.text, 0.78)}; margin-right: 12px; }
.h-compass { position: absolute; left: 50%; top: 104px; width: ${COMPASS_W}px; height: ${COMPASS_H}px; margin-left: -${COMPASS_W / 2}px; opacity: 0.55; transition: opacity 0.8s; -webkit-mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); }
.h-compass.off { opacity: 0; transition: none; }
.h-slots { position: absolute; left: 56px; bottom: 58px; width: 302px; height: 178px; }
.h-slot { ${SLOT} }
.h-slot.l { left: 0; bottom: 0; width: 92px; height: 108px; }
.h-slot.c { left: 104px; bottom: 80px; width: 94px; height: 96px; }
.h-slot.s { left: 150px; bottom: 12px; width: 38px; height: 44px; }
.h-slot.r { left: 209px; bottom: 0; width: 92px; height: 108px; }
.h-slot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.h-slot.l svg, .h-slot.c.held svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,0.8)); }
.h-slot.l::before, .h-slot.c.held::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 50% 48%, ${alpha(UI.text, 0.1)}, transparent 62%); }
.h-slot.empty svg { opacity: 0.3; }
.h-slot.s svg { inset: 5px; width: auto; height: auto; opacity: 0.85; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8)); }
.h-slot .n { position: absolute; right: 7px; bottom: 2px; font-size: 17px; color: ${INK}; }
.h-slot .k { position: absolute; left: 6px; top: 3px; font-size: 11px; color: ${UI.dim}; }
.h-slot.tap, .h-art.tap { filter: brightness(1.6); transition: none; }
.h-slot.c.drink { box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 0 22px ${alpha(UI.gold, 0.55)}; transition: box-shadow 0.15s; }
.h-arts { position: absolute; left: 50%; bottom: 30px; width: 0; height: 0; }
.h-art { position: absolute; border-radius: 50%; background: radial-gradient(circle at 50% 40%, rgba(30,36,58,0.74), rgba(6,8,14,0.84) 72%); box-shadow: 0 0 0 1px ${alpha(RING_BLUE, 0.62)}, 0 0 0 2px rgba(0,0,0,0.4), 0 0 12px ${alpha(RING_BLUE, 0.32)}, inset 0 0 18px ${alpha(RING_BLUE, 0.2)}; }
.h-art::before { content: ''; position: absolute; inset: 3px; border-radius: 50%; border: 1px solid ${alpha(RING_BLUE, 0.26)}; box-shadow: inset 0 0 6px ${alpha(RING_BLUE, 0.18)}; }
.h-art.s { width: 84px; height: 84px; left: -167px; bottom: 8px; }
.h-art.u { width: 112px; height: 112px; left: -56px; bottom: 0; }
.h-art svg { position: absolute; left: 14%; top: 14%; width: 72%; height: 72%; fill: none; stroke: ${ART_INK}; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 4px ${alpha(RING_BLUE, 0.55)}); }
.h-art.u svg { stroke: ${mix(ART_INK, INK, 0.35)}; }
.h-art .cd { position: absolute; inset: 0; border-radius: 50%; background: none; }
.h-art .k { position: absolute; left: 50%; bottom: -18px; transform: translateX(-50%); font-size: 11px; color: ${UI.dim}; }
.h-boss { position: absolute; left: 50%; bottom: 217px; width: 1000px; margin-left: -500px; opacity: 0; transition: opacity 0.6s; }
.h-boss.on { opacity: 1; transition: none; }
.h-boss .n { font-size: 20px; letter-spacing: 0.01em; color: ${INK}; margin: 0 0 5px 0; transition: opacity 0.5s; text-shadow: 0 1px 2px #000, 0 0 10px rgba(0,0,0,0.85); }
.h-boss.reveal .n { opacity: 0; transition: none; }
.h-boss .b { position: relative; height: 7px; ${BAR_FRAME} background: rgba(30,27,24,0.62); }
.h-boss .tr { ${TRAIL} background: ${alpha(PALE, 0.92)}; }
.h-boss .f { ${FILL} width: 100%; background: linear-gradient(90deg, ${HP_LO}, ${HP_MID} 55%, ${HP_HI}); }
.h-boss .f::after { ${FILL_CAP} }
.h-boss .sig { position: absolute; left: 18px; top: 100%; margin-top: 7px; width: 16px; height: 16px; fill: none; stroke: ${alpha(UI.text, 0.62)}; stroke-width: 1.1; filter: drop-shadow(0 0 3px rgba(0,0,0,0.9)); }
.h-reveal { position: absolute; left: 0; right: 0; bottom: 252px; text-align: center; opacity: 0; transition: opacity 0.8s ease; }
.h-reveal.on { opacity: 1; transition: none; }
.h-reveal .s { font-size: 11px; letter-spacing: 0.5em; text-indent: 0.5em; color: ${UI.gold}; text-transform: uppercase; }
.h-reveal .b { font-size: 36px; letter-spacing: 0.08em; text-indent: 0.08em; color: ${INK}; margin-top: 2px; text-shadow: 0 2px 12px rgba(0,0,0,0.95), 0 0 28px rgba(0,0,0,0.8); }
.h-reveal .u-orn { width: 480px; margin: 8px auto 0; }
.h-reticle { position: absolute; left: 0; top: 0; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.95); box-shadow: 0 0 8px rgba(255,255,255,0.55), 0 0 1px 1px rgba(0,0,0,0.5), inset 0 0 6px rgba(255,255,255,0.25); display: none; }
.h-reticle::before { content: ''; position: absolute; inset: -7px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.3); }
.h-reticle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px; border-radius: 50%; background: #fff; box-shadow: 0 0 5px #fff; }
.h-prompt { position: absolute; left: 50%; bottom: 160px; transform: translateX(-50%); display: none; align-items: center; gap: 12px; padding: 5px 18px 5px 10px; background: linear-gradient(90deg, transparent, rgba(6,8,14,0.55) 15%, rgba(6,8,14,0.55) 85%, transparent); font-size: 15px; letter-spacing: 0.08em; color: ${INK}; white-space: nowrap; }
.h-warn { position: absolute; left: 50%; top: 24%; transform: translateX(-50%); color: ${UI.danger}; font-size: 15px; letter-spacing: 0.34em; text-indent: 0.34em; text-shadow: 0 0 12px ${alpha(UI.danger, 0.6)}, 0 1px 2px #000; display: none; animation: h-pulse 1.1s infinite; white-space: nowrap; }
@keyframes h-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
.h-title { position: absolute; left: 0; right: 0; top: 30%; text-align: center; opacity: 0; transition: opacity 0.9s ease; }
.h-title.on { opacity: 1; transition: none; }
.h-title .b { font-size: 46px; letter-spacing: 0.34em; text-indent: 0.34em; color: ${INK}; text-shadow: 0 2px 16px rgba(0,0,0,0.95), 0 0 40px ${alpha(UI.gold, 0.18)}; }
.h-title .s { font-size: 12px; letter-spacing: 0.44em; text-indent: 0.44em; color: ${UI.dim}; margin-top: 8px; text-transform: uppercase; }
.h-title .u-orn { width: 420px; margin: 12px auto 0; }
.h-hint { position: absolute; right: 48px; bottom: 180px; font-size: 11px; letter-spacing: 0.16em; line-height: 2; color: ${UI.dim}; text-align: right; transition: opacity 1.2s; text-transform: uppercase; }
.h-hint b { display: inline-block; min-width: 84px; font-weight: normal; color: ${alpha(UI.text, 0.9)}; text-align: left; margin-left: 14px; }
`;

/** Shared SVG gradient defs (steel / gold / roundel glow), referenced by the slot and roundel art. */
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<linearGradient id="hudSteel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${STEEL_L}"/><stop offset="0.5" stop-color="${STEEL}"/><stop offset="1" stop-color="${STEEL_D}"/></linearGradient>
<linearGradient id="hudGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD_L}"/><stop offset="1" stop-color="${GOLD_D}"/></linearGradient>
<linearGradient id="hudFlask" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GOLD_L}"/><stop offset="0.45" stop-color="${UI.gold}"/><stop offset="1" stop-color="${GOLD_DD}"/></linearGradient>
<radialGradient id="hudGlow"><stop offset="0" stop-color="${RING_BLUE}" stop-opacity="0.5"/><stop offset="0.55" stop-color="${RING_BLUE}" stop-opacity="0.14"/><stop offset="1" stop-color="${RING_BLUE}" stop-opacity="0"/></radialGradient>
</defs></svg>`;

const S = (d, w = 0.7) => `fill="url(#hudSteel)" stroke="${STEEL_D}" stroke-width="${w}" stroke-linejoin="round"`;
const G = `fill="url(#hudGold)" stroke="${GOLD_D}" stroke-width="0.5" stroke-linejoin="round"`;
/** Weapon illustrations: drawn vertically (tip at -y) then laid diagonally inside a 64×80 slot. */
const WEAPON_ART = {
  greatsword: `<path d="M0-38L-4.5-31V7H4.5V-31Z" ${S()}/><path d="M0-36L-3.2-31V6" stroke="${STEEL_L}" stroke-width="0.7" opacity="0.8"/><path d="M0-30V5" stroke="${STEEL_D}" stroke-width="1.3" opacity="0.7"/><path d="M-12 7.5c4-2 8-2 12-1 4-1 8-1 12 1l-1 3.2c-3.5-1-7.5-1-11 0-3.5-1-7.5-1-11 0Z" ${G}/><rect x="-2.4" y="10.6" width="4.8" height="16" fill="${GRIP}"/><path d="M-2.4 13.5h4.8M-2.4 16.5h4.8M-2.4 19.5h4.8M-2.4 22.5h4.8" stroke="${GRIP_D}" stroke-width="0.8"/><path d="M0 26l3.4 3.4L0 32.8l-3.4-3.4Z" ${G}/>`,
  sword: `<path d="M0-33L-3.4-27V5H3.4V-27Z" ${S()}/><path d="M0-31L-2.3-27V4" stroke="${STEEL_L}" stroke-width="0.6" opacity="0.85"/><path d="M0-25V3" stroke="${STEEL_D}" stroke-width="1" opacity="0.7"/><path d="M-9.5 5.5c3-1.8 6.5-1.8 9.5-0.8 3-1 6.5-1 9.5 0.8l-0.8 2.8c-3-1-6-1-8.7 0-2.7-1-5.7-1-8.7 0Z" ${G}/><rect x="-2" y="8.2" width="4" height="13" fill="${GRIP}"/><path d="M-2 10.5h4M-2 13h4M-2 15.5h4M-2 18h4" stroke="${GRIP_D}" stroke-width="0.7"/><path d="M0 20.5l3 3-3 3-3-3Z" ${G}/>`,
  katana: `<path d="M0-36C-4.2-24-5.2-8-3.2 4H3C3-8 1.2-24 0-36Z" ${S()}/><path d="M-1.2-28C-2.8-18-3.4-6-2.2 2" stroke="${STEEL_L}" stroke-width="0.7" opacity="0.8"/><ellipse cy="5.2" rx="6.2" ry="1.9" ${G}/><rect x="-2.2" y="7" width="4.4" height="20" fill="${GRIP}"/><path d="M-2.2 9l4.4 4M2.2 13l-4.4 4M-2.2 17l4.4 4M2.2 21l-4.4 4" stroke="${GRIP_D}" stroke-width="0.8"/><rect x="-2.6" y="27" width="5.2" height="2.4" ${G}/>`,
  dagger: `<path d="M0-22L-3-16V3H3V-16Z" ${S()}/><rect x="-6.5" y="3" width="13" height="2.6" rx="1" ${G}/><rect x="-1.8" y="5.6" width="3.6" height="11" fill="${GRIP}"/><circle cy="18.5" r="2.2" ${G}/>`,
  halberd: `<rect x="-1.3" y="-30" width="2.6" height="66" fill="${WOOD}" stroke="${GRIP_D}" stroke-width="0.5"/><path d="M0-44L-2.4-33H2.4Z" ${S()}/><path d="M1.3-32C11-30 13-17 1.3-13Z" ${S()}/><path d="M-1.3-28L-7.5-24-1.3-19Z" ${S()}/><rect x="-3" y="-33" width="6" height="2" ${G}/>`,
  axe: `<rect x="-1.3" y="-32" width="2.6" height="68" fill="${WOOD}" stroke="${GRIP_D}" stroke-width="0.5"/><path d="M1.3-34C15-30 17-11 1.3-5Z" ${S()}/><path d="M-1.3-34C-15-30-17-11-1.3-5Z" ${S()}/><rect x="-3" y="-36" width="6" height="3" ${G}/>`,
  staff: `<rect x="-1.3" y="-28" width="2.6" height="64" fill="${WOOD}" stroke="${GRIP_D}" stroke-width="0.5"/><path d="M-4-28L-6-36M4-28L6-36" stroke="${GOLD_D}" stroke-width="1.2"/><path d="M0-44L5.2-34 0-25-5.2-34Z" fill="${RING_BLUE}" stroke="${STEEL_L}" stroke-width="0.6" style="filter:drop-shadow(0 0 3px ${RING_BLUE})"/>`,
  bow: `<path d="M0-36C-17-20-17 20 0 36" fill="none" stroke="${WOOD}" stroke-width="2.6" stroke-linecap="round"/><path d="M0-36V36" stroke="${STEEL_L}" stroke-width="0.6" opacity="0.8"/><rect x="-2.2" y="-7" width="4.4" height="14" rx="1" fill="${GRIP}"/>`,
};
// off-hand ghost (kite shield) and the golden flask (painted, with a stopper and a highlight streak)
WEAPON_ART.shield = `<path d="M0-24L17-18C17 2 9 15 0 22-9 15-17 2-17-18Z" fill="${alpha(UI.text, 0.06)}" stroke="${STEEL}" stroke-width="1"/><path d="M0-13V12M-10-4H10" stroke="${STEEL}" stroke-width="0.9"/>`;
WEAPON_ART.flask = `<path d="M-4.5-16H4.5V-9.5C10.5-6.5 13 1 13 9V15C13 18.5 10.5 21 7 21H-7C-10.5 21-13 18.5-13 15V9C-13 1-10.5-6.5-4.5-9.5Z" fill="url(#hudFlask)" stroke="${GOLD_DD}" stroke-width="0.8" stroke-linejoin="round"/><path d="M-6 12.5C-7.5 6-6 0-2.5-4" stroke="${shade(UI.gold, 1.6)}" stroke-width="1.4" stroke-linecap="round" opacity="0.65" fill="none"/><path d="M-5-11.5C-6.5-10-7.5-8-8-6" stroke="${shade(UI.gold, 1.6)}" stroke-width="0.9" stroke-linecap="round" opacity="0.5" fill="none"/><rect x="-6" y="-22" width="12" height="6.5" rx="1.2" fill="${GRIP}" stroke="${GRIP_D}" stroke-width="0.6"/><rect x="-6" y="-17.5" width="12" height="2" fill="${GOLD_D}"/>`;
// small quick-item: a clay fire pot with a lit fuse (the sub-slot under the item slot)
WEAPON_ART.pot = `<path d="M-8-6H8L11 3C12 10 7 14 0 14S-12 10-11 3Z" fill="${CLAY}" stroke="${CLAY_D}" stroke-width="0.8" stroke-linejoin="round"/><path d="M-7 2C-8 7-5 10-1 11" stroke="${shade(CLAY, 1.5)}" stroke-width="1.1" stroke-linecap="round" opacity="0.55" fill="none"/><rect x="-6" y="-10" width="12" height="4.5" rx="1" fill="${CLAY_D}" stroke="${shade(CLAY, 0.35)}" stroke-width="0.6"/><path d="M1-10C1-14 4-15 5-18" stroke="${GRIP}" stroke-width="1.3" stroke-linecap="round" fill="none"/><circle cx="5.5" cy="-19" r="1.8" fill="${shade(UI.gold, 1.5)}" style="filter:drop-shadow(0 0 3px ${UI.danger})"/>`;
/** Lays a vertical weapon drawing diagonally inside the slot. */
const weaponSvg = (id, rot = 38, k = 1.12) => `<svg viewBox="0 0 64 80" aria-hidden="true"><g transform="translate(32 41) rotate(${rot}) scale(${k})">${WEAPON_ART[id] || WEAPON_ART.sword}</g></svg>`;
/** Rune wheel: outer + inner rings, twelve spokes with forked tips, a hub (drawn once at build time). */
const RUNE_WHEEL = (() => {
  let d = '';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
    d += `M${(8 + c * 2.6).toFixed(2)} ${(8 + s * 2.6).toFixed(2)}L${(8 + c * 6.4).toFixed(2)} ${(8 + s * 6.4).toFixed(2)}`;
    if (i % 2 === 0) d += `M${(8 + c * 5.2 - s * 1.1).toFixed(2)} ${(8 + s * 5.2 + c * 1.1).toFixed(2)}L${(8 + c * 6.8).toFixed(2)} ${(8 + s * 6.8).toFixed(2)}L${(8 + c * 5.2 + s * 1.1).toFixed(2)} ${(8 + s * 5.2 - c * 1.1).toFixed(2)}`;
  }
  return `<circle cx="8" cy="8" r="7.2"/><circle cx="8" cy="8" r="4.3" opacity="0.7"/><circle cx="8" cy="8" r="1.4"/><path d="${d}"/>`;
})();
/** Ultimate art: an upright sword with rays fanning out behind it (the ring is the circle itself). */
const ULT_ART = (() => {
  let rays = '';
  for (const deg of [-150, -120, -95, -70, -40, 40, 70, 95, 120, 150]) {
    const a = deg * Math.PI / 180, c = Math.sin(a), s = -Math.cos(a);
    rays += `M${(24 + c * 9).toFixed(1)} ${(24 + s * 9).toFixed(1)}L${(24 + c * 21).toFixed(1)} ${(24 + s * 21).toFixed(1)}`;
  }
  return `<path d="${rays}" opacity="0.55"/><path d="M24 3L20.5 8.5V29H27.5V8.5Z"/><path d="M24 9V28" opacity="0.5"/><path d="M15.5 29H32.5L30 32.5H18Z"/><path d="M24 32.5V41"/><circle cx="24" cy="43.2" r="2"/>`;
})();

/** Line glyphs (48×48) for the arts, the rune wheel (16×16), the boss sigil (16×16) and the level roundel (96×96). */
const GLYPH = {
  // skill: a swept crescent slash with trailing feathered strokes
  skill: '<path d="M9 38C9.5 22 21 10 40 8.5C31.5 14 26 22.5 25.5 38C21 32 15 32 9 38Z"/><path d="M13.5 27.5c4-6.5 9.5-10.5 16.5-12.5" opacity="0.55"/><path d="M17 33.5c3-4 7-7 12-8.5" opacity="0.4"/><path d="M6 43l3.5-3.5M34 41l-3.5-3.5" opacity="0.6"/><path d="M40 8.5l4-2.5" opacity="0.5"/>',
  ult: ULT_ART,
  rune: RUNE_WHEEL,
  boss: '<path d="M8 1.5 14 5v6l-6 3.5L2 11V5Z"/><path d="M8 4.5v7M5 6l6 4M11 6l-6 4"/>',
  roundel: `<circle cx="48" cy="48" r="46" fill="rgba(5,8,16,0.74)"/><circle cx="48" cy="48" r="44" fill="url(#hudGlow)"/>
<circle cx="48" cy="48" r="46" fill="none" stroke="${alpha(INK, 0.5)}" stroke-width="1.1"/><circle cx="48" cy="48" r="43" fill="none" stroke="${alpha(RING_BLUE, 0.42)}" stroke-width="0.6"/>
<g class="sig" fill="none" stroke="${shade(RING_BLUE, 1.2)}" stroke-width="0.75" opacity="0.9" stroke-linecap="round"><circle cx="48" cy="30" r="29" opacity="0.8"/><circle cx="32" cy="58" r="29" opacity="0.8"/><circle cx="64" cy="58" r="29" opacity="0.8"/><path d="M48 6v84M6 48h84M18 18l60 60M78 18 18 78" opacity="0.45"/><circle cx="48" cy="48" r="14" opacity="0.8"/><circle cx="48" cy="48" r="34" opacity="0.3" stroke-dasharray="1 5"/></g>
<g stroke="${alpha(INK, 0.55)}" stroke-width="1"><path d="M48 2v4M48 90v4M2 48h4M90 48h4"/></g>`,
};
const svg = (name, vb = '0 0 48 48') => `<svg viewBox="${vb}" aria-hidden="true">${GLYPH[name]}</svg>`;
const WEAPON_GLYPH = { greatsword: 'greatsword', sword: 'sword', katana: 'katana', dagger: 'dagger', halberd: 'halberd', axe: 'axe', staff: 'staff', bow: 'bow' };

const _v = new THREE.Vector3();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; };
/** Strips dev suffixes such as "(Placeholder)" from entity names before they reach the screen. */
const clean = (s) => String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class HUD {
  constructor(game) {
    this.game = game;
    const root = this.root = document.getElementById('hud');
    const style = document.createElement('style'); style.textContent = BASE_CSS + CSS; document.head.appendChild(style);
    // The layout is proportioned for 1920×1080; on phone-sized screens (either dimension < 730px —
    // portrait especially) scale the whole HUD uniformly so bands/bars/map fit. 1920×1080 stays at
    // zoom 1, so the capture/critic pipeline is pixel-identical. Screen-projected placements
    // (the reticle) divide by `zoom` to stay put.
    this.zoom = 1;
    const fit = () => { this.zoom = Math.min(1, innerWidth / 730, innerHeight / 730); root.style.zoom = this.zoom; };
    fit(); window.addEventListener('resize', fit);
    root.innerHTML = DEFS + `
      <div class="h-tl"></div>
      <div class="h-lvl">${svg('roundel', '0 0 96 96')}<div class="v">1</div></div>
      <div class="h-bar h-hp"><div class="tr"></div><div class="f"></div></div>
      <div class="h-bar h-fp"><div class="tr"></div><div class="f"></div></div>
      <div class="h-bar h-st"><div class="tr"></div><div class="f"></div></div>
      <div class="h-sub"><div class="flask">${weaponSvg('flask', 0, 1.8)}<span class="n"></span></div><div class="sep"></div><div class="art" title="Ultimate">${svg('ult')}</div></div>
      <div class="h-runes"><i class="o t"></i><i class="o b"></i><i class="o l"></i>${svg('rune', '0 0 16 16')}<span class="v">0</span></div>
      <div class="h-day"><span class="t1">DAY I</span><span class="t2"></span></div>
      <canvas class="h-compass" width="${COMPASS_W}" height="${COMPASS_H}"></canvas>
      <div class="h-slots">
        <div class="h-slot l" title="Weapon">${weaponSvg('greatsword')}</div>
        <div class="h-slot c empty" title="Flask">${weaponSvg('flask', 0, 1.25)}<span class="n"></span><span class="k">C</span></div>
        <div class="h-slot s" title="Quick item">${weaponSvg('pot', 0, 1.75)}</div>
        <div class="h-slot r empty" title="Off-hand">${weaponSvg('shield', 0)}</div>
      </div>
      <div class="h-arts">
        <div class="h-art s" title="Skill">${svg('skill')}<div class="cd"></div><span class="k">1</span></div>
        <div class="h-art u" title="Ultimate">${svg('ult')}<div class="cd"></div><span class="k">2</span></div>
      </div>
      <div class="h-boss"><div class="n"></div><div class="b"><div class="tr"></div><div class="f"></div></div>${svg('boss', '0 0 16 16').replace('<svg ', '<svg class="sig" ')}</div>
      <div class="h-reveal"><div class="s"></div><div class="b"></div><div class="u-orn"></div></div>
      <div class="h-reticle"></div>
      <div class="h-prompt"><span class="u-key">E</span><span class="t"></span></div>
      <div class="h-warn">OUTSIDE THE NIGHT'S CIRCLE</div>
      <div class="h-title"><div class="b"></div><div class="u-orn"></div><div class="s"></div></div>
      <div class="h-hint">move<b>W A S D</b><br>sprint<b>Shift</b><br>dodge roll<b>Space</b><br>light / heavy<b>LMB / RMB</b><br>lock-on<b>Q / MMB</b><br>interact<b>E</b><br>flask<b>C</b><br>skill / ultimate<b>1 / 2</b><br>map<b>M</b><br>pause<b>Esc</b></div>`;
    const q = (s) => root.querySelector(s);
    this.el = {
      hp: q('.h-hp .f'), hpTr: q('.h-hp .tr'), fp: q('.h-fp .f'), fpTr: q('.h-fp .tr'), st: q('.h-st .f'), stTr: q('.h-st .tr'), hpBar: q('.h-hp'), stBar: q('.h-st'), fpBar: q('.h-fp'),
      level: q('.h-lvl .v'), flask: q('.h-sub .flask'), flaskN: q('.h-sub .flask .n'), flaskSep: q('.h-sub .sep'), ultMini: q('.h-sub .art'),
      runes: q('.h-runes .v'), boss: q('.h-boss'), bossName: q('.h-boss .n'), bossFill: q('.h-boss .f'), bossTr: q('.h-boss .tr'),
      day: q('.h-day .t1'), timer: q('.h-day .t2'), compass: q('.h-compass'),
      weaponSlot: q('.h-slot.l'), itemSlot: q('.h-slot.c'), itemN: q('.h-slot.c .n'), potSlot: q('.h-slot.s'), offSlot: q('.h-slot.r'), artSkill: q('.h-art.s'), artUlt: q('.h-art.u'), cdSkill: q('.h-art.s .cd'), cdUlt: q('.h-art.u .cd'),
      reticle: q('.h-reticle'), prompt: q('.h-prompt'), promptT: q('.h-prompt .t'), promptK: q('.h-prompt .u-key'),
      warn: q('.h-warn'), title: q('.h-title'), titleB: q('.h-title .b'), titleS: q('.h-title .s'),
      reveal: q('.h-reveal'), revealB: q('.h-reveal .b'), revealS: q('.h-reveal .s'), hint: q('.h-hint'),
    };
    this.cctx = this.el.compass.getContext('2d');
    this.last = {}; this.titleT = 0; this.hintT = 0; this.canvasT = 0; this.titleMode = 'card';
    this.trail = { hp: -1, fp: -1, st: -1, boss: -1 }; this.hold = { hp: 0, fp: 0, st: 0, boss: 0 }; this.prev = { hp: 1, fp: 1, st: 1, boss: 1 }; this.trailW = { hp: -1, fp: -1, st: -1, boss: -1 };
    this.bossRef = null;
    this.setVisible(false);
    this.hideHint();
  }

  setVisible(v) { this.root.classList.toggle('h-hidden', !v); this.visible = v; }

  /** Shows the controls list (bottom-right) and the key labels on the slots for `seconds`. */
  showControlsHint(seconds) { this.hintT = seconds; this.el.hint.style.opacity = '1'; this.el.hint.style.display = ''; this.root.classList.add('h-keys'); }

  /**
   * Title card. A boss name (matching run.boss) is shown as a lower-third reveal above the boss bar,
   * Elden Ring style; anything else (DAY I, NIGHT SURVIVED…) is the centred serif card.
   */
  showTitle(big, sub, dur = 3.6) {
    const E = this.el, boss = this.game.run && this.game.run.boss;
    const name = clean(big);
    const isBoss = !!(boss && name && name === clean(boss.name));
    this.titleMode = isBoss ? 'reveal' : 'card';
    if (isBoss) {
      const s = String(sub || '').toUpperCase();
      E.revealB.textContent = name; E.revealS.textContent = s === name.toUpperCase() ? '' : s;
      E.reveal.classList.add('on'); E.title.classList.remove('on'); E.boss.classList.add('reveal');
    } else {
      E.titleB.textContent = name; E.titleS.textContent = sub || '';
      E.title.classList.add('on'); E.reveal.classList.remove('on');
    }
    this.titleT = dur;
  }

  /** Ends the current title/reveal (fades out). */
  _endTitle() { const E = this.el; E.title.classList.remove('on'); E.reveal.classList.remove('on'); E.boss.classList.remove('reveal'); }

  /** Cuts the current title/reveal instantly (no fade). */
  hideTitle() {
    const E = this.el; this.titleT = 0;
    for (const el of [E.title, E.reveal, E.bossName]) el.style.transition = 'none';
    this._endTitle();
    requestAnimationFrame(() => { for (const el of [E.title, E.reveal, E.bossName]) el.style.transition = ''; });
  }

  hideHint() { this.hintT = 0; this.el.hint.style.display = 'none'; this.root.classList.remove('h-keys'); }

  setPrompt(text, key = 'E') {
    if (text === this.last.prompt && key === this.last.promptKey) return;
    this.last.prompt = text; this.last.promptKey = key;
    this.el.prompt.style.display = text ? 'flex' : 'none';
    if (text) { this.el.promptT.textContent = text; this.el.promptK.textContent = key; }
  }

  /**
   * Pose helper: snaps the HP / stamina / boss lag trails to sit `gap` of the bar behind the live values, the
   * way they look a beat after a hit and a roll (a pose that drops hp in one step would otherwise freeze a
   * full-width trail). `stGap` defaults to a shorter stamina lag; the FP trail is cleared.
   */
  settleTrails(gap = 0.1, stGap = gap * 0.8) {
    const p = this.game.player, boss = this.game.run && this.game.run.boss;
    const snap = (key, cur, lag, el) => { this.trail[key] = Math.min(1, cur + lag); this.prev[key] = cur; this.hold[key] = 0; this._trail(key, cur, 0, el); };
    if (p) {
      snap('hp', clamp01(p.hp / p.maxHp), gap, this.el.hpTr);
      snap('st', clamp01(p.stamina / p.maxStamina), stGap, this.el.stTr);
      snap('fp', clamp01(p.fp / (p.maxFp || 1)), 0, this.el.fpTr);
    }
    if (boss) { this.bossRef = boss; snap('boss', clamp01(boss.hp / boss.maxHp), gap, this.el.bossTr); }
  }

  _set(key, value, fn) { if (this.last[key] !== value) { this.last[key] = value; fn(value); } }

  /** Delayed damage trail: holds HOLD s after the last hit, then drains towards the live value (frozen while posing). */
  _trail(key, cur, dt, el) {
    const T = this.trail;
    if (T[key] < 0 || cur >= T[key]) { T[key] = cur; this.hold[key] = 0; }
    else if (!this.game.posing) {
      if (cur < this.prev[key] - 1e-6) this.hold[key] = 0;
      this.hold[key] += dt;
      if (this.hold[key] > HOLD) T[key] = Math.max(cur, T[key] - dt * (DRAIN + (T[key] - cur) * 1.6));
    }
    this.prev[key] = cur;
    const w = Math.round(T[key] * 1000) / 10;
    if (w !== this.trailW[key]) { this.trailW[key] = w; el.style.width = w + '%'; }
  }

  _cooldown(key, cd, max, el) {
    const deg = Math.round(clamp01(cd / max) * 360);
    this._set(key, deg, (d) => { el.style.background = d > 0 ? `conic-gradient(rgba(0,0,0,0.78) ${d}deg, transparent 0deg)` : 'none'; });
  }

  update(dt) {
    if (!this.visible) return;
    const game = this.game, p = game.player, run = game.run, L = this.last, E = this.el;
    if (this.titleT > 0) {
      this.titleT -= dt;
      if (this.titleT <= 0) this._endTitle();
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) { E.hint.style.opacity = '0'; this.root.classList.remove('h-keys'); setTimeout(() => { if (this.hintT <= 0) E.hint.style.display = 'none'; }, 1300); }
    }
    if (!p || !run) return;
    // bars: frame width scales with the max stat (Nightreign proportions at the starting stats)
    this._set('hpMax', p.maxHp, (v) => { E.hpBar.style.width = Math.min(620, 215 + v * 0.5) + 'px'; });
    this._set('fpMax', p.maxFp, (v) => { E.fpBar.style.width = Math.min(380, 120 + v * 1.25) + 'px'; });
    this._set('stMax', p.maxStamina, (v) => { E.stBar.style.width = Math.min(440, 125 + v * 1.5) + 'px'; });
    const hp01 = clamp01(p.hp / p.maxHp);
    this._set('hp', Math.round(hp01 * 1000), (v) => { E.hp.style.width = v / 10 + '%'; });
    this._trail('hp', hp01, dt, E.hpTr);
    const fp01 = clamp01(p.fp / (p.maxFp || 1)), st01 = clamp01(p.stamina / p.maxStamina);
    this._set('fp', Math.round(fp01 * 1000), (v) => { E.fp.style.width = v / 10 + '%'; });
    this._trail('fp', fp01, dt, E.fpTr);
    this._set('st', Math.round(st01 * 1000), (v) => { E.st.style.width = v / 10 + '%'; });
    this._trail('st', st01, dt, E.stTr);
    this._set('level', p.level | 0, (v) => { E.level.textContent = v; });
    this._set('runes', p.runes | 0, (v) => { E.runes.textContent = String(v); });
    // flask count (only when the player has flasks): the row under the bars and the raised item slot
    const flasks = typeof p.flasks === 'number' ? p.flasks : -1;
    const prevFlasks = L.flasks;
    this._set('flasks', flasks, (v) => {
      const on = v >= 0;
      E.flask.style.display = on ? 'flex' : 'none'; E.flaskSep.style.display = on ? 'block' : 'none';
      E.flask.classList.toggle('out', v === 0);
      if (on) E.flaskN.textContent = v;
      if (typeof prevFlasks === 'number' && v < prevFlasks) { E.itemSlot.classList.add('drink'); setTimeout(() => E.itemSlot.classList.remove('drink'), 350); }
      E.itemSlot.classList.toggle('empty', v <= 0); E.itemSlot.classList.toggle('held', v > 0); E.itemN.textContent = on ? v : '';
    });
    // slots + arts
    this._set('weapon', p.weapon && p.weapon.visual, (v) => {
      E.weaponSlot.innerHTML = weaponSvg(WEAPON_GLYPH[v] || 'sword');
      E.weaponSlot.title = clean(p.weapon && p.weapon.name) || 'Weapon';
    });
    const cdS = (SKILLS && SKILLS.skill && SKILLS.skill.cooldown) || 9, cdU = (SKILLS && SKILLS.ult && SKILLS.ult.cooldown) || 45;
    this._cooldown('cdS', p.skillCd, cdS, E.cdSkill);
    this._cooldown('cdU', p.ultCd, cdU, E.cdUlt);
    this._set('ultReady', p.ultCd <= 0, (v) => { E.ultMini.classList.toggle('on', v); });
    // boss bar
    const boss = run.boss;
    const bossVisible = !!(boss && (boss.alive || boss.deadT < 2.5));
    this._set('bossVis', bossVisible, (v) => { E.boss.classList.toggle('on', v); E.compass.classList.toggle('off', v); });
    if (boss) {
      if (boss !== this.bossRef) { this.bossRef = boss; this.trail.boss = 1; this.hold.boss = 0; this.prev.boss = 1; }
      this._set('bossName', boss.name, (v) => { E.bossName.textContent = clean(v); });
      const b01 = clamp01(boss.hp / boss.maxHp);
      this._set('bossHp', Math.round(b01 * 1000), (v) => { E.bossFill.style.width = v / 10 + '%'; });
      this._trail('boss', b01, dt, E.bossTr);
    }
    // day + timer (quiet line under the rune count)
    this._set('day', run.day, (v) => { E.day.textContent = 'DAY ' + ROMAN[v]; });
    let timer;
    if (run.dayEndT > 0) timer = 'NIGHT SURVIVED';
    else if (run.bossActive) timer = run.day === 3 ? 'THE NIGHTLORD' : 'FIELD BOSS';
    else if (run.ring.shrinking) timer = 'THE NIGHT CLOSES IN · ' + fmt(run.ring.shrinkDur - run.ring.shrinkT);
    else timer = (run.phase === 'explore2' ? 'FINAL CIRCLE IN ' : 'NIGHT FALLS IN ') + fmt(run.timeToNext());
    this._set('timer', timer, (v) => { E.timer.textContent = v; });
    // warning: 2 = outside the ring (red), 1 = the wall within 25 m (ring violet), 0 = none (p.ringDist is written by run/Ring.js)
    const warn = !p.alive ? 0 : p.outsideRing ? 2 : (p.ringDist !== undefined && p.ringDist < 25) ? 1 : 0;
    this._set('warn', warn, (v) => {
      E.warn.style.display = v ? 'block' : 'none';
      E.warn.textContent = v === 2 ? "OUTSIDE THE NIGHT'S CIRCLE" : 'THE NIGHT DRAWS NEAR';
      const c = v === 2 ? UI.danger : RING_BLUE;
      E.warn.style.color = c; E.warn.style.textShadow = `0 0 12px ${alpha(c, 0.6)}, 0 1px 2px #000`;
    });
    // reticle
    const t = p.lockTarget;
    if (t && t.alive) {
      _v.set(t.pos.x, t.pos.y + (t.height || 1.9 * t.scale) * 0.6, t.pos.z).project(game.camera); // chest height

      const vis = _v.z < 1;
      E.reticle.style.display = vis ? 'block' : 'none';
      if (vis) E.reticle.style.transform = `translate(${((_v.x + 1) / 2 * innerWidth / this.zoom) | 0}px, ${((1 - _v.y) / 2 * innerHeight / this.zoom) | 0}px)`;
      L.ret = true;
    } else if (L.ret) { E.reticle.style.display = 'none'; L.ret = false; }
    // compass (10 Hz, skipped while hidden)
    this.canvasT -= dt;
    if (this.canvasT <= 0) { this.canvasT = 0.1; if (!bossVisible) this.drawCompass(p, run); }
  }

  /** Compass strip: bearings relative to the camera (north = -Z), ring centre / nearest grace / boss markers. */
  drawCompass(p, run) {
    const c = this.cctx, W = COMPASS_W, H = COMPASS_H, cx = W / 2, ppd = W / COMPASS_FOV, base = 18;
    const heading = -this.game.cameraCtl.yaw, hd = heading * 180 / Math.PI, half = COMPASS_FOV / 2;
    c.clearRect(0, 0, W, H);
    c.fillStyle = alpha(UI.text, 0.5); c.fillRect(0, base, W, 1);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 3;
    for (let a = Math.floor((hd - half) / 15) * 15; a <= hd + half; a += 15) {
      const x = cx + (a - hd) * ppd, n = ((a % 360) + 360) % 360;
      const card = n % 90 === 0, inter = n % 45 === 0;
      const len = card ? 6 : inter ? 4 : 2;
      c.fillStyle = alpha(UI.text, card ? 0.9 : 0.45);
      c.fillRect(x - 0.5, base - len, 1, len);
      if (card) { c.fillStyle = INK; c.font = `13px ${FONT}`; c.fillText('NESW'[n / 90], x, 10); }
    }
    c.shadowBlur = 0;
    const mark = (x, z, draw) => {
      const rel = wrapPi(Math.atan2(x - p.pos.x, -(z - p.pos.z)) - heading) * 180 / Math.PI;
      if (Math.abs(rel) < half - 2) draw(cx + rel * ppd);
    };
    const ring = run.ring;
    if (Math.hypot(ring.center.x - p.pos.x, ring.center.z - p.pos.z) > 25) mark(ring.center.x, ring.center.z, (x) => {
      c.fillStyle = RING_BLUE; c.beginPath(); c.moveTo(x, base + 2); c.lineTo(x + 3, base + 5); c.lineTo(x, base + 8); c.lineTo(x - 3, base + 5); c.closePath(); c.fill();
    });
    const sites = this.game.graces && this.game.graces.sites;
    if (sites && sites.length) {
      let best = null, bd = Infinity;
      for (const g of sites) { const d = (g.x - p.pos.x) ** 2 + (g.z - p.pos.z) ** 2; if (d < bd) { bd = d; best = g; } }
      if (best && bd > 64) mark(best.x, best.z, (x) => { c.fillStyle = UI.gold; c.beginPath(); c.arc(x, base + 5, 2.2, 0, Math.PI * 2); c.fill(); });
    }
    // heading needle
    c.fillStyle = alpha(UI.text, 0.9); c.beginPath(); c.moveTo(cx, base - 6); c.lineTo(cx + 2.5, base - 1); c.lineTo(cx - 2.5, base - 1); c.closePath(); c.fill();
  }
}
