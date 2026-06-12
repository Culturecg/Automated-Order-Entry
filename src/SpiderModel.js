import * as THREE from 'three';

// A stylised Spider-Man built entirely from primitives — no external assets to
// load. Exposes a few limb references so the Player can animate run / swing /
// crawl poses. The whole rig hangs off a single group whose origin sits at the
// character's feet, +Z forward.

export function createSpiderMan() {
  const root = new THREE.Group();

  const red = new THREE.MeshStandardMaterial({ color: 0xc8132b, roughness: 0.5, metalness: 0.1 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d3f8c, roughness: 0.5, metalness: 0.1 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.2 });

  // pivot raised so feet are at y=0; total height ~1.9 units
  const body = new THREE.Group();
  body.position.y = 0.95; // hip height
  root.add(body);

  // torso (red) + lower abdomen (blue)
  const torso = mesh(new THREE.CapsuleGeometry(0.26, 0.45, 4, 10), red, [0, 0.28, 0]);
  const pelvis = mesh(new THREE.CapsuleGeometry(0.24, 0.18, 4, 8), blue, [0, -0.02, 0]);
  body.add(torso, pelvis);

  // head + mask eyes
  const head = mesh(new THREE.SphereGeometry(0.2, 16, 16), red, [0, 0.72, 0]);
  const eyeL = mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat, [-0.09, 0.74, 0.15]);
  const eyeR = mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat, [0.09, 0.74, 0.15]);
  eyeL.scale.set(1, 1.4, 0.6);
  eyeR.scale.set(1, 1.4, 0.6);
  body.add(head, eyeL, eyeR);

  // limbs — each is a pivot group so we can rotate from the joint
  const armL = limb(blue, -0.34, 0.5, 0.55);
  const armR = limb(blue, 0.34, 0.5, 0.55);
  const legL = limb(red, -0.13, 0.0, 0.7);
  const legR = limb(red, 0.13, 0.0, 0.7);
  body.add(armL.pivot, armR.pivot, legL.pivot, legR.pivot);

  root.castShadowDeep = true;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  return {
    root,
    parts: { body, head, armL, armR, legL, legR },
    _t: 0,

    // pose: 'run' | 'idle' | 'air' | 'swing' | 'crawl'
    update(dt, pose, speed01) {
      this._t += dt * (2 + speed01 * 10);
      const s = Math.sin(this._t);
      const c = Math.cos(this._t);

      switch (pose) {
        case 'run': {
          const amp = 0.6 + speed01 * 0.5;
          legL.pivot.rotation.x = s * amp;
          legR.pivot.rotation.x = -s * amp;
          armL.pivot.rotation.x = -s * amp * 0.8;
          armR.pivot.rotation.x = s * amp * 0.8;
          body.rotation.x = 0.18;
          body.position.y = 0.95 + Math.abs(c) * 0.05;
          break;
        }
        case 'air': {
          legL.pivot.rotation.x = -0.5; legR.pivot.rotation.x = -0.9;
          armL.pivot.rotation.x = -2.2; armR.pivot.rotation.x = -2.4;
          armL.pivot.rotation.z = 0.4; armR.pivot.rotation.z = -0.4;
          body.rotation.x = 0.1;
          break;
        }
        case 'swing': {
          // both arms reaching up toward the web line
          armL.pivot.rotation.x = -2.7; armR.pivot.rotation.x = -2.7;
          armL.pivot.rotation.z = 0.25; armR.pivot.rotation.z = -0.25;
          legL.pivot.rotation.x = -0.6 + s * 0.3;
          legR.pivot.rotation.x = -0.4 - s * 0.3;
          body.rotation.x = -0.25;
          break;
        }
        case 'crawl': {
          body.rotation.x = 1.2; // face the wall, belly out
          const ca = 0.5;
          legL.pivot.rotation.x = s * ca - 0.3; legR.pivot.rotation.x = -s * ca - 0.3;
          armL.pivot.rotation.x = -s * ca - 0.3; armR.pivot.rotation.x = s * ca - 0.3;
          armL.pivot.rotation.z = 0.5; armR.pivot.rotation.z = -0.5;
          break;
        }
        default: { // idle
          const b = Math.sin(this._t * 0.5) * 0.05;
          legL.pivot.rotation.x = 0; legR.pivot.rotation.x = 0;
          armL.pivot.rotation.x = b; armR.pivot.rotation.x = -b;
          armL.pivot.rotation.z = 0.08; armR.pivot.rotation.z = -0.08;
          body.rotation.x = 0;
          body.position.y = 0.95 + b * 0.3;
        }
      }
    },
  };
}

function mesh(geo, mat, pos) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

// A two-segment limb whose rotation pivot is at the shoulder/hip.
function limb(mat, x, yTop, length) {
  const pivot = new THREE.Group();
  pivot.position.set(x, yTop, 0);
  const seg = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.08, length, 4, 8),
    mat
  );
  seg.position.y = -length / 2;
  pivot.add(seg);
  return { pivot, seg, length };
}
