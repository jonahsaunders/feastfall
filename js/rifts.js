'use strict';
// The Rift Lantern (a legendary, found at the Rift Stones) opens two linked rifts: violet with a left click, green with a
// right click, on whatever you aim at: the ground, a wall of blocks, the tunnel rock, even the tunnel roof. Walk into one
// and you step out of the other, keeping your speed and facing out of it, so dropping into a rift in the floor flings you
// out of one on a wall. Anyone can go through, and a pair can join the surface to the tunnels.
// Rifts belong to whoever opened them and close when they die or lose the lantern. Opening and closing is shared
// through NET.fx; every machine moves the fighters it simulates.
const RIFT_REACH = 1000, RIFT_R = 22, RIFT_H = 32, RIFT_COLS = ['#b06cff', '#5ee38f'];

function resetRifts() { G.rifts = new Map(); G.riftCheckT = 0; }
function riftsOf(id) {
  if (!G.rifts) resetRifts();
  if (!G.rifts.has(id)) G.rifts.set(id, [null, null]);
  return G.rifts.get(id);
}
const packRift = r => r && [r.x, r.y, r.z, r.nx, r.ny, r.nz, r.layer].map(Math.round).concat(r.cell || []);
function unpackRift(a, n) {
  if (!Array.isArray(a) || a.length < 7 || a.slice(0, 7).some(v => typeof v !== 'number')) return null;
  return { x: a[0], y: a[1], z: a[2], nx: a[3], ny: a[4], nz: a[5], layer: a[6] ? 1 : 0, cell: a.length >= 10 ? a.slice(7, 10) : null, n };
}

// Aim the lantern: find the surface under the crosshair, which way it faces, and where the rift sits on it
function riftSpot(f, pitch) {
  const cp = Math.cos(pitch), dx = Math.cos(f.face) * cp, dy = Math.sin(f.face) * cp, dz = Math.sin(pitch), eye = f.z + EYE * (f.size || 1);
  const a = rayPick(f.x, f.y, eye, dx, dy, dz, RIFT_REACH, false, f.layer);
  if (!a) return null;
  const hx = f.x + dx * a.t, hy = f.y + dy * a.t, hz = eye + dz * a.t;
  let nx = 0, ny = 0, nz = 0, cell = null;
  if (a.hit === 'block') {
    if (a.pi === null) return null;
    nx = a.pi - a.i; ny = a.pk - a.k; nz = cellZ(a.pj) - cellZ(a.j) > 0 ? 1 : cellZ(a.pj) < cellZ(a.j) ? -1 : 0;
    cell = [a.i, a.j, a.k];
  } else if (a.hit === 'ground') nz = 1;
  else if (a.hit === 'roof') nz = -1;
  else if (a.hit === 'wall') { // tunnel rock: face back toward the open passage
    for (let q = 0; q < 8; q++) { const t = q / 8 * Math.PI * 2; if (walkUnder(hx + Math.cos(t) * 24, hy + Math.sin(t) * 24, 0)) { nx += Math.cos(t); ny += Math.sin(t); } }
    if (!nx && !ny) { nx = -dx; ny = -dy; }
  }
  // Snap to the main axis: floor, roof, or a wall facing out horizontally
  if (Math.abs(nz) >= Math.max(Math.abs(nx), Math.abs(ny)) && nz) { nx = ny = 0; nz = Math.sign(nz); }
  else { const l = hyp(nx, ny) || 1; nx /= l; ny /= l; nz = 0; }
  let x = hx + nx * 2, y = hy + ny * 2, z;
  if (nz > 0) z = (a.hit === 'ground' ? floorAt(hx, hy, f.layer) : hz) + 1;
  else if (nz < 0) z = hz - 1;
  else z = Math.max(hz, supportAt(hx + nx * 20, hy + ny * 20, hz, 6, f.layer) + RIFT_H); // stands on the floor in front of the wall
  return { x, y, z, nx, ny, nz, layer: f.layer, cell };
}
function openRift(f, n, pitch) {
  if (!f.alive || f.bike || f.heli || (f.riftCd || 0) > G.t) return false;
  f.riftCd = G.t + 0.35;
  const r = riftSpot(f, pitch), pair = riftsOf(f.id), other = pair[1 - n];
  if (!r) { if (f === G.human) toast('Nothing there to open a rift on'); Sfx.play('craft', f.x, f.y, f.z); return false; }
  if (other && other.layer === r.layer && Math.hypot(other.x - r.x, other.y - r.y, other.z - r.z) < RIFT_R * 2.5) { if (f === G.human) toast('Too close to your other rift'); return false; }
  r.n = n;
  pair[n] = r;
  const eye = f.z + EYE * (f.size || 1);
  addFx('tracer', f.x, f.y, f.layer, { x2: r.x, y2: r.y, z: eye - 12, z2: r.z, t: 0.18, col: RIFT_COLS[n] });
  riftFx(r);
  noise(f.x, f.y, f.layer, 380, f);
  NET.fx({ k: 'rift', o: f.id, n, r: packRift(r) });
  if (f === G.human && !other) toast(`${n ? 'Green' : 'Violet'} rift open · open the ${n ? 'violet' : 'green'} one (${n ? 'left' : 'right'} click) to link them`);
  return true;
}
function closeRifts(id, send) {
  const pair = G.rifts && G.rifts.get(id);
  if (!pair || (!pair[0] && !pair[1])) return;
  for (const r of pair) if (r) addFx('puff', r.x, r.y, r.layer, { col: RIFT_COLS[r.n], z: r.z, t: 0.5 });
  G.rifts.delete(id);
  if (send) NET.fx({ k: 'rift', o: id, n: -1 });
}
function applyRiftMsg(d) {
  if (typeof d.o !== 'string') return;
  if (d.n === -1) { closeRifts(d.o, false); return; }
  if (d.n !== 0 && d.n !== 1) return;
  const r = unpackRift(d.r, d.n);
  if (!r) return;
  riftsOf(d.o)[d.n] = r;
  riftFx(r);
}
function riftFx(r) {
  addFx('ring', r.x, r.y, r.layer, { col: RIFT_COLS[r.n], z: r.z + (r.nz ? 0 : -RIFT_H + 2), t: 0.5 });
  Sfx.play('rift', r.x, r.y, r.z);
}

// Is this fighter stepping (or falling, or jumping) into rift r?
function inRift(f, r) {
  if (r.layer !== f.layer) return false;
  if (r.nz > 0) return hyp(f.x - r.x, f.y - r.y) < RIFT_R && f.z <= r.z + 6 && f.z >= r.z - 40;
  if (r.nz < 0) return hyp(f.x - r.x, f.y - r.y) < RIFT_R && f.z + fh(f) >= r.z - 8 && f.z + fh(f) <= r.z + 40;
  const dx = f.x - r.x, dy = f.y - r.y, front = dx * r.nx + dy * r.ny, side = Math.abs(-dx * r.ny + dy * r.nx);
  return front < f.r + 6 && front > -10 && side < RIFT_R && f.z < r.z + RIFT_H && f.z + fh(f) > r.z - RIFT_H;
}
// Landing right now on a linked rift in the floor? (Then there's no fall damage: you keep falling, through it.)
function riftUnder(f) {
  if (!G.rifts || !G.rifts.size || f.riftT > G.t || f.remote || f.bike || f.heli) return false;
  for (const [, pair] of G.rifts) if (pair[0] && pair[1] && pair.some(r => r.nz > 0 && inRift(f, r))) return true;
  return false;
}
// Through: out of rift b at the speed you went in (at least a brisk step), facing out of it
function riftWarp(f, a, b) {
  if (b.layer !== f.layer && isTitan(f)) return; // Titans don't fit down the tunnels
  const s = Math.min(1500, Math.max(220, f.riftV || 0, Math.hypot(f.kbx || 0, f.kby || 0, f.vz || 0) + (hyp(f.mx || 0, f.my || 0) > 0.1 ? 190 : 0)));
  f.riftV = 0;
  if (f.layer !== b.layer) { f.layer = b.layer; f.path = null; }
  if (b.nz > 0) Object.assign(f, { x: b.x, y: b.y, z: b.z + 2, vz: Math.max(s, 340), kbx: 0, kby: 0 });           // out of the floor: straight up
  else if (b.nz < 0) Object.assign(f, { x: b.x, y: b.y, z: b.z - fh(f) - 4, vz: -Math.min(s, 400), kbx: 0, kby: 0 }); // out of a roof: dropped
  else {                                                                                                     // out of a wall: forward
    const x = b.x + b.nx * (f.r + 8), y = b.y + b.ny * (f.r + 8), out = Math.max(s, 280);
    Object.assign(f, { x, y, z: Math.max(b.z - RIFT_H, supportAt(x, y, b.z, f.r, b.layer)), kbx: b.nx * out, kby: b.ny * out, vz: 80, face: Math.atan2(b.ny, b.nx) });
  }
  f.x = clamp(f.x, 20, WORLD - 20); f.y = clamp(f.y, 20, WORLD - 20);
  Object.assign(f, { onGround: false, peakZ: f.z, riftT: G.t + 0.45, gather: null, hook: null, hidden: false });
  for (const r of [a, b]) addFx('puff', r.x, r.y, r.layer, { col: RIFT_COLS[r.n], z: r.z, t: 0.4 });
  Sfx.play('warp', a.x, a.y, a.z); Sfx.play('warp', b.x, b.y, b.z);
  noise(b.x, b.y, b.layer, 300, f);
  if (f === G.human && b.nz === 0) VIEW.pitch = -0.05;
}
// Every frame: move anyone we simulate who's gone into a linked rift; close rifts whose owner is gone or lost the
// lantern, and any stuck to a block that's been broken
function updateRifts(dt) {
  if (!G.rifts || !G.rifts.size) return;
  if ((G.riftCheckT -= dt) <= 0) {
    G.riftCheckT = 0.5;
    for (const [id, pair] of [...G.rifts]) {
      const o = fighterById(id);
      if (!o || !o.alive || G.pit) { closeRifts(id, false); continue; }
      if (!o.remote && !count(o, 'riftlantern')) { closeRifts(id, true); continue; }
      pair.forEach((r, n) => { if (r && r.cell && !blockAt(...r.cell)) { pair[n] = null; addFx('puff', r.x, r.y, r.layer, { col: RIFT_COLS[n], z: r.z }); } });
    }
  }
  for (const [, pair] of G.rifts) {
    if (!pair[0] || !pair[1]) continue;
    for (const f of G.fighters) {
      if (!f.alive || f.remote || f.bike || f.heli || f.riftT > G.t || f.pitT > 0) continue;
      if (inRift(f, pair[0])) riftWarp(f, pair[0], pair[1]);
      else if (inRift(f, pair[1])) riftWarp(f, pair[1], pair[0]);
    }
  }
}
