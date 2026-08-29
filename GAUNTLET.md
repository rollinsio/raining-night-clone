# Gauntlet protocol

Every piece of the demo is improved by a **builder** and judged by a separate **critic** with fresh context. The critic never sees the builder's notes. A piece is done only when the critic, shown our capture and the bar side by side **with labels stripped**, picks ours.

## Pieces and their poses

| id | piece | bar (image) | pose(s) via `window.__game.screenshotPose` |
|---|---|---|---|
| vista | Vista & atmosphere | Ashen `reference/ashen/frames/t_003.jpg` (+ Steam shots) | `vista` |
| character | Character & animation | Ashen `t_005.jpg` | `character` (close rear 3/4 of the player mid-run) |
| combat | Combat feel | Ashen `t_020.jpg` | `combat` (player mid-swing on an enemy, hit FX visible) |
| architecture | Churches, forts & ruins | Ashen `t_037.jpg`, `t_015.jpg` | `church`, `fort`, `ruin` |
| grace | Sites of Grace & loot | Nightreign `reference/nightreign/frames/t_008.jpg` | `grace` |
| ring | Night ring & three-day run | Nightreign `t_043.jpg` | `ring` |
| bosses | Field bosses (day 1 & 2) | Nightreign `t_060.jpg` | `boss` |
| nightlord | Nightlord (night 3) | Nightreign `t_108.jpg` | `nightlord` |
| hud | HUD & menus | Nightreign `t_058.jpg` | `hud` (gameplay with full HUD, boss bar visible) |
| hub | Roundtable Hold & relics | Nightreign `t_020.jpg` | `hub` |
| nightfarers | Eight Nightfarers | Nightreign `t_095.jpg` | `roster` (all eight lined up in the hub) |
| shifting | Shifting Earth | Nightreign `t_030.jpg` | `shifting` |
| perf | 60 fps at 1080p | measured | `vista`, `combat` for 5 s each |
| audio | Sound | Ashen trailer audio (description) | — (critic listens to a rendered WAV via `tools/renderaudio.mjs`) |

## Capture

```
npx vite --port 5173            # dev server (keep running)
node tools/screenshot.mjs vista combat grace   # → shots/<pose>.png, prints fps
node tools/blindpair.mjs <piece> <round> shots/<pose>.png reference/...   # → critic/<piece>/r<round>/{A,B}.jpg + prints mapping
```

Motion (animation) is judged from `node tools/motion.mjs <action>` — e.g. `combo`, `heavy`, `soldier:light`, `run` — which writes `shots/motion/<action>/`: `sheet_<view>.png` (every frame labelled with time / attack phase / tip speed), `onion_<view>.png` (ghosted frames with the blade-tip path: grey windup, red active, blue recover — dot spacing is speed), `motion_<view>.gif`, `trace.json` and `report.md` with checks. A builder touching clips runs it before and after; a critic reads the onion skins and the checks, not single frames.

## Critic contract

The critic receives only: the piece name, what the piece is supposed to achieve, and the two paths `A.jpg` / `B.jpg`. It must:

1. Look at both images (Read tool).
2. Answer **which is the better-looking, more convincing shipped-game frame for this piece: A or B.** Binary. No scores.
3. Name the **single biggest gap** of the weaker one, concretely (e.g. "terrain is a single flat green, no fog banding, silhouettes mush together"), and one specific fix.
4. Return JSON `{ "pick": "A"|"B", "confidence": "sure"|"lean", "biggest_gap": "...", "fix": "...", "notes": "..." }`.

The critic is harsh. It assumes both are shipped games and asks which studio it would be embarrassed by. Praise is not useful.

## Builder contract

The builder receives: the piece, the module folders it owns, the critic's last gap + fix, and the bar images (it may look at them). It edits only its folders (or notes cross-folder edits in `CHANGELOG.md`), keeps the game running with zero console errors, re-captures its pose, and returns the new capture path plus a one-line summary.

## Loop

For each piece: build → capture → blind pair → critic → (if critic picks the bar) back to build with the gap. Stop only when the critic picks ours. `progress/state.json` is updated after every verdict; `node tools/progress.mjs` regenerates the live page.
