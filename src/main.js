import * as THREE from 'three';
import { City } from './City.js';
import { Player } from './Player.js';
import { CameraController } from './CameraController.js';
import { createInput } from './input.js';

// ---- bootstrap -------------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4d4);          // hazy NYC daylight
scene.fog = new THREE.Fog(0x9fb4d4, 220, 700);

const camera = new THREE.PerspectiveCamera(
  68, window.innerWidth / window.innerHeight, 0.1, 2000
);
camera.position.set(0, 20, 20);

// ---- lighting --------------------------------------------------------------

const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x40404a, 0.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
sun.position.set(120, 260, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 800;
const sc = 260;
sun.shadow.camera.left = -sc;
sun.shadow.camera.right = sc;
sun.shadow.camera.top = sc;
sun.shadow.camera.bottom = -sc;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ---- world + actors --------------------------------------------------------

const city = new City(scene);
const cameraCtrl = new CameraController(camera, city);
const player = new Player(scene, city, cameraCtrl);
const input = createInput(canvas);

player.pos.set(0, 40, 0); // drop into the central plaza

// keep the sun following the player so shadows stay crisp around them
function repositionSun() {
  sun.position.set(player.pos.x + 120, 260, player.pos.z + 80);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();
}
scene.add(sun.target);

// ---- HUD refs --------------------------------------------------------------

const speedEl = document.getElementById('speed-value');
const stateEl = document.getElementById('state-value');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const controlsPanel = document.getElementById('controls');

startBtn.addEventListener('click', () => {
  startOverlay.classList.add('hidden');
  canvas.requestPointerLock();
});
// fade controls hint once playing
let played = false;

// ---- resize ----------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- main loop -------------------------------------------------------------

const clock = new THREE.Clock();
const STATE_LABELS = {
  ground: 'GROUNDED', air: 'AIRBORNE', swing: 'WEB-SWING', wall: 'WALL-CRAWL',
};

function frame() {
  const dt = clock.getDelta();

  // mouse-look
  const { dx, dy } = input.consumeMouse();
  cameraCtrl.handleMouse(dx, dy);
  input.pollKeyboardEdges();

  // camera-distance toggle (C) — simple edge detect
  if (input.down('KeyC') && !frame._cPrev) cameraCtrl.cyclePreset();
  frame._cPrev = input.down('KeyC');

  // respawn
  if (input.down('KeyR') && !frame._rPrev) player.respawn();
  frame._rPrev = input.down('KeyR');

  player.update(dt, input);
  cameraCtrl.update(dt, player.pos);
  repositionSun();

  // HUD
  speedEl.textContent = player.speedMph;
  stateEl.textContent = STATE_LABELS[player.state] || player.state.toUpperCase();

  if (!played && input.locked) {
    played = true;
    controlsPanel.style.opacity = '0.25';
  }

  input.endFrame();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
