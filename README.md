# Limveld — a browser Nightreign demo

A playable, high-fidelity demo of *Elden Ring Nightreign*'s run loop, built in the browser with Three.js and Vite. **Everything is procedural** — every mesh, material, shader, particle and UI element is generated in code. No models, textures, images, fonts or network requests.

Fan project, built as a rendering/gameplay exercise. Not affiliated with FromSoftware or Bandai Namco.

## Run it

```bash
npm install
npx vite --port 5173      # http://localhost:5173 — click the canvas for pointer lock
```

Controls: **WASD** move · **Shift** sprint · **Space** roll (i-frames) · **LMB** light · **RMB** heavy · **Q** lock-on · **E** interact/rest · **1/2** skill/ultimate · **M** map · **Esc** pause.

Detail: a **High / Medium / Low** selector sits in the bottom-right of the page (also in the pause menu) with a live fps readout beside it. High runs the post chain and 2048 sun shadows, Medium drops the shadow map to 1024, Low skips the post pass and sun shadows entirely. The choice is remembered in localStorage.

Performance: **~270 fps uncapped at 1920×1080** on an M-series GPU (measured with `tools/fps-probe.mjs` in headed Chromium), against a 60 fps target.

## What's in it

- **A three-day expedition** — explore → ring shrink → explore → ring shrink → day boss, three times, ending in a Nightlord on night 3, then a results screen.
- **The night ring** — a translucent "rain of night" wall that closes in on a schedule and damages you outside it.
- **Limveld** — a seeded 1200×1200 m heightmap with a lake, churches, a fort, ruins, a catacomb, enemy camps, and Sites of Grace.
- **Souls combat** — stamina, roll i-frames, poise/stagger, hit-stop, lock-on, light/heavy combos, weapon trails, spark impacts; soldiers, knights and wolf packs with telegraphed attacks.
- **Sites of Grace** — rest, spend runes to level, set your respawn.
- **Roundtable Hold hub** — Nightfarer select and relic vessels persisted in localStorage.
- Zero console errors; `node tools/smoke.mjs` runs 27 end-to-end checks over the whole loop.

## How it was built: the gauntlet loop

Each piece of the demo (vista, character, combat, ring, HUD, grace, architecture, bosses, …) is improved by a **builder** agent and judged by a separate **critic** agent with fresh context. The critic sees our capture and a real screenshot from a shipped game **side by side with the labels stripped**, picks the better frame, and names the single biggest gap. A piece is done only when the critic picks ours blind.

The bar: **Ashen** (A44 Games) for look and feel, **Elden Ring Nightreign** for run structure.

| Tool | What it does |
|---|---|
| `tools/screenshot.mjs` | Headless capture of any pose via `window.__game.screenshotPose()`; retries across Vite reloads, rejects blank frames |
| `tools/blindpair.mjs` | Normalises our capture and the reference to identical size/format, shuffles them into `A.jpg`/`B.jpg`, hides the key |
| `tools/gauntlet-round.workflow.js` | One round: builder → capture → blind pair → critic, fanned out per piece |
| `tools/record-verdict.mjs` | Applies verdicts to `progress/state.json` |
| `tools/progress.mjs` | Regenerates the live progress page from that state |
| `tools/fps-probe.mjs` | Real-GPU fps in headed Chromium |
| `tools/smoke.mjs` | 27 end-to-end checks over the full run loop |

`ARCHITECTURE.md` is the module contract every builder works against; `GAUNTLET.md` is the critic/builder protocol; `CHANGELOG.md` records what each round changed.

### Where the scoreboard actually stands

Four pieces won their first blind comparison. A **confirmation pass** then re-judged them with neutral, craft-only wording against fairer reference frames — and all four losses came back. The earlier wins were artifacts of the setup, not the work:

- two bar images were mis-filed (an Ashen ruin interior standing in for a "vista"; a Nightreign frame with no HUD used to judge the HUD),
- one goal said "night" while the reference was shot in daylight, which told the critic which frame to prefer,
- two wins were "leaning", not "sure".

So the honest board is: **fps is the only confirmed win**; every visual piece is still behind the bar. Four independent critics named the same fundamentals — no contact shadows or AO, flat untextured ground, and light sources that don't actually light characters or terrain. That's a rendering-foundations problem, not a per-piece one, and it's the work in flight when this snapshot was taken.

Recording that honestly is the point of the method: a gauntlet loop only produces quality if the comparison is real.

## Layout

```
src/core/        Game loop, input, events, seeded RNG, debug/pose API
src/render/      Palette, atmosphere, post, lights, contact shadows, particles
src/world/       Terrain, Limveld map gen, structures, props, POIs
src/entity/      Humanoid rig + procedural animation, player, camera, enemies, bosses
src/combat/      Hit volumes, damage, FX, weapon trails, arena dressing
src/run/         Expedition state machine, night ring, graces, loot
src/nightfarers/ The eight preset characters
src/hub/ meta/   Roundtable Hold, relics (localStorage)
src/ui/          HUD, menus, map
progress/        Live progress page + per-round verdicts
```

`window.__game` exposes `screenshotPose`, `teleport`, `setTime`, `spawn`, `setQuality`, `startExpedition` and `fps` for tooling.
