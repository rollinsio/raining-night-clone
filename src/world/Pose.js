/**
 * Screenshot compositions for the architecture piece (church / fort / ruin poses). Each puts the player on
 * the approach BETWEEN the Site of Grace and the building (so the grace beam stays out of frame), with a low
 * camera in a 3/4 view so one elevation is moonlit and the other in shadow, and fogged terrain behind.
 * Called by core/Debug.js with its `place` / `finish` helpers.
 */

/** POI-local (lx, lz) -> world (x, z), matching Limveld.build's kit placement. */
const local = (p, lx, lz) => ({ x: p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), z: p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw) });

/**
 * Debug.ensureRun() cuts the day title with `transition: none` and restores the transition on the next
 * animation frame; without a style flush in between the browser can still animate the fade, which leaves
 * a ghost "DAY I" card in a capture taken 0.5 s later. Reading layout forces the flush.
 */
function settleHud(game) {
  const el = game.hud && game.hud.el;
  if (!el) return;
  for (const k of ['title', 'reveal', 'bossName']) if (el[k]) void el[k].offsetHeight;
}

/** Church of Limveld from the front-right: player on the grass by the walled graveyard, porch and gable moonlit, breached side wall and buttresses in shadow, tower behind. */
export function composeChurchPose(game, { place, finish }) {
  settleHud(game);
  const c = game.limveld.poi('church', 0);
  const P = local(c, 12.8, 11.8), T = local(c, -2.5, -5.0);
  place(P.x, P.z, T.x, T.z, { pitch: -0.035, dist: 7.4, yawOffset: 0.14 });
  const cam = game.cameraCtl; cam.setOrbit(cam.yaw, cam.pitch, cam.dist, 0.9, 0.4);
  finish();
}

/** Fort of the Hill from the east flank of the approach, below the plateau: gatehouse, curtain and corner tower climbing against the sky (the grace stays behind the camera's left shoulder). */
export function composeFortPose(game, { place, finish }) {
  settleHud(game);
  const c = game.limveld.poi('fort', 0) || game.limveld.poi('church', 0);
  const P = local(c, 12, 40), T = local(c, -2, 22);
  place(P.x, P.z, T.x, T.z, { pitch: -0.06, dist: 8.5, yawOffset: 0.18 });
  const cam = game.cameraCtl; cam.setOrbit(cam.yaw, cam.pitch, cam.dist, 0.6, 0.5);
  finish();
}

/** Lakeside Ruins from the high ground above their stairs: the whole roofless abbey (gable with its great lancet, arcade, columns, tower stub, brazier glow) on its promontory against the misty basin; the grace stays just outside the left edge. */
export function composeRuinPose(game, { place, finish }) {
  settleHud(game);
  const c = game.limveld.poi('ruin', 0) || game.limveld.poi('church', 0);
  const P = local(c, 8, 18.5), T = local(c, -1, -6);
  place(P.x, P.z, T.x, T.z, { pitch: 0.1, dist: 8.5, yawOffset: 0.02 });
  const cam = game.cameraCtl; cam.setOrbit(cam.yaw, cam.pitch, cam.dist, 0.8, 0.4);
  finish();
}
