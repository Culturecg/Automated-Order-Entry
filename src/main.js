import * as THREE from 'three';
import { City } from './City.js';
import { Player } from './Player.js';
import { CameraController } from './CameraController.js';
import { createInput } from './input.js';
import { isTouchDevice, setupTouchControls } from './touch.js';
import { Traffic } from './Traffic.js';
import { Crowd } from './Crowd.js';
import { setupPostFX } from './postfx.js';

// ---- bootstrap -------------------------------------------------------------

// Quality tiers. Phones default to a much lighter 'mobile' tier so it stays
// smooth; ?fx=high forces full, ?fx=low / ?fx=off strip effects further.
const FXPARAM = new URLSearchParams(location.search).get('fx');
const TOUCH0 = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const QUALITY = FXPARAM === 'high' ? 'high'
  : FXPARAM === 'low' || FXPARAM === 'off' ? 'low'
  : TOUCH0 ? 'mobile' : 'high';
const LOWFX = QUALITY === 'low';
const FXOFF = FXPARAM === 'off';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(QUALITY === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = QUALITY === 'high';   // shadows are the heaviest cost
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

// Gradient sky used both as the backdrop AND as image-based lighting, so every
// surface picks up soft sky/ground bounce — the biggest realism win available
// without external HDRIs.
const sky = makeSkyEnv(renderer);
scene.background = sky.raw;        // equirect gradient renders as the sky dome
scene.environment = sky.texture;   // prefiltered map drives reflections/ambient
scene.fog = new THREE.Fog(0xb9c6d8, 260, 760);

function makeSkyEnv(renderer) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#3f6fb5');   // zenith
  g.addColorStop(0.45, '#88a6cc');
  g.addColorStop(0.62, '#cdd6e0');  // hazy horizon
  g.addColorStop(0.65, '#c9cdd2');
  g.addColorStop(1.0, '#6b6f78');   // ground bounce
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // prefilter into a proper environment map for clean reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  return { texture: envRT.texture, raw: tex };
}

const camera = new THREE.PerspectiveCamera(
  68, window.innerWidth / window.innerHeight, 0.1, 2000
);
camera.position.set(0, 20, 20);

// ---- lighting --------------------------------------------------------------

const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6a6f7a, 1.3);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
sun.position.set(120, 260, 80);
sun.castShadow = QUALITY === 'high';
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

// lighter world on phones: smaller map, fewer cars & people = fewer draw calls
const city = new City(scene, { blocks: QUALITY === 'high' ? 16 : 12 });
const cameraCtrl = new CameraController(camera, city);
const player = new Player(scene, city, cameraCtrl);
// ~3x denser now that people & cars are single-mesh (cheap) entities
const traffic = new Traffic(scene, city, QUALITY === 'high' ? 80 : 42);
const crowd = new Crowd(scene, city, player, QUALITY === 'high' ? 110 : 56);
player.crowd = crowd;            // enables web-bind + melee
const input = createInput(canvas);

const TOUCH = isTouchDevice();
if (TOUCH) setupTouchControls(input);

player.pos.set(0, 40, 0); // drop into the central plaza
window.__game = { player, cameraCtrl, city, traffic, crowd, input }; // debug/automation handle

// keep the sun following the player so shadows stay crisp around them
function repositionSun() {
  sun.position.set(player.pos.x + 120, 260, player.pos.z + 80);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();
}
scene.add(sun.target);

// ---- cinematic post-processing (bloom / grade / vignette / FXAA) ----------
// On by default; ?fx=low (or ?fx=off) skips it so low-end phones stay smooth.
const postfx = (LOWFX || FXOFF) ? null : setupPostFX(renderer, scene, camera, QUALITY);

// ---- HUD refs --------------------------------------------------------------

const speedEl = document.getElementById('speed-value');
const stateEl = document.getElementById('state-value');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const controlsPanel = document.getElementById('controls');
const healthFill = document.getElementById('health-fill');
const senseEl = document.getElementById('spider-sense');
const senseArrow = document.getElementById('sense-arrow');
const senseLabel = document.getElementById('sense-label');
const vignette = document.getElementById('sense-vignette');
const objectiveEl = document.getElementById('objective');
const bossBar = document.getElementById('boss-bar');
const bossFill = document.getElementById('boss-fill');
const _proj = new THREE.Vector3();

function updateCombatHud() {
  healthFill.style.width = player.health + '%';
  healthFill.style.background = player.health < 30 ? '#e62429' : (player.health < 60 ? '#e6a029' : '#3ad06a');

  const sense = crowd.spiderSense();
  if (sense) {
    senseEl.style.display = 'block';
    vignette.style.opacity = sense.role === 'boss' ? '1' : '0.7';
    _proj.copy(sense.pos); _proj.project(camera);
    let x = _proj.x, y = _proj.y;
    if (_proj.z > 1) { x = -x; y = -y; }      // target behind camera
    const ang = Math.atan2(y, x);
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const rad = Math.min(window.innerWidth, window.innerHeight) * 0.3;
    senseArrow.style.left = (cx + Math.cos(ang) * rad) + 'px';
    senseArrow.style.top = (cy - Math.sin(ang) * rad) + 'px';
    senseArrow.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    const d = Math.round(player.pos.distanceTo(sense.pos));
    senseLabel.textContent = sense.role === 'boss' ? '⚠ GREEN GOBLIN'
      : sense.state === 'flee' ? `CHASE HIM · ${d}m`
      : (sense.state === 'rob' || sense.state === 'approach') ? `ROBBERY! · ${d}m`
      : `THREAT · ${d}m`;
  } else {
    senseEl.style.display = 'none';
    vignette.style.opacity = '0';
  }

  const st = crowd.status();
  if (st.boss) {
    objectiveEl.textContent = 'DEFEAT THE GREEN GOBLIN';
    bossBar.style.display = 'block';
    bossFill.style.width = Math.max(0, st.boss.hp / st.boss.maxhp * 100) + '%';
  } else if (st.bossDefeated) {
    objectiveEl.textContent = 'CITY SAVED ✓';
    bossBar.style.display = 'none';
  } else {
    objectiveEl.textContent = `Stop crime — ${st.neutralized}/15 to draw out the boss`;
    bossBar.style.display = 'none';
  }
}

startBtn.addEventListener('click', () => {
  startOverlay.classList.add('hidden');
  if (!TOUCH) canvas.requestPointerLock(); // iOS has no pointer lock
});
// fade controls hint once playing
let played = false;

// ---- resize ----------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (postfx) postfx.setSize(window.innerWidth, window.innerHeight);
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
  traffic.update(dt, player);
  crowd.update(dt);

  // auto-recenter the camera behind Spidey
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  let follow = null;
  if (player.state === 'swing') {
    // snap quickly to right behind him, looking the way he's flying
    const heading = hSpeed > 1 ? Math.atan2(player.vel.x, player.vel.z) : player.facing;
    follow = { heading, rate: 6, lock: 0.25, pitch: 0.18, pitchRate: 2.5 };
  } else if (player.state === 'ground' && hSpeed > 2) {
    follow = { heading: player.facing, rate: 1.0 + Math.min(1, hSpeed / 20) * 1.6 };
  }
  cameraCtrl.update(dt, player.pos, follow);
  repositionSun();

  // HUD
  speedEl.textContent = player.speedMph;
  stateEl.textContent = STATE_LABELS[player.state] || player.state.toUpperCase();
  updateCombatHud();

  if (!played && input.locked) {
    played = true;
    controlsPanel.style.opacity = '0.25';
  }

  input.endFrame();
  if (postfx) postfx.render(dt); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
