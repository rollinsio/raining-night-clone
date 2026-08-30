/**
 * window.__game debug API (mandatory for critics / the screenshot tool):
 * teleport, setTime, spawn, killAll, setFps, screenshotPose(name), fps, ready, setQuality, startExpedition, resume,
 * giveWeapon(id, rarity) / equip(i) / swapWeapon() (inventory).
 * Poses are deterministic compositions; the sim is frozen afterwards (call resume() to continue).
 */
import * as THREE from 'three';
import { composeCombatPose } from '../combat/Pose.js';
import { HERO_SPEED } from '../entity/Humanoid.js';
import { composeBossPose } from '../entity/bosses/Pose.js';
import { composeRingPose } from '../run/Pose.js';
import { composeChurchPose, composeFortPose, composeRuinPose } from '../world/Pose.js';
import { makeWeapon } from '../run/Loot.js';

const _v = new THREE.Vector3();

export function installDebug(game) {
  const ensureRun = () => {
    if (game.state !== 'EXPEDITION') game.startExpedition('Wylder');
    game.hud.hideTitle(); game.hud.hideHint();
  };

  /** Place the player at (x,z) facing (tx,tz); camera behind looking the same way (+ yawOffset). */
  const place = (x, z, tx, tz, { pitch = 0.18, dist = 5.6, yawOffset = 0, clip = 'idle' } = {}) => {
    const p = game.player;
    p.teleport(x, z);
    p.yaw = Math.atan2(tx - x, tz - z);
    p.setState('idle'); p.attack.phase = 'none'; p.sprinting = false; p.speed = 0;
    p.anim.play(clip, { restart: true });
    const dx = tx - x, dz = tz - z;
    const cam = game.cameraCtl;
    cam.lockTarget = null;
    cam.setOrbit(Math.atan2(-dx, -dz) + yawOffset, pitch, dist);
    cam.snap();
  };
  const freezeAll = () => { for (const e of game.entities) { e.frozen = true; if (e.anim) e.anim.settle(40); } };
  const unfreezeAll = () => { for (const e of game.entities) e.frozen = false; };
  const finish = () => {
    freezeAll();
    game.cameraCtl.snap();
    game.atmosphere.update(0);
    game.posing = true;
  };
  const spawnAt = (type, x, z, faceX, faceZ, clip = 'alert') => {
    const e = game.run.spawnDebug(type);
    e.teleport(x, z); e.yaw = Math.atan2(faceX - x, faceZ - z);
    e.setAggro(); e.setState('chase'); e.anim.play(clip, { restart: true });
    return e;
  };

  const poses = {
    vista() {
      ensureRun(); unfreezeAll(); game.posing = false;
      // high ground south-east of the lake, looking across the water toward the moon
      place(150, 210, -42, -21, { pitch: -0.02, dist: 8, yawOffset: 0.32 });
      finish();
    },
    combat() {
      ensureRun(); unfreezeAll(); game.posing = false;
      composeCombatPose(game, { place, finish }); // composition lives in src/combat/Pose.js
    },
    grace() {
      ensureRun(); unfreezeAll(); game.posing = false;
      const g = game.graces.sites[7];
      // low camera behind the kneeling player, beam rising in front; refresh the warm light + prompt
      place(g.x + 1.1, g.z - 2.6, g.x, g.z, { pitch: -0.08, dist: 5.0, yawOffset: 0.12, clip: 'rest' });
      game.graces.update(0);
      finish();
    },
    ring() {
      ensureRun(); unfreezeAll(); game.posing = false;
      composeRingPose(game, { place, finish }); // composition lives in src/run/Pose.js
    },
    boss() {
      ensureRun(); unfreezeAll(); game.posing = false;
      composeBossPose(game, { place, finish }); // composition lives in src/entity/bosses/Pose.js
    },
    church() {
      ensureRun(); unfreezeAll(); game.posing = false;
      composeChurchPose(game, { place, finish }); // composition lives in src/world/Pose.js
    },
    catacomb() {
      ensureRun(); unfreezeAll(); game.posing = false;
      const c = game.limveld.poi('catacomb');
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      place(c.x + fx * 12 + fz * 2, c.z + fz * 12 - fx * 2, c.x, c.z, { pitch: 0.08, dist: 5.5, yawOffset: 0.3 });
      finish();
    },
    hub() {
      game.posing = false; unfreezeAll();
      game.enterHub();
    },
    /** Close rear three-quarter of the player mid-run (character piece). */
    character() {
      ensureRun(); unfreezeAll(); game.posing = false;
      game.player.anim.ctx.speed = HERO_SPEED; // sprint cadence: the rig's hero frame (knee drive, trailing toe-off) lands on the settle
      place(150, 205, 150, 150, { pitch: 0.14, dist: 3.1, yawOffset: 0.95, clip: 'run' });
      const cam = game.cameraCtl; cam.setOrbit(cam.yaw, cam.pitch, cam.dist, -0.55, -0.55); // hero right of centre under the moon, clear of both HUD clusters
      finish();
    },
    /** Gameplay with the full HUD: boss bar, lock-on, damaged bars, runes (hud piece). */
    hud() {
      poses.boss();
      game.hud.hideTitle(); // mid-fight: the reveal has already passed, the small name + bar remain
      const p = game.player, b = game.run.boss;
      p.hp = Math.round(p.maxHp * 0.55); p.stamina = Math.round(p.maxStamina * 0.4);
      if (p.maxFp) p.fp = Math.round(p.maxFp * 0.7);
      p.runes = 4820;
      if (typeof p.flasks !== 'number') p.flasks = 3; // flask count on the item slot (Player owns the real counter)
      if (b) {
        b.hp = Math.round(b.maxHp * 0.64); // damaged boss so the pale trail shows behind the fill
        p.setLock(b);                       // true lock-on: reticle + lock framing (camera snapped to the lock yaw/pitch)
        const cam = game.cameraCtl;
        // near-level camera: less floor, the boss and its raised halberd fill the upper half of the frame
        cam.yaw = Math.atan2(-(b.pos.x - p.pos.x), -(b.pos.z - p.pos.z)) + 0.12; cam.pitch = -0.02; cam.dist = 6.4; cam.snap();
      }
      game.events.emit('runes:changed', p.runes);
      if (game.hud && game.hud.settleTrails) game.hud.settleTrails(0.1); // short trails, as a beat after a hit
      if (game.hud && game.hud.update) game.hud.update(0.016);
    },
    /** The fort on the hill from outside its walls (architecture piece). */
    fort() {
      ensureRun(); unfreezeAll(); game.posing = false;
      composeFortPose(game, { place, finish }); // composition lives in src/world/Pose.js
    },
    /** Lakeside ruins (architecture piece). */
    ruin() {
      ensureRun(); unfreezeAll(); game.posing = false;
      composeRuinPose(game, { place, finish }); // composition lives in src/world/Pose.js
    },
    /** Night-3 Nightlord encounter (nightlord piece) — currently shares the boss pose. */
    nightlord() { poses.boss(); },
    /** All Nightfarers lined up in the hub (nightfarers piece) — currently the hub scene. */
    roster() { poses.hub(); },
    /** Shifting Earth biome (shifting piece) — currently the vista until the event exists. */
    shifting() { poses.vista(); },
  };

  const api = {
    get game() { return game; },
    get fps() { return game.fps; },
    get ready() { return game.ready; },
    get state() { return game.state; },
    get frameCount() { return game.frameCount; },
    get poses() { return Object.keys(poses); },
    teleport(x, z) { ensureRun(); game.player.teleport(x, z); game.cameraCtl.snap(); },
    setTime(day, t01 = 0) { ensureRun(); game.run.setTime(day, t01); game.atmosphere.setTime(day, t01); },
    spawn(type = 'soldier') { ensureRun(); return game.run.spawnDebug(type); },
    killAll() { for (const e of game.entities) if (e !== game.player && e.alive) e.die(null); },
    /** Put a weapon in the player's inventory as a pickup would (held if it is an upgrade). Returns the weapon. */
    giveWeapon(id = 'sword', rarity = 'common') { ensureRun(); const w = makeWeapon(id, rarity); game.player.pickupWeapon(w); return w; },
    equip(i) { ensureRun(); const p = game.player, w = p.inventory.equip(i); if (w) p.equipWeapon(w); return w; },
    swapWeapon() { ensureRun(); return game.player.swapWeapon(1); },
    setFps(n) { game.fpsCap = n > 0 ? n : 0; },
    setQuality(q) { game.setQuality(q); },
    startExpedition(nf = 'Wylder') { game.startExpedition(nf); },
    screenshotPose(name) { const f = poses[name]; if (!f) throw new Error('unknown pose ' + name + ' (' + Object.keys(poses).join(', ') + ')'); f(); return name; },
    resume() { game.posing = false; unfreezeAll(); },
    /** When true the frame loop only renders; advance() is the sole sim driver (deterministic tests). */
    setManual(on = true) { game.manualSim = !!on; },
    /** Step the simulation synchronously (deterministic tests): n fixed 1/60 s updates, no rendering. */
    advance(seconds = 1) { const n = Math.max(1, Math.round(seconds * 60)); for (let i = 0; i < n; i++) game.update(1 / 60); return game.time; },
  };
  window.__game = api;
  return api;
}
