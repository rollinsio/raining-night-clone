export const meta = {
  name: 'gauntlet-round',
  description: 'One gauntlet round: per piece, builder → fresh capture + blind pair → harsh critic',
  phases: [
    { title: 'Build', detail: 'one builder per piece, owns its folders' },
    { title: 'Capture', detail: 'fresh capture, blind A/B pair' },
    { title: 'Judge', detail: 'fresh critic picks A or B blind' },
  ],
}

const ROOT = '/Users/rollins/code/games/nightreign-clone'
const URL = args.serverUrl || 'http://localhost:5173'
const round = args.round
const pieces = args.pieces || []

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    console_errors: { type: 'integer' },
    capture: { type: 'string', description: 'path of the PNG you last captured for this piece' },
    fps_headless: { type: 'number' },
  },
  required: ['summary', 'files_changed', 'console_errors', 'capture'],
}
const PAIR_SCHEMA = {
  type: 'object',
  properties: {
    load_ok: { type: 'boolean' },
    ours_capture: { type: 'string' },
    A: { type: 'string', enum: ['ours', 'bar'] },
    B: { type: 'string', enum: ['ours', 'bar'] },
    dir: { type: 'string' },
    fps: { type: ['number', 'null'] },
    console_errors: { type: 'integer' },
  },
  required: ['load_ok', 'ours_capture', 'A', 'B', 'dir', 'console_errors'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pick: { type: 'string', enum: ['A', 'B'] },
    confidence: { type: 'string', enum: ['sure', 'lean'] },
    biggest_gap: { type: 'string', description: 'the single biggest concrete gap of the weaker frame' },
    fix: { type: 'string', description: 'one specific, implementable fix for that gap' },
    notes: { type: 'string' },
  },
  required: ['pick', 'confidence', 'biggest_gap', 'fix'],
}

function builderPrompt(p) {
  return `You are the BUILDER for the "${p.name}" piece of a browser-playable Elden Ring Nightreign demo (Three.js 0.185 + Vite, zero external assets, everything procedural). Project: ${ROOT}. Read ${ROOT}/ARCHITECTURE.md and ${ROOT}/GAUNTLET.md first, then ${ROOT}/CHANGELOG.md.

Round ${round}. A separate harsh critic will compare a fresh capture of our build, blind and side by side, against a frame from a shipped game. Your job is to make ours the one the critic picks.

PIECE GOAL: ${p.goal}

YOU OWN these folders/files and should confine edits to them (if you must touch something else, keep it minimal and add a line to CHANGELOG.md): ${p.folders.join(', ')}.
Other builders are editing other folders right now in parallel — do not reformat or rewrite shared files, do not rename exports others import, and never break window.__game or the screenshot poses.

THE BAR (look at these with the Read tool before you start, and again before you finish): ${p.bar}${p.extraBars ? ', ' + p.extraBars.join(', ') : ''}. More references in ${ROOT}/reference/ashen (Ashen look: low-poly, faceless heads, flat-shaded facets, muted palette, warm/cool contrast, heavy fog, big silhouettes) and ${ROOT}/reference/nightreign (Nightreign structure: eternal night, blue rain-of-night ring, golden grace, Souls HUD).

${p.gap ? `LAST CRITIC VERDICT — ours lost. Biggest gap: ${p.gap}\nSuggested fix: ${p.fix}\nFix THIS first, then anything else that gets the frame closer to the bar.` : 'First round for this piece: get it to a state that could plausibly pass for a shipped stylized game frame.'}

HOW TO WORK:
- The dev server is already running at ${URL} (do not start another; if it is down, run \`cd ${ROOT} && npx vite --port 5173\` in the background).
- Capture your pose(s) with \`cd ${ROOT} && node tools/screenshot.mjs ${p.poses.join(' ')}\` → shots/<pose>.png, then LOOK at the PNG with the Read tool and put it next to the bar. Iterate: edit → capture → look, at least 3 times. Be your own harsh critic; the real critic will be harsher.
- The screenshot tool prints console errors — there must be zero when you finish.
- Keep it fast: pixel ratio 1, instancing, no per-frame allocations; this must hold 60 fps at 1080p on a real GPU.
- Write clean modules with short doc comments. Update CHANGELOG.md (one line per module you changed).
- Do not ask questions. Do not stop early. Work until the capture genuinely looks like the bar's league, then return.

Return JSON: summary (2–3 sentences of what changed), files_changed, console_errors, capture (path to your final PNG for pose "${p.poses[0]}"), fps_headless.`
}

function pairPrompt(p) {
  return `Mechanical task in ${ROOT}. The dev server runs at ${URL}.
1. Run: cd ${ROOT} && node tools/screenshot.mjs ${p.poses[0]}
   If it fails because the page did not load or threw, wait 20s and retry once. Record load_ok and the number of console errors it printed, and the fps it printed (or null).
2. Run: cd ${ROOT} && node tools/blindpair.mjs ${p.id} ${round} shots/${p.poses[0]}.png ${p.bar}
   It prints a JSON line {"A":..., "B":..., "dir":...}. Return those fields exactly as printed.
   If it exits with BLANK_CAPTURE (the frame was black), wait 20s, re-run step 1, then step 2 again — up to 3 attempts. If still blank, return load_ok=false.
Also copy the capture for the record: cp shots/${p.poses[0]}.png critic/${p.id}/r${round}/ours.png
Return JSON: load_ok, ours_capture (absolute path of ours.png), A, B, dir, fps, console_errors. Do not look at the images. Do not describe them.`
}

function criticPrompt(p, pair) {
  return `You are a harsh art director judging two frames from two different third-person action games. Both are presented as shipped games. You do not know which studio made which.

The piece being judged: "${p.name}". What a great frame for this piece does: ${p.goal}

Look at both images with the Read tool:
A: ${pair.dir}/A.jpg
B: ${pair.dir}/B.jpg

Decide which frame is better FOR THIS PIECE — the one you would be less embarrassed to ship. Binary. No ties, no scores. Judge composition, silhouette readability, lighting and colour harmony, material/shading consistency, atmosphere, sense of scale, and whether the frame reads as a coherent art direction rather than placeholder geometry. Motion blur, compression, or HUD presence are NOT reasons to pick or reject.

Then, for the WEAKER frame, name the single biggest concrete gap (what specifically makes it read as lesser — be precise: e.g. "ground is one flat colour with no value variation, so the character has no grounding shadow and floats") and ONE specific, implementable fix.

Praise is not useful. Return JSON: pick ("A"|"B"), confidence ("sure"|"lean"), biggest_gap, fix, notes (one sentence on the stronger frame's key strength).`
}

phase('Build')
const results = await pipeline(
  pieces,
  (p) =>
    args.skipBuild
      ? Promise.resolve({ piece: p.id, summary: '(judge-only pass: no build this round)', files_changed: [], console_errors: 0, capture: '' })
      : agent(builderPrompt(p), { label: `build:${p.id}`, phase: 'Build', schema: BUILD_SCHEMA }).then((b) => ({ ...(b || {}), piece: p.id })),
  (b, p) => agent(pairPrompt(p), { label: `pair:${p.id}`, phase: 'Capture', schema: PAIR_SCHEMA, effort: 'low' }).then((pair) => ({ build: b, pair: pair ? { ...pair, piece: p.id } : null })),
  ({ build, pair }, p) => {
    if (!pair || !pair.load_ok) return { piece: p.id, build, pair, verdict: null, won: false, error: 'capture failed' }
    return agent(criticPrompt(p, pair), { label: `critic:${p.id}`, phase: 'Judge', schema: VERDICT_SCHEMA }).then((v) => {
      const oursLetter = pair.A === 'ours' ? 'A' : 'B'
      const won = !!v && v.pick === oursLetter
      log(`${p.name}: ${won ? 'OURS WINS' : 'bar wins'} (${v && v.confidence}) — gap: ${v && v.biggest_gap}`)
      return { piece: p.id, build, pair, verdict: v ? { ...v, piece: p.id } : null, won }
    })
  },
)

const out = { round, results: results.filter(Boolean) }
phase('Record')
await agent(
  `Write the following JSON verbatim to the file ${ROOT}/progress/rounds/r${round}.json (create the directory if needed), then run \`cd ${ROOT} && node tools/record-verdict.mjs progress/rounds/r${round}.json\` and return its last line of output.\n\n` + JSON.stringify(out),
  { label: 'record', phase: 'Record', effort: 'low' },
)
return out
