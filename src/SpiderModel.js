import * as THREE from 'three';

// Funko-Pop Spider-Man (matched to the reference figure) with refined anatomy.
//  • giant rounded-block head; eyes are sphere-cap patches CONCENTRIC with the
//    head so they wrap onto its surface (no floating lenses); web-line mask.
//  • sculpted torso (pecs + abs), tapered arms with mitt hands, thighs + calf
//    bulges, shaped boots.
//  • articulated for run/idle/air/swing/climb/land/perch + punch & kick combos.
// Origin at the feet, +Z forward.

const UP = new THREE.Vector3(0, 1, 0);

export function createSpiderMan() {
  const root = new THREE.Group();

  const RED = 0xd61f2b, BLUE = 0x153887;
  const red = mat(RED, 0.5), blue = mat(BLUE, 0.55);
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdce6ff, emissiveIntensity: 0.3, roughness: 0.12, side: THREE.DoubleSide });
  const eyeRimMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.6, side: THREE.DoubleSide });
  const maskMat = new THREE.MeshStandardMaterial({ map: makeMaskTexture(RED), roughness: 0.5, metalness: 0.05 });

  function mat(c, r) { return new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 }); }

  const HIP_Y = 0.60;
  const body = new THREE.Group();
  body.position.y = HIP_Y;
  root.add(body);

  // ---- torso ----
  const chest = m(new THREE.CapsuleGeometry(0.25, 0.16, 6, 14), red, [0, 0.24, 0]);
  chest.scale.set(1.18, 1.0, 0.84);
  const trunks = m(new THREE.SphereGeometry(0.26, 16, 12), blue, [0, 0.0, 0]);
  trunks.scale.set(1.06, 0.82, 0.92);
  const flankL = m(new THREE.CapsuleGeometry(0.08, 0.26, 4, 8), blue, [-0.19, 0.18, 0]);
  const flankR = m(new THREE.CapsuleGeometry(0.08, 0.26, 4, 8), blue, [0.19, 0.18, 0]);
  body.add(trunks, chest, flankL, flankR);

  // pecs
  body.add(scaled(m(new THREE.SphereGeometry(0.12, 12, 10), red, [-0.1, 0.30, 0.13]), [1, 0.8, 0.7]));
  body.add(scaled(m(new THREE.SphereGeometry(0.12, 12, 10), red, [0.1, 0.30, 0.13]), [1, 0.8, 0.7]));
  // abs (2 columns x 3 rows)
  for (let r = 0; r < 3; r++) for (const sx of [-1, 1]) {
    body.add(scaled(m(new THREE.SphereGeometry(0.05, 8, 8), red, [sx * 0.06, 0.16 - r * 0.07, 0.18]), [1, 0.9, 0.6]));
  }
  // spider emblem
  const emblem = m(new THREE.CircleGeometry(0.07, 16), black, [0, 0.33, 0.21]); emblem.rotation.x = -0.12;
  body.add(emblem);
  // deltoids
  body.add(m(new THREE.SphereGeometry(0.125, 12, 12), blue, [-0.28, 0.34, 0]));
  body.add(m(new THREE.SphereGeometry(0.125, 12, 12), blue, [0.28, 0.34, 0]));

  // ---- tiny neck + GIANT wrapped-eye head ----
  body.add(m(new THREE.CylinderGeometry(0.11, 0.14, 0.05, 10), red, [0, 0.42, 0]));
  const headPivot = new THREE.Group(); headPivot.position.y = 0.46; body.add(headPivot);
  const headGroup = new THREE.Group(); headGroup.position.y = 0.40; headPivot.add(headGroup);
  // squarer Funko head: a rounded CUBE (sphere morphed toward a box)
  headGroup.scale.set(1.42, 1.08, 1.12);
  headGroup.add(m(roundedBoxGeo(0.42, 0.5), maskMat, [0, 0, 0]));

  // Eyes: signature swept Spidey lenses (pointed at the inner corner, big
  // rounded outer lobe, tilted up). Flat decals on the front of the head,
  // parented to the unscaled headPivot so they keep their shape.
  const eyeGeo = new THREE.ShapeGeometry(makeSpideyEye(0.26, 0.30));
  for (const sx of [-1, 1]) {
    const white = new THREE.Mesh(eyeGeo, eyeMat);
    const rim = new THREE.Mesh(eyeGeo, eyeRimMat);
    for (const part of [white, rim]) {
      part.scale.set(sx, 1, 1);             // mirror so the point faces centre
      part.position.set(sx * 0.16, 0.49, 0.47);
      part.rotation.z = sx * 0.32;          // sweep the outer lobe upward
    }
    rim.position.z = 0.46; rim.scale.set(sx * 1.18, 1.16, 1);
    headPivot.add(rim, white);
  }

  // ---- arms (blue shoulder→elbow, red glove mitt) ----
  const armL = makeArm(-0.30, 0.36, blue, red);
  const armR = makeArm(0.30, 0.36, blue, red);
  body.add(armL.shoulder, armR.shoulder);

  // ---- legs (blue, calf bulge, red boots) ----
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
      return (side === 'L' ? armL : armR).wrist.getWorldPosition(target);
    },

    // pose: run|idle|air|swing|climb|land|perch ; opts.attack={type,step,variant,t01}
    update(dt, pose, speed01, opts = {}) {
      this._t += dt * (2 + speed01 * 10);
      const t = this._t, s = Math.sin(t), c = Math.cos(t);

      // base heroic stance reset
      armL.shoulder.rotation.set(0, 0, 0.22); armR.shoulder.rotation.set(0, 0, -0.22);
      armL.elbow.rotation.set(0, 0, 0); armR.elbow.rotation.set(0, 0, 0);
      legL.hip.rotation.set(0, 0, 0.07); legR.hip.rotation.set(0, 0, -0.07);
      legL.knee.rotation.set(0, 0, 0); legR.knee.rotation.set(0, 0, 0);
      legL.ankle.rotation.set(0, 0, 0); legR.ankle.rotation.set(0, 0, 0);
      headPivot.rotation.set(0, 0, 0);

      switch (pose) {
        case 'run': {
          const a = 0.7 + speed01 * 0.5;
          legL.hip.rotation.x = s * a; legR.hip.rotation.x = -s * a;
          legL.knee.rotation.x = Math.max(0.1, (1 - c) * 0.6 * (1 + speed01));
          legR.knee.rotation.x = Math.max(0.1, (1 + c) * 0.6 * (1 + speed01));
          legL.ankle.rotation.x = -0.15 + s * 0.3; legR.ankle.rotation.x = -0.15 - s * 0.3;
          armL.shoulder.rotation.set(-s * a * 0.9, 0, 0.18); armR.shoulder.rotation.set(s * a * 0.9, 0, -0.18);
          armL.elbow.rotation.x = -1.2; armR.elbow.rotation.x = -1.2;
          body.rotation.x = 0.16 + speed01 * 0.08; body.position.y = HIP_Y + Math.abs(c) * 0.05;
          headPivot.rotation.x = -0.1; break;
        }
        case 'air':
          legL.hip.rotation.x = -0.5; legL.knee.rotation.x = 1.4; legL.ankle.rotation.x = 0.3;
          legR.hip.rotation.x = -0.95; legR.knee.rotation.x = 0.7; legR.ankle.rotation.x = 0.3;
          armL.shoulder.rotation.set(-2.0, 0, 0.7); armL.elbow.rotation.x = -0.5;
          armR.shoulder.rotation.set(-2.0, 0, -0.7); armR.elbow.rotation.x = -0.5;
          body.rotation.x = 0.1; body.position.y = HIP_Y; break;
        case 'swing':
          armL.shoulder.rotation.set(-2.95, 0, 0.18); armL.elbow.rotation.x = -0.18;
          armR.shoulder.rotation.set(-2.95, 0, -0.18); armR.elbow.rotation.x = -0.18;
          legL.hip.rotation.x = -0.5 + s * 0.25; legL.knee.rotation.x = 0.85 + s * 0.2;
          legR.hip.rotation.x = -0.32 - s * 0.25; legR.knee.rotation.x = 1.1 - s * 0.2;
          legL.ankle.rotation.x = 0.5; legR.ankle.rotation.x = 0.5;
          body.rotation.x = -0.25; body.position.y = HIP_Y; break;
        case 'climb': {
          body.rotation.x = 0.2; body.position.y = HIP_Y; const a = 0.55;
          armL.shoulder.rotation.set(-2.5 + s * a, 0, 0.35); armR.shoulder.rotation.set(-2.5 - s * a, 0, -0.35);
          armL.elbow.rotation.x = -0.5 - Math.max(0, s) * 0.6; armR.elbow.rotation.x = -0.5 - Math.max(0, -s) * 0.6;
          legL.hip.rotation.x = -0.6 - s * a * 0.8; legL.knee.rotation.x = 0.7 + Math.max(0, -s) * 0.7;
          legR.hip.rotation.x = -0.6 + s * a * 0.8; legR.knee.rotation.x = 0.7 + Math.max(0, s) * 0.7;
          legL.ankle.rotation.x = 0.3; legR.ankle.rotation.x = 0.3; headPivot.rotation.x = -0.25; break;
        }
        case 'land':
          legL.hip.rotation.set(0.5, 0, 0.2); legR.hip.rotation.set(0.5, 0, -0.2);
          legL.knee.rotation.x = 1.0; legR.knee.rotation.x = 1.0;
          legL.ankle.rotation.x = -0.4; legR.ankle.rotation.x = -0.4;
          armL.shoulder.rotation.set(-0.6, 0, 0.5); armL.elbow.rotation.x = -0.4;
          armR.shoulder.rotation.set(-0.6, 0, -0.5); armR.elbow.rotation.x = -0.4;
          body.rotation.x = 0.4; body.position.y = HIP_Y - 0.2; break;
        case 'perch': {
          // signature Spidey ledge crouch: deep knee bend, feet planted wide,
          // ONE hand down on the surface, torso upright & forward, head up.
          legL.hip.rotation.set(1.35, 0, 0.4); legR.hip.rotation.set(1.45, 0, -0.3);
          legL.knee.rotation.x = 1.9; legR.knee.rotation.x = 1.85;
          legL.ankle.rotation.x = -0.7; legR.ankle.rotation.x = -0.7;
          // right arm straight down to the ground between the feet
          armR.shoulder.rotation.set(0.55, 0, -0.12); armR.elbow.rotation.x = -0.05;
          // left forearm resting across the knee
          armL.shoulder.rotation.set(-0.15, 0, 0.45); armL.elbow.rotation.x = -1.3;
          body.rotation.x = 0.32; body.position.y = HIP_Y - 0.42; headPivot.rotation.x = -0.45; break;
        }
        case 'downed': {
          // knocked onto his backside, propped on his hands
          legL.hip.rotation.set(-1.0, 0, 0.3); legR.hip.rotation.set(-1.1, 0, -0.3);
          legL.knee.rotation.x = 1.0; legR.knee.rotation.x = 0.9;
          armL.shoulder.rotation.set(1.1, 0, 0.6); armL.elbow.rotation.x = -0.3;
          armR.shoulder.rotation.set(1.1, 0, -0.6); armR.elbow.rotation.x = -0.3;
          body.rotation.x = -0.7; body.position.y = HIP_Y - 0.55; headPivot.rotation.x = 0.3; break;
        }
        case 'block': {
          // braced guard: forearms crossed up in front of the face
          const j = Math.sin(t * 2) * 0.03;
          armL.shoulder.rotation.set(-1.5, 0, 0.6 + j); armL.elbow.rotation.x = -1.9;
          armR.shoulder.rotation.set(-1.5, 0, -0.6 - j); armR.elbow.rotation.x = -1.9;
          legL.hip.rotation.x = 0.15; legR.hip.rotation.x = -0.1;
          legL.knee.rotation.x = 0.4; legR.knee.rotation.x = 0.35;
          body.rotation.x = 0.18; body.position.y = HIP_Y - 0.06; break;
        }
        default: {
          const b = Math.sin(t * 0.5) * 0.04;
          legL.knee.rotation.x = 0.12; legR.knee.rotation.x = 0.12;
          legL.ankle.rotation.x = -0.1; legR.ankle.rotation.x = -0.1;
          armL.shoulder.rotation.set(b, 0, 0.26); armR.shoulder.rotation.set(-b, 0, -0.26);
          armL.elbow.rotation.x = -0.35; armR.elbow.rotation.x = -0.35;
          body.rotation.x = 0; body.position.y = HIP_Y + b * 0.3;
        }
      }

      // ---- combat overlay (judo / Muay Thai flavoured) ----
      if (opts.attack) applyAttack(opts.attack);

      function applyAttack(atk) {
        const e = Math.sin(Math.min(1, atk.t01) * Math.PI); // strike envelope 0→1→0
        const A = atk.variant !== 'B';
        if (atk.type === 'punch') {
          if (atk.step === 0) {                       // jab (lead left) / elbow (B)
            if (A) { armL.shoulder.rotation.set(-1.45 * e - 0.1, 0, 0.05); armL.elbow.rotation.x = -0.1 * (1 - e); body.rotation.y = 0.18 * e; }
            else { armR.shoulder.rotation.set(-0.6 * e, 0.4 * e, -0.2); armR.elbow.rotation.x = -2.2 + e * 0.4; body.rotation.y = -0.5 * e; }
            armR.shoulder.rotation.z = -0.2; armL.elbow.rotation.x = armL.elbow.rotation.x || -1.2;
          } else if (atk.step === 1) {                // cross (right) / hook (left, B)
            if (A) { armR.shoulder.rotation.set(-1.55 * e - 0.1, 0, -0.05); armR.elbow.rotation.x = -0.1 * (1 - e); body.rotation.y = -0.4 * e; armL.elbow.rotation.x = -1.5; }
            else { armL.shoulder.rotation.set(-1.2 * e, 0, 0.2 + 1.0 * e); armL.elbow.rotation.x = -1.4 + e * 0.6; body.rotation.y = 0.5 * e; armR.elbow.rotation.x = -1.5; }
          } else {                                    // uppercut (A) / superman punch (B)
            const rise = e;
            armR.shoulder.rotation.set(0.3 - 1.7 * rise, 0, -0.1); armR.elbow.rotation.x = -1.6 + rise * 1.2;
            armL.shoulder.rotation.set(-0.4, 0, 0.3); armL.elbow.rotation.x = -1.6;
            body.position.y = HIP_Y - (1 - rise) * 0.12;
            body.rotation.x = -0.2 * rise;
          }
        } else { // kick
          if (atk.step === 0) {                       // low kick (A) / push-kick teep (B)
            if (A) { legR.hip.rotation.set(-0.85 * e, 0, -0.5 * e - 0.07); legR.knee.rotation.x = (1 - e) * 1.0 + 0.2; }
            else { legR.hip.rotation.set(-1.3 * e, 0, -0.07); legR.knee.rotation.x = (1 - e) * 1.4 + 0.1; }
            legR.ankle.rotation.x = -0.2; armL.shoulder.rotation.x = -0.7 * e; armR.shoulder.rotation.x = 0.4 * e;
            body.rotation.y = 0.2 * e;
          } else if (atk.step === 1) {                // high head kick (A) / roundhouse (B)
            if (A) { legR.hip.rotation.set(-1.9 * e, 0, -0.07); legR.knee.rotation.x = (1 - e) * 1.4 + 0.1; }
            else { legR.hip.rotation.set(-1.1 * e, -0.9 * e, -0.07); legR.knee.rotation.x = (1 - e) * 1.2 + 0.2; body.rotation.y = -0.6 * e; }
            legR.ankle.rotation.x = -0.3; armL.shoulder.rotation.set(-1.2 * e, 0, 0.6);
            armR.shoulder.rotation.set(-0.4 * e, 0, -0.8);
          } else {                                    // jumping 360 spin kick (A) / jumping knee (B)
            if (A) { legR.hip.rotation.set(-1.1, -1.0 * e, -0.07); legR.knee.rotation.x = 0.2; }
            else { legR.hip.rotation.set(-1.7 * e, 0, -0.07); legR.knee.rotation.x = 1.6 * e + 0.2; }
            legL.knee.rotation.x = 0.8;
            armL.shoulder.rotation.set(-1.4 * e, 0, 1.0); armR.shoulder.rotation.set(-1.4 * e, 0, -1.0);
            body.rotation.x = -0.15;
          }
        }
      }
    },
  };

  // ---- builders ----
  function m(geo, material, pos) { const x = new THREE.Mesh(geo, material); x.position.set(pos[0], pos[1], pos[2]); return x; }
  function scaled(mesh, s) { mesh.scale.set(s[0], s[1], s[2]); return mesh; }

  function eyeCap(radius, thetaLen, material, dir, roll, ovalScale) {
    const geo = new THREE.SphereGeometry(radius, 20, 14, 0, Math.PI * 2, 0, thetaLen);
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.set(ovalScale[0], ovalScale[1], ovalScale[2]);
    const qOrient = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll);
    mesh.quaternion.copy(qOrient).multiply(qRoll);
    return mesh;
  }

  function makeArm(x, y, upperMat, gloveMat) {
    const UPPER = 0.20, FORE = 0.18;
    const shoulder = new THREE.Group(); shoulder.position.set(x, y, 0);
    shoulder.add(scaled(m(new THREE.CapsuleGeometry(0.092, UPPER, 4, 8), upperMat, [0, -UPPER / 2, 0]), [1.05, 1, 1.05])); // bicep
    const elbow = new THREE.Group(); elbow.position.y = -UPPER - 0.02; shoulder.add(elbow);
    elbow.add(m(new THREE.CapsuleGeometry(0.082, FORE, 4, 8), gloveMat, [0, -FORE / 2, 0]));
    const wrist = new THREE.Group(); wrist.position.y = -FORE - 0.03; elbow.add(wrist);
    // smooth rounded glove (a soft mitt) + a little thumb
    const palm = m(new THREE.SphereGeometry(0.075, 12, 10), gloveMat, [0, -0.09, 0]);
    palm.scale.set(0.95, 1.35, 0.8);
    const thumb = m(new THREE.CapsuleGeometry(0.026, 0.05, 4, 6), gloveMat, [0.06, -0.07, 0.02]); thumb.rotation.z = 0.7;
    wrist.add(palm, thumb);
    return { shoulder, elbow, wrist, hand: palm };
  }

  function makeLeg(x, y, legMat, bootMat) {
    const THIGH = 0.24, SHIN = 0.22;
    const hip = new THREE.Group(); hip.position.set(x, y, 0);
    hip.add(scaled(m(new THREE.CapsuleGeometry(0.13, THIGH, 4, 8), legMat, [0, -THIGH / 2, 0]), [1.05, 1, 1.05])); // thigh
    const knee = new THREE.Group(); knee.position.y = -THIGH - 0.02; hip.add(knee);
    knee.add(m(new THREE.CapsuleGeometry(0.105, SHIN, 4, 8), legMat, [0, -SHIN / 2, 0]));
    knee.add(scaled(m(new THREE.SphereGeometry(0.085, 8, 8), legMat, [0, -SHIN * 0.45, -0.05]), [1, 1.4, 1])); // calf bulge
    const ankle = new THREE.Group(); ankle.position.y = -SHIN - 0.02; knee.add(ankle);
    knee.add(m(new THREE.CapsuleGeometry(0.085, 0.12, 4, 8), bootMat, [0, -SHIN + 0.04, 0])); // boot ankle
    // smooth boot: a capsule sole laid forward + rounded toe
    const sole = m(new THREE.CapsuleGeometry(0.075, 0.16, 4, 8), bootMat, [0, -0.07, 0.05]);
    sole.rotation.x = Math.PI / 2; sole.scale.set(1, 1, 0.8);
    ankle.add(sole);
    return { hip, knee, ankle, foot: ankle };
  }
}

// Red mask texture: black web lines + the two big white Funko eyes painted on
// the front of the head (UV ≈ 0.25, 0.5). The eyes are pointed almonds (wide,
// rounded outer-top lobe tapering to a sharp inner point) with thick black rims.
function makeMaskTexture(redHex) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const r = (redHex >> 16) & 255, g = (redHex >> 8) & 255, b = redHex & 255;
  ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, S, S);

  // web lines
  ctx.strokeStyle = 'rgba(10,10,14,0.8)'; ctx.lineWidth = 1.8;
  for (let i = 0; i < 16; i++) { const x = (i / 16) * S; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
  for (let j = 1; j < 10; j++) { const y = Math.pow(j / 10, 1.3) * S; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }

  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// Signature Spider-Man eye: a sharp point at the inner corner (-x), sweeping
// out to a big rounded lobe (+x). Drawn for the right eye; mirror for the left.
function makeSpideyEye(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.5, 0);                                   // inner point
  s.bezierCurveTo(-w * 0.2, h * 0.62, w * 0.25, h * 0.55, w * 0.45, h * 0.22); // top sweep to outer
  s.quadraticCurveTo(w * 0.6, 0, w * 0.42, -h * 0.32);     // round outer lobe
  s.bezierCurveTo(w * 0.1, -h * 0.5, -w * 0.25, -h * 0.32, -w * 0.5, 0); // bottom back to point
  return s;
}

// A rounded cube: a sphere whose verts are pushed toward the enclosing box by
// `k` (0 = sphere, 1 = cube). Gives the boxy-but-soft Funko head silhouette.
function roundedBoxGeo(r, k) {
  const g = new THREE.SphereGeometry(r, 40, 30);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().multiplyScalar(1 / r);
    const mx = Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) || 1;
    const cube = n.multiplyScalar(1 / mx).multiplyScalar(r);  // project to cube face
    v.lerp(cube, k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true; g.computeVertexNormals();
  return g;
}
