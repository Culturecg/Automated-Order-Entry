// Centralised input state: keyboard, mouse-look, and pointer lock.
// Everything the game needs to read each frame lives on the returned object.

export function createInput(canvas) {
  const input = {
    keys: Object.create(null),
    // mouse-look deltas accumulated since last consume()
    mouseDX: 0,
    mouseDY: 0,
    // edge-triggered buttons (latched until the next endFrame)
    webPressed: false,
    webReleased: false,
    punchPressed: false,
    kickPressed: false,
    dodgePressed: false,
    locked: false,
  };

  // --- keyboard ---
  window.addEventListener('keydown', (e) => {
    input.keys[e.code] = true;
    if (!e.repeat) {
      if (e.code === 'KeyJ') input.punchPressed = true;
      if (e.code === 'KeyK') input.kickPressed = true;
      if (e.code === 'KeyQ') input.dodgePressed = true;
    }
    // prevent the page from scrolling when using space / arrows
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    input.keys[e.code] = false;
  });

  // --- pointer lock for mouse-look (desktop only; iOS Safari has no pointer lock) ---
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  canvas.addEventListener('click', () => {
    if (!isTouch && !input.locked) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });

  window.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });

  // --- mouse buttons: left = shoot web, right = release ---
  window.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.webPressed = true;
    if (e.button === 2) input.webReleased = true;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // E also fires a web (keyboard alternative), edge-triggered below.
  let ePrev = false;

  input.consumeMouse = () => {
    const dx = input.mouseDX;
    const dy = input.mouseDY;
    input.mouseDX = 0;
    input.mouseDY = 0;
    return { dx, dy };
  };

  // Call once per frame AFTER reading edge flags to reset them.
  input.endFrame = () => {
    input.webPressed = false;
    input.webReleased = false;
    input.punchPressed = false;
    input.kickPressed = false;
    input.dodgePressed = false;
  };

  // Resolve "E" keyboard into the same edge-triggered web press.
  input.pollKeyboardEdges = () => {
    const eNow = !!input.keys['KeyE'];
    if (eNow && !ePrev) input.webPressed = true;
    ePrev = eNow;
  };

  input.down = (code) => !!input.keys[code];

  return input;
}
