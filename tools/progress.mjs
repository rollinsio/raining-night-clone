// Generates progress/index.html from progress/state.json.
// Usage: node tools/progress.mjs
// Images referenced in state are thumbnailed via ffmpeg (640px wide jpg) and inlined as data URIs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const STATE = path.join(ROOT, 'progress', 'state.json');
const OUT = path.join(ROOT, 'progress', 'index.html');
const THUMBS = path.join(ROOT, 'progress', 'thumbs');
fs.mkdirSync(THUMBS, { recursive: true });

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

function thumb(rel) {
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  const key = rel.replace(/[^a-zA-Z0-9]+/g, '_') + '_' + Math.floor(stat.mtimeMs) + '.jpg';
  const out = path.join(THUMBS, key);
  if (!fs.existsSync(out)) {
    try {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', abs, '-vf', 'scale=640:-2', '-q:v', '5', out]);
    } catch (e) {
      return null;
    }
  }
  return 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { won: 'Won blind', lost: 'Lost', building: 'Building', queued: 'Queued', critic: 'Under review' };

const pieces = state.pieces || [];
const won = pieces.filter((p) => p.status === 'won').length;
const totalRounds = pieces.reduce((a, p) => a + (p.rounds || 0), 0);

function pieceCard(p) {
  const ours = thumb(p.ours);
  const bar = thumb(p.bar);
  const img = (src, label) =>
    src
      ? `<figure><img src="${src}" alt="${esc(label)}" loading="lazy"><figcaption>${esc(label)}</figcaption></figure>`
      : `<figure class="empty"><div class="ph">no capture yet</div><figcaption>${esc(label)}</figcaption></figure>`;
  return `
  <article class="piece s-${esc(p.status)}" id="piece-${esc(p.id)}">
    <header>
      <h2>${esc(p.name)}</h2>
      <span class="pill">${esc(STATUS_LABEL[p.status] || p.status)}</span>
    </header>
    <div class="meta"><span><b>${p.rounds || 0}</b> round${p.rounds === 1 ? '' : 's'}</span>${p.metric ? `<span class="metric">${esc(p.metric)}</span>` : ''}</div>
    <div class="shots">${img(ours, 'Ours')}${img(bar, p.barLabel || 'Bar')}</div>
    ${p.verdict ? `<p class="verdict"><span class="lbl">Critic</span>${esc(p.verdict)}</p>` : ''}
    ${p.gap ? `<p class="gap"><span class="lbl">Biggest gap</span>${esc(p.gap)}</p>` : ''}
  </article>`;
}

const log = (state.log || []).slice().reverse().slice(0, 80);

const html = `<title>Limveld Gauntlet</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Source+Sans+3:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#0b0d14; --surface:#121623; --surface-2:#1a1f30; --line:#262c42;
  --text:#d9d3c3; --muted:#8b90a3; --gold:#c9a24a; --ring:#5b7fd4;
  --won:#6b9a5e; --lost:#9a3535; --building:#d08a3a; --queued:#4a5068; --critic:#5b7fd4;
  --shadow:0 1px 0 rgba(255,255,255,.03) inset, 0 10px 30px rgba(0,0,0,.35);
}
@media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){
  --bg:#efece4; --surface:#f8f6f0; --surface-2:#e9e5da; --line:#d6d1c3;
  --text:#1d1f2a; --muted:#5d6275; --gold:#9a7422; --ring:#3b5fb8;
  --won:#3f7a35; --lost:#9a2f2f; --building:#b86f1f; --queued:#8a8fa3; --critic:#3b5fb8;
  --shadow:0 1px 2px rgba(0,0,0,.06);
}}
:root[data-theme="light"]{
  --bg:#efece4; --surface:#f8f6f0; --surface-2:#e9e5da; --line:#d6d1c3;
  --text:#1d1f2a; --muted:#5d6275; --gold:#9a7422; --ring:#3b5fb8;
  --won:#3f7a35; --lost:#9a2f2f; --building:#b86f1f; --queued:#8a8fa3; --critic:#3b5fb8;
  --shadow:0 1px 2px rgba(0,0,0,.06);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Source Sans 3",ui-sans-serif,system-ui,sans-serif;font-size:16px;line-height:1.45;-webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:32px 24px 64px}
.top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px 32px;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px}
h1{font-family:Cinzel,Georgia,serif;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:clamp(22px,3vw,32px);margin:0;color:var(--gold);text-wrap:balance}
.sub{color:var(--muted);margin:6px 0 0;max-width:62ch}
.stats{display:flex;gap:28px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.stat{display:flex;flex-direction:column;gap:2px}
.stat b{font-size:26px;font-weight:500;line-height:1;color:var(--text)}
.stat span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.stat.gold b{color:var(--gold)}
.banner{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--building);padding:12px 16px;border-radius:6px;margin-bottom:28px;box-shadow:var(--shadow)}
.banner .dot{width:10px;height:10px;border-radius:50%;background:var(--building);box-shadow:0 0 0 4px color-mix(in srgb,var(--building) 25%,transparent);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
@media (prefers-reduced-motion:reduce){.banner .dot{animation:none}}
.banner p{margin:0}
.banner time{margin-left:auto;color:var(--muted);font-family:"IBM Plex Mono",monospace;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:18px}
.piece{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.piece::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--queued)}
.piece.s-won::before{background:var(--won)} .piece.s-lost::before{background:var(--lost)} .piece.s-building::before{background:var(--building)} .piece.s-critic::before{background:var(--critic)}
.piece header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.piece h2{font-family:Cinzel,Georgia,serif;font-weight:500;font-size:15px;letter-spacing:.08em;text-transform:uppercase;margin:0;text-wrap:balance}
.pill{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.s-won .pill{color:var(--won);border-color:var(--won)} .s-lost .pill{color:var(--lost);border-color:var(--lost)} .s-building .pill{color:var(--building);border-color:var(--building)} .s-critic .pill{color:var(--critic);border-color:var(--critic)}
.meta{display:flex;gap:16px;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.meta b{color:var(--text);font-weight:500}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0;display:flex;flex-direction:column;gap:4px}
figure img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:4px;border:1px solid var(--line);background:#000;display:block}
figure .ph{width:100%;aspect-ratio:16/9;border-radius:4px;border:1px dashed var(--line);display:grid;place-items:center;color:var(--muted);font-size:12px;background:var(--surface-2)}
figcaption{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.verdict,.gap{margin:0;font-size:14px;display:grid;grid-template-columns:88px 1fr;gap:8px;align-items:baseline}
.lbl{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.gap{color:var(--text)} .gap .lbl{color:var(--lost)}
.verdict{color:var(--muted);font-style:italic}
h3{font-family:Cinzel,Georgia,serif;font-weight:500;letter-spacing:.1em;text-transform:uppercase;font-size:13px;color:var(--muted);margin:40px 0 12px}
.log{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.log li{display:grid;grid-template-columns:150px 1fr;gap:16px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.log time{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
@media (max-width:640px){.verdict,.gap,.log li{grid-template-columns:1fr}.stats{gap:18px}}
</style>
<div class="wrap">
  <div class="top">
    <div>
      <h1>Limveld Gauntlet</h1>
      <p class="sub">Browser build of a Nightreign run, judged blind against Ashen screenshots and Nightreign's overview trailer. A piece is done only when a fresh critic picks ours without knowing which is which.</p>
    </div>
    <div class="stats">
      <div class="stat gold"><b>${won}<span style="font-size:14px;color:var(--muted)">/${pieces.length}</span></b><span>won blind</span></div>
      <div class="stat"><b>${totalRounds}</b><span>critic rounds</span></div>
      <div class="stat"><b>${state.fps != null ? esc(state.fps) : '—'}</b><span>fps @1080p</span></div>
    </div>
  </div>
  <div class="banner"><span class="dot"></span><p>${esc(state.status || '')}</p><time datetime="${esc(state.updated)}">${esc(new Date(state.updated || Date.now()).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} PT</time></div>
  <section class="grid">${pieces.map(pieceCard).join('')}</section>
  <h3>Log</h3>
  <ul class="log">${log.map((l) => `<li><time>${esc(new Date(l.t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time><span>${esc(l.msg)}</span></li>`).join('')}</ul>
</div>
`;
fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB), ${pieces.length} pieces, ${won} won`);
