/**
 * Game: renderer/scene/camera, world construction, fixed-step loop with hit-stop time scale,
 * the HUB -> EXPEDITION -> RESULTS state machine, entity list and quality switch.
 * System order per step: input -> player -> entities -> combat -> run -> graces -> camera -> hud -> atmosphere -> render.
 */
import * as THREE from 'three';
import { Events } from './Events.js';
import { Input } from './Input.js';
import { Touch } from './Touch.js';
import { HubPreview } from '../hub/Preview.js';
import { Rng } from './Rng.js';
import { installDebug } from './Debug.js';
import { Atmosphere } from '../render/Atmosphere.js';
import { Postfx } from '../render/Postfx.js';
import { Terrain } from '../world/Terrain.js';
import { Limveld } from '../world/Limveld.js';
import { Props } from '../world/Props.js';
import { Colliders } from '../world/Colliders.js';
import { Player } from '../entity/Player.js';
import { CameraController } from '../entity/Camera.js';
import { Combat } from '../combat/Combat.js';
import { Expedition } from '../run/Expedition.js';
import { GraceSystem } from '../run/Grace.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { GameMap } from '../ui/Map.js';
import { NIGHTFARERS, getNightfarer } from '../nightfarers/index.js';

const STEP = 1 / 60;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.info.autoReset = false; // reset once per frame so totals include every post pass
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 1600);
    this.events = new Events();
    this.input = new Input(canvas);
    this.seed = 1337;
    this.rng = new Rng(this.seed);
    this.entities = [];
    this.player = null; this.run = null;
    this.state = 'BOOT';
    this.time = 0; this.hitStopT = 0; this.paused = false; this.posing = false;
    this.ready = false; this.quality = 'high';
    this.fps = 0; this._dts = new Float32Array(60); this._dti = 0; this.fpsCap = 0; this._last = 0; this._acc = 0; this._capAcc = 0;
    this.frameCount = 0;
  }

  start() {
    this.terrain = new Terrain(this, { seed: this.seed }); this.terrain.generate();
    this.limveld = new Limveld(this, this.terrain, this.rng.fork(1)); this.limveld.plan();
    this.terrain.build(); this.limveld.build();
    this.colliders = new Colliders(this.terrain);
    this.props = new Props(this, this.terrain, this.limveld, this.rng.fork(2)); this.props.build();
    this.atmosphere = new Atmosphere(this);
    this.postfx = new Postfx(this.renderer, this.scene, this.camera);
    this.graces = new GraceSystem(this, this.limveld);
    this.combat = new Combat(this);
    this.cameraCtl = new CameraController(this);
    this.hud = new HUD(this);
    this.menus = new Menus(this);
    this.map = new GameMap(this);
    this.touch = new Touch(this);
    this.hubPreview = new HubPreview(this); // roster figure in the hub
    installDebug(this);
    window.addEventListener('resize', () => this.resize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'EXPEDITION' && !this.menus.isOpen() && !this.posing) this.menus.openPause();
    };
    this.events.on('player:died', () => this.menus.showDeath());
    this.enterHub();
    requestAnimationFrame((t) => this.frame(t));
  }

  // -------------------------------------------------------------------------------------------- states

  enterHub() {
    this.state = 'HUB';
    this.clearRun();
    const c = this.limveld.poi('church', 0);
    this.cameraCtl.setOrbitMode(new THREE.Vector3(c.x, c.y, c.z), 34);
    this.hud.setVisible(false); this.hud.hideTitle();
    this.input.wantLock = false; this.input.exitLock();
    this.menus.openHub(NIGHTFARERS, (nf) => this.startExpedition(nf.id));
  }

  startExpedition(nfId) {
    const nf = getNightfarer(nfId);
    this.menus.closeAll();
    this.hubPreview.hide();
    this.clearRun();
    this.state = 'EXPEDITION';
    this.player = new Player(this, nf);
    this.addEntity(this.player);
    this.run = new Expedition(this, nf);
    this.run.start();
    this.hud.setVisible(true);
    this.hud.showControlsHint(10);
    this.input.wantLock = true;
    this.events.emit('run:start', nf);
  }

  endExpedition(result) {
    if (this.state !== 'EXPEDITION') return;
    const stats = this.run.results(result);
    this.state = 'RESULTS';
    this.input.wantLock = false; this.input.exitLock();
    this.hud.setVisible(false);
    this.cameraCtl.lockTarget = null;
    this.menus.showResults(stats, () => this.enterHub());
  }

  clearRun() {
    for (const e of this.entities) e.dispose();
    this.entities.length = 0;
    this.player = null;
    if (this.run) { this.run.dispose(); this.run = null; }
    this.combat.reset();
    this.cameraCtl.lockTarget = null;
    this.paused = false; this.posing = false;
    if (this.map.isOpen) this.map.close();
  }

  addEntity(e) { this.entities.push(e); this.scene.add(e.object3d); }

  requestHitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); }

  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high';
    this.postfx.enabled = this.quality === 'high';
    this.atmosphere.setQuality(this.quality);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
  }

  // -------------------------------------------------------------------------------------------- loop

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (!this._last) this._last = now;
    let real = (now - this._last) / 1000;
    if (this.fpsCap > 0) { this._capAcc += real; if (this._capAcc < 1 / this.fpsCap) { this._last = now; return; } real = this._capAcc; this._capAcc = 0; }
    this._last = now;
    this._dts[this._dti] = real; this._dti = (this._dti + 1) % 60;
    let sum = 0; for (let i = 0; i < 60; i++) sum += this._dts[i];
    this.fps = sum > 0 ? 60 / sum : 0;
    const dt = Math.min(real, 1 / 30);
    this._acc += dt;
    let steps = 0;
    if (this.manualSim) this._acc = 0; // tests drive the sim through __game.advance()
    while (this._acc >= STEP && steps < 2) { this.update(STEP); this._acc -= STEP; steps++; }
    if (this._acc > STEP) this._acc = 0;
    this.render();
    this.frameCount++;
    this.ready = true;
  }

  update(step) {
    let ts = 1;
    if (this.hitStopT > 0) { this.hitStopT -= step; ts = 0.12; }
    const dt = step * ts;
    const input = this.input;
    input.update();
    if (input.wasPressed('pause')) this.menus.togglePause();
    if (input.wasPressed('map')) this.map.toggle();
    if (input.wasPressed('inventory')) this.menus.toggleInventory();
    const sim = this.state === 'EXPEDITION' && !this.paused && !this.posing;
    if (sim) {
      this.time += dt;
      const ents = this.entities;
      this.player.update(dt);
      for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (e !== this.player) e.update(dt); }
      for (let i = ents.length - 1; i >= 0; i--) { const e = ents[i]; if (e.remove) { e.dispose(); ents[i] = ents[ents.length - 1]; ents.pop(); } }
      this.combat.update(dt);
      this.run.update(dt);
      this.graces.update(dt);
    } else if (this.state === 'HUB') {
      this.time += dt;
      this.graces.update(dt);
    }
    this.cameraCtl.update(dt);
    if (this.state === 'HUB') this.hubPreview.update(dt);
    this.hud.update(dt);
    this.atmosphere.update(dt);
    this.postfx.update(dt);
    this.terrain.update(this.camera.position);
    this.map.update(dt);
    if (this.touch) this.touch.update();
    input.endFrame();
  }

  render() { this.renderer.info.reset(); this.postfx.render(); }
}
