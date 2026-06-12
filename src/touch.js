// PUBG Mobile-style touch controls.
//   • Left thumb: floating virtual joystick → analog movement (input.moveAxis)
//   • Right side: drag anywhere to look (feeds input.mouseDX/DY, like mouse-look)
//   • Action buttons (right cluster): Swing, Jump, Sprint, Cling + small top
//     buttons for camera distance & respawn.
// It writes into the SAME input object the keyboard/mouse uses, so the rest of
// the game is unchanged — touch just synthesises keys, look deltas and an
// analog move axis.

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

export function setupTouchControls(input) {
  document.body.classList.add('touch');

  // analog movement vector consumed by Player (x = strafe, y = forward)
  input.moveAxis = { x: 0, y: 0 };

  const root = document.createElement('div');
  root.id = 'touch-ui';
  document.body.appendChild(root);

  // ----- floating joystick visual -----
  const joy = document.createElement('div');
  joy.className = 'joy';
  const joyBase = document.createElement('div');
  joyBase.className = 'joy-base';
  const joyKnob = document.createElement('div');
  joyKnob.className = 'joy-knob';
  joy.append(joyBase, joyKnob);
  joy.style.display = 'none';
  root.appendChild(joy);

  const JOY_RADIUS = 64;

  // ----- action buttons -----
  function makeButton(label, cls, { hold, code, onPress } = {}) {
    const b = document.createElement('button');
    b.className = `touch-btn ${cls}`;
    b.innerHTML = label;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('active');
      if (onPress) onPress();
      if (code) input.keys[code] = true;
    }, { passive: false });
    const release = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      b.classList.remove('active');
      if (code && hold) input.keys[code] = false;
      else if (code && !hold) input.keys[code] = false; // momentary too
    };
    b.addEventListener('touchend', release, { passive: false });
    b.addEventListener('touchcancel', release, { passive: false });
    root.appendChild(b);
    return b;
  }

  // big primary = web swing (edge-triggered, toggles swing on/off in Player)
  makeButton('WEB', 'btn-swing', { onPress: () => { input.webPressed = true; } });
  // jump (hold-ish; Player reads Space as level-triggered)
  makeButton('JUMP', 'btn-jump', { hold: true, code: 'Space' });
  // sprint (hold) — wall-climbing is automatic: jump/run into a building
  makeButton('RUN', 'btn-sprint', { hold: true, code: 'ShiftLeft' });
  // small utility buttons
  makeButton('CAM', 'btn-cam', { hold: true, code: 'KeyC' });
  makeButton('⟳', 'btn-respawn', { hold: true, code: 'KeyR' });

  // ----- gesture tracking on the canvas/background -----
  const half = () => window.innerWidth / 2;
  let joyId = null, joyOrigin = null;
  let lookId = null, lookLast = null;

  function onStart(e) {
    for (const t of e.changedTouches) {
      // ignore touches that land on a button
      if (t.target.closest && t.target.closest('.touch-btn')) continue;
      if (t.clientX < half() && joyId === null) {
        joyId = t.identifier;
        joyOrigin = { x: t.clientX, y: t.clientY };
        joy.style.left = `${t.clientX}px`;
        joy.style.top = `${t.clientY}px`;
        joy.style.display = 'block';
        joyKnob.style.transform = 'translate(-50%, -50%)';
      } else if (t.clientX >= half() && lookId === null) {
        lookId = t.identifier;
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  function onMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        let dx = t.clientX - joyOrigin.x;
        let dy = t.clientY - joyOrigin.y;
        const d = Math.hypot(dx, dy);
        if (d > JOY_RADIUS) { dx *= JOY_RADIUS / d; dy *= JOY_RADIUS / d; }
        joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        input.moveAxis.x = dx / JOY_RADIUS;
        input.moveAxis.y = -dy / JOY_RADIUS; // up = forward
      } else if (t.identifier === lookId) {
        input.mouseDX += (t.clientX - lookLast.x) * 1.4;
        input.mouseDY += (t.clientY - lookLast.y) * 1.4;
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  }

  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyId = null;
        input.moveAxis.x = 0;
        input.moveAxis.y = 0;
        joy.style.display = 'none';
      }
      if (t.identifier === lookId) lookId = null;
    }
  }

  // Attach to window so multi-touch across the whole screen is captured;
  // button touches are filtered out via stopPropagation + target checks.
  window.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd, { passive: false });
  window.addEventListener('touchcancel', onEnd, { passive: false });
}
