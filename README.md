# Spider-Man · NYC — Third-Person Prototype

A browser-based 3D prototype that nails the **core feel** first: a GTA-style
third-person camera and Spider-Man's signature traversal (run, jump,
**web-swing**, and wall-crawl) through a procedurally generated New York City
skyline. No build step, no external art assets — it runs straight in a modern
browser using [Three.js](https://threejs.org/) loaded from a CDN.

> Goal of this milestone: **get the perspective and the gameplay right.**
> Levels, missions, enemies and story come next.

## Run it

ES module import maps need to be served over HTTP (not opened as a `file://`).
Pick any static server:

```bash
# Option A — Node (no install)
npx serve .

# Option B — Python
python3 -m http.server 8080

# Option C — npm script (alias for `npx serve`)
npm start
```

Then open the printed URL (e.g. http://localhost:3000 or http://localhost:8080)
and **click the screen** to lock the mouse and start swinging.

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move (relative to camera) |
| `Mouse` | Look / orbit the third-person camera |
| `Shift` | Sprint |
| `Space` | Jump · (in a swing) launch off the web · (on a wall) leap off |
| `Left Click` / `E` | Shoot web & swing (auto-aims at the best nearby building) |
| `Right Click` | Release web |
| `F` | Cling to & climb walls (hold) |
| `C` | Cycle camera distance |
| `R` | Respawn at city center |

### On iPhone / touch devices (PUBG-style)
Touch controls appear automatically on phones and tablets:
- **Left thumb** — floating virtual joystick to move (analog: push further = faster).
- **Right side** — drag anywhere to look / aim the camera.
- **WEB** (big red button) — shoot web & swing; tap again to release.
- **JUMP**, **RUN** (sprint, hold), **CLING** (wall-crawl, hold).
- Small top-right buttons: **CAM** (camera distance) and **⟳** (respawn).

**Open it on an iPhone via GitHub Pages:** visit
`https://culturecg.github.io/Automated-Order-Entry/` in Safari, then tap
**CLICK TO SWING IN**.

> **One-time Pages setup (repo admin):** the deploy workflow can't enable Pages
> by itself. Go to **Settings → Pages → Build and deployment → Source** and
> select **GitHub Actions**. After that, every push to this branch (or `main`)
> auto-deploys via `.github/workflows/pages.yml`; watch progress in the
> **Actions** tab.

**No-deploy alternative (same Wi-Fi):** run `npm start` on a computer, find its
local IP (e.g. `192.168.x.x`), and open `http://192.168.x.x:8080` in iPhone Safari.

### Web-swing tips
- Swing physics are a real pendulum: hold **W** at the bottom of an arc to *pump*
  and build speed, then tap **Space** to launch into the next swing.
- Hold **W** while swinging to reel in (gain height); **S** to let out line.

## How it's structured

```
index.html            Entry point + HUD + import map
vendor/
  three.module.js     Vendored Three.js (no CDN / works offline)
src/
  style.css           HUD / overlay / touch-controls styling
  main.js             Bootstrap: renderer, scene, lights, game loop
  City.js             Procedural Manhattan grid + street props (cars, hydrants,
                      lamps, sidewalks, crosswalks) + collision & ray helpers
  Player.js           Character controller: movement / air / swing / wall states
  SpiderModel.js      Articulated Spider-Man rig (elbow/knee/ankle joints)
  CameraController.js  GTA-style third-person orbit camera w/ collision
  input.js            Keyboard + pointer-lock mouse-look + edge-triggered buttons
  touch.js            PUBG-style mobile controls (joystick / look / buttons)
```

**Performance switch:** append `?fx=low` to the URL to disable shadows and cap
resolution — useful on older phones.

## Architecture notes (for the next milestone)

- **City** stores every building as an axis-aligned box, so both the player
  collision (sphere-vs-box) and the web auto-aim (ray-vs-box fan) are cheap and
  scale to a much larger map.
- **Player** is a small state machine (`ground / air / swing / wall`). Adding new
  traversal (zip-to-point, wall-run, dive) means adding a state, not rewriting.
- The web-swing constraint is a positional (Verlet-style) distance constraint —
  stable and easy to tune via the constants at the top of `Player.js`.

## Roadmap

- [ ] Tune traversal feel (swing momentum, camera lag, FOV kick at speed)
- [ ] Collectibles / time-trial rings to make traversal a game loop
- [ ] Pedestrians & traffic for that living-city GTA feel
- [ ] Mission framework + objective markers
- [ ] Combat prototype
- [ ] Real character/city art (glTF models, baked lighting)
