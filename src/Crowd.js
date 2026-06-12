import * as THREE from 'three';
import { makePerson, PERSON_TYPES } from './Person.js';

// The living city: a wandering NYC crowd plus the crime/combat loop.
//   • pedestrians walk the sidewalks, scatter from danger, and block Spidey
//     (solid — he can't run through them).
//   • robbers pick a victim, mug them (spider-sense fires, pointing the way),
//     then flee — chase them down and beat them with punches/kicks.
//   • web a bad guy to bind him 15s (he struggles); 3 hits snap the web, then
//     he fights back — keep hitting until he's out. Enemies block & counter.
//   • neutralise 15 to summon the GREEN GOBLIN boss (4× tougher, hits as hard
//     as you, web holds 1/3 as long).

const PED_COUNT = 38;
const SPAWN_RADIUS = 140;     // peds live within this of the player
const ROBBER_HP = 6, BOSS_HP = 24;
const WEB_BIND_TIME = 15, BOSS_BIND_TIME = 5;
const WEB_BREAK_HITS = 3;
const GRAVITY = -38, GROUND_Y = 0.0;

export class Crowd {
  constructor(scene, city, player, pedCount = PED_COUNT) {
    this.scene = scene; this.city = city; this.player = player;
    this.people = [];
    this.enemies = [];
    this.neutralized = 0;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.robberyCooldown = 4;
    this._tmp = new THREE.Vector3();

    for (let i = 0; i < pedCount; i++) this.people.push(this._spawnPed(true));
  }

  _spawnPed(anywhere) {
    const rnd = Math.random;
    const type = PERSON_TYPES[(rnd() * PERSON_TYPES.length) | 0];
    const person = makePerson(type, rnd);
    this.scene.add(person.root);
    const p = this._pedSpawnPoint(anywhere);
    const e = {
      person, role: 'ped', pos: new THREE.Vector3(p.x, GROUND_Y, p.z),
      vel: new THREE.Vector3(), target: this._wanderTarget(p), state: 'walk',
      speed: 2 + Math.random() * 1.6, cower: 0, panic: 0,
    };
    person.root.position.copy(e.pos);
    return e;
  }

  _pedSpawnPoint(anywhere) {
    for (let i = 0; i < 8; i++) {
      const pt = this.city.randomSidewalkPoint(Math.random);
      const d = Math.hypot(pt.x - this.player.pos.x, pt.z - this.player.pos.z);
      if (anywhere || (d > 20 && d < SPAWN_RADIUS)) return pt;
    }
    return this.city.randomSidewalkPoint(Math.random);
  }

  _wanderTarget(from) {
    const pt = this.city.randomSidewalkPoint(Math.random);
    return new THREE.Vector3(pt.x, 0, pt.z);
  }

  // ---- enemy spawning -------------------------------------------------------

  _spawnRobber() {
    // pick a victim ped reasonably near the player so the action is visible
    const cand = this.people.filter((p) => p.state !== 'flee' &&
      p.pos.distanceTo(this.player.pos) < 90);
    if (cand.length === 0) return;
    const victim = cand[(Math.random() * cand.length) | 0];
    const person = makePerson('robber', Math.random);
    this.scene.add(person.root);
    const ang = Math.random() * Math.PI * 2;
    const pos = victim.pos.clone().add(new THREE.Vector3(Math.cos(ang) * 30, 0, Math.sin(ang) * 30));
    person.root.position.copy(pos);
    this.enemies.push({
      person, role: 'robber', pos, vel: new THREE.Vector3(), state: 'approach',
      hp: ROBBER_HP, maxhp: ROBBER_HP, victim, robTimer: 0, boundT: 0, hitsBound: 0,
      atkCd: 1, stagger: 0, downed: 0, blockCd: 0, windup: 0,
    });
  }

  _spawnBoss() {
    const person = makePerson('boss', Math.random);
    this.scene.add(person.root);
    const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    const pos = this.player.pos.clone().addScaledVector(dir, 26); pos.y = GROUND_Y;
    person.root.position.copy(pos);
    this.boss = {
      person, role: 'boss', pos, vel: new THREE.Vector3(), state: 'fight',
      hp: BOSS_HP, maxhp: BOSS_HP, victim: null, robTimer: 0, boundT: 0, hitsBound: 0,
      atkCd: 1.5, stagger: 0, downed: 0, blockCd: 0, windup: 0,
    };
    this.enemies.push(this.boss);
    this.bossSpawned = true;
  }

  // ---- web binding (called by Player.shootWeb) ------------------------------

  nearestEnemyInAim(origin, dir, range = 34) {
    let best = null, bestScore = 0.4;
    for (const e of this.enemies) {
      if (e.state === 'down') continue;
      const to = this._tmp.subVectors(e.pos, origin); const d = to.length();
      if (d > range || d < 0.1) continue;
      const score = to.normalize().dot(dir); // how directly we're aiming at it
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  bindEnemy(e) {
    e.state = 'bound';
    e.boundT = e.role === 'boss' ? BOSS_BIND_TIME : WEB_BIND_TIME;
    e.hitsBound = 0;
    if (!e.web) {
      e.web = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, wireframe: true })
      );
      this.scene.add(e.web);
    }
    e.web.visible = true;
  }

  // ---- main update ----------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.05);
    const player = this.player;

    // spawn robberies until the boss — one at a time, spaced 20-60s apart so
    // there are real lulls in the action.
    if (!this.bossSpawned && !this.bossDefeated) {
      this.robberyCooldown -= dt;
      if (this.robberyCooldown <= 0 && this._activeRobberies() < 1) {
        this._spawnRobber(); this.robberyCooldown = 20 + Math.random() * 40;
      }
      if (this.neutralized >= 15) this._spawnBoss();
    }

    this._updatePeds(dt);
    this._updateEnemies(dt);
    this._resolvePlayerMelee();
    this._updateSoftLock();
  }

  // Soft-lock: tell the player which thug to focus so attacks track them.
  _updateSoftLock() {
    let best = null, bd = 10, prio = -1;
    for (const e of this.enemies) {
      if (e.state === 'down') continue;
      const d = e.pos.distanceTo(this.player.pos);
      if (d > bd) continue;
      const p = e.state === 'bound' ? 3 : e.state === 'fight' ? 2 : 1;
      if (p > prio || (p === prio && d < bd)) { prio = p; best = e; bd = Math.min(bd, d + 0.01); }
    }
    this.player.lockTarget = best ? best.pos : null;
  }

  _activeRobberies() {
    return this.enemies.filter((e) => e.role === 'robber' && e.state !== 'down').length;
  }

  _updatePeds(dt) {
    const player = this.player;
    for (const e of this.people) {
      // relocate peds that wander too far from the player
      if (e.pos.distanceTo(player.pos) > SPAWN_RADIUS + 40) {
        const p = this._pedSpawnPoint(false); e.pos.set(p.x, GROUND_Y, p.z);
      }
      // panic if a robbery / boss is near
      const danger = this._nearestDanger(e.pos, 16);
      let pose = 'walk';
      if (danger) {
        e.panic = 1; const away = this._tmp.subVectors(e.pos, danger).setY(0).normalize();
        e.vel.lerp(away.multiplyScalar(e.speed * 2.2), 0.2); pose = 'walk';
      } else if (e.cower > 0) {
        e.cower -= dt; e.vel.multiplyScalar(0.7); pose = 'cower';
      } else {
        // wander toward target
        const to = this._tmp.subVectors(e.target, e.pos).setY(0);
        if (to.length() < 2) e.target.copy(this._wanderTarget(e.pos));
        else e.vel.lerp(to.normalize().multiplyScalar(e.speed), 0.05);
      }
      e.pos.addScaledVector(e.vel, dt);
      this._keepOnStreet(e);
      this._collidePlayer(e);
      // face travel
      if (e.vel.lengthSq() > 0.04) e.person.root.rotation.y = Math.atan2(e.vel.x, e.vel.z);
      e.person.root.position.copy(e.pos);
      e.person.update(dt, pose, Math.min(1, e.vel.length() / 4));
    }
  }

  _updateEnemies(dt) {
    const player = this.player;
    for (const e of this.enemies) {
      if (e.stagger > 0) e.stagger -= dt;
      if (e.atkCd > 0) e.atkCd -= dt;
      if (e.blockCd > 0) e.blockCd -= dt;
      const toPlayer = this._tmp.subVectors(player.pos, e.pos); toPlayer.y = 0;
      const distP = toPlayer.length();
      let pose = 'idle';

      switch (e.state) {
        case 'approach': {
          if (!e.victim || e.victim.state === 'flee') { e.state = 'flee'; break; }
          const to = new THREE.Vector3().subVectors(e.victim.pos, e.pos).setY(0);
          if (to.length() < 1.8) { e.state = 'rob'; e.robTimer = 3.0; }
          else e.vel.lerp(to.normalize().multiplyScalar(4.5), 0.1);
          pose = 'walk'; break;
        }
        case 'rob': {
          e.vel.multiplyScalar(0.7); e.robTimer -= dt;
          if (e.victim) { e.victim.cower = 0.3; }
          pose = 'fight';
          if (e.robTimer <= 0) e.state = 'flee';
          if (distP < 6) e.state = 'fight';
          break;
        }
        case 'flee': {
          const away = new THREE.Vector3().subVectors(e.pos, player.pos).setY(0).normalize();
          e.vel.lerp(away.multiplyScalar(6.5), 0.08);
          pose = 'walk';
          if (distP < 4.5) e.state = 'fight';
          break;
        }
        case 'fight': {
          if (distP > 9 && e.role !== 'boss') { e.state = 'flee'; break; }
          const want = 1.8;
          if (e.windup <= 0) {
            if (distP > want + 0.3) e.vel.lerp(toPlayer.clone().normalize().multiplyScalar(e.role === 'boss' ? 4.2 : 3.5), 0.1);
            else e.vel.multiplyScalar(0.7);
          } else {
            e.vel.multiplyScalar(0.6); // plant for the strike
          }
          // telegraph → strike, with randomized cadence so it isn't a metronome
          if (e.windup > 0) {
            e.windup -= dt;
            if (e.windup <= 0) {
              if (distP < 2.7 && e.stagger <= 0) {
                const dir = toPlayer.clone().normalize();
                player.takeHit(dir, e.role === 'boss' ? 20 : 8);
              }
              e.atkCd = (e.role === 'boss' ? 0.9 : 1.5) + Math.random() * (e.role === 'boss' ? 0.7 : 1.2);
            }
          } else if (e.atkCd <= 0 && distP < 2.5 && e.stagger <= 0 && player._downed <= 0) {
            e.windup = e.role === 'boss' ? 0.5 : 0.4; // readable wind-up you can block/beat
          }
          pose = 'fight'; break;
        }
        case 'bound': {
          e.vel.multiplyScalar(0.8); e.boundT -= dt;
          pose = 'struggle';
          if (e.web) { e.web.position.copy(e.pos).y += e.person.height * 0.5; }
          if (e.boundT <= 0) { this._freeWeb(e); e.state = 'fight'; }
          break;
        }
        case 'down': {
          e.vel.multiplyScalar(0.8); pose = 'down';
          break;
        }
      }

      // gravity + integrate (enemies stay on the street plane)
      e.vel.y += GRAVITY * dt;
      e.pos.addScaledVector(e.vel, dt);
      if (e.pos.y < GROUND_Y) { e.pos.y = GROUND_Y; e.vel.y = 0; }
      this._keepOnStreet(e);
      if (e.state !== 'down') this._collidePlayer(e);
      if (e.vel.lengthSq() > 0.05 && e.state !== 'bound') e.person.root.rotation.y = Math.atan2(e.vel.x, e.vel.z);
      else if (e.state === 'fight') e.person.root.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      e.person.root.position.copy(e.pos);
      e.person.update(dt, pose, Math.min(1, e.vel.length() / 5));
    }
    // recycle downed enemies after a bit
    this.enemies = this.enemies.filter((e) => {
      if (e.state === 'down') {
        e.downed += dt;
        if (e.downed > 6) { this.scene.remove(e.person.root); this._freeWeb(e, true); return false; }
      }
      return true;
    });
  }

  _resolvePlayerMelee() {
    const player = this.player;
    const hit = player.strikeImpact;
    if (!hit) return;
    player.strikeImpact = null;
    const fdir = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    let target = null, bestD = 3.8;
    for (const e of this.enemies) {
      if (e.state === 'down') continue;
      const to = this._tmp.subVectors(e.pos, player.pos); to.y = 0;
      const d = to.length();
      // strongly prefer whatever the soft-lock is on (very forgiving)
      const isLock = player.lockTarget && e.pos === player.lockTarget;
      const reach = isLock ? 6.0 : 3.8;
      if (d > reach) continue;
      if (!isLock && to.normalize().dot(fdir) < -0.2 && d > 1.6) continue; // roughly in front
      if (isLock) { target = e; break; }   // lock wins outright
      if (d < bestD) { target = e; bestD = d; }
    }
    if (!target) return;

    const bound = target.state === 'bound';
    // unbound enemies rarely block (so your soft-locked combos actually connect)
    if (!bound && target.blockCd <= 0 && Math.random() < 0.12) {
      target.blockCd = 1.0;
      // counter: shove the player a touch
      const dir = new THREE.Vector3().subVectors(player.pos, target.pos).setY(0).normalize();
      player.takeHit(dir, 5);
      return;
    }
    target.hp -= 1 + (hit.power || 0) * 0.0; // each clean hit = 1
    target.stagger = 0.4;
    if (bound) {
      target.hitsBound += 1;
      if (target.hitsBound >= WEB_BREAK_HITS && target.boundT > 0) { this._freeWeb(target); target.state = 'fight'; }
    }
    if (target.hp <= 0) this._neutralize(target);
  }

  _neutralize(e) {
    e.state = 'down'; e.downed = 0; this._freeWeb(e);
    if (e.victim) e.victim.cower = 0;
    if (e.role === 'boss') { this.bossDefeated = true; this.boss = null; }
    else this.neutralized += 1;
  }

  _freeWeb(e, dispose) {
    if (e.web) { e.web.visible = false; if (dispose) { this.scene.remove(e.web); e.web = null; } }
  }

  // ---- helpers --------------------------------------------------------------

  _nearestDanger(pos, range) {
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (e.state === 'down' || e.state === 'bound') continue;
      const d = e.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = e.pos; }
    }
    return best;
  }

  _keepOnStreet(e) {
    // push out of buildings using the city collider; keep on the ground plane
    const r = this.city.collideSphere(e.pos, e.person.radius + 0.1);
    e.pos.x = r.pos.x; e.pos.z = r.pos.z;
    if (r.onWall) { const n = r.wallNormal; const into = e.vel.dot(n); if (into < 0) e.vel.addScaledVector(n, -into); }
  }

  _collidePlayer(e) {
    // solid: Spider-Man can't run through people; push both apart
    const pr = 0.6, er = e.person.radius;
    const dx = this.player.pos.x - e.pos.x, dz = this.player.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz), min = pr + er;
    if (d < min && d > 1e-4) {
      const nx = dx / d, nz = dz / d, push = (min - d);
      // player heavier: ped yields more
      this.player.pos.x += nx * push * 0.35; this.player.pos.z += nz * push * 0.35;
      e.pos.x -= nx * push * 0.65; e.pos.z -= nz * push * 0.65;
    }
  }

  // For the HUD spider-sense: where's the active threat?
  spiderSense() {
    let target = null, prio = -1;
    for (const e of this.enemies) {
      if (e.state === 'down') continue;
      const pr = e.role === 'boss' ? 5 : (e.state === 'rob' ? 4 : e.state === 'approach' ? 3 : e.state === 'flee' ? 2 : 1);
      if (pr > prio) { prio = pr; target = e; }
    }
    if (!target) return null;
    return { pos: target.pos, role: target.role, state: target.state };
  }

  status() {
    return {
      neutralized: this.neutralized,
      boss: this.bossSpawned && !this.bossDefeated ? this.boss : null,
      bossDefeated: this.bossDefeated,
    };
  }
}
