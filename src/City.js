import * as THREE from 'three';

// Procedural Manhattan. A grid of blocks, each carrying one or two towers with
// varied facades and colours; perimeter sidewalks (curbs), patina'd asphalt
// streets, crosswalks, hydrants and lamps. Buildings are axis-aligned boxes so
// the player physics and web raycasts stay cheap. Moving cars live in Traffic.js.

export class City {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.blocks = opts.blocks ?? 16;          // grid is blocks x blocks (bigger map)
    this.blockSize = opts.blockSize ?? 58;
    this.street = opts.street ?? 22;
    this.buildings = [];                      // { box, mesh, height }
    this.carColliders = [];                   // (kept for API compat; traffic handles its own)
    this.half = (this.blocks * (this.blockSize + this.street)) / 2;

    this._facades = makeFacadeTextures();
    this._buildGround();
    this._buildBuildings();
    this._buildSidewalks();
    this._buildStreetDressing();
    this._scatterRoofProps();
  }

  _buildGround() {
    const span = this.blocks * (this.blockSize + this.street) + 240;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(span / 8), roughness: 0.96, metalness: 0.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _buildBuildings() {
    const rng = mulberry32(1337);
    const pitch = this.blockSize + this.street;
    const start = -this.half + this.blockSize / 2;

    for (let gx = 0; gx < this.blocks; gx++) {
      for (let gz = 0; gz < this.blocks; gz++) {
        const cx = start + gx * pitch;
        const cz = start + gz * pitch;
        if (Math.abs(cx) < pitch && Math.abs(cz) < pitch) continue; // central plaza

        const towers = rng() > 0.5 ? 2 : 1;
        for (let t = 0; t < towers; t++) {
          const footprint = this.blockSize * (towers === 2 ? 0.42 : 0.8);
          const offset = towers === 2 ? (t === 0 ? -1 : 1) * this.blockSize * 0.22 : 0;
          const h = 26 + Math.pow(rng(), 1.9) * 250;
          const w = footprint * (0.72 + rng() * 0.28);
          const d = footprint * (0.72 + rng() * 0.28);

          // facade type by height, unique hue tint per building
          const fac = h > 150 ? this._facades.glass
            : (rng() > 0.5 ? this._facades.office : this._facades.brick);
          const map = fac.clone();
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          map.repeat.set(Math.max(2, Math.round(w / 7)), Math.max(3, Math.round(h / 7)));
          map.needsUpdate = true;

          const tint = new THREE.Color().setHSL(
            0.55 + (rng() - 0.5) * 0.18,     // cool-ish hues with spread
            0.06 + rng() * 0.18,
            0.45 + rng() * 0.28
          );
          const mat = new THREE.MeshStandardMaterial({
            map, color: tint,
            roughness: fac === this._facades.glass ? 0.25 + rng() * 0.2 : 0.7,
            metalness: fac === this._facades.glass ? 0.5 : 0.12,
            envMapIntensity: 0.9,
          });

          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          mesh.position.set(cx + offset, h / 2, cz + offset * 0.3);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.scene.add(mesh);

          // low parapet trim whose TOP is flush with the roof floor (so Spidey
          // stands ON the roof, not sunk inside a raised rim).
          const lip = new THREE.Mesh(
            new THREE.BoxGeometry(w * 1.03, 0.6, d * 1.03),
            new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.7), roughness: 0.8 })
          );
          lip.position.set(cx + offset, h - 0.3, cz + offset * 0.3);
          this.scene.add(lip);

          this.buildings.push({ box: new THREE.Box3().setFromObject(mesh), mesh, height: h });
        }
      }
    }
  }

  _buildSidewalks() {
    // FIX for the "walking in snow" look: sidewalks are thin perimeter curbs
    // around each block, NOT a giant light slab covering the whole block.
    const rng = mulberry32(22);
    const pitch = this.blockSize + this.street;
    const start = -this.half + this.blockSize / 2;
    const tex = makeSidewalkTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0 });

    const frames = [];
    for (let gx = 0; gx < this.blocks; gx++) {
      for (let gz = 0; gz < this.blocks; gz++) {
        const cx = start + gx * pitch, cz = start + gz * pitch;
        if (Math.abs(cx) < pitch && Math.abs(cz) < pitch) continue;
        frames.push([cx, cz]);
      }
    }

    const SW = 4.0;                 // sidewalk width
    // Thin, near-flush slabs (top at y≈0.05) so feet don't sink into a raised
    // curb. Perimeter frame of four around each block.
    const TH = 0.05;
    const longGeo = new THREE.BoxGeometry(this.blockSize + 2 * SW, TH, SW);
    const sideGeo = new THREE.BoxGeometry(SW, TH, this.blockSize + 2 * SW);
    const im = new THREE.InstancedMesh(longGeo, mat, frames.length * 2);
    const im2 = new THREE.InstancedMesh(sideGeo, mat, frames.length * 2);
    const m = new THREE.Matrix4();
    const yy = TH / 2;
    frames.forEach(([cx, cz], i) => {
      m.makeTranslation(cx, yy, cz - (this.blockSize / 2 + SW / 2)); im.setMatrixAt(i * 2, m);
      m.makeTranslation(cx, yy, cz + (this.blockSize / 2 + SW / 2)); im.setMatrixAt(i * 2 + 1, m);
      m.makeTranslation(cx - (this.blockSize / 2 + SW / 2), yy, cz); im2.setMatrixAt(i * 2, m);
      m.makeTranslation(cx + (this.blockSize / 2 + SW / 2), yy, cz); im2.setMatrixAt(i * 2 + 1, m);
    });
    im.receiveShadow = im2.receiveShadow = true;
    this.scene.add(im, im2);
  }

  _buildStreetDressing() {
    const rng = mulberry32(4242);
    const pitch = this.blockSize + this.street;
    const start = -this.half + this.blockSize / 2;
    const inPlaza = (x, z) => Math.abs(x) < pitch && Math.abs(z) < pitch;
    const m4 = new THREE.Matrix4();
    const sV = new THREE.Vector3(1, 1, 1);

    // hydrants
    const hyd = [];
    for (let gx = 0; gx < this.blocks; gx++) for (let gz = 0; gz < this.blocks; gz++) {
      const cx = start + gx * pitch, cz = start + gz * pitch;
      if (inPlaza(cx, cz) || rng() > 0.45) continue;
      const o = this.blockSize / 2 + 2.2;
      const corner = [[-o, -o], [o, -o], [-o, o], [o, o]][(rng() * 4) | 0];
      hyd.push([cx + corner[0], cz + corner[1]]);
    }
    const hIM = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.2, 0.42, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xcf2a1c, roughness: 0.5 }), hyd.length);
    hyd.forEach(([x, z], i) => { m4.makeTranslation(x, 0.55, z); hIM.setMatrixAt(i, m4); });
    hIM.castShadow = true; this.scene.add(hIM);

    // street lamps
    const lamps = [];
    for (let gx = 0; gx < this.blocks; gx++) for (let gz = 0; gz < this.blocks; gz++) {
      const cx = start + gx * pitch, cz = start + gz * pitch;
      if (inPlaza(cx, cz)) continue;
      const o = this.blockSize / 2 + 3.0;
      lamps.push([cx - o, cz - this.blockSize * 0.25]);
      lamps.push([cx + o, cz + this.blockSize * 0.25]);
    }
    const poleIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.6, metalness: 0.6 }), lamps.length);
    const headIM = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd877, emissiveIntensity: 1.0 }), lamps.length);
    lamps.forEach(([x, z], i) => {
      m4.makeTranslation(x, 2.8, z); poleIM.setMatrixAt(i, m4);
      m4.makeTranslation(x, 5.7, z); headIM.setMatrixAt(i, m4);
    });
    poleIM.castShadow = true; this.scene.add(poleIM, headIM);

    // crosswalks
    const tex = makeCrosswalkTexture();
    const cross = [];
    for (let i = 0; i < this.blocks - 1; i++) for (let j = 0; j < this.blocks - 1; j++) {
      const x = start + i * pitch + pitch / 2, z = start + j * pitch + pitch / 2;
      if (inPlaza(x, z)) continue;
      cross.push([x, z]);
    }
    const cIM = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(this.street + 6, this.street + 6),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95 }), cross.length);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    cross.forEach(([x, z], i) => { m4.compose(new THREE.Vector3(x, 0.04, z), flat, sV); cIM.setMatrixAt(i, m4); });
    cIM.receiveShadow = true; this.scene.add(cIM);
  }

  _scatterRoofProps() {
    const rng = mulberry32(99);
    for (const b of this.buildings) {
      const c = b.box.getCenter(new THREE.Vector3());
      if (rng() < 0.3) {
        const tank = new THREE.Mesh(
          new THREE.CylinderGeometry(3, 3.4, 6, 12),
          new THREE.MeshStandardMaterial({ color: 0x5a4634, roughness: 0.9 }));
        tank.position.set(c.x, b.height + 3, c.z);
        tank.castShadow = true; this.scene.add(tank);
      }
      if (rng() < 0.4) { // AC / mechanical box
        const ac = new THREE.Mesh(
          new THREE.BoxGeometry(4, 2, 4),
          new THREE.MeshStandardMaterial({ color: 0x787c84, roughness: 0.8, metalness: 0.3 }));
        ac.position.set(c.x + (rng() - 0.5) * 6, b.height + 1.2, c.z + (rng() - 0.5) * 6);
        ac.castShadow = true; this.scene.add(ac);
      }
    }
  }

  // ---- Physics / query helpers (unchanged API) ----------------------------

  collideSphere(pos, radius) {
    const result = { pos: pos.clone(), onWall: false, wallNormal: null, hitTop: false };
    for (let i = 0; i < this.buildings.length + this.carColliders.length; i++) {
      const box = i < this.buildings.length
        ? this.buildings[i].box
        : this.carColliders[i - this.buildings.length];
      if (pos.x + radius < box.min.x || pos.x - radius > box.max.x) continue;
      if (pos.z + radius < box.min.z || pos.z - radius > box.max.z) continue;
      if (pos.y + radius < box.min.y || pos.y - radius > box.max.y) continue;

      const cx = clamp(result.pos.x, box.min.x, box.max.x);
      const cy = clamp(result.pos.y, box.min.y, box.max.y);
      const cz = clamp(result.pos.z, box.min.z, box.max.z);
      const dx = result.pos.x - cx, dy = result.pos.y - cy, dz = result.pos.z - cz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < radius * radius && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        result.pos.x += nx * push; result.pos.y += ny * push; result.pos.z += nz * push;
        if (Math.abs(ny) > 0.5 && dy > 0) result.hitTop = true;
        else { result.onWall = true; result.wallNormal = new THREE.Vector3(nx, ny, nz); }
      }
    }
    return result;
  }

  raycast(origin, dir, maxDist) {
    let best = null;
    for (const b of this.buildings) {
      const hit = rayBox(origin, dir, b.box, maxDist);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }

  findSwingAnchor(origin, lookDir, maxDist) {
    const candidates = [];
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(lookDir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, lookDir).normalize();
    for (let yaw = -0.5; yaw <= 0.5; yaw += 0.25) {
      for (let pitch = 0.1; pitch <= 0.9; pitch += 0.2) {
        const dir = lookDir.clone().addScaledVector(right, yaw).addScaledVector(realUp, pitch).normalize();
        const hit = this.raycast(origin, dir, maxDist);
        if (hit && hit.point.y > origin.y + 4) candidates.push(hit);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.point.y - a.point.y) - (a.t - b.t) * 0.5);
    return candidates[0];
  }
}

// ---- helpers ---------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rayBox(origin, dir, box, maxDist) {
  let tmin = 0, tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];
  let hitAxis = 0, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (o[i] < lo[i] || o[i] > hi[i]) return null; }
    else {
      const inv = 1 / d[i];
      let t1 = (lo[i] - o[i]) * inv, t2 = (hi[i] - o[i]) * inv, s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; hitAxis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  const point = new THREE.Vector3(origin.x + dir.x * tmin, origin.y + dir.y * tmin, origin.z + dir.z * tmin);
  const normal = new THREE.Vector3(); normal.setComponent(hitAxis, sign);
  return { t: tmin, point, normal };
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

// ---- textures --------------------------------------------------------------

function noise(ctx, w, h, amt, base) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = base + (Math.random() - 0.5) * amt;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function makeAsphaltTexture(repeat) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  noise(ctx, 128, 128, 26, 54);                 // grainy dark asphalt
  // patina: faint oil streaks & patches
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${20 + Math.random() * 30},${20 + Math.random() * 30},${24 + Math.random() * 30},0.25)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 128, Math.random() * 128, 4 + Math.random() * 18, 3 + Math.random() * 10, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSidewalkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  noise(ctx, 128, 128, 22, 150);                // light-grey concrete
  // expansion joints (the slab grid)
  ctx.strokeStyle = 'rgba(60,60,64,0.5)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  // patina stains
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(70,68,64,${0.06 + Math.random() * 0.12})`;
    ctx.beginPath(); ctx.arc(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 12, 0, 7); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCrosswalkTexture() {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(232,232,236,0.82)';
  const band = 18, stripe = 6, gap = 6;
  for (let x = 8; x < S - 8; x += stripe + gap) { ctx.fillRect(x, 2, stripe, band); ctx.fillRect(x, S - band - 2, stripe, band); }
  for (let y = 8; y < S - 8; y += stripe + gap) { ctx.fillRect(2, y, band, stripe); ctx.fillRect(S - band - 2, y, band, stripe); }
  return new THREE.CanvasTexture(c);
}

// Three reusable facade textures (full colour). Cloned + tinted per building.
function makeFacadeTextures() {
  return {
    glass: makeGlassFacade(),
    office: makeOfficeFacade(),
    brick: makeBrickFacade(),
  };
}

function makeGlassFacade() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, '#5b7fa6'); g.addColorStop(1, '#3a5577');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(20,30,45,0.6)'; ctx.lineWidth = 1;
  for (let y = 0; y <= 64; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke(); }
  for (let x = 0; x <= 64; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
  for (let y = 2; y < 64; y += 6) for (let x = 1; x < 64; x += 8)
    if (Math.random() > 0.7) { ctx.fillStyle = 'rgba(255,236,170,0.5)'; ctx.fillRect(x, y, 6, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}

function makeOfficeFacade() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a9388'; ctx.fillRect(0, 0, 64, 64);    // concrete/stone
  for (let y = 4; y < 64; y += 10) for (let x = 4; x < 64; x += 10) {
    ctx.fillStyle = Math.random() > 0.65 ? '#ffe9a8' : '#2b2f38';
    ctx.fillRect(x, y, 6, 7);
    ctx.strokeStyle = 'rgba(40,38,34,0.6)'; ctx.strokeRect(x - 1, y - 1, 8, 9);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}

function makeBrickFacade() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a3b2e'; ctx.fillRect(0, 0, 64, 64);     // brick base
  ctx.strokeStyle = 'rgba(40,20,16,0.4)'; ctx.lineWidth = 1;
  for (let y = 0; y < 64; y += 5) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke();
    const off = (y / 5) % 2 ? 5 : 0;
    for (let x = off; x < 64; x += 10) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 5); ctx.stroke(); }
  }
  for (let y = 6; y < 64; y += 16) for (let x = 8; x < 64; x += 16) {
    ctx.fillStyle = Math.random() > 0.6 ? '#ffe9a8' : '#20232b';
    ctx.fillRect(x, y, 8, 10);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
