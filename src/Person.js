import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

// Low-poly stylised people for the NYC crowd, the robbers, and the boss.
// One builder, many types — distinguished by size, palette and a prop or two.
// Each returns a rig with swinging limbs and a tiny pose API for walk / cower /
// fight / struggle (web-bound) / down.

const TYPES = {
  businessman:   { h: 1.0,  skin: 0xd8a079, top: 0x2a2f3a, leg: 0x23262e, hair: 0x20140c, prop: 'briefcase' },
  businesswoman: { h: 0.98, skin: 0xe2b48c, top: 0x7a3550, leg: 0x2a2330, hair: 0x3a2418, prop: 'bag', skirt: true },
  tourist:       { h: 0.96, skin: 0xe8c099, top: 0x18a0c0, leg: 0xb8a060, hair: 0x2a1c10, prop: 'camera', cap: 0xdd4444 },
  kid:           { h: 0.66, skin: 0xe8c0a0, top: 0xffce3a, leg: 0x2f6fd0, hair: 0x2a1810 },
  grandpa:       { h: 0.92, skin: 0xd8b89a, top: 0x6a6f63, leg: 0x4a4d52, hair: 0xdadada, prop: 'cane', cap: 0x4a4030, slow: true },
  grandma:       { h: 0.88, skin: 0xe0c0a4, top: 0x8a6f9a, leg: 0x6a5560, hair: 0xe8e8e8, prop: 'bag', skirt: true, slow: true },
  homeless:      { h: 0.95, skin: 0xc99d77, top: 0x5a4a32, leg: 0x3e3422, hair: 0x2a2018, cap: 0x33302a },
  vendor:        { h: 1.0,  skin: 0xc98a5a, top: 0xcfd2d6, leg: 0x394150, hair: 0x1c140c, cap: 0xcc3333, apron: true },
  robber:        { h: 1.0,  skin: 0xb98e6a, top: 0x161821, leg: 0x14161d, hair: 0x0c0c10, hood: true },
  boss:          { h: 1.35, skin: 0x4faa3a, top: 0x6a3fb0, leg: 0x3a2470, hair: 0x2a5a22, goblin: true },
};

export const PERSON_TYPES = Object.keys(TYPES).filter((t) => t !== 'robber' && t !== 'boss');

// Cheap background pedestrian: every part merged into ONE mesh (single draw
// call) with baked vertex colours, so we can have big crowds. No limb rig —
// just a whole-body walk bob / lean / cower. Detailed enemies use makePerson.
const _sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.04 });

export function makeMergedPerson(type, rng = Math.random) {
  const cfg = TYPES[type] || TYPES.businessman;
  const s = cfg.h;
  const parts = [];
  const add = (geo, hex, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    const col = new THREE.Color(hex); const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  // legs, torso, head, hair/cap, arms, hands — static A-pose
  add(new THREE.CapsuleGeometry(0.07, 0.34, 3, 6), cfg.leg, -0.09, 0.2 * s + 0.02, 0);
  add(new THREE.CapsuleGeometry(0.07, 0.34, 3, 6), cfg.leg, 0.09, 0.2 * s + 0.02, 0);
  add(new THREE.CapsuleGeometry(0.17, 0.34, 4, 8), cfg.top, 0, 0.62 * s, 0, 1.05, 1, 0.7);
  add(new THREE.SphereGeometry(0.15, 10, 8), cfg.skin, 0, 0.95 * s, 0);
  add(new THREE.SphereGeometry(0.155, 10, 8), cfg.cap || cfg.hair, 0, 1.0 * s, -0.02);
  add(new THREE.CapsuleGeometry(0.05, 0.3, 3, 5), cfg.top, -0.2, 0.6 * s, 0);
  add(new THREE.CapsuleGeometry(0.05, 0.3, 3, 5), cfg.top, 0.2, 0.6 * s, 0);
  add(new THREE.SphereGeometry(0.05, 6, 5), cfg.skin, -0.2, 0.42 * s, 0);
  add(new THREE.SphereGeometry(0.05, 6, 5), cfg.skin, 0.2, 0.42 * s, 0);

  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.Mesh(geo, _sharedMat);
  mesh.castShadow = true;
  const root = new THREE.Group(); root.add(mesh);

  let t = Math.random() * 10; const baseY = 0;
  return {
    root, type, radius: 0.35 * s, height: 1.7 * s,
    update(dt, pose, speed01 = 0) {
      t += dt * (5 + speed01 * 7);
      if (pose === 'cower') { mesh.rotation.x = 0.6; root.position.y = baseY - 0.12; }
      else if (pose === 'walk') {
        mesh.rotation.x = 0.05 + speed01 * 0.05;
        mesh.rotation.z = Math.sin(t) * 0.05;            // sway
        root.position.y = baseY + Math.abs(Math.sin(t)) * 0.04;
      } else { mesh.rotation.set(0, 0, 0); root.position.y = baseY; }
    },
  };
}

export function makePerson(type, rng = Math.random) {
  const cfg = TYPES[type] || TYPES.businessman;
  const root = new THREE.Group();
  const scale = cfg.h;
  const g = new THREE.Group();
  g.scale.setScalar(scale);
  root.add(g);

  const M = (hex, rough = 0.7) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.05 });
  const skin = M(cfg.skin, 0.6), top = M(cfg.top), leg = M(cfg.leg), hair = M(cfg.hair, 0.85);

  const HIP = 0.92;
  const body = new THREE.Group(); body.position.y = HIP; g.add(body);

  // torso
  const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), top, [0, 0.22, 0]);
  torso.scale.set(1.05, 1, 0.7);
  body.add(torso);
  if (cfg.apron) { const ap = mesh(new THREE.BoxGeometry(0.3, 0.4, 0.06), M(0xffffff, 0.8), [0, 0.2, 0.13]); body.add(ap); }

  // head + hair/cap/hood
  const head = mesh(new THREE.SphereGeometry(0.15, 14, 12), skin, [0, 0.56, 0]);
  body.add(head);
  if (cfg.goblin) {
    // pointy goblin ears + brow
    for (const sx of [-1, 1]) body.add(mesh(new THREE.ConeGeometry(0.05, 0.14, 6), skin, [sx * 0.13, 0.62, 0]));
    body.add(mesh(new THREE.SphereGeometry(0.155, 12, 10), M(0x3f8f30, 0.6), [0, 0.5, 0.02]));
  }
  if (cfg.hood) {
    body.add(mesh(new THREE.SphereGeometry(0.18, 12, 10), M(cfg.top, 0.8), [0, 0.55, -0.03]));
    body.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), M(0x101216, 0.6), [0, 0.54, 0.08])); // shadowed face
  } else {
    body.add(mesh(new THREE.SphereGeometry(0.155, 12, 10), hair, [0, 0.62, -0.02]));
    if (cfg.cap) { const cap = mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(cfg.cap), [0, 0.62, 0]); body.add(cap);
      const brim = mesh(new THREE.BoxGeometry(0.22, 0.03, 0.12), M(cfg.cap), [0, 0.6, 0.14]); body.add(brim); }
  }

  // arms (shoulder pivots)
  const arms = [];
  for (const sx of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(sx * 0.2, 0.42, 0); body.add(piv);
    piv.add(mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 6), top, [0, -0.18, 0]));
    piv.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), skin, [0, -0.36, 0])); // hand
    arms.push(piv);
  }
  // legs
  const legs = [];
  for (const sx of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(sx * 0.09, 0.02, 0); body.add(piv);
    if (cfg.skirt) piv.add(mesh(new THREE.CapsuleGeometry(0.07, 0.34, 4, 6), leg, [0, -0.2, 0]));
    else piv.add(mesh(new THREE.CapsuleGeometry(0.065, 0.36, 4, 6), leg, [0, -0.2, 0]));
    piv.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.18), M(0x1a1a1e), [0, -0.4, 0.04])); // shoe
    legs.push(piv);
  }

  // props
  if (cfg.prop === 'briefcase') arms[1].add(mesh(new THREE.BoxGeometry(0.18, 0.14, 0.06), M(0x3a2a1a), [0, -0.4, 0]));
  if (cfg.prop === 'bag') arms[0].add(mesh(new THREE.BoxGeometry(0.14, 0.12, 0.08), M(0x8a3a4a), [0, -0.38, 0]));
  if (cfg.prop === 'cane') arms[1].add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), M(0x4a3420), [0, -0.45, 0.05]));
  if (cfg.prop === 'camera') body.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), M(0x111), [0, 0.34, 0.16]));

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  let t = Math.random() * 10;
  return {
    root, body, arms, legs, type,
    radius: 0.35 * scale,
    height: 1.7 * scale,
    update(dt, pose, speed01 = 0) {
      t += dt * (4 + speed01 * 8);
      const s = Math.sin(t);
      switch (pose) {
        case 'walk':
          legs[0].rotation.x = s * 0.7; legs[1].rotation.x = -s * 0.7;
          arms[0].rotation.x = -s * 0.5; arms[1].rotation.x = s * 0.5;
          body.rotation.x = 0.04; body.position.y = HIP + Math.abs(Math.cos(t)) * 0.02; break;
        case 'cower':
          body.rotation.x = 0.5; body.position.y = HIP - 0.18;
          arms[0].rotation.x = -2.4; arms[1].rotation.x = -2.4;
          legs[0].rotation.x = 0.4; legs[1].rotation.x = 0.4; break;
        case 'fight': {
          const j = Math.sin(t * 3);
          arms[0].rotation.set(-1.4 - j * 0.5, 0, 0.3); arms[1].rotation.set(-1.4 + j * 0.5, 0, -0.3);
          legs[0].rotation.x = 0.15; legs[1].rotation.x = -0.15; body.rotation.x = 0.1; break;
        }
        case 'struggle': {
          const j = Math.sin(t * 12);
          body.rotation.set(j * 0.18, j * 0.4, 0); body.position.y = HIP - 0.05;
          arms[0].rotation.x = -0.4 + j * 0.3; arms[1].rotation.x = -0.4 - j * 0.3;
          legs[0].rotation.x = j * 0.2; legs[1].rotation.x = -j * 0.2; break;
        }
        case 'down':
          body.rotation.x = 1.4; body.position.y = 0.3;
          arms[0].rotation.x = -1.6; arms[1].rotation.x = -1.6;
          legs[0].rotation.x = 0.2; legs[1].rotation.x = -0.2; break;
        default: // idle
          legs[0].rotation.x = 0; legs[1].rotation.x = 0;
          arms[0].rotation.x = 0.05 * s; arms[1].rotation.x = -0.05 * s;
          body.rotation.x = 0; body.position.y = HIP;
      }
    },
  };

  function mesh(geo, m, p) { const x = new THREE.Mesh(geo, m); x.position.set(p[0], p[1], p[2]); return x; }
}
