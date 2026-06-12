import * as THREE from 'three';

// GTA-style third-person orbit camera. Mouse drives yaw/pitch; the camera trails
// the player at a spring-damped distance and pulls in if a building would clip
// the view. Looks at a point slightly above the character.

export class CameraController {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;

    this.yaw = 0;            // around world Y
    this.pitch = 0.32;       // tilt down a touch
    this.distance = 7.5;
    this.distanceTarget = 7.5;
    this.distancePresets = [5, 7.5, 11];
    this._presetIdx = 1;

    this.sensitivity = 0.0024;
    this.minPitch = -0.55;
    this.maxPitch = 1.25;

    this._currentPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._initialised = false;
    this._manualTimer = 99; // seconds since the player last steered the camera
  }

  cyclePreset() {
    this._presetIdx = (this._presetIdx + 1) % this.distancePresets.length;
    this.distanceTarget = this.distancePresets[this._presetIdx];
  }

  // Apply accumulated mouse movement.
  handleMouse(dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) > 1.5) this._manualTimer = 0; // user is steering
    this.yaw -= dx * this.sensitivity;
    this.pitch += dy * this.sensitivity;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  // Forward vector on the horizontal plane (used to orient player movement).
  getForward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize().negate();
  }
  getRight() {
    // NB: no negate — cross(forward, up) IS screen-right (negating it was the
    // cause of inverted left/right strafing).
    const f = this.getForward();
    return new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  }
  // Full look direction including pitch — used for web auto-aim.
  getLookDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * cp
    ).normalize().negate();
  }

  // follow = { heading, rate } | null — when set (player is moving) and the
  // user hasn't touched the camera for a moment, the camera gently glides back
  // behind the player. A manual drag always wins instantly.
  update(dt, targetPos, follow = null) {
    this._manualTimer += dt;
    const lock = follow ? (follow.lock ?? 1.0) : 1.0;
    if (follow && this._manualTimer > lock) {
      const desired = follow.heading + Math.PI; // sit behind the player
      let d = desired - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * follow.rate);
      // ease pitch back to a comfortable trailing angle
      const pitchTarget = follow.pitch ?? 0.30;
      this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * (follow.pitchRate ?? 0.8));
    }

    // look target around the chest/head of the (short Funko) body
    const focus = targetPos.clone().add(new THREE.Vector3(0, 1.05, 0));

    // smooth distance toward preset
    this.distance += (this.distanceTarget - this.distance) * Math.min(1, dt * 8);

    // spherical offset behind the player
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).multiplyScalar(this.distance);

    let desired = focus.clone().add(offset);

    // camera collision: cast from focus to desired, pull in if blocked
    const dir = desired.clone().sub(focus);
    const len = dir.length();
    dir.normalize();
    const hit = this.city.raycast(focus, dir, len);
    if (hit && hit.t < len) {
      desired = focus.clone().addScaledVector(dir, Math.max(1.5, hit.t - 0.5));
    }
    // keep camera above the street
    if (desired.y < 1.2) desired.y = 1.2;

    if (!this._initialised) {
      this._currentPos.copy(desired);
      this._lookAt.copy(focus);
      this._initialised = true;
    } else {
      const posLerp = Math.min(1, dt * 10);
      const lookLerp = Math.min(1, dt * 14);
      this._currentPos.lerp(desired, posLerp);
      this._lookAt.lerp(focus, lookLerp);
    }

    this.camera.position.copy(this._currentPos);
    this.camera.lookAt(this._lookAt);
  }
}
