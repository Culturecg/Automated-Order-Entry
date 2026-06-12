import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

const _carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4, envMapIntensity: 0.85 });

// Moving NYC traffic. Cars drive down the avenues/streets in lanes. Behaviour
// vs. Spider-Man:
//   • if he's standing in front of a car (in its lane), it brakes and waits —
//     normal traffic flow.
//   • if he drops in right in front of a moving car with no time to stop, the
//     car stops AND clips him, launching him backward (knockback).
// Cars are varied shapes (sedan / SUV / taxi / van / sports) for a GTA feel.

const TYPES = ['sedan', 'suv', 'taxi', 'van', 'sports'];

export class Traffic {
  constructor(scene, city, count = 26) {
    this.scene = scene;
    this.city = city;
    this.cars = [];

    const pitch = city.blockSize + city.street;
    const start = -city.half + city.blockSize / 2;
    const lim = city.half - 4;
    // street centerlines between blocks
    const lines = [];
    for (let i = 0; i < city.blocks - 1; i++) lines.push(start + i * pitch + pitch / 2);
    this.lim = lim;

    const rng = mulberry32(7);
    for (let i = 0; i < count; i++) {
      const vertical = rng() > 0.5;              // drives along Z (true) or X
      const line = lines[(rng() * lines.length) | 0];
      const dir = rng() > 0.5 ? 1 : -1;
      const laneOff = dir * (city.street * 0.22); // keep to the right
      const type = TYPES[(rng() * TYPES.length) | 0];
      const car = makeCar(type, rng);

      const pos = new THREE.Vector3();
      const along = -lim + rng() * (2 * lim);
      if (vertical) pos.set(line + laneOff, 0, along);
      else pos.set(along, 0, line + laneOff);

      car.group.position.copy(pos);
      car.group.rotation.y = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      scene.add(car.group);

      this.cars.push({
        ...car, vertical, dir, line, laneOff,
        pos, speed: 8 + rng() * 8, maxSpeed: 12 + rng() * 10,
        frontClear: 99, stoppedFor: 0, hitCooldown: 0,
      });
    }
  }

  update(dt, player) {
    const p = player.pos;
    for (const car of this.cars) {
      const fwd = car.vertical
        ? new THREE.Vector3(0, 0, car.dir)
        : new THREE.Vector3(car.dir, 0, 0);

      // distance of the player ahead of the car (signed) and lateral offset
      const toP = new THREE.Vector3().subVectors(p, car.pos);
      const ahead = toP.dot(fwd);
      const lateral = car.vertical ? Math.abs(p.x - car.pos.x) : Math.abs(p.z - car.pos.z);
      const inLane = lateral < 2.4 && p.y < 3.0;

      // braking target
      let target = car.maxSpeed;
      if (inLane && ahead > 0 && ahead < 16) {
        target = THREE.MathUtils.clamp((ahead - 4) / 12, 0, 1) * car.maxSpeed;
      }
      // also brake for the car ahead in the same lane
      for (const o of this.cars) {
        if (o === car || o.vertical !== car.vertical || o.line !== car.line || o.dir !== car.dir) continue;
        const d = new THREE.Vector3().subVectors(o.pos, car.pos).dot(fwd);
        if (d > 0 && d < 9) target = Math.min(target, Math.max(0, (d - 5) / 4) * car.maxSpeed);
      }

      // ease speed toward target
      const accel = target > car.speed ? 9 : 26; // brakes harder than it accelerates
      car.speed += THREE.MathUtils.clamp(target - car.speed, -accel * dt, accel * dt);
      if (car.speed < 0) car.speed = 0;

      // ---- collision / knockback ----
      if (car.hitCooldown > 0) car.hitCooldown -= dt;
      const hitZone = inLane && ahead > -1.5 && ahead < 3.2;
      if (hitZone) {
        const suddenlyThere = player._justLandedTimer > 0 || player.state === 'air';
        if (suddenlyThere && car.speed > 4 && car.hitCooldown <= 0) {
          // clip him — launch backward along the car's travel + up
          const kb = fwd.clone().multiplyScalar(16).add(new THREE.Vector3(0, 11, 0));
          player.knockback(kb);
          car.speed = 0;
          car.hitCooldown = 1.2;
        } else {
          car.speed = 0; // he's established in front → just wait
        }
      }

      // integrate
      car.pos.addScaledVector(fwd, car.speed * dt);
      // wrap around the map edges
      const axisVal = car.vertical ? car.pos.z : car.pos.x;
      if (axisVal > this.lim) { if (car.vertical) car.pos.z = -this.lim; else car.pos.x = -this.lim; }
      if (axisVal < -this.lim) { if (car.vertical) car.pos.z = this.lim; else car.pos.x = this.lim; }

      // solid body: don't let Spidey run through a car. Push him out of the
      // footprint along the shallowest axis (knockback above handles real hits).
      if (p.y < 2.0 && car.hitCooldown <= 0) {
        const hw = (car.vertical ? car.halfWid : car.halfLen) + 0.55;
        const hl = (car.vertical ? car.halfLen : car.halfWid) + 0.55;
        const dxp = p.x - car.pos.x, dzp = p.z - car.pos.z;
        if (Math.abs(dxp) < hw && Math.abs(dzp) < hl) {
          const penX = hw - Math.abs(dxp), penZ = hl - Math.abs(dzp);
          if (penX < penZ) player.pos.x = car.pos.x + Math.sign(dxp || 1) * hw;
          else player.pos.z = car.pos.z + Math.sign(dzp || 1) * hl;
          if (inLane) car.speed = 0; // he's against it → wait
        }
      }

      car.group.position.copy(car.pos);
      // spin wheels
      const roll = car.speed * dt / 0.34;
      for (const w of car.wheels) w.rotation.x -= roll;
    }
  }
}

// ---- car prototypes --------------------------------------------------------

function makeCar(type, rng) {
  const palette = [0xb52630, 0x1d3f8c, 0x101216, 0xe8e8ea, 0x2a6e4f, 0x6d7079, 0x8a8d96, 0x394150];
  let color = palette[(rng() * palette.length) | 0];
  let L = 4.3, W = 1.9, H = 0.55, cabH = 0.5, cabLen = 2.0, cabOff = -0.2;
  if (type === 'taxi') { color = 0xf2b500; }
  if (type === 'suv') { L = 4.6; W = 2.0; H = 0.8; cabH = 0.7; cabLen = 2.4; }
  if (type === 'van') { L = 5.0; W = 2.0; H = 0.7; cabH = 1.0; cabLen = 3.2; cabOff = -0.3; }
  if (type === 'sports') { L = 4.2; W = 1.95; H = 0.45; cabH = 0.36; cabLen = 1.7; }

  const worn = new THREE.Color(color).multiplyScalar(0.82 + rng() * 0.12); // patina
  const GLASS = 0x12161c, TRIM = 0x202227, DIRT = 0x2a2620, PLATE = 0xe8e4cc;
  const LIGHT = 0xfff2c0, TAIL = 0x661414, WHEEL = 0x0c0c0e;

  const parts = [];
  const box = (w, h, d, col, x, y, z, rx) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.applyMatrix4(new THREE.Matrix4().makeRotationX(rx));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    paint(g, col); parts.push(g);
  };
  const cyl = (r, len, col, x, y, z) => {
    const g = new THREE.CylinderGeometry(r, r, len, 12);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    paint(g, col); parts.push(g);
  };
  function paint(g, hex) {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }

  box(W, H, L, worn.getHex(), 0, 0.45 + H / 2, 0);                       // body
  box(W * 0.86, cabH, cabLen, GLASS, 0, 0.45 + H + cabH / 2 - 0.02, cabOff); // cabin
  if (type === 'van' || type === 'suv') box(W * 0.9, 0.08, cabLen, worn.getHex(), 0, 0.45 + H + cabH, cabOff);
  if (type === 'taxi') box(0.5, 0.18, 0.25, 0xffe9a8, 0, 0.45 + H + cabH + 0.12, cabOff);
  box(W + 0.02, 0.18, L * 0.96, DIRT, 0, 0.45, 0);                      // rocker grime
  box(W * 0.96, 0.18, 0.18, TRIM, 0, 0.5, L / 2);                       // bumpers
  box(W * 0.96, 0.18, 0.18, TRIM, 0, 0.5, -L / 2);
  box(W * 0.5, 0.16, 0.05, TRIM, 0, 0.62, L / 2 + 0.01);               // grille
  box(0.34, 0.12, 0.03, PLATE, 0, 0.5, -L / 2 - 0.02);                  // plate
  for (const sx of [-1, 1]) {
    box(0.02, cabH * 0.6, cabLen * 0.8, GLASS, sx * W * 0.43, 0.45 + H + cabH * 0.55, cabOff); // side windows
    box(0.22, 0.16, 0.06, LIGHT, sx * W * 0.32, 0.55, L / 2);           // headlights
    box(0.22, 0.16, 0.06, TAIL, sx * W * 0.32, 0.55, -L / 2);           // taillights
  }
  const wx = W / 2 + 0.02, wz = L * 0.32;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) cyl(0.36, 0.26, WHEEL, sx * wx, 0.36, sz * wz);

  const mesh = new THREE.Mesh(mergeGeometries(parts, false), _carMat);
  mesh.castShadow = true;
  const group = new THREE.Group(); group.add(mesh);
  return { group, wheels: [], halfLen: L / 2, halfWid: W / 2 };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
