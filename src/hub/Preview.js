/**
 * Roundtable Hold roster preview: the selected Nightfarer's dressed rig (nightfarers/Rig.js), standing in its
 * presentation pose, held in front of the slowly orbiting hub camera. Placement is in camera space so it stays
 * framed while the background drifts: above the roster sheet in portrait, beside the panel in landscape.
 * Rigs are built once per class and kept for the session.
 */
import * as THREE from 'three';
import { createNightfarerRig } from '../nightfarers/Rig.js';

const _v = new THREE.Vector3();
const DEG = Math.PI / 180;

export class HubPreview {
  constructor(game) {
    this.game = game;
    this.rig = null; this.id = null;
    this.cache = new Map();
  }

  /** Show `nf` (roster entry). Idempotent for the current selection. */
  show(nf) {
    if (!nf || this.id === nf.id) return;
    this.hide();
    let rig = this.cache.get(nf.id);
    if (!rig) { rig = createNightfarerRig(nf); this.cache.set(nf.id, rig); }
    this.rig = rig; this.id = nf.id;
    this.game.scene.add(rig.root);
    rig.animator.play(rig.presentClip, { restart: true, rate: 10 });
    this.update(0);
  }

  hide() {
    if (!this.rig) return;
    this.game.scene.remove(this.rig.root);
    this.rig = null; this.id = null;
  }

  update(dt) {
    const rig = this.rig;
    if (!rig) return;
    const cam = this.game.camera;
    cam.updateMatrixWorld();
    const portrait = cam.aspect < 1;
    const d = portrait ? 6.2 : 5.6, H = d * Math.tan(cam.fov * 0.5 * DEG); // half view height at the figure
    // portrait: feet just above the roster sheet (~52% down), figure in the top half; landscape: right of the panel
    const ox = portrait ? 0 : 0.37 * 2 * H * cam.aspect, oy = portrait ? -0.1 : -1.0;
    _v.set(ox, oy, -d).applyMatrix4(cam.matrixWorld);
    rig.root.position.copy(_v);
    rig.root.rotation.y = Math.atan2(cam.position.x - _v.x, cam.position.z - _v.z) - 0.35; // three-quarter view
    rig.update(dt);
  }
}
