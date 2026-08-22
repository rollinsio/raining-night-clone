// Applies a gauntlet round result to progress/state.json and regenerates the page.
// Usage: node tools/record-verdict.mjs <result.json> [--fps N] [--status "text"]
// result.json = { round, results: [{ piece, build, pair, verdict, won, error }] }
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const STATE = path.join(ROOT, 'progress', 'state.json');
const argv = process.argv.slice(2);
const file = argv[0];
const fpsIdx = argv.indexOf('--fps');
const statusIdx = argv.indexOf('--status');
const fps = fpsIdx > -1 ? Number(argv[fpsIdx + 1]) : null;
const status = statusIdx > -1 ? argv[statusIdx + 1] : null;

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const res = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = new Date().toISOString();
state.updated = now;
state.round = Math.max(state.round || 0, res.round || 0);
if (fps != null && !Number.isNaN(fps)) state.fps = fps;
if (status) state.status = status;

for (const r of res.results || []) {
  const p = state.pieces.find((x) => x.id === r.piece);
  if (!p) continue;
  p.rounds = (p.rounds || 0) + 1;
  if (r.pair && r.pair.ours_capture && fs.existsSync(r.pair.ours_capture)) {
    p.ours = path.relative(ROOT, r.pair.ours_capture);
  } else if (r.build && r.build.capture) {
    const abs = path.isAbsolute(r.build.capture) ? r.build.capture : path.join(ROOT, r.build.capture);
    if (fs.existsSync(abs)) p.ours = path.relative(ROOT, abs);
  }
  if (r.error || !r.verdict) {
    p.status = 'lost';
    p.verdict = `Round ${res.round}: capture failed (${r.error || 'no verdict'}).`;
    p.gap = r.error || 'capture failed';
    state.log.push({ t: now, msg: `${p.name}: round ${res.round} capture failed — ${r.error || 'no verdict'}` });
    continue;
  }
  p.status = r.won ? 'won' : 'lost';
  const conf = r.verdict.confidence === 'sure' ? 'sure' : 'leaning';
  p.verdict = r.won
    ? `Round ${res.round}: critic picked OURS blind (${conf}). ${r.verdict.notes || ''}`.trim()
    : `Round ${res.round}: critic picked the bar (${conf}). ${r.verdict.notes || ''}`.trim();
  p.gap = r.won ? '' : `${r.verdict.biggest_gap} — fix: ${r.verdict.fix}`;
  p.lastGap = r.verdict.biggest_gap;
  p.lastFix = r.verdict.fix;
  state.log.push({
    t: now,
    msg: `${p.name}: round ${res.round} — ${r.won ? 'OURS WON blind' : 'bar won'} (${conf}). ${r.won ? '' : 'Gap: ' + r.verdict.biggest_gap}`.trim(),
  });
  if (r.build && r.build.summary) state.log.push({ t: now, msg: `${p.name}: builder — ${r.build.summary}` });
}

fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
execFileSync('node', [path.join(ROOT, 'tools', 'progress.mjs')], { stdio: 'inherit' });
const won = state.pieces.filter((p) => p.status === 'won').length;
console.log(`recorded round ${res.round}: ${won}/${state.pieces.length} won`);
