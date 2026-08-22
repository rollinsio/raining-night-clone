// Builds a blind A/B pair for a critic.
// Usage: node tools/blindpair.mjs <piece> <round> <oursPath> <barPath>
// Writes critic/<piece>/r<round>/A.jpg and B.jpg, both normalised to 1600x900 JPEG q4 so
// resolution/format cannot give the source away. Prints {"A":"ours"|"bar","B":...,"dir":...} to stdout.
// The critic must only be given the A/B paths — never this mapping.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const [piece, round, ours, bar] = process.argv.slice(2);
if (!piece || !round || !ours || !bar) {
  console.error('usage: blindpair <piece> <round> <oursPath> <barPath>');
  process.exit(2);
}
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const dir = path.join(ROOT, 'critic', piece, `r${round}`);
fs.mkdirSync(dir, { recursive: true });

// Refuse blank captures (a black frame is a capture fault, not a verdict).
function meanLuma(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'info', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = String(r.stdout || '') + String(r.stderr || '');
  const m = /YAVG=([\d.]+)/.exec(s);
  return m ? Number(m[1]) : NaN;
}
const luma = meanLuma(ours);
if (!Number.isNaN(luma) && luma < 30) {
  console.error(`BLANK_CAPTURE: ${ours} mean luma ${luma.toFixed(1)} — re-run the screenshot tool and try again`);
  process.exit(3);
}

// Hidden but reproducible coin flip: hash of piece+round+file sizes.
const sz = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
const h = crypto.createHash('sha256').update(`${piece}|${round}|${sz(ours)}|${sz(bar)}`).digest();
const oursIsA = h[0] % 2 === 0;

function norm(src, dst) {
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-i', src,
    '-vf', 'scale=1600:900:force_original_aspect_ratio=increase,crop=1600:900',
    '-q:v', '4', dst,
  ]);
}
norm(oursIsA ? ours : bar, path.join(dir, 'A.jpg'));
norm(oursIsA ? bar : ours, path.join(dir, 'B.jpg'));
const map = { A: oursIsA ? 'ours' : 'bar', B: oursIsA ? 'bar' : 'ours', dir };
fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(map));
console.log(JSON.stringify(map));
