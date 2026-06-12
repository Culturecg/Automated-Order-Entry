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
  }

  cyclePreset() {
    this._presetIdx = (this._presetIdx + 1) % this.distancePresets.length;
    this.distanceTarget = this.distancePresets[this._presetIdx];
  }

  // Apply accumulated mouse movement.
  handleMouse(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch += dy * this.sensitivity;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  // Forward vector on the horizontal plane (used to orient player movement).
  getForward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize().negate();
  }
  getRight() {
    const f = this.getForward();
    return new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize().negate();
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

  update(dt, targetPos) {
    // desired look target a bit above the feet/origin
    const focus = targetPos.clone().add(new THREE.Vector3(0, 1.4, 0));

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
