import * as THREE from 'three';

// A stylised Spider-Man built from primitives — no external assets to load.
// Articulated rig: each arm has shoulder + ELBOW joints (upper arm / forearm /
// hand), each leg has hip + KNEE + ANKLE joints (thigh / shin / foot), so run,
// swing and crawl poses read like a human superhero rather than stiff tubes.
// Origin is at the feet, +Z forward.

export function createSpiderMan() {
  const root = new THREE.Group();

  const red = new THREE.MeshStandardMaterial({ color: 0xc8132b, roughness: 0.45, metalness: 0.1 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d3f8c, roughness: 0.5, metalness: 0.1 });
  const darkRed = new THREE.MeshStandardMaterial({ color: 0x9c0f22, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.2 });

  // ---- torso (heroic V-taper) ----
  const HIP_Y = 1.02;
  const body = new THREE.Group();
  body.position.y = HIP_Y;
  root.add(body);

  // chest: wide at the shoulders
  const chest = mesh(new THREE.SphereGeometry(0.25, 16, 12), red, [0, 0.40, 0]);
  chest.scale.set(1.15, 1.0, 0.68);
  // abdomen: narrower waist
  const abs = mesh(new THREE.CylinderGeometry(0.17, 0.20, 0.30, 12), red, [0, 0.14, 0]);
  // pelvis (blue trunks)
  const pelvis = mesh(new THREE.SphereGeometry(0.21, 12, 10), blue, [0, -0.04, 0]);
  pelvis.scale.set(1.1, 0.75, 0.85);
  body.add(chest, abs, pelvis);

  // spider emblem on the chest
  const emblem = mesh(new THREE.SphereGeometry(0.05, 8, 8), black, [0, 0.43, 0.165]);
  emblem.scale.set(0.8, 1.6, 0.3);
  body.add(emblem);

  // deltoids — modest shoulder caps
  const deltL = mesh(new THREE.SphereGeometry(0.085, 10, 10), red, [-0.305, 0.50, 0]);
  const deltR = mesh(new THREE.SphereGeometry(0.085, 10, 10), red, [0.305, 0.50, 0]);
  body.add(deltL, deltR);

  // ---- head + neck ----
  const neck = mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.16, 8), red, [0, 0.68, 0]);
  const head = mesh(new THREE.SphereGeometry(0.175, 16, 16), red, [0, 0.88, 0.01]);
  head.scale.set(0.9, 1.1, 1.0);
  const eyeL = mesh(new THREE.SphereGeometry(0.078, 10, 10), eyeMat, [-0.078, 0.90, 0.13]);
  const eyeR = mesh(new THREE.SphereGeometry(0.078, 10, 10), eyeMat, [0.078, 0.90, 0.13]);
  eyeL.scale.set(0.85, 1.35, 0.45); eyeL.rotation.z = 0.28;
  eyeR.scale.set(0.85, 1.35, 0.45); eyeR.rotation.z = -0.28;
  body.add(neck, head, eyeL, eyeR);

  // ---- arms: shoulder → elbow → hand ----
  // classic suit: red shoulders, blue mid-arm, red gloves
  const armL = makeArm(-0.32, 0.50, blue, red);
  const armR = makeArm(0.32, 0.50, blue, red);
  body.add(armL.shoulder, armR.shoulder);

  // ---- legs: hip → knee → ankle ----
  // blue legs, red boots
  const legL = makeLeg(-0.15, 0.02, blue, darkRed, red);
  const legR = makeLeg(0.15, 0.02, blue, darkRed, red);
  body.add(legL.hip, legR.hip);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return {
    root,
    parts: { body, head, armL, armR, legL, legR },
    _t: 0,

    // pose: 'run' | 'idle' | 'air' | 'swing' | 'crawl'
    update(dt, pose, speed01) {
      this._t += dt * (2 + speed01 * 10);
      const t = this._t;
      const s = Math.sin(t);
      const c = Math.cos(t);

      switch (pose) {
        case 'run': {
          const amp = 0.65 + speed01 * 0.45;
          // hips swing opposite each other
          legL.hip.rotation.x = s * amp;
          legR.hip.rotation.x = -s * amp;
          // knee folds hardest while that leg recovers forward
          legL.knee.rotation.x = Math.max(0.12, (1 - c) * 0.5 * (1.1 + speed01 * 0.5));
          legR.knee.rotation.x = Math.max(0.12, (1 + c) * 0.5 * (1.1 + speed01 * 0.5));
          // ankle flex through the stride
          legL.ankle.rotation.x = -0.2 + s * 0.35;
          legR.ankle.rotation.x = -0.2 - s * 0.35;
          // arms pump opposite the legs, elbows held bent like a sprinter
          armL.shoulder.rotation.x = -s * amp * 0.9;
          armR.shoulder.rotation.x = s * amp * 0.9;
          armL.shoulder.rotation.z = 0.18; armR.shoulder.rotation.z = -0.18;
          armL.elbow.rotation.x = -1.4; armR.elbow.rotation.x = -1.4;
          body.rotation.x = 0.22 + speed01 * 0.08;
          body.position.y = HIP_Y + Math.abs(c) * 0.06;
          break;
        }
        case 'air': {
          // skydive spread, knees tucked asymmetrically
          legL.hip.rotation.x = -0.5;  legL.knee.rotation.x = 1.5;  legL.ankle.rotation.x = 0.4;
          legR.hip.rotation.x = -1.0;  legR.knee.rotation.x = 0.7;  legR.ankle.rotation.x = 0.3;
          armL.shoulder.rotation.x = -2.0; armL.shoulder.rotation.z = 0.7;  armL.elbow.rotation.x = -0.5;
          armR.shoulder.rotation.x = -2.0; armR.shoulder.rotation.z = -0.7; armR.elbow.rotation.x = -0.5;
          body.rotation.x = 0.12;
          body.position.y = HIP_Y;
          break;
        }
        case 'swing': {
          // both arms reach overhead toward the web line, legs trail
          armL.shoulder.rotation.x = -2.85; armL.shoulder.rotation.z = 0.22; armL.elbow.rotation.x = -0.25;
          armR.shoulder.rotation.x = -2.85; armR.shoulder.rotation.z = -0.22; armR.elbow.rotation.x = -0.25;
          legL.hip.rotation.x = -0.55 + s * 0.25; legL.knee.rotation.x = 0.9 + s * 0.2;
          legR.hip.rotation.x = -0.35 - s * 0.25; legR.knee.rotation.x = 1.2 - s * 0.2;
          legL.ankle.rotation.x = 0.5; legR.ankle.rotation.x = 0.5; // toes pointed
          body.rotation.x = -0.3;
          body.position.y = HIP_Y;
          break;
        }
        case 'crawl': {
          // on all fours against the wall
          body.rotation.x = 1.25;
          const ca = 0.45;
          legL.hip.rotation.x = s * ca - 0.5;  legL.knee.rotation.x = 1.1 + s * 0.3;
          legR.hip.rotation.x = -s * ca - 0.5; legR.knee.rotation.x = 1.1 - s * 0.3;
          legL.ankle.rotation.x = 0.5; legR.ankle.rotation.x = 0.5;
          armL.shoulder.rotation.x = -s * ca - 0.9; armL.shoulder.rotation.z = 0.55;
          armR.shoulder.rotation.x = s * ca - 0.9;  armR.shoulder.rotation.z = -0.55;
          armL.elbow.rotation.x = -1.0; armR.elbow.rotation.x = -1.0;
          body.position.y = HIP_Y - 0.25;
          break;
        }
        default: { // idle — relaxed stance, soft breathing
          const b = Math.sin(t * 0.5) * 0.04;
          legL.hip.rotation.x = 0; legR.hip.rotation.x = 0;
          legL.knee.rotation.x = 0.08; legR.knee.rotation.x = 0.08;
          legL.ankle.rotation.x = -0.08; legR.ankle.rotation.x = -0.08;
          armL.shoulder.rotation.x = b; armR.shoulder.rotation.x = -b;
          armL.shoulder.rotation.z = 0.14; armR.shoulder.rotation.z = -0.14;
          armL.elbow.rotation.x = -0.3; armR.elbow.rotation.x = -0.3;
          body.rotation.x = 0;
          body.position.y = HIP_Y + b * 0.3;
        }
      }
    },
  };

  // ---- rig builders --------------------------------------------------------

  function mesh(geo, mat, pos) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    return m;
  }

  // upper arm (sleeve color) → elbow → forearm → red glove
  function makeArm(x, y, sleeveMat, gloveMat) {
    const UPPER = 0.34, FORE = 0.31;
    const shoulder = new THREE.Group();
    shoulder.position.set(x, y, 0);

    const upper = mesh(new THREE.CapsuleGeometry(0.075, UPPER, 4, 8), sleeveMat, [0, -UPPER / 2, 0]);
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -UPPER;
    shoulder.add(elbow);

    const fore = mesh(new THREE.CapsuleGeometry(0.065, FORE, 4, 8), sleeveMat, [0, -FORE / 2, 0]);
    elbow.add(fore);

    const hand = mesh(new THREE.SphereGeometry(0.085, 8, 8), gloveMat, [0, -FORE - 0.04, 0]);
    hand.scale.set(0.8, 1.15, 0.9);
    elbow.add(hand);
    // glove cuff
    const cuff = mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.12, 8), gloveMat, [0, -FORE + 0.04, 0]);
    elbow.add(cuff);

    return { shoulder, elbow, hand };
  }

  // thigh → knee → shin → ankle → foot (red boots from mid-shin)
  function makeLeg(x, y, legMat, bootMat, footMat) {
    const THIGH = 0.42, SHIN = 0.40;
    const hip = new THREE.Group();
    hip.position.set(x, y, 0);

    const thigh = mesh(new THREE.CapsuleGeometry(0.10, THIGH, 4, 8), legMat, [0, -THIGH / 2, 0]);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);

    const shin = mesh(new THREE.CapsuleGeometry(0.08, SHIN, 4, 8), legMat, [0, -SHIN / 2, 0]);
    knee.add(shin);
    // boot upper wraps the lower shin
    const bootTop = mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.22, 8), bootMat, [0, -SHIN + 0.08, 0]);
    knee.add(bootTop);

    const ankle = new THREE.Group();
    ankle.position.y = -SHIN;
    knee.add(ankle);

    const foot = mesh(new THREE.BoxGeometry(0.13, 0.09, 0.26), footMat, [0, -0.045, 0.06]);
    ankle.add(foot);

    return { hip, knee, ankle, foot };
  }
}
