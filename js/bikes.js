'use strict';
// Motorcycles: fast, loud and fragile. Easy to go fast, just as easy to hurt yourself.
// Hitting a tree or a wall at speed throws you off, hard landings hurt, getting off at speed hurts,
// and a wrecked bike explodes. Whoever rides a bike simulates it on their machine; everyone else draws
// it under the rider and hears about getting on and off through NET.fx. A riderless bike still rolling
// is simulated by whoever rode it last.
const BIKE = { top: 540, accel: 310, brake: 760, reverse: -130, turn: 2.5, hp: 100 };
const BIKE_SURF = [1, 0.84, 0.86, 0.52]; // top speed by ground: forest, desert, mountains, swamp
const BIKE_COLS = ['#c63d3d', '#e2733b', '#3f6fb0', '#2f7d4f', '#d8a45a', '#7f5ab0'];
const kmh = s => Math.round(Math.abs(s) / B * 3.6); // a block is about a metre
const toward = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);

// Parked where the map put them (the same on every machine)
function spawnBikes() {
  G.bikes = (world.bikes || []).map((s, n) => ({
    id: 'k' + n, x: s.x, y: s.y, z: heightAt(s.x, s.y), face: s.face, col: BIKE_COLS[n % BIKE_COLS.length],
    speed: 0, vz: 0, gvz: 0, air: false, airT: 0, hp: BIKE.hp, rider: null, owner: null,
    throttle: 0, steer: 0, brake: false, gone: false, wheel: 0, smokeT: 0, sendT: 0,
  }));
}
const bikeById = id => G.bikes.find(k => k.id === id);
const riderOf = k => k.rider ? fighterById(k.rider) : null;
const bikeStill = k => Math.abs(k.speed) < 2 && !k.air;
function nearBike(f, r = 46) {
  let best = null, bd = r;
  for (const k of G.bikes) {
    if (k.gone || k.rider || f.layer) continue;
    const d = hyp(k.x - f.x, k.y - f.y);
    if (d < bd && Math.abs(k.z - f.z) < 30) { bd = d; best = k; }
  }
  return best;
}

// ---- getting on and off ----
function mountBike(f, k) {
  if (!k || k.gone || k.rider || f.layer || f.bike || !f.alive || f.pitT > 0) return false;
  if (isTitan(f)) { if (f === G.human) toast('Titans are too heavy to ride'); return false; }
  k.rider = f.id; k.owner = f.id; f.bike = k;
  Object.assign(f, { x: k.x, y: k.y, z: k.z, face: k.face, gather: null, hidden: false, charge: -1, kbx: 0, kby: 0, vz: 0, refillT: 0 });
  Object.assign(k, { throttle: 0, steer: 0, brake: false });
  if (f === G.human) VIEW.lookYaw = 0;
  sendBike(k);
  Sfx.play('rev', k.x, k.y, k.z);
  return true;
}
// Get off. At speed you're thrown and it hurts. `quiet` just lets go (teleports, deaths, crashes).
function dismountBike(f, quiet = false) {
  const k = f.bike;
  if (!k) return;
  f.bike = null;
  if (k.rider === f.id) k.rider = null;
  Object.assign(k, { throttle: 0, steer: 0, brake: false, offT: G.t }); // the bike won't run over whoever just got off
  if (!quiet && f.alive) {
    const s = Math.abs(k.speed), c = Math.cos(k.face), sn = Math.sin(k.face);
    if (s > 110) {
      Object.assign(f, { kbx: c * s * 0.8, kby: sn * s * 0.8, vz: 220, onGround: false, peakZ: f.z });
      if (f === G.human) toast(`You bailed at ${kmh(s)} km/h`);
      f.diedTo = 'crash'; hurtRaw(f, (s - 90) / 45, null); if (f.alive) f.diedTo = null;
    } else {
      f.x = clamp(k.x - sn * 24, 20, WORLD - 20); f.y = clamp(k.y + c * 24, 20, WORLD - 20);
      f.z = supportAt(f.x, f.y, k.z + 10, f.r, 0); Object.assign(f, { vz: 0, onGround: true, peakZ: f.z });
    }
  }
  sendBike(k);
}
function sendBike(k) {
  NET.fx({ k: 'bk', i: k.id, r: k.rider, o: k.owner, p: [k.x, k.y, k.z, k.face * 100, k.speed, k.hp].map(Math.round) });
}
// Another machine: someone got on or off, or a riderless bike rolled somewhere
function applyBikeMsg(d) {
  const k = bikeById(d.i);
  if (!k || k.gone) return;
  const me = G.human;
  if (d.r && k.rider === me.id && d.r !== me.id) { // we both got on at once: the lower id keeps it
    if (d.r > me.id) return;
    dismountBike(me, true); toast('Someone else got on first');
  }
  const prev = riderOf(k);
  if (prev && prev.remote && prev.bike === k) prev.bike = null;
  k.rider = d.r || null; k.owner = d.o || null;
  if (Array.isArray(d.p)) [k.x, k.y, k.z, k.face, k.speed, k.hp] = [d.p[0], d.p[1], d.p[2], d.p[3] / 100, d.p[4], d.p[5]];
  const r = riderOf(k);
  if (r && r.remote) r.bike = k;
  if (!k.rider) k.air = false;
}

// ---- driving ----
// What's in the way at (x, y): trees, rocks and cacti, solid blocks at wheel height, the pit wall, the map edge
function bikeObstacle(k, x, y) {
  for (const o of nearObjs(x, y, 60)) {
    if (o.kind === 'reed' || (o.kind === 'tree' && o.amt <= 0) || (o.kind === 'rock' && o.amt <= 0)) continue;
    if (hyp(o.x - x, o.y - y) < o.r + 11 && k.z < heightAt(o.x, o.y) + 60) return o.kind;
  }
  if (BL.map.size) {
    const i = Math.floor(x / B), c = Math.floor(y / B);
    for (let j = Math.floor((k.z + STEP + 1) / B); j <= Math.floor((k.z + 38) / B); j++) if (solidAt(i, j, c)) return 'wall';
  }
  if (G.pit && hyp(x - PIT.x, y - PIT.y) > PIT.r - 20) return 'wall';
  if (x < 30 || y < 30 || x > WORLD - 30 || y > WORLD - 30) return 'wall';
  return null;
}
function driveBike(k, r, dt) {
  const bi = biomeAt(k.x, k.y), wet = blockAt(Math.floor(k.x / B), Math.floor((k.z + 1) / B), Math.floor(k.y / B));
  const top = BIKE.top * BIKE_SURF[bi] * (r && r.bot ? 0.8 : 1) * (wet && wet.type === 'water' ? 0.6 : 1);
  let c = Math.cos(k.face), sn = Math.sin(k.face);
  if (!k.air) {
    if (k.brake) k.speed = toward(k.speed, 0, BIKE.brake * 1.3 * dt);
    else if (k.throttle > 0.05) k.speed = k.speed < 0 ? k.speed + BIKE.brake * dt
      : k.speed < top ? Math.min(top, k.speed + BIKE.accel * k.throttle * (1 - k.speed / (top * 1.15)) * dt) : toward(k.speed, top, 220 * dt);
    else if (k.throttle < -0.05) k.speed = k.speed > 0 ? k.speed - BIKE.brake * dt : Math.max(BIKE.reverse, k.speed - 160 * dt);
    else k.speed = toward(k.speed, 0, (Math.abs(k.speed) > top ? 260 : 70) * dt);
    // Steering bites harder as you pick up speed, then gets twitchy near the top
    const as = Math.abs(k.speed);
    k.face += k.steer * BIKE.turn * Math.min(1, as / 120) * (1 - Math.min(0.5, as / 1100)) * (k.speed < 0 ? -1 : 1) * dt;
    c = Math.cos(k.face); sn = Math.sin(k.face);
    // Downhill pulls you faster, uphill slows you
    k.speed -= (heightAt(k.x + c * 20, k.y + sn * 20) - heightAt(k.x - c * 20, k.y - sn * 20)) / 40 * 520 * dt;
  }
  const nx = k.x + c * k.speed * dt, ny = k.y + sn * k.speed * dt, dir = k.speed < 0 ? -1 : 1;
  const hit = bikeObstacle(k, nx, ny) || bikeObstacle(k, nx + c * 22 * dir, ny + sn * 22 * dir);
  if (hit) {
    const s = Math.abs(k.speed);
    if (s > 200) { crashBike(k, r, s, hit); return; }
    k.hp -= s / 25; k.speed = -k.speed * 0.25;
    if (s > 60) Sfx.play('hit', k.x, k.y, k.z);
    if (k.hp <= 0) explodeBike(k);
    return;
  }
  k.x = nx; k.y = ny;
  k.wheel += k.speed * dt / 11.7;
  if (r && (k.noiseT = (k.noiseT || 0) - dt) <= 0) { k.noiseT = 0.6; noise(k.x, k.y, 0, 450 + Math.abs(k.speed) * 0.6, r); } // engines carry
  if (Math.abs(k.speed) > 110) ramFighters(k, r);
  // Up and down: follow the ground; when it drops away faster than you, you're in the air
  const g = supportAt(k.x, k.y, k.z, 10, 0);
  if (!k.air) {
    if (g < k.z - 5) { k.air = true; k.vz = Math.min(k.gvz, 700); k.airT = 0; }
    else { k.gvz = clamp((g - k.z) / Math.max(dt, 1 / 240), -700, 800); k.z = g; }
  }
  if (k.air) {
    k.vz -= GRAV * dt; k.z += k.vz * dt; k.airT += dt;
    if (k.z <= g) { const impact = -k.vz; k.z = g; k.air = false; k.gvz = 0; k.vz = 0; landBike(k, r, impact); }
  }
  // Lava melts it; a wreck smokes before it goes up
  const lava = lavaPoolAt(k.x, k.y, -4) || (wet && wet.type === 'lava');
  if (lava && !k.air) k.hp -= 22 * dt;
  if (k.hp < 35 && (k.smokeT -= dt) <= 0) { k.smokeT = 0.18; addFx('puff', k.x, k.y, 0, { col: '#3a3632', z: k.z + 26 }); }
  if (k.hp <= 0) explodeBike(k);
}
// Anyone in the way gets run over: damage and a big knock. Running into a Titan is like hitting a wall.
function ramFighters(k, r) {
  const by = r || (k.owner && fighterById(k.owner)), s = Math.abs(k.speed), a = k.face + (k.speed < 0 ? Math.PI : 0);
  for (const t of G.fighters) {
    if (!t.alive || t === r || t.layer || t.bike || (t.isClone && t.owner === r) || (t.id === k.owner && G.t - (k.offT ?? -9) < 1.5)) continue;
    if (hyp(t.x - k.x, t.y - k.y) > t.r + 16 || Math.abs(t.z - k.z) > 40 || t.ramT > G.t) continue;
    t.ramT = G.t + 0.8;
    if (isTitan(t)) { crashBike(k, r, s, 'titan'); return; }
    if (!t.remote) t.diedTo = 'ram';
    hurt(t, s / 60, by === t ? null : by, a, s * 0.9, 260);
    if (t.alive && !t.remote) t.diedTo = null;
    k.speed *= 0.65; k.hp -= 4;
    Sfx.play('crash', t.x, t.y, t.z);
  }
}
// Hit something solid at speed: you go over the handlebars
function crashBike(k, r, s, what) {
  k.hp -= s / 5.5; k.speed = 0;
  Sfx.play('crash', k.x, k.y, k.z);
  addFx('puff', k.x, k.y, 0, { col: '#b8a488', big: true, z: k.z + 12 });
  if (r) {
    const c = Math.cos(k.face), sn = Math.sin(k.face);
    dismountBike(r, true);
    Object.assign(r, { kbx: -c * 140, kby: -sn * 140, vz: 320, onGround: false, peakZ: r.z });
    if (r === G.human) toast(`Crashed into ${{ tree: 'a tree', rock: 'a rock', wall: 'a wall', titan: 'a Titan', land: 'the ground', pit: 'a pitfall' }[what] || 'something'} at ${kmh(s)} km/h`);
    r.diedTo = 'crash'; hurtRaw(r, Math.max(1, (s - 150) / 28), null); if (r.alive) r.diedTo = null;
  }
  if (k.hp <= 0) explodeBike(k);
}
function landBike(k, r, impact) {
  if (r === G.human && k.airT > 1) toast(`Big air: ${k.airT.toFixed(1)}s`);
  const w = blockAt(Math.floor(k.x / B), Math.floor((k.z + 1) / B), Math.floor(k.y / B));
  if (w && w.type === 'water') { Sfx.play('splash', k.x, k.y, k.z); return; } // water still saves you
  if (impact < 620) { if (impact > 380) Sfx.play('thud', k.x, k.y, k.z); return; }
  k.hp -= (impact - 560) / 7;
  addFx('ring', k.x, k.y, 0, { col: '#d9c7a8', big: true, z: k.z + 1 });
  if (impact > 950 && r) { crashBike(k, r, impact * 0.6, 'land'); return; }
  Sfx.play('thud', k.x, k.y, k.z);
  if (r) { r.diedTo = 'crash'; hurtRaw(r, (impact - 600) / 90, null); if (r.alive) r.diedTo = null; }
  if (k.hp <= 0) explodeBike(k);
}
// A wreck goes up: everyone close takes a hit and gets thrown
function explodeBike(k) {
  if (k.gone) return;
  k.gone = true;
  const r = riderOf(k);
  if (r && r.bike === k) { if (r.remote) r.bike = null; else dismountBike(r, true); }
  const by = k.owner && fighterById(k.owner);
  for (const t of G.fighters) {
    if (!t.alive || t.layer || t.isClone) continue;
    const d = hyp(t.x - k.x, t.y - k.y);
    if (d > 110 || Math.abs(t.z - k.z) > 90) continue;
    if (!t.remote) t.diedTo = 'bike';
    hurt(t, 7 * (1 - d / 160), t === by ? null : by, Math.atan2(t.y - k.y, t.x - k.x), 520, 360);
    if (t.alive && !t.remote) t.diedTo = null;
  }
  bikeBoomFx(k.x, k.y, k.z);
  noise(k.x, k.y, 0, 1000, by);
  NET.fx({ k: 'bkx', i: k.id, x: Math.round(k.x), y: Math.round(k.y), z: Math.round(k.z) });
}
function bikeBoomFx(x, y, z) {
  addFx('puff', x, y, 0, { col: '#e2733b', big: true, z: z + 20 }); addFx('puff', x, y, 0, { col: '#3a3632', big: true, z: z + 40 });
  addFx('bolt', x, y, 0, { t: 0.2 });
  Sfx.play('bolt', x, y, z);
}

// A fighter we simulate is riding: the bike moves, the rider goes with it
function rideBike(f, dt) {
  const k = f.bike;
  if (k.gone || f.layer || !f.alive) { dismountBike(f, true); return; }
  driveBike(k, f, dt);
  if (f.bike !== k) return; // crashed off
  Object.assign(f, { x: k.x, y: k.y, z: k.z, face: k.face, vz: k.vz, onGround: !k.air, peakZ: k.z, kbx: 0, kby: 0, mx: 0, my: 0, gather: null });
  touchLiquid(f);
  // Traps still work on wheels: pitfalls wreck you, spikes shred the tyre, pads launch you, blast traps blow
  const tr = !k.air ? trapAt(f) : null, trap = tr && tr.b;
  if (!trap || trap.owner === f.id) return;
  if (trap.type === 'pitfall') {
    breakBlock(tr.i, tr.j, tr.k, null);
    addFx('hole', (tr.i + .5) * B, (tr.k + .5) * B, 0, { t: 6, z: f.z + 0.6 });
    crashBike(k, f, Math.max(Math.abs(k.speed), 260), 'pit');
  } else if (trap.type === 'pad') {
    if (!(f.padCd > G.t)) { f.padCd = G.t + 0.6; k.air = true; k.vz = 900; k.airT = 0; addFx('ring', f.x, f.y, 0, { col: '#4fb3a9', big: true, z: f.z + 2 }); }
  } else if (f.spikeCd <= 0) {
    f.spikeCd = 0.9;
    if (trap.type === 'blast') detonate(tr.i, tr.j, tr.k, fighterById(trap.owner));
    else { k.hp -= 25; k.speed *= 0.5; Sfx.play('spike', f.x, f.y, f.z); if (f === G.human) toast('Spike trap! It shredded your tyre'); if (k.hp <= 0) explodeBike(k); }
  }
}

// Every frame: bikes ridden elsewhere follow their riders; riderless ones roll to a stop
function updateBikes(dt) {
  for (const k of G.bikes || []) {
    if (k.gone) continue;
    const r = riderOf(k);
    if (r && r.bike !== k) k.rider = null;
    if (r && r.bike === k) {
      if (!r.alive) { k.rider = null; continue; }
      if (!r.remote) continue; // our own riders run through rideBike
      const px = k.x, py = k.y;
      Object.assign(k, { x: r.x, y: r.y, z: r.z, face: r.face, air: r.z > heightAt(r.x, r.y) + 6 });
      k.speed += (hyp(k.x - px, k.y - py) / Math.max(dt, 1e-3) - k.speed) * Math.min(1, dt * 6);
      k.wheel += k.speed * dt / 11.7;
      continue;
    }
    if (bikeStill(k)) continue;
    const o = k.owner && fighterById(k.owner), mine = o ? !o.remote : !NET.on || NET.isHost();
    if (!mine) continue;
    Object.assign(k, { throttle: 0, steer: 0, brake: false });
    driveBike(k, null, dt);
    if ((k.sendT -= dt) <= 0 || bikeStill(k)) { k.sendT = 0.15; sendBike(k); }
  }
}
