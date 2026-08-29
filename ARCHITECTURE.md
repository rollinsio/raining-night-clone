# Nightreign Demo — Architecture Contract

Browser-playable demo of Elden Ring Nightreign. Three.js + Vite, vanilla ES modules, **zero external assets** — every mesh, texture, and sound is generated procedurally in code so the build is self-contained and loads instantly.

Target: **Chrome, 1920×1080, 60 fps** (`renderer` at devicePixelRatio capped at 1.0; use instancing, frustum culling, merged geometry, and a single directional shadow cascade at most).

Visual bar: **Ashen (A44 Games)** — low-poly, faceless humanoids (smooth featureless heads), flat-shaded facets with soft vertex-colour gradients, muted desaturated palette with strong warm/cool light contrast, heavy aerial fog, wide vistas, pastel-to-dark skies, soft ambient occlusion in crevices. Structure bar: **Nightreign overview trailer** — eternal night, blue rain-of-night ring, golden Sites of Grace, Souls HUD.

## Directory layout (module ownership — one builder per folder, never edit outside your folder without a note in `CHANGELOG.md`)

```
index.html                 canvas + #hud root + #menu root
src/main.js                boot: new Game(); game.start()
src/core/Game.js           renderer, scene, camera, clock, system list, top-level state machine HUB→EXPEDITION→RESULTS
src/core/Input.js          keyboard/mouse/gamepad → named actions (move, sprint, roll, light, heavy, skill, ult, lockOn, interact, map)
src/core/Events.js         tiny pub/sub bus: on/off/emit
src/core/Rng.js            seeded mulberry32: rng.float(), rng.int(a,b), rng.pick(arr), rng.chance(p)
src/core/Debug.js          window.__game: { teleport(x,z), setTime(day, t01), spawn(type), killAll(), setFps(), screenshotPose(name), fps }
src/render/Style.js        PALETTE constants, material factories: flatMat(color), charMat(color), emissive(color)
src/render/Atmosphere.js   sky dome shader, fog, hemi+dir light, moon, night ring tint, post (vignette, slight bloom)
src/render/Postfx.js       EffectComposer setup (keep cheap; toggleable)
src/world/Terrain.js       heightmap (fbm, seeded), chunked mesh w/ vertex colours, getHeight(x,z), getNormal(x,z)
src/world/Limveld.js       map gen: places POIs (ruins, catacomb, fort, church, camp, great-church), grace sites, spawn, boss arenas
src/world/Props.js         instanced low-poly trees, rocks, grass tufts, pillars, walls, gravestones
src/world/Structures.js    buildable kits: church(), fort(), ruin(), catacombEntrance()
src/entity/Entity.js       base: object3d, hp/maxHp, stamina, poise, radius, alive, update(dt), takeHit(hit)
src/entity/Humanoid.js     low-poly faceless rig from primitives + procedural animation (idle, run, roll, attack windups, hit, death)
src/entity/Player.js       controller: movement rel. to camera, sprint, roll (i-frames), lock-on, light/heavy combos, skill, ultimate, stamina/FP, no fall damage
src/entity/Camera.js       third-person orbit w/ lock-on framing, collision with terrain, shake
src/entity/Enemy.js        base AI FSM: idle/patrol/alert/chase/attack/recover/stagger/dead; telegraphs; drops runes
src/entity/enemies/*.js    Soldier, Wolf, Knight, Archer, Bat, Troll
src/entity/bosses/Boss.js  boss base: phases, health bar hookup, arena, intro card, death → ring reset
src/entity/bosses/*.js     day1 field bosses (Tree Sentinel-like, Bell Bearing Hunter-like), day2 (Gaping Jaw-like, Centipede-demon), Nightlord: Gladius/Adel/Heolstor-like w/ phase 2 (+3 for Everdark)
src/combat/Combat.js       hit volumes (sphere sweeps), damage calc, poise/stagger, i-frames, hit-stop, hit FX, rune payout
src/combat/Projectiles.js  arrows / glintstone bolts for the ranged movesets (bow, staff): swept hits, terrain stop, trail + burst FX
src/combat/Weapons.js      weapon table (type, dmg, scaling, moveset id, rarity), movesets (timings, hitbox frames, motion values)
src/nightfarers/index.js   8 classes: Wylder, Guardian, Ironeye, Raider, Recluse, Executor, Duchess, Revenant — stats, start weapon, skill(), ultimate(), cooldowns
src/run/Expedition.js      run state: day (1..3), timer, phase (explore/ring1/ring2/boss), events, end conditions
src/run/Ring.js            night ring: center/radius schedule per day, shrink easing, outside-damage tick, ring mesh/shader
src/run/Loot.js            chest/weapon drop RNG, rarity weights by day, pickup prompt
src/run/Grace.js           Site of Grace: rest, level-up (runes → level via curve), respawn point
src/run/ShiftingEarth.js   optional terrain rewrite variants: crater (lava), mountain (ice), swamp (rot) — tougher enemies, better loot
src/hub/Roundtable.js      Roundtable Hold scene: nightfarer select, relic slots, start expedition
src/hub/Preview.js         hub roster figure: the selected Nightfarer's dressed rig (nightfarers/Rig.js) held in front of the orbit camera
src/meta/Relics.js         persistence via localStorage: relics owned, vessel slots per nightfarer, run history
src/ui/HUD.js              HP/FP/stamina bars (top-left), runes (bottom-right), boss bar (bottom-center), day/timer + ring indicator, lock-on reticle, pickup prompts, damage numbers off
src/ui/Menus.js            title, hub menus, level-up, inventory, death ("YOU DIED" style), victory, pause
src/ui/Map.js              fullscreen map (M): POIs, grace, ring circle + next circle, player marker
src/audio/Audio.js         WebAudio procedural: ambient drone, wind, hit thuds, sword swish, grace chime, boss drums
tools/screenshot.mjs       playwright: boots dev server URL, poses via window.__game, captures 1920×1080 PNGs + fps
```

## Shared conventions

- Units: metres. Player height 1.8. Map ~1200×1200 m. Y up.
- `Game` exposes `game.scene`, `game.camera`, `game.renderer`, `game.events`, `game.input`, `game.rng`, `game.terrain`, `game.player`, `game.entities` (array), `game.run` (Expedition), `game.hud`.
- Systems implement `update(dt)`; Game calls them in order: input → player → entities → combat → run → camera → hud → atmosphere → render.
- Events (string names): `player:hit`, `enemy:died`, `runes:changed`, `boss:start`, `boss:phase`, `boss:died`, `day:changed`, `ring:phase`, `grace:rest`, `levelup`, `loot:pickup`, `player:died`, `run:won`, `run:lost`.
- Materials: `MeshStandardMaterial` with `flatShading: true`, roughness ~0.9, metalness 0, plus vertex colours for terrain. Characters use a custom toon-ish gradient via `MeshToonMaterial` with a 3-step gradient map, or flat-shaded standard — keep consistent across all entities (Style.js decides).
- Humanoids have NO facial features. Heads are smooth capsules/spheres. Bodies are tapered boxes/capsules. Cloth via simple hanging quads with vertex sway.
- Colours: the palette lives in `Style.js` — every builder imports it. Never hardcode hex in other modules.
- Debug API is mandatory for critics: `window.__game.teleport`, `setTime`, `spawn`, `screenshotPose(name)` where names include `vista`, `combat`, `grace`, `ring`, `boss`, `hub`, `church`, `catacomb`.
- No external URLs. No fetch. No images. Fonts: system-ui / Georgia for HUD (no webfont loads).
