import * as THREE from 'three';
import { createSpiderMan } from './SpiderModel.js';

// Spider-Man's character controller. Owns position/velocity, runs the movement
// & traversal state machine (ground / air / swing / wall), and drives the model
// pose. Collision is delegated to City. The web line is rendered here too.

const GRAVITY = -38;
const MOVE_ACCEL = 60;
const MAX_RUN = 14;
const MAX_SPRINT = 22;
const JUMP_VELOCITY = 16;
const AIR_CONTROL = 0.35;
const RADIUS = 0.6;            // collision sphere radius
const WEB_RANGE = 140;
const SWING_PUMP = 26;         // forward force while swinging (web-swing "pump")

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

    this.model = createSpiderMan();
    scene.add(this.model.root);

    // web line (a thin cylinder stretched between hand and anchor)
    this.webMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.webGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.webLine = new THREE.Line(this.webGeo, this.webMat);
    this.webLine.visible = false;
    scene.add(this.webLine);

    // small marker showing the current/last web anchor (debug-y but pretty)
    this.anchorDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4455 })
    );
    this.anchorDot.visible = false;
    scene.add(this.anchorDot);

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
    const lookDir = this.cameraCtrl.getLookDir();
    const hit = this.city.findSwingAnchor(origin, lookDir, WEB_RANGE);
    if (!hit) return false;

    this.anchor = hit.point.clone();
    this.ropeLength = this.pos.distanceTo(this.anchor) * 0.92; // slightly taut
    this.ropeLength = Math.max(6, this.ropeLength);
    this.state = 'swing';
    this.webLine.visible = true;
    this.anchorDot.visible = true;
    this.anchorDot.position.copy(this.anchor);
    return true;
  }

  releaseWeb() {
    this.anchor = null;
    this.webLine.visible = false;
    this.anchorDot.visible = false;
    if (this.state === 'swing') this.state = 'air';
  }

  update(dt, input) {
    // clamp dt so a stutter can't tunnel us through the world
    dt = Math.min(dt, 0.033);

    // wall-cling intent read up-front so _collide() (later this frame) sees it
    this._wantWall = input.down('KeyF');

    const fwd = this.cameraCtrl.getForward();
    const right = this.cameraCtrl.getRight();

    // movement intent from WASD
    const move = new THREE.Vector3();
    if (input.down('KeyW')) move.add(fwd);
    if (input.down('KeyS')) move.sub(fwd);
    if (input.down('KeyD')) move.add(right);
    if (input.down('KeyA')) move.sub(right);
    const hasInput = move.lengthSq() > 0;
    if (hasInput) move.normalize();

    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');

    // ---- web input (edge-triggered) ----
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
      case 'wall':   this._updateWall(dt, move, hasInput, input); break;
    }

    // ---- integrate + collide ----
    this.pos.addScaledVector(this.vel, dt);
    this._collide();

    // ---- ground contact check ----
    if (this.state !== 'wall') {
      if (this.pos.y <= RADIUS + 0.001) {
        this.pos.y = RADIUS;
        if (this.vel.y < 0) this.vel.y = 0;
        if (this.state === 'air' || this.state === 'swing') {
          this.releaseWeb();
          this.state = 'ground';
        }
      } else if (this.state === 'ground') {
        // walked off a ledge
        this.state = 'air';
      }
    }

    this._updateModel(dt, hasInput, sprint);
    this._updateWebLine();

    // speed readout (convert sim units → arbitrary "mph" for flavor)
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.speedMph = Math.round(horiz * 3.0);
  }

  // ---- per-state logic -----------------------------------------------------

  _updateGround(dt, move, hasInput, sprint, input) {
    const maxSpeed = sprint ? MAX_SPRINT : MAX_RUN;
    if (hasInput) {
      this.vel.x += move.x * MOVE_ACCEL * dt;
      this.vel.z += move.z * MOVE_ACCEL * dt;
      this.facing = Math.atan2(move.x, move.z);
    } else {
      // friction
      this.vel.x *= Math.pow(0.0008, dt);
      this.vel.z *= Math.pow(0.0008, dt);
    }
    // clamp horizontal speed
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (h > maxSpeed) { const s = maxSpeed / h; this.vel.x *= s; this.vel.z *= s; }

    this.vel.y = 0;
    if (input.down('Space')) {
      this.vel.y = JUMP_VELOCITY;
      this.state = 'air';
    }
    // press F near a wall handled in _collide via wall stick
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
    // constraint (Verlet-style positional correction toward the anchor).
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
      // we already advanced via integrate at the end of update(); so set vel to
      // realise the constrained move this frame:
      this.pos.copy(constrained.addScaledVector(this.vel, -dt)); // pre-integrate
    }

    // shorten the rope gradually while holding W to climb / gain height
    if (input.down('KeyW')) {
      this.ropeLength = Math.max(5, this.ropeLength - 14 * dt);
    }
    if (input.down('KeyS')) {
      this.ropeLength = Math.min(WEB_RANGE, this.ropeLength + 14 * dt);
    }

    // Space while swinging = release with an upward boost (the satisfying launch)
    if (input.down('Space')) {
      this.releaseWeb();
      this.vel.y += 6;
      this.state = 'air';
    }

    // face direction of travel
    if (Math.hypot(this.vel.x, this.vel.z) > 1) {
      this.facing = Math.atan2(this.vel.x, this.vel.z);
    }
  }

  _updateWall(dt, move, hasInput, input) {
    // stuck to a wall; small gravity slide unless holding into the wall
    const n = this.wallNormal;
    // build wall-plane basis: up world + tangent
    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(up, n).normalize();

    const climb = new THREE.Vector3();
    if (input.down('KeyW')) climb.add(up);
    if (input.down('KeyS')) climb.sub(up);
    if (input.down('KeyD')) climb.add(tangent);
    if (input.down('KeyA')) climb.sub(tangent);

    this.vel.set(0, 0, 0);
    if (climb.lengthSq() > 0) {
      climb.normalize().multiplyScalar(8);
      this.vel.copy(climb);
    } else {
      this.vel.y = -1.5; // slow slide when idle
    }
    // press into wall to stay; jump off
    if (input.down('Space')) {
      this.vel.copy(n).multiplyScalar(12);
      this.vel.y = JUMP_VELOCITY * 0.8;
      this.state = 'air';
      return;
    }
    if (!input.down('KeyF')) {
      this.state = 'air';
    }
    // face into wall
    this.facing = Math.atan2(-n.x, -n.z);
  }

  _collide() {
    const r = this.city.collideSphere(this.pos, RADIUS);
    this.pos.copy(r.pos);

    if (r.hitTop) {
      // landed on a rooftop
      if (this.vel.y < 0) this.vel.y = 0;
      if (this.state === 'air' || this.state === 'swing') {
        this.releaseWeb();
        this.state = 'ground-roof';
        this.state = 'ground';
      }
    }
    if (r.onWall) {
      // kill velocity into the wall
      const n = r.wallNormal;
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into);

      // allow wall-cling when F held and we're airborne against a vertical face
      if (this._wantWall && Math.abs(n.y) < 0.4 && this.state !== 'ground') {
        this.wallNormal = n.clone();
        this.state = 'wall';
      }
    }
  }

  _updateModel(dt, hasInput, sprint) {
    // smooth facing
    const target = this.facing;
    let cur = this.model.root.rotation.y;
    let d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.model.root.rotation.y = cur + d * Math.min(1, dt * 12);

    this.model.root.position.copy(this.pos);
    this.model.root.position.y -= RADIUS; // feet to ground

    let pose = 'idle';
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'swing') pose = 'swing';
    else if (this.state === 'wall') pose = 'crawl';
    else if (this.state === 'air') pose = 'air';
    else if (h > 0.6) pose = 'run';

    const speed01 = Math.min(1, h / MAX_SPRINT);
    this.model.update(dt, pose, speed01);
  }

  _updateWebLine() {
    if (!this.anchor) return;
    const hand = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.webGeo.setFromPoints([hand, this.anchor]);
    this.webGeo.attributes.position.needsUpdate = true;
  }

  // Called from main each frame to pass the F (wall) intent before collide runs.
  setWallIntent(v) { this._wantWall = v; }
}
