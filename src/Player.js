import * as THREE from 'three';
import { createSpiderMan } from './SpiderModel.js';

// Spider-Man's character controller. Owns position/velocity, runs the movement
// & traversal state machine (ground / air / swing / wall), and drives the model
// pose + orientation. Collision is delegated to City. Webs are rendered as
// visible cords; released strands stay anchored and drape with rope physics.

const GRAVITY = -38;
const MOVE_ACCEL = 60;
const MAX_RUN = 14;
const MAX_SPRINT = 22;
const JUMP_VELOCITY = 16;
const AIR_CONTROL = 0.35;
const RADIUS = 0.6;            // collision sphere radius
const WEB_RANGE = 140;
const SWING_PUMP = 26;         // forward force while swinging (web-swing "pump")
const CLIMB_SPEED = 9;
const WEB_LIFE = 20;           // seconds a released strand lingers
const WEB_FADE = 14;           // when it starts fading

const sharedWebGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 5);
const UP = new THREE.Vector3(0, 1, 0);

// A released web strand: verlet rope pinned at the anchor, free end falls and
// sways naturally, drapes on the ground, fades away after WEB_LIFE seconds.
class WebStrand {
  constructor(scene, anchor, end, vel) {
    this.scene = scene;
    this.life = 0;
    const N = 10;
    this.nodes = [];
    this.prev = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const p = anchor.clone().lerp(end, t);
      this.nodes.push(p.clone());
      // free end inherits a bit of the player's velocity → natural whip
      this.prev.push(p.clone().addScaledVector(vel, -0.016 * t));
    }
    this.segLen = anchor.distanceTo(end) / (N - 1);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xf5f5ff, transparent: true, opacity: 0.95 });
    this.meshes = [];
    for (let i = 0; i < N - 1; i++) {
      const m = new THREE.Mesh(sharedWebGeo, this.mat);
      scene.add(m);
      this.meshes.push(m);
    }
  }

  // returns false when the strand has expired
  update(dt) {
    this.life += dt;
    if (this.life > WEB_LIFE) return false;

    // verlet integration on the free nodes (node 0 stays pinned)
    const damp = 0.985;
    for (let i = 1; i < this.nodes.length; i++) {
      const p = this.nodes[i], q = this.prev[i];
      const vx = (p.x - q.x) * damp;
      const vy = (p.y - q.y) * damp;
      const vz = (p.z - q.z) * damp;
      q.copy(p);
      p.x += vx;
      p.y += vy + 0.55 * GRAVITY * dt * dt; // light webbing falls gently
      p.z += vz;
      if (p.y < 0.05) p.y = 0.05;           // drape on the street
    }
    // distance constraints to keep segment lengths
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.nodes.length - 1; i++) {
        const a = this.nodes[i], b = this.nodes[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - this.segLen) / d;
        if (i === 0) { // anchor pinned: move only b
          b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff;
        } else {
          const half = diff * 0.5;
          a.x += dx * half; a.y += dy * half; a.z += dz * half;
          b.x -= dx * half; b.y -= dy * half; b.z -= dz * half;
        }
      }
    }

    if (this.life > WEB_FADE) {
      this.mat.opacity = 0.95 * (1 - (this.life - WEB_FADE) / (WEB_LIFE - WEB_FADE));
    }

    // place a cylinder along each segment
    for (let i = 0; i < this.meshes.length; i++) {
      orientSegment(this.meshes[i], this.nodes[i], this.nodes[i + 1]);
    }
    return true;
  }

  dispose() {
    for (const m of this.meshes) this.scene.remove(m);
    this.mat.dispose();
  }
}

function orientSegment(mesh, a, b) {
  const len = a.distanceTo(b);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, Math.max(len, 0.001), 1);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  mesh.quaternion.setFromUnitVectors(UP, dir);
}

export class Player {
  constructor(scene, city, camera) {
    this.scene = scene;
    this.city = city;
    this.cameraCtrl = camera;

    this.pos = new THREE.Vector3(0, 2, 0);
    this.vel = new THREE.Vector3();
    this.facing = 0;          // yaw the model faces
    this.state = 'air';       // 'ground' | 'air' | 'swing' | 'wall'

    // web-swing data
    this.anchor = null;       // THREE.Vector3 anchor point
    this.ropeLength = 0;
    this.wallNormal = null;
    this._wallLost = 0;       // seconds without wall contact while climbing
    this.strands = [];        // released WebStrand instances
    this._onGround = false;
    this._landTimer = 0;      // brief crouch-landing pose
    this._justLandedTimer = 0; // for traffic "no time to react" knockback
    this._perchTimer = 0;     // time stood still on a rooftop
    // combo melee: tap repeatedly to chain a 3-hit string
    this._atk = { type: null, step: 0, variant: 'A', t: 0, dur: 0 };
    this._comboWindow = 0;    // time left to continue the current string
    this._spinYaw = 0;        // extra body spin for the 360 kick
    this._punchPrev = false;
    this._kickPrev = false;
    this._tmp = new THREE.Vector3();

    this.model = createSpiderMan();
    scene.add(this.model.root);

    // active web: a visible taut cord from hand to anchor
    this.webMesh = new THREE.Mesh(
      sharedWebGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.webMesh.visible = false;
    scene.add(this.webMesh);

    this.speedMph = 0;
  }

  respawn() {
    this.pos.set(0, 40, 0);
    this.vel.set(0, 0, 0);
    this.releaseWeb();
    this.state = 'air';
  }

  shootWeb() {
    const origin = this.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    // aim where you're LOOKING, biased toward the stick — toggle left while
    // web-jumping and the next web reaches for an anchor on your left.
    const aim = this.cameraCtrl.getLookDir();
    if (this._move && this._move.lengthSq() > 0.01) {
      const m = this._move.clone(); m.y = 0;
      if (m.lengthSq() > 0.001) {
        m.normalize();
        aim.x = aim.x * 0.35 + m.x * 1.0;
        aim.z = aim.z * 0.35 + m.z * 1.0;
        aim.y = Math.max(aim.y, 0.3);   // keep arcs reaching upward
        aim.normalize();
      }
    }
    const hit = this.city.findSwingAnchor(origin, aim, WEB_RANGE);
    if (!hit) return false;

    this.anchor = hit.point.clone();
    this.ropeLength = this.pos.distanceTo(this.anchor) * 0.92; // slightly taut
    this.ropeLength = Math.max(6, this.ropeLength);
    // webbing from the ground gives a launch hop so the swing can actually start
    if (this.state === 'ground') this.vel.y = Math.max(this.vel.y, 11);
    this.state = 'swing';
    this.webMesh.visible = true;
    return true;
  }

  releaseWeb() {
    if (this.anchor) {
      // the strand stays behind, hanging from the anchor
      const hand = this.model.getWristWorld('R', this._tmp).clone();
      this.strands.push(new WebStrand(this.scene, this.anchor, hand, this.vel));
      if (this.strands.length > 6) this.strands.shift().dispose();
    }
    this.anchor = null;
    this.webMesh.visible = false;
    if (this.state === 'swing') this.state = 'air';
  }

  update(dt, input) {
    // clamp dt so a stutter can't tunnel us through the world
    dt = Math.min(dt, 0.033);

    const fwd = this.cameraCtrl.getForward();
    const right = this.cameraCtrl.getRight();

    // movement intent from WASD
    const move = new THREE.Vector3();
    if (input.down('KeyW')) move.add(fwd);
    if (input.down('KeyS')) move.sub(fwd);
    if (input.down('KeyD')) move.add(right);
    if (input.down('KeyA')) move.sub(right);
    let moveMag = move.lengthSq() > 0 ? 1 : 0; // analog 0..1 (keyboard = full)

    // analog touch joystick overrides keyboard when active
    const ax = input.moveAxis;
    if (ax && (ax.x !== 0 || ax.y !== 0)) {
      move.copy(fwd).multiplyScalar(ax.y).addScaledVector(right, ax.x);
      moveMag = Math.min(1, Math.hypot(ax.x, ax.y));
    }
    const hasInput = move.lengthSq() > 0;
    if (hasInput) move.normalize();
    this._moveMag = moveMag;
    this._move = move; // collide() reads this for wall auto-stick

    // raw up/lateral intents (climbing is screen-relative, not camera-relative)
    let upIntent = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    let latIntent = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    if (ax && (ax.x !== 0 || ax.y !== 0)) { upIntent = ax.y; latIntent = ax.x; }

    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');

    // ---- combat: rapid taps chain a 3-hit combo (jab-cross-uppercut /
    //      low-high-360). Hold RUN while striking for the alternate string. ----
    const a = this._atk;
    if (a.t > 0) a.t += dt;
    if (this._comboWindow > 0) this._comboWindow -= dt;
    if (a.type && a.t >= a.dur && this._comboWindow <= 0) a.type = null; // string ended
    if (this._spinYaw > 0) this._spinYaw = Math.max(0, this._spinYaw - dt * (Math.PI * 2 / 0.55));

    const canAttack = this.state === 'ground' || this.state === 'air';
    if (canAttack && input.punchPressed) this._strike('punch', sprint);
    if (canAttack && input.kickPressed) this._strike('kick', sprint);

    // ---- web input (edge-triggered toggle: tap to attach, tap to release) ----
    if (input.webPressed) {
      if (this.state === 'swing') this.releaseWeb();
      else this.shootWeb();
    }
    if (input.webReleased) this.releaseWeb();

    // ---- state machine ----
    switch (this.state) {
      case 'ground': this._updateGround(dt, move, hasInput, sprint, input); break;
      case 'air':    this._updateAir(dt, move, hasInput, input); break;
      case 'swing':  this._updateSwing(dt, move, hasInput, input); break;
      case 'wall':   this._updateWall(dt, upIntent, latIntent, move, input); break;
    }

    // ---- integrate + collide (sets this._onGround, incl. on rooftops) ----
    const fallSpeed = -this.vel.y;
    this.pos.addScaledVector(this.vel, dt);
    this._collide(dt);

    // ---- ground contact: works at street level AND on building tops ----
    if (this._onGround) {
      if (this.state === 'air' || this.state === 'swing') {
        this.releaseWeb();
        this.state = 'ground';
        this._justLandedTimer = 0.35;                 // brief "just arrived" flag
        if (fallSpeed > 16) this._landTimer = 0.32;   // hard landing → crouch
      } else if (this.state === 'wall' && upIntent <= 0) {
        this.state = 'ground';
      }
    } else if (this.state === 'ground') {
      this.state = 'air'; // walked off a ledge / rooftop edge
    }
    if (this._landTimer > 0) this._landTimer -= dt;
    if (this._justLandedTimer > 0) this._justLandedTimer -= dt;

    // rooftop perch timer: standing still on a building top → signature crouch
    const still = Math.hypot(this.vel.x, this.vel.z) < 0.6;
    if (this.state === 'ground' && this.pos.y > 2.5 && still && !this._atk.type) {
      this._perchTimer += dt;
    } else {
      this._perchTimer = 0;
    }

    this._updateModel(dt, hasInput, sprint);
    this._updateWebs(dt);

    // speed readout (convert sim units → arbitrary "mph" for flavor)
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.speedMph = Math.round(horiz * 3.0);
  }

  // ---- per-state logic -----------------------------------------------------

  // Knockback from a car clip etc. Launch him along dir (already includes lift).
  knockback(velVec) {
    this.releaseWeb();
    this.vel.copy(velVec);
    this.state = 'air';
    this._atk.type = null;
  }

  _strike(type, heavy) {
    const a = this._atk;
    // continue the string if we're mid-combo of the same type, else start fresh
    const chaining = a.type === type && this._comboWindow > 0 && a.step < 2;
    const step = chaining ? a.step + 1 : 0;
    const variant = chaining ? a.variant : (heavy ? 'B' : 'A');
    const durs = type === 'kick' ? [0.34, 0.40, 0.56] : [0.24, 0.28, 0.40];
    a.type = type; a.step = step; a.variant = variant; a.t = 0.0001; a.dur = durs[step];
    this._comboWindow = a.dur + 0.32;

    const f = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    // forward commitment scales up through the combo
    const lunge = (type === 'kick' ? 3 : 2) + step * 1.5;
    if (this.state === 'ground') this.vel.addScaledVector(f, lunge);

    // finishers leap: uppercut hops, 360 kick & jumping knee jump + spin
    if (step === 2) {
      if (type === 'kick') {
        if (this.state === 'ground') { this.vel.y = Math.max(this.vel.y, 11); this.state = 'air'; }
        if (variant === 'A') this._spinYaw = Math.PI * 2; // full 360 spin
        this.vel.addScaledVector(f, 4);
      } else if (this.state === 'ground') {
        this.vel.y = Math.max(this.vel.y, 7);
      }
    }
  }

  _updateGround(dt, move, hasInput, sprint, input) {
    // attacking roots you briefly (no steering mid-strike)
    const attacking = !!this._atk.type && this._atk.t < this._atk.dur;
    const maxSpeed = (sprint ? MAX_SPRINT : MAX_RUN) * (this._moveMag || 1);
    if (hasInput && !attacking) {
      this.vel.x += move.x * MOVE_ACCEL * dt;
      this.vel.z += move.z * MOVE_ACCEL * dt;
      this.facing = Math.atan2(move.x, move.z);
    } else {
      // friction
      this.vel.x *= Math.pow(attacking ? 0.02 : 0.0008, dt);
      this.vel.z *= Math.pow(attacking ? 0.02 : 0.0008, dt);
    }
    // clamp horizontal speed
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (h > maxSpeed) { const s = maxSpeed / h; this.vel.x *= s; this.vel.z *= s; }

    // gentle downward press keeps him planted on rooftops & slopes so the
    // collision reports ground contact every frame (otherwise he'd "fall off").
    this.vel.y = -3;
    if (input.down('Space') && !attacking) {
      this.vel.y = JUMP_VELOCITY;
      this.state = 'air';
    }
  }

  _updateAir(dt, move, hasInput, input) {
    this.vel.y += GRAVITY * dt;
    if (hasInput) {
      this.vel.x += move.x * MOVE_ACCEL * AIR_CONTROL * dt;
      this.vel.z += move.z * MOVE_ACCEL * AIR_CONTROL * dt;
      this.facing = Math.atan2(this.vel.x, this.vel.z);
    }
    // cap horizontal air speed generously (swinging can exceed this; this is glide)
    const h = Math.hypot(this.vel.x, this.vel.z);
    const cap = 40;
    if (h > cap) { const s = cap / h; this.vel.x *= s; this.vel.z *= s; }
  }

  _updateSwing(dt, move, hasInput, input) {
    // gravity still applies
    this.vel.y += GRAVITY * dt;

    // "pump": push along the swing tangent in the camera-forward direction so
    // holding W down-swing builds speed, like timing a real swing.
    if (hasInput) {
      this.vel.addScaledVector(move, SWING_PUMP * dt);
    }

    // integrate provisional position then enforce the rope as a distance
    // constraint (positional correction toward the anchor).
    const provisional = this.pos.clone().addScaledVector(this.vel, dt);
    const toAnchor = provisional.clone().sub(this.anchor);
    const dist = toAnchor.length();

    if (dist > this.ropeLength) {
      // pull back onto the sphere of radius ropeLength
      toAnchor.multiplyScalar(this.ropeLength / dist);
      const constrained = this.anchor.clone().add(toAnchor);
      // remove the velocity component along the rope (radial) -> keeps tangential
      const radial = toAnchor.clone().normalize();
      const vAlong = this.vel.dot(radial);
      this.vel.addScaledVector(radial, -vAlong);
      this.pos.copy(constrained.addScaledVector(this.vel, -dt)); // pre-integrate
    }

    // shorten the rope gradually while holding W to climb / gain height
    if (input.down('KeyW')) {
      this.ropeLength = Math.max(5, this.ropeLength - 14 * dt);
    }
    if (input.down('KeyS')) {
      this.ropeLength = Math.min(WEB_RANGE, this.ropeLength + 14 * dt);
    }

    // Space while swinging = web-jump: release and launch up off the line so
    // you can gain height and fire the next web from higher up.
    if (input.down('Space')) {
      this.releaseWeb();
      this.vel.multiplyScalar(1.06);  // keep the momentum
      this.vel.y += 10;               // strong upward kick off the web
      this.state = 'air';
    }

    // face direction of travel
    if (Math.hypot(this.vel.x, this.vel.z) > 1) {
      this.facing = Math.atan2(this.vel.x, this.vel.z);
    }
  }

  _updateWall(dt, upIntent, latIntent, move, input) {
    const n = this.wallNormal;
    const tangent = new THREE.Vector3().crossVectors(UP, n).normalize();

    // Spider-Man sticks — no sliding. Joystick up/down climbs, left/right shimmies.
    this.vel.set(0, 0, 0);
    this.vel.addScaledVector(UP, upIntent * CLIMB_SPEED);
    this.vel.addScaledVector(tangent, latIntent * CLIMB_SPEED * 0.8);
    this.vel.addScaledVector(n, -2); // gentle press into the wall keeps contact

    // jump off the wall
    if (input.down('Space')) {
      this.vel.copy(n).multiplyScalar(12);
      this.vel.y = JUMP_VELOCITY * 0.85;
      this.state = 'air';
      return;
    }
    // pull directly away from the wall to let go
    if (move.lengthSq() > 0 && move.dot(n) > 0.55) {
      this.vel.copy(n).multiplyScalar(5);
      this.state = 'air';
      return;
    }

    // ledge vault: climbing up and the wall just ended → pop up onto the roof
    if (upIntent > 0.2) {
      const probe = this.pos.clone().add(new THREE.Vector3(0, 0.2, 0));
      const hit = this.city.raycast(probe, n.clone().negate(), RADIUS + 1.2);
      if (!hit) {
        this.vel.set(0, 9.5, 0).addScaledVector(n, -5);
        this.state = 'air';
        return;
      }
    }

    // face into the wall
    this.facing = Math.atan2(-n.x, -n.z);
  }

  _collide(dt) {
    this._onGround = false;
    const r = this.city.collideSphere(this.pos, RADIUS);
    this.pos.copy(r.pos);

    // street floor
    if (this.pos.y <= RADIUS) {
      this.pos.y = RADIUS;
      if (this.vel.y < 0) this.vel.y = 0;
      this._onGround = true;
    }
    // building rooftop
    if (r.hitTop) {
      if (this.vel.y < 0) this.vel.y = 0;
      this._onGround = true;
    }

    if (r.onWall && Math.abs(r.wallNormal.y) < 0.4) {
      const n = r.wallNormal;
      // kill velocity into the wall
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into);

      // AUTO-STICK: airborne contact, or running into the wall on the ground,
      // makes Spidey cling — no button needed.
      const pushingIn = this._move && this._move.lengthSq() > 0 && this._move.dot(n) < -0.35;
      if (this.state === 'air' || (this.state === 'ground' && pushingIn)) {
        this.wallNormal = n.clone();
        this.state = 'wall';
      } else if (this.state === 'wall') {
        this.wallNormal = n.clone(); // refresh while shimmying around corners
      }
      this._wallLost = 0;
    } else if (this.state === 'wall') {
      // lost contact (corner, ledge) — give a beat to recover, then fall
      this._wallLost += dt;
      if (this._wallLost > 0.18) this.state = 'air';
    }
  }

  _updateModel(dt, hasInput, sprint) {
    // --- orientation ---
    const targetQuat = new THREE.Quaternion();
    if (this.state === 'swing' && this.anchor) {
      // align the body with the rope: "up" runs along the web, facing travel.
      const ropeUp = this.anchor.clone().sub(this.pos).normalize();
      let face = this.vel.clone().addScaledVector(ropeUp, -this.vel.dot(ropeUp));
      if (face.lengthSq() < 0.4) {
        face.set(Math.sin(this.facing), 0, Math.cos(this.facing))
            .addScaledVector(ropeUp, -ropeUp.y * 0); // fallback heading
      }
      face.normalize();
      const side = new THREE.Vector3().crossVectors(ropeUp, face).normalize();
      const fwd2 = new THREE.Vector3().crossVectors(side, ropeUp).normalize();
      const m = new THREE.Matrix4().makeBasis(side, ropeUp, fwd2);
      targetQuat.setFromRotationMatrix(m);
    } else {
      // upright, plus any 360-spin-kick body rotation
      targetQuat.setFromEuler(new THREE.Euler(0, this.facing + this._spinYaw, 0));
    }
    // snap instantly during the spin so the 360 reads; otherwise smooth
    const rate = this.state === 'swing' ? 5 : (this._spinYaw > 0 ? 30 : 9);
    this.model.root.quaternion.slerp(targetQuat, Math.min(1, dt * rate));

    this.model.root.position.copy(this.pos);
    this.model.root.position.y -= RADIUS; // feet to ground

    const attacking = this._atk.type && this._atk.t < this._atk.dur;
    let pose = 'idle';
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'swing') pose = 'swing';
    else if (this.state === 'wall') pose = 'climb';
    else if (this.state === 'air') pose = 'air';
    else if (this._landTimer > 0) pose = 'land';
    else if (this._perchTimer > 1.0) pose = 'perch';
    else if (h > 0.6) pose = 'run';

    const attack = attacking
      ? { type: this._atk.type, step: this._atk.step, variant: this._atk.variant, t01: this._atk.t / this._atk.dur }
      : null;
    const speed01 = Math.min(1, h / MAX_SPRINT);
    this.model.update(dt, pose, speed01, { attack });
  }

  _updateWebs(dt) {
    // active taut cord — fires from the wrist, hand grips the line
    if (this.anchor) {
      const wrist = this.model.getWristWorld('R', this._tmp).clone();
      orientSegment(this.webMesh, wrist, this.anchor);
    }
    // released strands
    for (let i = this.strands.length - 1; i >= 0; i--) {
      if (!this.strands[i].update(dt)) {
        this.strands[i].dispose();
        this.strands.splice(i, 1);
      }
    }
  }
}
