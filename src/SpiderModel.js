import * as THREE from 'three';

// Funko-Pop Spider-Man, matched to the reference figure:
//  • ENORMOUS rounded-block head ≈ half the total height, almost no neck
//  • big black-rimmed white teardrop eyes; web lines across the red mask
//  • short stocky torso, wide heroic stance, stubby limbs, chunky gloves/boots
//  • classic colour split: red mask/chest-centre/gloves/boots, blue
//    shoulders+upper-arms, blue trunks+legs
// Built from primitives — no external assets. Articulated (shoulders/elbows,
// hips/knees/ankles) with wrist sockets so webs fire from the wrists.
// Origin at the feet, +Z forward.

export function createSpiderMan() {
  const root = new THREE.Group();

  const RED = 0xd61f2b, BLUE = 0x153887;
  const red = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.5, metalness: 0.05 });
  const blue = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.55, metalness: 0.05 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf0ff, emissiveIntensity: 0.35, roughness: 0.15 });
  const maskMat = new THREE.MeshStandardMaterial({ map: makeMaskTexture(RED), roughness: 0.5, metalness: 0.05 });

  // Funko proportions: short body, giant head. Feet at y=0.
  const HIP_Y = 0.60;
  const body = new THREE.Group();
  body.position.y = HIP_Y;
  root.add(body);

  // ---- short, stocky torso ----
  const chest = mesh(new THREE.CapsuleGeometry(0.26, 0.16, 6, 14), red, [0, 0.24, 0]);
  chest.scale.set(1.18, 1.0, 0.82);
  const trunks = mesh(new THREE.SphereGeometry(0.27, 16, 12), blue, [0, 0.0, 0]);
  trunks.scale.set(1.06, 0.82, 0.92);
  // blue side panels reading as the suit's flanks
  const flankL = mesh(new THREE.CapsuleGeometry(0.085, 0.26, 4, 8), blue, [-0.2, 0.18, 0]);
  const flankR = mesh(new THREE.CapsuleGeometry(0.085, 0.26, 4, 8), blue, [0.2, 0.18, 0]);
  body.add(trunks, chest, flankL, flankR);

  // black spider emblem on the chest
  const emblem = mesh(new THREE.CircleGeometry(0.075, 16), black, [0, 0.30, 0.215]);
  emblem.rotation.x = -0.15;
  body.add(emblem);

  // blue deltoid shoulder caps
  body.add(mesh(new THREE.SphereGeometry(0.13, 12, 12), blue, [-0.28, 0.34, 0]));
  body.add(mesh(new THREE.SphereGeometry(0.13, 12, 12), blue, [0.28, 0.34, 0]));

  // ---- tiny neck + GIANT head ----
  const neck = mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.05, 10), red, [0, 0.42, 0]);
  body.add(neck);
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.46;
  body.add(headPivot);

  // rounded-block head: wider-than-tall (≈3:2 like the reference Funko)
  const head = mesh(new THREE.SphereGeometry(0.42, 24, 20), maskMat, [0, 0.40, 0]);
  head.scale.set(1.5, 1.02, 1.12);
  headPivot.add(head);

  // big black-rimmed white teardrop eyes, set wide on the broad mask
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.17, 16, 16), eyeMat, [sx * 0.24, 0.38, 0.40]);
    eye.scale.set(1.1, 1.55, 0.45);
    eye.rotation.z = sx * 0.45;
    eye.rotation.y = sx * -0.28;
    const rim = mesh(new THREE.TorusGeometry(0.17, 0.032, 8, 24), black, [sx * 0.24, 0.38, 0.395]);
    rim.scale.set(1.1, 1.55, 0.55);
    rim.rotation.z = sx * 0.45;
    rim.rotation.y = sx * -0.28;
    headPivot.add(eye, rim);
  }

  // ---- stubby arms: blue shoulder→elbow, red glove ----
  const armL = makeArm(-0.30, 0.36, blue, red);
  const armR = makeArm(0.30, 0.36, blue, red);
  body.add(armL.shoulder, armR.shoulder);

  // ---- short stocky legs: blue, red boots; wide heroic stance ----
  const legL = makeLeg(-0.17, -0.04, blue, red);
  const legR = makeLeg(0.17, -0.04, blue, red);
  body.add(legL.hip, legR.hip);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return {
    root,
    parts: { body, headPivot, armL, armR, legL, legR },
    _t: 0,

    getWristWorld(side, target) {
      root.updateMatrixWorld(true);
      const a = side === 'L' ? armL : armR;
      return a.wrist.getWorldPosition(target);
    },

    // pose: 'run'|'idle'|'air'|'swing'|'climb'|'land'   opts:{attack:{type,t01}}
    update(dt, pose, speed01, opts = {}) {
      this._t += dt * (2 + speed01 * 10);
      const t = this._t;
      const s = Math.sin(t), c = Math.cos(t);

      // reset, then default to a slightly wide heroic stance
      armL.shoulder.rotation.set(0, 0, 0.22);
      armR.shoulder.rotation.set(0, 0, -0.22);
      armL.elbow.rotation.set(0, 0, 0);
      armR.elbow.rotation.set(0, 0, 0);
      legL.hip.rotation.set(0, 0, 0.07);
      legR.hip.rotation.set(0, 0, -0.07);
      legL.knee.rotation.set(0, 0, 0);
      legR.knee.rotation.set(0, 0, 0);
      headPivot.rotation.set(0, 0, 0);

      switch (pose) {
        case 'run': {
          const amp = 0.7 + speed01 * 0.5;
          legL.hip.rotation.x = s * amp; legR.hip.rotation.x = -s * amp;
          legL.knee.rotation.x = Math.max(0.1, (1 - c) * 0.6 * (1 + speed01));
          legR.knee.rotation.x = Math.max(0.1, (1 + c) * 0.6 * (1 + speed01));
          legL.ankle.rotation.x = -0.15 + s * 0.3; legR.ankle.rotation.x = -0.15 - s * 0.3;
          armL.shoulder.rotation.set(-s * amp * 0.9, 0, 0.18);
          armR.shoulder.rotation.set(s * amp * 0.9, 0, -0.18);
          armL.elbow.rotation.x = -1.2; armR.elbow.rotation.x = -1.2;
          body.rotation.x = 0.16 + speed01 * 0.08;
          body.position.y = HIP_Y + Math.abs(c) * 0.05;
          headPivot.rotation.x = -0.1;
          break;
        }
        case 'air': {
          legL.hip.rotation.x = -0.5; legL.knee.rotation.x = 1.4; legL.ankle.rotation.x = 0.3;
          legR.hip.rotation.x = -0.95; legR.knee.rotation.x = 0.7; legR.ankle.rotation.x = 0.3;
          armL.shoulder.rotation.set(-2.0, 0, 0.7); armL.elbow.rotation.x = -0.5;
          armR.shoulder.rotation.set(-2.0, 0, -0.7); armR.elbow.rotation.x = -0.5;
          body.rotation.x = 0.1; body.position.y = HIP_Y;
          break;
        }
        case 'swing': {
          armL.shoulder.rotation.set(-2.95, 0, 0.18); armL.elbow.rotation.x = -0.18;
          armR.shoulder.rotation.set(-2.95, 0, -0.18); armR.elbow.rotation.x = -0.18;
          legL.hip.rotation.x = -0.5 + s * 0.25; legL.knee.rotation.x = 0.85 + s * 0.2;
          legR.hip.rotation.x = -0.32 - s * 0.25; legR.knee.rotation.x = 1.1 - s * 0.2;
          legL.ankle.rotation.x = 0.5; legR.ankle.rotation.x = 0.5;
          body.rotation.x = -0.25; body.position.y = HIP_Y;
          break;
        }
        case 'climb': {
          body.rotation.x = 0.2; body.position.y = HIP_Y;
          const ca = 0.55;
          armL.shoulder.rotation.set(-2.5 + s * ca, 0, 0.35);
          armR.shoulder.rotation.set(-2.5 - s * ca, 0, -0.35);
          armL.elbow.rotation.x = -0.5 - Math.max(0, s) * 0.6;
          armR.elbow.rotation.x = -0.5 - Math.max(0, -s) * 0.6;
          legL.hip.rotation.x = -0.6 - s * ca * 0.8; legL.knee.rotation.x = 0.7 + Math.max(0, -s) * 0.7;
          legR.hip.rotation.x = -0.6 + s * ca * 0.8; legR.knee.rotation.x = 0.7 + Math.max(0, s) * 0.7;
          legL.ankle.rotation.x = 0.3; legR.ankle.rotation.x = 0.3;
          headPivot.rotation.x = -0.25;
          break;
        }
        case 'land': {
          legL.hip.rotation.set(0.5, 0, 0.2); legR.hip.rotation.set(0.5, 0, -0.2);
          legL.knee.rotation.x = 1.0; legR.knee.rotation.x = 1.0;
          legL.ankle.rotation.x = -0.4; legR.ankle.rotation.x = -0.4;
          armL.shoulder.rotation.set(-0.6, 0, 0.5); armL.elbow.rotation.x = -0.4;
          armR.shoulder.rotation.set(-0.6, 0, -0.5); armR.elbow.rotation.x = -0.4;
          body.rotation.x = 0.4; body.position.y = HIP_Y - 0.2;
          break;
        }
        default: { // idle — relaxed heroic stance, soft breathing
          const b = Math.sin(t * 0.5) * 0.04;
          legL.knee.rotation.x = 0.12; legR.knee.rotation.x = 0.12;
          legL.ankle.rotation.x = -0.1; legR.ankle.rotation.x = -0.1;
          armL.shoulder.rotation.set(b, 0, 0.26); armR.shoulder.rotation.set(-b, 0, -0.26);
          armL.elbow.rotation.x = -0.35; armR.elbow.rotation.x = -0.35;
          body.rotation.x = 0; body.position.y = HIP_Y + b * 0.3;
        }
      }

      // ---- combat overlay ----
      const atk = opts.attack;
      if (atk) {
        const e = Math.sin(Math.min(1, atk.t01) * Math.PI);
        if (atk.type === 'punch') {
          armR.shoulder.rotation.set(-1.55 * e - 0.1, 0, -0.05);
          armR.elbow.rotation.x = -0.15 * (1 - e) - 0.05;
          armL.shoulder.rotation.set(0.6 * e, 0, 0.2); armL.elbow.rotation.x = -1.4;
          body.rotation.y = 0.5 * e;
        } else {
          legR.hip.rotation.set(-1.5 * e, 0, -0.07);
          legR.knee.rotation.x = (1 - e) * 1.2 + 0.1;
          legR.ankle.rotation.x = -0.2;
          armL.shoulder.rotation.x = -1.0 * e; armR.shoulder.rotation.x = -0.8 * e;
          body.rotation.x = -0.15 * e;
        }
      }
    },
  };

  // ---- builders ----
  function mesh(geo, mat, pos) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    return m;
  }

  function makeArm(x, y, upperMat, gloveMat) {
    const UPPER = 0.20, FORE = 0.18;
    const shoulder = new THREE.Group();
    shoulder.position.set(x, y, 0);
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.095, UPPER, 4, 8), upperMat, [0, -UPPER / 2, 0]));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER - 0.02;
    shoulder.add(elbow);
    elbow.add(mesh(new THREE.CapsuleGeometry(0.088, FORE, 4, 8), gloveMat, [0, -FORE / 2, 0]));
    const wrist = new THREE.Group();
    wrist.position.y = -FORE - 0.03;
    elbow.add(wrist);
    const hand = mesh(new THREE.SphereGeometry(0.125, 10, 10), gloveMat, [0, -0.03, 0]);
    hand.scale.set(0.95, 1.05, 1.0);
    wrist.add(hand);
    return { shoulder, elbow, wrist, hand };
  }

  function makeLeg(x, y, legMat, bootMat) {
    const THIGH = 0.24, SHIN = 0.22;
    const hip = new THREE.Group();
    hip.position.set(x, y, 0);
    hip.add(mesh(new THREE.CapsuleGeometry(0.13, THIGH, 4, 8), legMat, [0, -THIGH / 2, 0]));
    const knee = new THREE.Group();
    knee.position.y = -THIGH - 0.02;
    hip.add(knee);
    knee.add(mesh(new THREE.CapsuleGeometry(0.115, SHIN, 4, 8), legMat, [0, -SHIN / 2, 0]));
    const ankle = new THREE.Group();
    ankle.position.y = -SHIN - 0.02;
    knee.add(ankle);
    // chunky boot
    knee.add(mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.16, 8), bootMat, [0, -SHIN + 0.05, 0]));
    ankle.add(mesh(new THREE.BoxGeometry(0.18, 0.13, 0.34), bootMat, [0, -0.05, 0.08]));
    return { hip, knee, ankle, foot: ankle };
  }
}

// Red mask texture with black web lines. On a sphere the vertical lines become
// longitude spokes (converging at the top of the head) and the horizontal lines
// become latitude arcs — exactly the way a Funko Spidey mask web reads.
function makeMaskTexture(redHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const r = (redHex >> 16) & 255, g = (redHex >> 8) & 255, b = redHex & 255;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(10,10,14,0.85)';
  ctx.lineWidth = 2.2;
  // longitude spokes
  for (let i = 0; i < 14; i++) {
    const x = (i / 14) * S;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
  }
  // latitude arcs (denser toward the top pole)
  for (let j = 1; j < 9; j++) {
    const y = Math.pow(j / 9, 1.3) * S;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
