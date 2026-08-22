/**
 * Deterministic `ring` screenshot composition (night ring piece), called from core/Debug.js.
 * The player stands on the grassy overlook crest facing north along the contour, the wall of the night a dozen
 * metres ahead where the ground falls away (so the fire rises from below the crest and the camera behind sits on
 * level turf); the camera is low, looking slightly up, so the grass is silhouetted against the blue fire and the
 * veil runs off the top of the frame with the hero tree's branches framing it. The ring is held mid-shrink so the
 * HUD shows the closing-in countdown and the proximity warning.
 * RING_POSE is exported (not frozen) so a capture script can tune the composition without editing this file.
 */
export const RING_POSE = { px: 146, pz: 208, tx: 146, tz: 240, wall: 12, R: 150, pitch: -0.06, dist: 8.5, yaw: -0.25, side: 1.2, lift: 0, time: 3.7, hold: 42 };

export function composeRingPose(game, { place, finish }) {
  const P = RING_POSE, ring = game.run.ring;
  place(P.px, P.pz, P.tx, P.tz, { pitch: P.pitch, dist: P.dist, yawOffset: P.yaw });
  const cam = game.cameraCtl;
  cam.setOrbit(cam.yaw, cam.pitch, cam.dist, P.side, P.lift); // pose-only lateral shift: the player sits left of centre, the wall fills the right
  const dx = P.tx - P.px, dz = P.tz - P.pz, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
  ring.setImmediate({ x: P.px + ux * (P.wall - P.R), z: P.pz + uz * (P.wall - P.R) }, P.R);
  ring.holdShrink(P.hold, 60);
  ring.time = P.time; // fixed flame frame so captures are repeatable
  ring.update(0.5);
  finish();
  if (game.hud && game.hud.update) game.hud.update(0.016);
}
