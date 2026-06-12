import * as THREE from 'three';

// Procedurally generates a Manhattan-style grid: a flat street network with
// rectangular skyscrapers on each block. Buildings are stored as axis-aligned
// boxes so the player physics and web-swing raycasts can query them cheaply.

export class City {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.blocks = opts.blocks ?? 12;          // grid is blocks x blocks
    this.blockSize = opts.blockSize ?? 60;    // footprint of a block
    this.street = opts.street ?? 18;          // street width between blocks
    this.buildings = [];                      // { box: THREE.Box3, mesh }
    this.half = (this.blocks * (this.blockSize + this.street)) / 2;

    this._buildGround();
    this._buildBuildings();
    this._scatterProps();
  }

  _buildGround() {
    const span = this.blocks * (this.blockSize + this.street) + 200;

    // Asphalt
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({ color: 0x202028, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Street grid lines (subtle, helps read motion & scale)
    const grid = new THREE.GridHelper(span, this.blocks * 2, 0x444455, 0x33333d);
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  _randBuildingColor(rng) {
    // muted glass/concrete palette so neon webs & player pop
    const palette = [0x4a5066, 0x3b4252, 0x5a6172, 0x474b5a, 0x606878, 0x39414f];
    return palette[Math.floor(rng() * palette.length)];
  }

  _buildBuildings() {
    const rng = mulberry32(1337); // deterministic so the city is stable between runs
    const pitch = this.blockSize + this.street;
    const start = -this.half + this.blockSize / 2;

    // shared base materials reused by tinting clones — cheaper than unique mats
    const windowTex = makeWindowTexture();

    for (let gx = 0; gx < this.blocks; gx++) {
      for (let gz = 0; gz < this.blocks; gz++) {
        // leave a central plaza open as a spawn / landmark
        const cx = start + gx * pitch;
        const cz = start + gz * pitch;
        if (Math.abs(cx) < pitch && Math.abs(cz) < pitch) continue;

        // Sometimes split a block into 1-2 towers for variety
        const towers = rng() > 0.55 ? 2 : 1;
        for (let t = 0; t < towers; t++) {
          const footprint = this.blockSize * (towers === 2 ? 0.42 : 0.82);
          const offset = towers === 2 ? (t === 0 ? -1 : 1) * this.blockSize * 0.22 : 0;

          const h = 30 + Math.pow(rng(), 1.8) * 220; // skewed toward shorter, a few giants
          const w = footprint * (0.7 + rng() * 0.3);
          const d = footprint * (0.7 + rng() * 0.3);

          const mat = new THREE.MeshStandardMaterial({
            color: this._randBuildingColor(rng),
            roughness: 0.6,
            metalness: 0.15,
            map: windowTex,
          });
          // tile the window texture proportional to height
          mat.map = windowTex.clone();
          mat.map.needsUpdate = true;
          mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
          mat.map.repeat.set(Math.max(2, Math.round(w / 8)), Math.max(3, Math.round(h / 8)));

          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          mesh.position.set(cx + offset, h / 2, cz + offset * 0.3);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.scene.add(mesh);

          const box = new THREE.Box3().setFromObject(mesh);
          this.buildings.push({ box, mesh, height: h });
        }
      }
    }
  }

  _scatterProps() {
    // A few rooftop water-tank cylinders for silhouette interest.
    const rng = mulberry32(99);
    for (const b of this.buildings) {
      if (rng() > 0.25) continue;
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3.4, 6, 10),
        new THREE.MeshStandardMaterial({ color: 0x5a4634, roughness: 0.9 })
      );
      const c = b.box.getCenter(new THREE.Vector3());
      tank.position.set(c.x, b.height + 3, c.z);
      tank.castShadow = true;
      this.scene.add(tank);
    }
  }

  // ---- Physics / query helpers --------------------------------------------

  // Resolve a sphere (player capsule approximation) against all building boxes.
  // Returns the corrected position and which axis the contact was on.
  collideSphere(pos, radius) {
    const result = { pos: pos.clone(), onWall: false, wallNormal: null, hitTop: false };
    for (const b of this.buildings) {
      const box = b.box;
      // quick reject
      if (pos.x + radius < box.min.x || pos.x - radius > box.max.x) continue;
      if (pos.z + radius < box.min.z || pos.z - radius > box.max.z) continue;
      if (pos.y + radius < box.min.y || pos.y - radius > box.max.y) continue;

      // closest point on box to sphere center
      const cx = clamp(result.pos.x, box.min.x, box.max.x);
      const cy = clamp(result.pos.y, box.min.y, box.max.y);
      const cz = clamp(result.pos.z, box.min.z, box.max.z);
      const dx = result.pos.x - cx;
      const dy = result.pos.y - cy;
      const dz = result.pos.z - cz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < radius * radius && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = (radius - dist);
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        result.pos.x += nx * push;
        result.pos.y += ny * push;
        result.pos.z += nz * push;
        if (Math.abs(ny) > 0.5 && dy > 0) result.hitTop = true;
        else { result.onWall = true; result.wallNormal = new THREE.Vector3(nx, ny, nz); }
      }
    }
    return result;
  }

  // Raycast from origin toward dir; return nearest building hit point/normal
  // within maxDist, or null. Used to pick a web anchor.
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const b of this.buildings) {
      const hit = rayBox(origin, dir, b.box, maxDist);
      if (hit && (!best || hit.t < best.t)) {
        best = hit;
      }
    }
    return best;
  }

  // Find a good auto-aim anchor: cast a fan of rays around the look direction
  // and pick the closest valid building hit, biased toward up-and-forward.
  findSwingAnchor(origin, lookDir, maxDist) {
    const candidates = [];
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(lookDir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, lookDir).normalize();

    for (let yaw = -0.5; yaw <= 0.5; yaw += 0.25) {
      for (let pitch = 0.1; pitch <= 0.9; pitch += 0.2) {
        const dir = lookDir.clone()
          .addScaledVector(right, yaw)
          .addScaledVector(realUp, pitch)
          .normalize();
        const hit = this.raycast(origin, dir, maxDist);
        if (hit && hit.point.y > origin.y + 4) {
          candidates.push(hit);
        }
      }
    }
    if (candidates.length === 0) return null;
    // prefer higher anchors (better swing arc), then closer ones
    candidates.sort((a, b) => (b.point.y - a.point.y) - (a.t - b.t) * 0.5);
    return candidates[0];
  }
}

// ---- helpers ---------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Slab-method ray vs AABB.
function rayBox(origin, dir, box, maxDist) {
  let tmin = 0, tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];
  let hitAxis = 0, sign = 1;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (lo[i] - o[i]) * inv;
      let t2 = (hi[i] - o[i]) * inv;
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; hitAxis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  const point = new THREE.Vector3(
    origin.x + dir.x * tmin,
    origin.y + dir.y * tmin,
    origin.z + dir.z * tmin
  );
  const normal = new THREE.Vector3();
  normal.setComponent(hitAxis, sign);
  return { t: tmin, point, normal };
}

// Deterministic PRNG so the skyline is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a small canvas texture of lit/unlit windows.
function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b303d';
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 4; y < 64; y += 10) {
    for (let x = 4; x < 64; x += 10) {
      const lit = Math.random() > 0.6;
      ctx.fillStyle = lit ? '#ffe9a8' : '#161a22';
      ctx.fillRect(x, y, 6, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
