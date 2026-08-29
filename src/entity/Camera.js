/**
 * Third-person orbit camera: pointer-lock mouse orbit, smooth follow, terrain collision (pulls in),
 * lock-on framing (blends yaw toward the target and frames both), shake, and a slow orbit mode for the hub.
 * Convention: camera sits at pivot + (sin(yaw), ., cos(yaw)) * dist, so it looks along (-sin(yaw), -cos(yaw)).
 */
import * as THREE from 'three';

const _v = new THREE.Vector3(), _pivot = new THREE.Vector3(), _desired = new THREE.Vector3(), _look = new THREE.Vector3(), _off = new THREE.Vector3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class CameraController {
  constructor(game) {
    this.game = game; this.camera = game.camera;
    this.yaw = Math.PI; this.pitch = 0.3; this.dist = 5.6;
    this.mode = 'orbit';
    this.lockTarget = null;
    this.smoothPivot = new THREE.Vector3(); this.pos = new THREE.Vector3();
    this.initialized = false;
    this.shake = 0; this.shakeSeed = 0;
    this.lunge = 0; this.lungeT = 0; // contact lunge: a short push toward the pivot that springs back (addLunge)
    this.orbitCenter = new THREE.Vector3(); this.orbitR = 16; this.orbitT = 0;
    this.fov = 55;
    /** Over-the-shoulder framing: pivot slides this far to the camera's right (character sits left of centre). */
    this.shoulder = 0.28;
    /** Pose-only framing: extra lateral pivot shift (m, camera-right) and pivot height delta (m); reset by every setOrbit. */
    this.side = 0; this.lift = 0;
  }

  setOrbitMode(center, radius = 16) { this.mode = 'orbit'; this.orbitCenter.copy(center); this.orbitR = radius; this.lockTarget = null; }
  follow() { this.mode = 'follow'; this.initialized = false; }
  /** Set the orbit (screenshot poses / respawn). `side` / `lift` shift the framing for one composition and reset on the next call. */
  setOrbit(yaw, pitch, dist, side = 0, lift = 0) { this.yaw = yaw; this.pitch = pitch; if (dist) this.dist = dist; this.side = side; this.lift = lift; }
  addShake(a) { this.shake = Math.min(1, this.shake + a); }
  /** Push the camera `a` metres toward the pivot over ~0.2 s (the body driving a cut), springing back. */
  addLunge(a) { this.lunge = Math.max(this.lunge, a); this.lungeT = 0; }
  /** Horizontal forward direction of the camera (for camera-relative movement). */
  cameraForward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt) {
    const cam = this.camera, T = this.game.terrain;
    if (this.mode === 'orbit') {
      this.orbitT += dt * 0.06;
      const c = this.orbitCenter, r = this.orbitR;
      _v.set(c.x + Math.sin(this.orbitT) * r, c.y + r * 0.3, c.z + Math.cos(this.orbitT) * r);
      const h = T.getHeight(_v.x, _v.z) + 2.5;
      if (_v.y < h) _v.y = h;
      cam.position.copy(_v);
      _look.set(c.x, c.y + 4, c.z);
      cam.lookAt(_look);
      return;
    }
    const p = this.game.player;
    if (!p) return;
    const input = this.game.input;
    if (this.lockTarget && !this.lockTarget.alive) this.lockTarget = null;
    if (!this.lockTarget) {
      this.yaw -= input.dx * input.sensitivity;
      this.pitch = clamp(this.pitch + input.dy * input.sensitivity, -0.32, 1.15);
    } else {
      const t = this.lockTarget;
      const ty = Math.atan2(-(t.pos.x - p.pos.x), -(t.pos.z - p.pos.z));
      let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-5 * dt));
      this.pitch += (0.24 - this.pitch) * (1 - Math.exp(-3 * dt));
    }
    const sh = this.shoulder + this.side;
    _pivot.set(p.pos.x + Math.cos(this.yaw) * sh, p.pos.y + 1.5 + this.lift, p.pos.z - Math.sin(this.yaw) * sh);
    if (this.lockTarget) { const t = this.lockTarget; _v.set(t.pos.x, t.pos.y + 1.2 * t.scale, t.pos.z); _pivot.lerp(_v, 0.28); }
    if (!this.initialized) this.smoothPivot.copy(_pivot);
    else this.smoothPivot.lerp(_pivot, 1 - Math.exp(-11 * dt));

    const cp = Math.cos(this.pitch);
    _desired.set(this.smoothPivot.x + Math.sin(this.yaw) * cp * this.dist, this.smoothPivot.y + Math.sin(this.pitch) * this.dist, this.smoothPivot.z + Math.cos(this.yaw) * cp * this.dist);
    // terrain collision: march from the pivot outwards and stop before the ground
    let k = 1;
    for (let i = 1; i <= 10; i++) {
      const s = i / 10;
      _v.lerpVectors(this.smoothPivot, _desired, s);
      if (_v.y < T.getHeight(_v.x, _v.z) + 0.6) { k = Math.max(0.18, (i - 1) / 10); break; }
    }
    _v.lerpVectors(this.smoothPivot, _desired, k);
    const hh = T.getHeight(_v.x, _v.z) + 0.5;
    if (_v.y < hh) _v.y = hh;
    if (!this.initialized) { this.pos.copy(_v); this.initialized = true; }
    else this.pos.lerp(_v, 1 - Math.exp(-16 * dt));

    _off.set(0, 0, 0);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      const s = this.shake * this.shake * 0.22;
      this.shakeSeed += dt * 38;
      _off.set(Math.sin(this.shakeSeed * 1.3) * s, Math.cos(this.shakeSeed * 1.7) * s, Math.sin(this.shakeSeed * 0.9) * s * 0.5);
    }
    if (this.lunge > 0) {
      this.lungeT += dt;
      const k = this.lungeT / 0.22, e = k < 1 ? Math.sin(k * Math.PI) : 0; // in fast, out slower
      if (k >= 1) this.lunge = 0;
      _v.subVectors(this.smoothPivot, this.pos).normalize().multiplyScalar(this.lunge * e);
      _off.add(_v);
    }
    cam.position.copy(this.pos).add(_off);
    _look.copy(this.smoothPivot);
    cam.lookAt(_look);
    const fovT = p.sprinting ? 61 : 55;
    if (Math.abs(fovT - this.fov) > 0.05) { this.fov += (fovT - this.fov) * (1 - Math.exp(-5 * dt)); cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  /** Jump straight to the resolved position (screenshot poses, respawn). */
  snap() { this.initialized = false; this.shake = 0; this.update(1 / 60); }
}
