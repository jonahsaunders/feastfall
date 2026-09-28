'use strict';
// Attack helicopters: two seats. The pilot flies it; the gunner sits in the nose with the chain gun and rockets.
// Fuel only burns in the air, and a helicopter that runs dry up there drops out of the sky and explodes, so land
// before the gauge hits zero. Landing on a helipad refuels it, and rearms it while the gunner seat is empty. Shots at the crew hit the armoured
// airframe instead; when the hull gives out it explodes, and so does anything that hits the ground too hard.
// Whoever flies a helicopter simulates it on their machine (like a motorcycle rider) and shares its state through
// NET.fx; the gunner's machine owns the ammo, fires, and decides what its shots hit.
const HELI = { top: 700, climb: 280, sink: 330, accel: 460, hp: 45, fuel: 100, burn: 100 / 90, ammo: 150, rockets: 6, ceil: 560, body: 34, rotorR: 112 };
const HELI_SEATS = { pilot: { x: 16, z: 40 }, gunner: { x: 46, z: 32 } }; // along the nose, and up from the skids
const SEATS = ['pilot', 'gunner'];
const TURRET = 2.0; // the chin gun turns this far either side of the nose
const NO_CTL = { fw: 0, st: 0, up: 0 };

// Parked on their helipads (the same on every machine)
function spawnHelis() {
  G.helis = (world.helis || []).map((s, n) => ({
    id: 'h' + n, x: s.x, y: s.y, z: heightAt(s.x, s.y), face: s.face, vx: 0, vy: 0, vz: 0,
    hp: HELI.hp, fuel: HELI.fuel, ammo: HELI.ammo, rockets: HELI.rockets, pilot: null, gunner: null, owner: null,
    gone: false, air: false, dead: false, rotor: 0, blade: 0, tail: 0, tilt: 0, roll: 0, ctl: { fw: 0, st: 0, up: 0 },
    sendT: 0, noiseT: 0, smokeT: 0, gunT: 0, rkT: 0, lastBy: null, lastByT: -99, net: null,
  }));
  G.tracerOut = []; G.tracerT = 0;
}
const heliById = id => (G.helis || []).find(h => h.id === id);
const heliCrew = h => SEATS.map(s => h[s] && fighterById(h[s])).filter(f => f && f.heli === h);
// Simulated here: whoever flew it last, or the host (or a solo game) once they're gone
function heliMine(h) {
  const o = h.owner && fighterById(h.owner);
  return o && o.alive ? !o.remote : !NET.on || NET.isHost();
}
// The ammo belongs to the gunner's machine
function ammoMine(h) {
  const g = h.gunner && fighterById(h.gunner);
  return g && g.heli === h ? !g.remote : heliMine(h);
}
const heliUp = h => h.air;
const onPad = h => !h.air && (world.helis || []).some(p => hyp(p.x - h.x, p.y - h.y) < 70);
const kmhOf = h => Math.round(hyp(h.vx, h.vy) / B * 3.6);
function seatPos(h, seat) {
  const s = HELI_SEATS[seat], c = Math.cos(h.face), sn = Math.sin(h.face);
  return { x: h.x + c * s.x, y: h.y + sn * s.x, z: h.z + s.z };
}
// Where the chin gun sits, and where the gunner looks from
function muzzle(h) {
  const c = Math.cos(h.face), sn = Math.sin(h.face);
  return { x: h.x + c * 84, y: h.y + sn * 84, z: h.z + 14 };
}
// Close enough to climb in, with a free seat
function nearHeli(f, r = 110) {
  if (G.pit || f.layer || !G.helis) return null;
  let best = null, bd = r;
  for (const h of G.helis) {
    if (h.gone || (h.pilot && h.gunner) || Math.abs(h.z - f.z) > 50) continue;
    const d = hyp(h.x - f.x, h.y - f.y);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

// ---- getting in and out ----
function boardHeli(f, h, seat) {
  if (!h || h.gone || G.pit || f.layer || f.bike || f.heli || !f.alive || f.pitT > 0) return false;
  if (isTitan(f)) { if (f === G.human) toast('Titans don’t fit in the cockpit'); return false; }
  seat = seat || (!h.pilot ? 'pilot' : !h.gunner ? 'gunner' : null);
  if (!seat || h[seat]) return false;
  h[seat] = f.id; f.heli = h; f.seat = seat; f.aimYaw = 0;
  const o = h.owner && fighterById(h.owner);
  if (seat === 'pilot' || !o || !o.alive) h.owner = f.id;
  Object.assign(f, { gather: null, hidden: false, charge: -1, kbx: 0, kby: 0, vz: 0, refillT: 0, sneak: false });
  if (f.emoteT > 0) stopEmote(f);
  if (f === G.human) {
    VIEW.lookYaw = 0; VIEW.pitch = seat === 'gunner' ? -0.3 : -0.1; mouse.down = false;
    toast(seat === 'pilot' ? 'Pilot seat · hold Space to lift off once the rotors are up to speed' : 'Gunner seat · left click fires the chain gun, right click fires a rocket');
  }
  placeCrew(h);
  sendHeli(h);
  Sfx.play('door_shut', h.x, h.y, h.z);
  return true;
}
// Climb out. On the ground you step out beside it; in the air you just drop (and the fall hurts like any other).
// `quiet` just lets go (deaths, teleports, explosions).
function leaveHeli(f, quiet = false) {
  const h = f.heli;
  if (!h) return;
  const seat = f.seat;
  f.heli = null; f.seat = null;
  if (h[seat] === f.id) h[seat] = null;
  if (!quiet && f.alive) {
    const c = Math.cos(h.face), sn = Math.sin(h.face), side = seat === 'pilot' ? 1 : -1;
    const x = clamp(h.x - sn * 52 * side + c * 10, 20, WORLD - 20), y = clamp(h.y + c * 52 * side + sn * 10, 20, WORLD - 20);
    if (h.air) {
      Object.assign(f, { x, y, z: h.z + 20, vz: Math.min(0, h.vz), kbx: h.vx * 0.8, kby: h.vy * 0.8, onGround: false, peakZ: h.z + 20 });
      if (f === G.human) toast(`You jumped out ${Math.round((h.z - heliGround(h)) / B)} blocks up`);
    } else {
      const z = supportAt(x, y, h.z + 20, f.r, 0);
      Object.assign(f, { x, y, z, vz: 0, kbx: 0, kby: 0, onGround: true, peakZ: z });
    }
  }
  if (f === G.human) { VIEW.lookYaw = 0; mouse.down = false; }
  sendHeli(h);
}
// Pilot ↔ gunner, when the other seat is free. With nobody flying, it holds a hover and sinks slowly.
function switchSeat(f) {
  const h = f.heli;
  if (!h) return false;
  const to = f.seat === 'pilot' ? 'gunner' : 'pilot';
  if (h[to]) { if (f === G.human) toast(`${fighterById(h[to]) ? fighterById(h[to]).name : 'Someone'} is in the ${to} seat`); return false; }
  h[f.seat] = null; h[to] = f.id; f.seat = to; f.aimYaw = 0;
  if (to === 'pilot') { h.owner = f.id; f.face = h.face; }
  if (f === G.human) {
    mouse.down = false; VIEW.pitch = to === 'gunner' ? -0.3 : -0.1;
    toast(to === 'pilot' ? 'Pilot seat' : h.air ? 'Gunner seat · with nobody flying, it hovers and sinks slowly' : 'Gunner seat');
  }
  sendHeli(h);
  return true;
}
// Seats, and where it is: sent when someone gets in, out or swaps
function sendHeli(h) {
  NET.fx({ k: 'hl', i: h.id, p: h.pilot, g: h.gunner, o: h.owner, s: heliState(h) });
}
const heliState = h => [h.x, h.y, h.z, h.face * 100, h.vx, h.vy, h.vz, h.fuel * 10, h.hp * 10, h.rotor * 100, h.dead ? 1 : 0].map(Math.round);
function readState(h, s) {
  if (!Array.isArray(s) || s.length < 11) return;
  h.net = { x: s[0], y: s[1], z: s[2], face: s[3] / 100, vx: s[4], vy: s[5], vz: s[6], rotor: s[9] / 100 };
  h.fuel = s[7] / 10; h.hp = s[8] / 10; h.dead = !!s[10];
  if (!h.seen) { h.seen = true; Object.assign(h, { x: s[0], y: s[1], z: s[2], face: s[3] / 100 }); }
}
// Another machine: someone got in, out or swapped seats. Two people who take the same seat at once: the lower id keeps it.
function applyHeliMsg(d) {
  const h = heliById(d.i);
  if (!h || h.gone) return;
  let resend = false;
  for (const seat of SEATS) {
    const want = (seat === 'pilot' ? d.p : d.g) || null, cur = h[seat] && fighterById(h[seat]);
    if (cur && !cur.remote && cur.heli === h && cur.seat === seat && want !== cur.id) { // one of ours is in that seat
      if (!want || want > cur.id) { resend = true; continue; } // their news is older, or we win the tie
      leaveHeli(cur, true); if (cur === G.human) toast('Someone else got in first');
    }
    if (cur && cur.remote && cur.heli === h && cur.id !== want) { cur.heli = null; cur.seat = null; }
    h[seat] = want;
    const f = want && fighterById(want);
    if (f && f.remote) { if (f.heli && f.heli !== h) vacate(f.heli, f.id); f.heli = h; f.seat = seat; }
  }
  const pilot = h.pilot && fighterById(h.pilot);
  if (!(pilot && !pilot.remote)) h.owner = d.o || null;
  if (!heliMine(h)) readState(h, d.s);
  if (resend) sendHeli(h);
}
const vacate = (h, id) => { for (const s of SEATS) if (h[s] === id) h[s] = null; };
function applyHeliState(d) {
  const h = heliById(d.i);
  if (h && !h.gone && !heliMine(h)) readState(h, d.s);
}

// ---- flying ----
// The ground under the skids: terrain, blocks, and tree tops (you can land on a big tree, if you're careful)
function heliGround(h, x = h.x, y = h.y, z = h.z) {
  let g = supportAt(x, y, z, 40, 0);
  for (const [a, b] of [[28, 0], [-28, 0], [0, 20], [0, -20]]) g = Math.max(g, heightAt(x + a, y + b));
  for (const o of nearObjs(x, y, 70)) {
    if (o.kind !== 'tree' || o.amt <= 0 || hyp(o.x - x, o.y - y) > o.r + 20) continue;
    const top = heightAt(o.x, o.y) + treeTop(o);
    if (top <= z + STEP) g = Math.max(g, top);
  }
  return g;
}
const treeTop = o => o.style === 1 ? 70 : o.style === 2 ? 170 : 145;
// What the body runs into at (x, y): trees, rocks and cacti, and placed blocks
function heliObstacle(h, x, y) {
  const r = HELI.body;
  for (const o of nearObjs(x, y, 80)) {
    if (o.kind === 'reed' || o.amt <= 0) continue;
    const top = heightAt(o.x, o.y) + (o.kind === 'tree' ? treeTop(o) : o.r * 1.3);
    if (hyp(o.x - x, o.y - y) < o.r + r && h.z + 6 < top) return o.kind === 'tree' ? 'a tree' : 'a rock';
  }
  if (BL.map.size) {
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++)
      for (let k = Math.floor((y - r) / B); k <= Math.floor((y + r) / B); k++)
        for (let j = Math.floor((h.z + 8) / B); j <= Math.floor((h.z + 62) / B); j++) {
          if (!solidAt(i, j, k)) continue;
          const cx = clamp(x, i * B, (i + 1) * B), cy = clamp(y, k * B, (k + 1) * B);
          if (hyp(cx - x, cy - y) < r) return 'a wall';
        }
  }
  return null;
}
function flyHeli(h, dt) {
  const p = h.pilot ? fighterById(h.pilot) : null, piloted = !!(p && p.alive && p.heli === h);
  const c = piloted ? h.ctl : NO_CTL;
  if (piloted) h.face = p.face;
  // Parked, empty and quiet: just top it up if it's on a pad
  if (!piloted && !h.air && h.rotor <= 0 && !h.dead && !h.vx && !h.vy) { padService(h, dt); return; }
  const g0 = heliGround(h);
  h.air = h.z > g0 + 1.5;
  // Rotors: a pilot starts them; they keep turning in the air and wind down once it's parked and empty
  const run = (piloted || h.air) && h.fuel > 0 && !h.dead;
  h.rotor = run ? Math.min(1, h.rotor + dt / 2.5) : Math.max(0, h.rotor - dt / 6);
  // Fuel only burns in the air. Run dry up there and the engine quits.
  if (h.air && !h.dead && h.fuel > 0) {
    const was = h.fuel;
    h.fuel = Math.max(0, h.fuel - HELI.burn * dt);
    fuelWarnings(h, was);
    if (h.fuel <= 0) flameOut(h);
  }
  // The stick: forward and back, strafe, up and down; the nose follows the pilot's mouse
  const cf = Math.cos(h.face), sf = Math.sin(h.face);
  let tx = 0, ty = 0;
  if (h.air && !h.dead) {
    const fw = c.fw * (c.fw < 0 ? 0.45 : 1), st = c.st * 0.6;
    tx = (cf * fw - sf * st) * HELI.top; ty = (sf * fw + cf * st) * HELI.top;
  }
  const acc = (h.air ? HELI.accel : 1400) * dt;
  h.vx = toward(h.vx, tx, acc); h.vy = toward(h.vy, ty, acc);
  if (h.dead) h.vz -= GRAV * dt;
  else if (h.rotor < 1) h.vz = h.air ? Math.max(-HELI.sink, h.vz - GRAV * 0.4 * dt) : 0; // not up to speed yet: no lift
  else {
    let tvz = c.up > 0 ? c.up * HELI.climb : c.up < 0 ? c.up * HELI.sink : piloted ? 0 : -38; // nobody flying: it sinks
    if (h.z > g0 + HELI.ceil) tvz = Math.min(tvz, -60); // service ceiling
    h.vz = toward(h.vz, tvz, 700 * dt);
  }
  // Across: bump into trees, rocks, walls and hillsides
  const px = h.x, py = h.y, s = hyp(h.vx, h.vy);
  if (s > 0.5) {
    const nx = clamp(h.x + h.vx * dt, 40, WORLD - 40), ny = clamp(h.y + h.vy * dt, 40, WORLD - 40);
    const hit = heliObstacle(h, nx, ny) || heliObstacle(h, nx + cf * 40, ny + sf * 40);
    if (hit) { heliBump(h, s, hit); h.vx *= -0.3; h.vy *= -0.3; }
    else { if (nx !== h.x + h.vx * dt) h.vx = 0; if (ny !== h.y + h.vy * dt) h.vy = 0; h.x = nx; h.y = ny; }
  }
  if (h.gone) return;
  // Up and down: land, or hit the ground
  h.z += h.vz * dt;
  const g = heliGround(h);
  if (h.air && g > h.z + 14 && s > 120) { // flew into rising ground
    h.x = px; h.y = py; heliBump(h, s, 'the hillside'); h.vx *= -0.3; h.vy *= -0.3;
    if (h.gone) return;
  }
  const floor = heliGround(h);
  if (h.z <= floor) {
    const impact = -h.vz, wasAir = h.air;
    h.z = floor; h.vz = Math.max(0, h.vz);
    if (h.dead) { explodeHeli(h); return; }
    if (wasAir) touchDown(h, impact, s);
    h.air = false;
  } else h.air = h.z > floor + 1.5;
  if (h.gone) return;
  // A lava pool under the skids cooks it
  if (!h.air && lavaPoolAt(h.x, h.y, -10)) h.hp -= 20 * dt;
  if (h.air && h.rotor > 0.6) rotorStrike(h, piloted ? p : null);
  if (piloted && (h.noiseT -= dt) <= 0) { h.noiseT = 0.6; noise(h.x, h.y, 0, 1400, p); } // you hear a helicopter from far away
  padService(h, dt);
  if (h.hp <= 0) explodeHeli(h);
}
function touchDown(h, impact, s) {
  const crew = heliCrew(h);
  if (impact < 400 && s < 420) { if (impact > 180) Sfx.play('thud', h.x, h.y, h.z); return; }
  const dmg = Math.max(0, impact - 360) / 5 + Math.max(0, s - 420) / 14;
  h.hp -= dmg; h.crashT = G.t;
  addFx('ring', h.x, h.y, 0, { col: '#d9c7a8', big: true, z: h.z + 1 });
  Sfx.play('crash', h.x, h.y, h.z);
  if (crew.includes(G.human)) toast(h.hp <= 0 ? 'You crashed the helicopter' : impact < 400 ? `Scraped the ground at ${kmhOf(h)} km/h: −${Math.round(dmg / HELI.hp * 100)}% hull` : `Hard landing: −${Math.round(dmg / HELI.hp * 100)}% hull`);
}
function heliBump(h, s, what) {
  if (s < 200) { if (s > 60) Sfx.play('hit', h.x, h.y, h.z); h.hp -= s / 60; return; }
  const dmg = s / 9;
  h.hp -= dmg; h.crashT = G.t;
  Sfx.play('crash', h.x, h.y, h.z);
  addFx('puff', h.x, h.y, 0, { col: '#b8a488', big: true, z: h.z + 30 });
  if (heliCrew(h).includes(G.human)) toast(`Hit ${what} at ${kmhOf(h)} km/h`);
  if (h.hp <= 0) explodeHeli(h);
}
// Anyone standing in the rotor disc gets hit by the blades
function rotorStrike(h, by) {
  const rz = h.z + 72;
  for (const t of G.fighters) {
    if (!t.alive || t.layer || t.heli || t.isClone || t.rotorT > G.t) continue;
    if (rz < t.z || rz > t.z + fh(t) || hyp(t.x - h.x, t.y - h.y) > HELI.rotorR + t.r) continue;
    t.rotorT = G.t + 1;
    if (!t.remote) t.diedTo = 'heli';
    withKind('heli', () => hurt(t, 6, by, Math.atan2(t.y - h.y, t.x - h.x), 620, 280));
    if (t.alive && !t.remote) t.diedTo = null;
    h.hp -= 3;
    Sfx.play('crash', t.x, t.y, t.z);
  }
}
// Fuel warnings for whoever's aboard (your own crew hears them on their machines through the state)
function fuelWarnings(h, was) {
  if (!heliCrew(h).includes(G.human)) return;
  if (was > 30 && h.fuel <= 30) { toast('Low fuel: find somewhere to land'); Sfx.say('Low fuel'); }
  if (was > 12 && h.fuel <= 12) { banner('Fuel critical', 'Land now, or it explodes when the tank runs dry.'); Sfx.say('Fuel critical. Land now.', true); }
}
function flameOut(h) {
  h.dead = true;
  addFx('puff', h.x, h.y, 0, { col: '#3a3632', big: true, z: h.z + 60 });
  Sfx.play('crash', h.x, h.y, h.z);
  if (heliCrew(h).includes(G.human)) { toast('Out of fuel! Bail out (E)'); Sfx.say('Engine failure', true); }
  sendHeli(h);
}
// On a helipad: refuel, and rearm (on the machine that owns the ammo)
function padService(h, dt) {
  if (!onPad(h) || h.dead) return;
  if (h.fuel < HELI.fuel) h.fuel = Math.min(HELI.fuel, h.fuel + 15 * dt);
  if (h.hp < HELI.hp && h.rotor < 0.05) h.hp = Math.min(HELI.hp, h.hp + 2 * dt); // ground crew patch it up while it's switched off
}
// Rearming needs the gunner seat empty: the ground crew can't load the gun while someone's firing it
function rearm(h, dt) {
  if (!onPad(h) || h.gunner || !ammoMine(h) || (h.ammo >= HELI.ammo && h.rockets >= HELI.rockets)) return;
  h.rearmT = (h.rearmT || 0) + dt;
  if (h.rearmT < 0.4) return;
  h.rearmT = 0; h.rearms = (h.rearms || 0) + 1;
  h.ammo = Math.min(HELI.ammo, h.ammo + 10);
  if (h.rockets < HELI.rockets && h.rearms % 3 === 0) h.rockets++;
  sendAmmo(h, true);
}

// ---- damage and explosions ----
// Hits on a helicopter (or its crew) come here. Only the machine flying it applies them.
function damageHeli(h, amt, by) {
  if (!h || h.gone || !(amt > 0)) return false;
  const s = by && by.isFighter ? (by.owner || by) : null;
  if (s) {
    if (s.heli === h || !pvpOn()) return false; // not your own ride, and not before PvP
    if (G.duo && heliCrew(h).some(c => allied(c, s))) return false;
  }
  addFx('puff', h.x + rr(-20, 20), h.y + rr(-20, 20), 0, { col: '#f0c060', z: h.z + 30 + rr(0, 20), t: 0.25 });
  Sfx.play('spike', h.x, h.y, h.z);
  if (!heliMine(h)) { NET.fx({ k: 'hd', i: h.id, d: +amt.toFixed(2), by: s ? s.id : null }); return true; }
  h.hp -= amt;
  if (s) { h.lastBy = s.id; h.lastByT = G.t; s.dealtT = G.t; }
  const crew = heliCrew(h);
  if (crew.includes(G.human) && s) addDmgDir(Math.atan2(s.y - G.human.y, s.x - G.human.x), amt);
  if (h.hp <= 0) explodeHeli(h);
  return true;
}
// It goes up. Hitting the ground (out of fuel, or wrecked on impact) kills whoever's still aboard; blown up any other
// way, the crew are thrown clear badly hurt (and usually a long way down). Everyone close takes a hit too.
function explodeHeli(h) {
  if (h.gone) return;
  h.gone = true;
  const by = h.lastBy && G.t - h.lastByT < 20 ? fighterById(h.lastBy) : null, crash = h.dead || G.t - (h.crashT ?? -9) < 0.2;
  const crew = heliCrew(h);
  for (const f of crew) {
    if (f.remote) { f.heli = null; f.seat = null; }
    else { leaveHeli(f, true); Object.assign(f, { vz: 260, onGround: false, peakZ: f.z, kbx: rr(-200, 200), kby: rr(-200, 200) }); }
    if (!f.remote) f.diedTo = 'heli';
    withKind('heli', () => hurtRaw(f, crash ? 40 : 12, by && by !== f ? by : null));
    if (f.alive && !f.remote) f.diedTo = null;
  }
  h.pilot = h.gunner = null;
  for (const t of G.fighters) {
    if (!t.alive || t.layer || t.isClone || crew.includes(t)) continue;
    const d = Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z);
    if (d > 160) continue;
    if (!t.remote) t.diedTo = 'heli';
    withKind('heli', () => hurt(t, 10 * (1 - d / 220), t === by ? null : by, Math.atan2(t.y - h.y, t.x - h.x), 560, 380));
    if (t.alive && !t.remote) t.diedTo = null;
  }
  heliBoomFx(h.x, h.y, h.z);
  noise(h.x, h.y, 0, 1600, by);
  NET.fx({ k: 'hx', i: h.id, x: Math.round(h.x), y: Math.round(h.y), z: Math.round(h.z) });
}
// Another machine blew it up
function applyHeliBoom(d) {
  const h = heliById(d.i);
  if (h && !h.gone) {
    h.gone = true;
    for (const f of heliCrew(h)) {
      if (f.remote) { f.heli = null; f.seat = null; continue; }
      leaveHeli(f, true);
      Object.assign(f, { vz: 260, onGround: false, peakZ: f.z });
    }
  }
  heliBoomFx(d.x, d.y, d.z);
}
function heliBoomFx(x, y, z) {
  addFx('puff', x, y, 0, { col: '#e2733b', big: true, z: z + 30 }); addFx('puff', x + 20, y - 15, 0, { col: '#ffd24a', big: true, z: z + 50 });
  addFx('puff', x - 15, y + 10, 0, { col: '#3a3632', big: true, z: z + 70, t: 1.2 }); addFx('ring', x, y, 0, { col: '#e2733b', big: true, z: z + 5 });
  addFx('bolt', x, y, 0, { t: 0.2 });
  Sfx.play('bolt', x, y, z); Sfx.play('crash', x, y, z);
}

// ---- the gunner ----
function fireGun(f) {
  const h = f.heli;
  if (!h || h.gone || f.seat !== 'gunner' || h.gunT > G.t) return false;
  if (h.ammo <= 0) {
    if (f === G.human && !(h.dryT > G.t)) { h.dryT = G.t + 1.2; Sfx.play('craft'); toast('Out of rounds: land on a helipad to rearm'); }
    return false;
  }
  h.gunT = G.t + 0.12; h.ammo--;
  sendAmmo(h, h.ammo === 0);
  const m = muzzle(h), sp = 0.014, yaw = f.face + rr(-sp, sp), pit = (f.pitch || 0) + rr(-sp, sp), cp = Math.cos(pit);
  const dx = Math.cos(yaw) * cp, dy = Math.sin(yaw) * cp, dz = Math.sin(pit);
  const hit = gunRay(h, f, m.x, m.y, m.z, dx, dy, dz, 1500), me = f === G.human && G.stats;
  if (me) G.stats.shots = (G.stats.shots || 0) + 1;
  let landed = false;
  if (hit.t && hit.t.isFighter) landed = withKind('gun', () => hurt(hit.t, 1, f, Math.atan2(dy, dx), 70));
  else if (hit.h) landed = damageHeli(hit.h, 1, f);
  if (landed && me) { hitMark(); G.stats.hits = (G.stats.hits || 0) + 1; }
  tracer(m.x, m.y, m.z, hit.x, hit.y, hit.z, hit.what);
  G.tracerOut.push([m.x, m.y, m.z, hit.x, hit.y, hit.z, hit.what === 'air' ? 0 : 1].map(Math.round));
  Sfx.play('gun', m.x, m.y, m.z);
  noise(m.x, m.y, 0, 900, f);
  return true;
}
// March along the shot: the ground, blocks, trees, then anyone (or any other helicopter) near the line
function gunRay(h, f, x0, y0, z0, dx, dy, dz, max) {
  const cands = [], hl = Math.hypot(dx, dy) || 1;
  for (const t of G.fighters) {
    if (!t.alive || t.layer || t === f || t.heli === h) continue;
    const ox = t.x - x0, oy = t.y - y0, along = (ox * dx + oy * dy) / hl;
    if (along < 0 || along > max || Math.abs(ox * dy - oy * dx) / hl > t.r + 20) continue;
    cands.push(t);
  }
  const helis = (G.helis || []).filter(o => o !== h && !o.gone && hyp(o.x - x0, o.y - y0) < max + 60);
  let px = x0, py = y0, pz = z0;
  for (let s = 10; s <= max; s += 10) {
    px = x0 + dx * s; py = y0 + dy * s; pz = z0 + dz * s;
    if (pz < heightAt(px, py)) return { x: px, y: py, z: heightAt(px, py), what: 'ground' };
    if (BL.map.size && solidAt(Math.floor(px / B), Math.floor(pz / B), Math.floor(py / B))) return { x: px, y: py, z: pz, what: 'block' };
    if (s % 40 === 0 && pz < heightAt(px, py) + 175) {
      for (const o of nearObjs(px, py, 40)) if (o.amt > 0 && o.kind !== 'reed' && hyp(o.x - px, o.y - py) < o.r && pz < heightAt(o.x, o.y) + (o.kind === 'tree' ? treeTop(o) : o.r * 1.3)) return { x: px, y: py, z: pz, what: 'tree' };
    }
    for (const t of cands) if (hyp(t.x - px, t.y - py) < t.r + 4 && pz > t.z - 2 && pz < t.z + fh(t) + 2) return { x: px, y: py, z: pz, what: 'fighter', t };
    for (const o of helis) if (Math.hypot(o.x - px, o.y - py, o.z + 40 - pz) < 46) return { x: px, y: py, z: pz, what: 'heli', h: o };
  }
  return { x: px, y: py, z: pz, what: 'air' };
}
function tracer(x0, y0, z0, x1, y1, z1, what) {
  addFx('tracer', x0, y0, 0, { x2: x1, y2: y1, z: z0, z2: z1, t: 0.07 });
  if (what && what !== 'air') addFx('puff', x1, y1, 0, { col: what === 'fighter' ? '#c63d3d' : what === 'heli' ? '#f0c060' : what === 'tree' ? '#7a6a4a' : '#b8a488', z: z1 - 8, t: 0.3 });
}
function fireRocket(f) {
  const h = f.heli;
  if (!h || h.gone || f.seat !== 'gunner' || h.rkT > G.t) return false;
  if (h.rockets <= 0) { if (f === G.human) toast('Out of rockets: land on a helipad to rearm'); return false; }
  h.rkT = G.t + 0.6; h.rockets--;
  sendAmmo(h, true);
  const c = Math.cos(h.face), sn = Math.sin(h.face), side = h.rockets % 2 ? 1 : -1; // left pod, right pod
  const x = h.x + c * 20 - sn * 30 * side, y = h.y + sn * 20 + c * 30 * side, z = h.z + 26;
  // Fly from the pod to whatever's under the crosshair, so the rocket lands where the gunner is looking
  const pit = f.pitch || 0, cp = Math.cos(pit), m = muzzle(h);
  const sight = gunRay(h, f, m.x, m.y, m.z, Math.cos(f.face) * cp, Math.sin(f.face) * cp, Math.sin(pit), 1500);
  const dx = sight.x - x, dy = sight.y - y, dz = sight.z - z, dl = Math.hypot(dx, dy, dz) || 1, s = 1150;
  spawnProj({ kind: 'rocket', x, y, z, vx: dx / dl * s, vy: dy / dl * s, vz: dz / dl * s + Math.min(60, dl / s * 40), owner: f, layer: 0, life: 2.2, heli: h.id });
  addFx('puff', x, y, 0, { col: '#e6dfcc', z, t: 0.4 });
  Sfx.play('rocket', x, y, z);
  noise(x, y, 0, 900, f);
  return true;
}
// A rocket goes off: blocks nearby are blown apart, everyone close takes a hit, other helicopters take a big one
function rocketBlast(x, y, z, owner, hid) {
  const i = Math.floor(x / B), j = Math.floor(z / B), k = Math.floor(y / B);
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) for (let dk = -2; dk <= 2; dk++) {
    const b = blockAt(i + di, j + dj, k + dk);
    if (b && !BLOCKS[b.type].unbreakable && di * di + dj * dj + dk * dk <= 5) breakBlock(i + di, j + dj, k + dk, null);
  }
  let landed = false;
  for (const t of G.fighters) {
    if (!t.alive || t.layer || t.heli) continue; // crews are covered by the helicopter below
    const d = Math.hypot(t.x - x, t.y - y, t.z + 30 - z);
    if (d > 110) continue;
    if (withKind('rocket', () => hurt(t, 7 * (1 - d / 150), owner, Math.atan2(t.y - y, t.x - x), 460, 320)) && t !== owner) landed = true;
  }
  for (const o of G.helis || []) {
    if (o.gone || o.id === hid) continue;
    const d = Math.hypot(o.x - x, o.y - y, o.z + 40 - z);
    if (d < 130 && damageHeli(o, 14 * (1 - d / 200), owner)) landed = true;
  }
  if (landed && owner === G.human) hitMark();
  addFx('puff', x, y, 0, { col: '#e2733b', big: true, z: z + 10 }); addFx('puff', x, y, 0, { col: '#3a3632', big: true, z: z + 30 });
  addFx('bolt', x, y, 0, { t: 0.2 });
  noise(x, y, 0, 1000, owner);
  NET.fx({ k: 'boom', x: Math.round(x), y: Math.round(y), z: Math.round(z) });
  Sfx.play('bolt', x, y, z);
}
// Does a rocket in flight hit a helicopter it didn't come from?
const rocketHitsHeli = p => (G.helis || []).some(o => !o.gone && o.id !== p.heli && Math.hypot(o.x - p.x, o.y - p.y, o.z + 40 - p.z) < 48);
// Ammo is sent when it changes (a few times a second while firing, at once when it runs out or is refilled)
function sendAmmo(h, now = false) { h.ammoDirty = true; if (now) flushAmmo(h); }
function flushAmmo(h) {
  if (!h.ammoDirty) return;
  h.ammoDirty = false; h.ammoSentT = G.t;
  NET.fx({ k: 'ha', i: h.id, a: h.ammo, r: h.rockets });
}
function applyHeliAmmo(d) {
  const h = heliById(d.i);
  if (!h || h.gone || ammoMine(h)) return;
  if (typeof d.a === 'number') h.ammo = clamp(d.a, 0, HELI.ammo);
  if (typeof d.r === 'number') h.rockets = clamp(d.r, 0, HELI.rockets);
}
function applyTracers(d) {
  const a = Array.isArray(d.a) ? d.a : [];
  for (let n = 0; n + 7 <= a.length && n < 70; n += 7) {
    tracer(a[n], a[n + 1], a[n + 2], a[n + 3], a[n + 4], a[n + 5], a[n + 6] ? 'ground' : 'air');
    if (n === 0) Sfx.play('gun', a[0], a[1], a[2]);
  }
}

// ---- every frame ----
// Put the crew in their seats
function placeCrew(h) {
  for (const seat of SEATS) {
    const f = h[seat] && fighterById(h[seat]);
    if (!f || f.heli !== h) continue;
    const s = seatPos(h, seat);
    Object.assign(f, { x: s.x, y: s.y, z: s.z, vz: 0, onGround: true, peakZ: s.z, kbx: 0, kby: 0, mx: 0, my: 0, gather: null, hidden: false });
    if (!f.remote) f.face = seat === 'pilot' ? h.face : h.face + (f.aimYaw || 0);
  }
}
// A helicopter flown on another machine: head for where it last said it was, carrying on at its speed
function followHeli(h, dt) {
  const n = h.net;
  if (!n) return;
  n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
  if (hyp(n.x - h.x, n.y - h.y) > 400) { h.x = n.x; h.y = n.y; h.z = n.z; }
  const k = Math.min(1, dt * 8);
  h.x += (n.x - h.x) * k; h.y += (n.y - h.y) * k; h.z += (n.z - h.z) * k;
  h.face += angDiff(h.face, n.face) * k;
  h.vx = n.vx; h.vy = n.vy; h.vz = n.vz;
  h.rotor += (n.rotor - h.rotor) * k;
  const g = heliGround(h);
  if (h.z < g) { h.z = g; if (n.z < g) n.z = g; }
  h.air = h.z > g + 1.5;
}
function updateHelis(dt) {
  for (const h of G.helis || []) {
    if (h.gone) continue;
    // Forget anyone who's gone from a seat
    for (const seat of SEATS) {
      if (!h[seat]) continue;
      const f = fighterById(h[seat]);
      if (!f || f.heli !== h || !f.alive) { if (f && f.heli === h) { f.heli = null; f.seat = null; } h[seat] = null; }
    }
    if (heliMine(h)) {
      flyHeli(h, dt);
      if (h.gone) continue;
      const busy = h.air || h.rotor > 0.01 || hyp(h.vx, h.vy) > 0.5;
      if ((h.sendT -= dt) <= 0 && (busy || h.wasBusy)) { h.sendT = 0.1; h.wasBusy = busy; NET.fx({ k: 'hs', i: h.id, s: heliState(h) }); }
    } else followHeli(h, dt);
    if (h.hp <= 0 && heliMine(h)) { explodeHeli(h); continue; }
    rearm(h, dt);
    if (h.ammoDirty && G.t - (h.ammoSentT || -9) > 0.25) flushAmmo(h);
    // Blades turn, the body leans into where it's going; a damaged one smokes
    h.blade += h.rotor * dt * 26; h.tail += h.rotor * dt * 60;
    const cf = Math.cos(h.face), sf = Math.sin(h.face), fwd = h.vx * cf + h.vy * sf, side = -h.vx * sf + h.vy * cf;
    const k = Math.min(1, dt * 4);
    h.tilt += (-(h.air ? fwd / HELI.top * 0.28 : 0) - h.tilt) * k; h.roll += ((h.air ? side / HELI.top * 0.35 : 0) - h.roll) * k;
    if (h.hp < HELI.hp * 0.4 && (h.smokeT -= dt) <= 0) { h.smokeT = h.hp < HELI.hp * 0.2 ? 0.08 : 0.2; addFx('puff', h.x - cf * 20, h.y - sf * 20, 0, { col: h.hp < HELI.hp * 0.2 ? '#e2733b' : '#3a3632', z: h.z + 58 }); }
    placeCrew(h);
    // Low fuel beeps for your own crew
    if (heliCrew(h).includes(G.human) && h.air && h.fuel < 12 && (h.beepT = (h.beepT || 0) - dt) <= 0) { h.beepT = 0.5; Sfx.play('beep'); }
  }
  // Tracers you fired go out in batches
  if (G.tracerOut && G.tracerOut.length && (G.tracerT -= dt) <= 0) { G.tracerT = 0.12; NET.fx({ k: 'tr', a: G.tracerOut.flat() }); G.tracerOut = []; }
}
// Someone we simulate is aboard: the helicopter carries them. Returns true while they're still in.
function rideHeli(f) {
  const h = f.heli;
  if (!h.gone && f.alive && !f.layer) return true;
  if (h.gone) { f.heli = null; f.seat = null; } else leaveHeli(f, true);
  return false;
}
// Keep people from walking through a parked helicopter
function pushFromHelis(f) {
  for (const h of G.helis || []) {
    if (h.gone || f.heli || Math.abs(f.z - h.z) > 70) continue;
    const cx = h.x + Math.cos(h.face) * 15, cy = h.y + Math.sin(h.face) * 15, d = hyp(f.x - cx, f.y - cy), m = HELI.body + f.r;
    if (d < m && d > 0.01) { f.x = cx + (f.x - cx) / d * m; f.y = cy + (f.y - cy) / d * m; }
  }
}

// ---- bots ride along as gunners for their duos partner ----
// Walk to the partner's parked helicopter and take the gunner seat
function botBoard(b, dt) {
  const h = b.plan.h, p = partnerOf(b);
  if (!h || h.gone || h.gunner || h.air || !p || p.heli !== h) { b.plan = null; return; }
  if (hyp(h.x - b.x, h.y - b.y) < 90 && Math.abs(h.z - b.z) < 50) { if (!boardHeli(b, h, 'gunner')) b.plan = null; }
  else steer(b, h.x, h.y, 0, dt);
}
// In the gunner seat: swing the chin gun onto the nearest enemy in sight and fire in bursts; rockets for people
// up towers or in other helicopters
function botGunner(b, dt) {
  const h = b.heli, p = h.pilot && fighterById(h.pilot);
  if (!p || !p.alive || p.heli !== h) { if (!h.air) { leaveHeli(b); b.plan = null; } return; } // the pilot got out: us too
  const L = botLvl();
  if ((b.gunLook = (b.gunLook || 0) - dt) <= 0) {
    b.gunLook = 0.35;
    let best = null, bd = 1100;
    const m = muzzle(h);
    if (pvpOn()) for (const t of G.fighters) {
      if (!t.alive || t.layer || t.heli === h || allied(t, b) || t.hidden) continue;
      const d = Math.hypot(t.x - m.x, t.y - m.y, t.z - m.z);
      if (d > bd || Math.abs(angDiff(h.face, Math.atan2(t.y - m.y, t.x - m.x))) > TURRET + 0.2 || !canSee(b, t)) continue;
      bd = d; best = t;
    }
    if (best !== b.gunTarget) { b.gunTarget = best; b.burst = 0; b.gunWait = rr(0.2, 0.6) * L.notice; }
  }
  const t = b.gunTarget;
  b.aimYaw = b.aimYaw || 0;
  if (!t || !t.alive) { b.aimYaw += clamp(-b.aimYaw, -dt, dt); b.pitch = -0.3; return; }
  const m = muzzle(h), d = hyp(t.x - m.x, t.y - m.y), want = angDiff(h.face, Math.atan2(t.y - m.y, t.x - m.x));
  b.aimYaw += clamp(clamp(want, -TURRET, TURRET) - b.aimYaw, -3.2 * dt, 3.2 * dt);
  b.face = h.face + b.aimYaw;
  b.pitch = Math.atan2(t.z + 30 - m.z, d) + (b.aimErr || 0);
  if ((b.gunWait -= dt) > 0) return;
  if (Math.abs(angDiff(b.face, h.face + want)) > 0.06) return;
  // Bursts: fire for a second or so, pause, and pick a new small aiming error each burst (bigger on Easy)
  if (b.burst <= 0) { b.burst = rr(0.7, 1.3); b.aimErr = rr(-1, 1) * L.aim * 0.5; b.face += rr(-1, 1) * L.aim * 0.3; }
  b.burst -= dt;
  if (b.burst <= 0) { b.gunWait = rr(0.3, 0.7); return; }
  const high = t.heli || t.z > heightAt(t.x, t.y) + 50;
  if (h.rockets > 0 && (high || d < 600) && rng() < dt * (high ? 1.2 : 0.25)) fireRocket(b);
  else fireGun(b);
}
