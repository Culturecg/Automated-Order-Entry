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
    this.carColliders = [];                   // Box3 per parked car
    this.half = (this.blocks * (this.blockSize + this.street)) / 2;

    this._buildGround();
    this._buildBuildings();
    this._scatterProps();
    this._buildStreets();
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
            roughness: 0.45 + rng() * 0.3,  // glassy → concrete spread
            metalness: 0.2,
            envMapIntensity: 0.9,
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

  // ---- Street life: sidewalks, parked cars, hydrants, lamps, crosswalks ----
  // Everything here uses InstancedMesh so hundreds of props cost only a handful
  // of draw calls (important for iPhone).

  _buildStreets() {
    const rng = mulberry32(4242);
    const pitch = this.blockSize + this.street;
    const start = -this.half + this.blockSize / 2;
    const inPlaza = (x, z) => Math.abs(x) < pitch && Math.abs(z) < pitch;

    // ---------- sidewalks: a raised slab under each block ----------
    {
      const slabs = [];
      for (let gx = 0; gx < this.blocks; gx++) {
        for (let gz = 0; gz < this.blocks; gz++) {
          slabs.push([start + gx * pitch, start + gz * pitch]);
        }
      }
      const geo = new THREE.BoxGeometry(this.blockSize + 7, 0.22, this.blockSize + 7);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a8d96, roughness: 0.95 });
      const im = new THREE.InstancedMesh(geo, mat, slabs.length);
      const m = new THREE.Matrix4();
      slabs.forEach(([x, z], i) => {
        m.makeTranslation(x, 0.11, z);
        im.setMatrixAt(i, m);
      });
      im.receiveShadow = true;
      this.scene.add(im);
    }

    // ---------- parked cars (lots of yellow cabs) ----------
    const carTransforms = []; // { x, z, rotY, color }
    const palette = [0xe8e8ea, 0x17171c, 0x9aa0ab, 0x8c1f28, 0x1e3a5c, 0x3c4047];
    const TAXI = 0xf2b500;
    const curb = this.street / 2 - 2.4; // distance from street center to parked lane
    const along = (fixed, isVertical) => {
      for (let p = -this.half + 8; p < this.half - 8; p += 8.5) {
        // skip the stretch crossing another street
        const cell = ((p + this.half) % pitch);
        if (cell > this.blockSize) continue;
        for (const side of [-1, 1]) {
          if (rng() > 0.4) continue;
          const x = isVertical ? fixed + side * curb : p;
          const z = isVertical ? p : fixed + side * curb;
          if (inPlaza(x, z)) continue;
          const heading = isVertical ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2);
          carTransforms.push({
            x, z,
            rotY: heading + (rng() - 0.5) * 0.04,
            color: rng() < 0.35 ? TAXI : palette[Math.floor(rng() * palette.length)],
          });
        }
      }
    };
    for (let i = 0; i < this.blocks - 1; i++) {
      const s = start + i * pitch + pitch / 2; // street centerline between blocks
      along(s, true);   // vertical street (cars face ±z)
      along(s, false);  // horizontal street
    }

    const n = carTransforms.length;
    const bodyIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.9, 0.55, 4.3),
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4 }),
      n
    );
    const cabIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.7, 0.5, 2.1),
      new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.2, metalness: 0.6 }),
      n
    );
    const wheelIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.33, 0.33, 0.26, 10),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 }),
      n * 4
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const wheelRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const sV = new THREE.Vector3(1, 1, 1);
    carTransforms.forEach((c, i) => {
      q.setFromEuler(new THREE.Euler(0, c.rotY, 0));
      m4.compose(new THREE.Vector3(c.x, 0.62, c.z), q, sV);
      bodyIM.setMatrixAt(i, m4);
      bodyIM.setColorAt(i, new THREE.Color(c.color));
      m4.compose(new THREE.Vector3(c.x, 1.12, c.z).add(new THREE.Vector3(0, 0, -0.35).applyQuaternion(q)), q, sV);
      cabIM.setMatrixAt(i, m4);
      // 4 wheels
      const wq = q.clone().multiply(wheelRot);
      [[-0.92, 1.35], [0.92, 1.35], [-0.92, -1.35], [0.92, -1.35]].forEach(([wx, wz], wi) => {
        const off = new THREE.Vector3(wx, 0, wz).applyQuaternion(q);
        m4.compose(new THREE.Vector3(c.x + off.x, 0.33, c.z + off.z), wq, sV);
        wheelIM.setMatrixAt(i * 4 + wi, m4);
      });
      // collider (slightly generous AABB regardless of heading)
      this.carColliders.push(new THREE.Box3(
        new THREE.Vector3(c.x - 2.2, 0, c.z - 2.2),
        new THREE.Vector3(c.x + 2.2, 1.45, c.z + 2.2)
      ));
    });
    bodyIM.castShadow = cabIM.castShadow = true;
    this.scene.add(bodyIM, cabIM, wheelIM);

    // ---------- fire hydrants at block corners ----------
    {
      const spots = [];
      for (let gx = 0; gx < this.blocks; gx++) {
        for (let gz = 0; gz < this.blocks; gz++) {
          const cx = start + gx * pitch, cz = start + gz * pitch;
          if (inPlaza(cx, cz)) continue;
          if (rng() > 0.5) continue; // not every corner
          const o = this.blockSize / 2 + 2.2;
          const corner = [[-o, -o], [o, -o], [-o, o], [o, o]][Math.floor(rng() * 4)];
          spots.push([cx + corner[0], cz + corner[1]]);
        }
      }
      const im = new THREE.InstancedMesh(
        new THREE.CapsuleGeometry(0.20, 0.42, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xd02818, roughness: 0.55 }),
        spots.length
      );
      spots.forEach(([x, z], i) => {
        m4.makeTranslation(x, 0.55, z);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      this.scene.add(im);
    }

    // ---------- street lamps along the curbs ----------
    {
      const spots = [];
      for (let gx = 0; gx < this.blocks; gx++) {
        for (let gz = 0; gz < this.blocks; gz++) {
          const cx = start + gx * pitch, cz = start + gz * pitch;
          if (inPlaza(cx, cz)) continue;
          const o = this.blockSize / 2 + 2.8;
          // two lamps per block on alternating sides
          spots.push([cx - o, cz - this.blockSize * 0.25]);
          spots.push([cx + o, cz + this.blockSize * 0.25]);
        }
      }
      const poleIM = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.7, metalness: 0.5 }),
        spots.length
      );
      const headIM = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd877, emissiveIntensity: 0.9 }),
        spots.length
      );
      spots.forEach(([x, z], i) => {
        m4.makeTranslation(x, 2.8, z);
        poleIM.setMatrixAt(i, m4);
        m4.makeTranslation(x, 5.7, z);
        headIM.setMatrixAt(i, m4);
      });
      poleIM.castShadow = true;
      this.scene.add(poleIM, headIM);
    }

    // ---------- crosswalk stripes at every intersection ----------
    {
      const tex = makeCrosswalkTexture();
      const spots = [];
      for (let i = 0; i < this.blocks - 1; i++) {
        for (let j = 0; j < this.blocks - 1; j++) {
          const x = start + i * pitch + pitch / 2;
          const z = start + j * pitch + pitch / 2;
          if (inPlaza(x, z)) continue;
          spots.push([x, z]);
        }
      }
      const geo = new THREE.PlaneGeometry(this.street + 4, this.street + 4);
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95 });
      const im = new THREE.InstancedMesh(geo, mat, spots.length);
      const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      spots.forEach(([x, z], i) => {
        m4.compose(new THREE.Vector3(x, 0.03, z), flat, sV);
        im.setMatrixAt(i, m4);
      });
      im.receiveShadow = true;
      this.scene.add(im);
    }
  }

  // ---- Physics / query helpers --------------------------------------------

  // Resolve a sphere (player capsule approximation) against all building boxes.
  // Returns the corrected position and which axis the contact was on.
  collideSphere(pos, radius) {
    const result = { pos: pos.clone(), onWall: false, wallNormal: null, hitTop: false };
    for (let i = 0; i < this.buildings.length + this.carColliders.length; i++) {
      const box = i < this.buildings.length
        ? this.buildings[i].box
        : this.carColliders[i - this.buildings.length];
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
  // NOTE: this texture MULTIPLIES the building color, so keep it bright —
  // near-white facade, slightly darker window panes, occasional lit window.
  ctx.fillStyle = '#e8eaf0';
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 4; y < 64; y += 10) {
    for (let x = 4; x < 64; x += 10) {
      const lit = Math.random() > 0.6;
      ctx.fillStyle = lit ? '#fff3c4' : '#7d8699';
      ctx.fillRect(x, y, 6, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// Zebra crosswalk stripes on all four approaches of an intersection,
// transparent in the middle so the asphalt shows through.
function makeCrosswalkTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(235,235,240,0.85)';
  const band = 18;             // depth of each crosswalk band from the edge
  const stripe = 6, gap = 6;   // stripe rhythm
  // top & bottom bands: vertical stripes
  for (let x = 8; x < S - 8; x += stripe + gap) {
    ctx.fillRect(x, 2, stripe, band);
    ctx.fillRect(x, S - band - 2, stripe, band);
  }
  // left & right bands: horizontal stripes
  for (let y = 8; y < S - 8; y += stripe + gap) {
    ctx.fillRect(2, y, band, stripe);
    ctx.fillRect(S - band - 2, y, band, stripe);
  }
  return new THREE.CanvasTexture(c);
}
