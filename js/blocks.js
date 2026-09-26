'use strict';
// Placeable blocks on a 25-unit grid (surface only): towers, walls, bunkers, traps.
// Cell (i, j, k): i = floor(x / B), k = floor(y / B) horizontally, j = floor(z / B) vertically.
const B = 25, FH = 62, STEP = 8, GRAV = 1100, JUMP_V = 285, REACH = 130, MAX_BLOCKS = 8000;
const BLOCKS = {
  plank:  { name: 'Planks',      solid: true,  hard: 0.5,  color: '#a2774a' },
  cobble: { name: 'Cobblestone', solid: true,  hard: 1.2,  color: '#8c8e8a' },
  hay:    { name: 'Hay Bale',    solid: true,  hard: 0.2,  color: '#d6b248', soft: true },
  spike:  { name: 'Spike Trap',  solid: false, hard: 0.35, color: '#6b5a48', trap: true },
};
const BL = { map: new Map(), ver: 0 };
const bkey = (i, j, k) => i + ',' + j + ',' + k;
const blockAt = (i, j, k) => BL.map.get(bkey(i, j, k));
function solidAt(i, j, k) { const b = BL.map.get(bkey(i, j, k)); return !!b && BLOCKS[b.type].solid; }
function resetBlocks() { BL.map.clear(); BL.ver++; }

// Highest thing you can stand on under a footprint: terrain or a block top no higher than z + STEP.
let SUP_TYPE = null;
function supportAt(x, y, z, r, layer) {
  SUP_TYPE = null;
  if (layer === 1) return 0;
  let s = heightAt(x, y);
  const hr = r * 0.7;
  const i0 = Math.floor((x - hr) / B), i1 = Math.floor((x + hr) / B);
  const k0 = Math.floor((y - hr) / B), k1 = Math.floor((y + hr) / B);
  const jTop = Math.floor((z + STEP) / B) - 1;
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
    for (let j = jTop; (j + 1) * B > s; j--) {
      const b = blockAt(i, j, k);
      if (b && BLOCKS[b.type].solid) { s = (j + 1) * B; SUP_TYPE = b.type; break; }
    }
  }
  return s;
}

// Push a fighter's circle out of any solid block it overlaps vertically.
function collideBlocks(f) {
  if (!BL.map.size) return;
  const i0 = Math.floor((f.x - f.r) / B), i1 = Math.floor((f.x + f.r) / B);
  const k0 = Math.floor((f.y - f.r) / B), k1 = Math.floor((f.y + f.r) / B);
  const j0 = Math.floor((f.z + STEP) / B), j1 = Math.floor((f.z + FH - 1) / B);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
    if (!solidAt(i, j, k)) continue;
    const qx = clamp(f.x, i * B, (i + 1) * B), qy = clamp(f.y, k * B, (k + 1) * B);
    const dx = f.x - qx, dy = f.y - qy, d = hyp(dx, dy);
    if (d >= f.r) continue;
    if (d > 0.001) { f.x += dx / d * (f.r - d); f.y += dy / d * (f.r - d); }
    else {
      const px = [f.x - i * B, (i + 1) * B - f.x], py = [f.y - k * B, (k + 1) * B - f.y], m = Math.min(...px, ...py);
      if (m === px[0]) f.x = i * B - f.r; else if (m === px[1]) f.x = (i + 1) * B + f.r;
      else if (m === py[0]) f.y = k * B - f.r; else f.y = (k + 1) * B + f.r;
    }
    f.kbx *= 0.5; f.kby *= 0.5;
  }
}
function headBlocked(f) {
  const j = Math.floor((f.z + FH) / B), hr = f.r * 0.7;
  for (const [ox, oy] of [[-hr, -hr], [hr, -hr], [-hr, hr], [hr, hr]])
    if (solidAt(Math.floor((f.x + ox) / B), j, Math.floor((f.y + oy) / B))) return j * B - FH;
  return null;
}

// March a ray from the eye; returns the first block or ground it hits within reach.
function rayPick(ox, oy, oz, dx, dy, dz, reach) {
  let pi = null, pj = null, pk = null;
  for (let t = 0; t <= reach; t += 2) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const i = Math.floor(x / B), j = Math.floor(z / B), k = Math.floor(y / B);
    const b = blockAt(i, j, k);
    if (b) return { hit: 'block', i, j, k, b, pi, pj, pk, t };
    if (z <= heightAt(x, y)) {
      const cj = Math.floor(heightAt((i + .5) * B, (k + .5) * B) / B);
      return { hit: 'ground', i, j: cj, k, pi: i, pj: cj, pk: k, t };
    }
    pi = i; pj = j; pk = k;
  }
  return null;
}

function cellBlockedByBody(i, j, k) {
  for (const f of G.fighters) {
    if (!f.alive || f.layer !== 0) continue;
    const qx = clamp(f.x, i * B, (i + 1) * B), qy = clamp(f.y, k * B, (k + 1) * B);
    if (hyp(f.x - qx, f.y - qy) >= f.r - 1) continue;
    if (f.z >= (j + 1) * B - 0.5 || f.z + FH <= j * B) continue;
    return true;
  }
  return false;
}
function canPlace(type, i, j, k) {
  if (i < 1 || k < 1 || i >= WORLD / B - 1 || k >= WORLD / B - 1 || j > 60) return false;
  if (BL.map.has(bkey(i, j, k)) || BL.map.size >= MAX_BLOCKS) return false;
  if (BLOCKS[type].solid && cellBlockedByBody(i, j, k)) return false;
  if (!BLOCKS[type].solid) { // traps sit on something
    const g = heightAt((i + .5) * B, (k + .5) * B);
    if (!solidAt(i, j - 1, k) && g < j * B - 4) return false;
  }
  return true;
}
const BTYPES = Object.keys(BLOCKS);
function placeBlock(f, type, i, j, k) {
  if (count(f, type) <= 0 || !canPlace(type, i, j, k)) return false;
  take(f, type, 1, heldId(f) === type ? f.sel : null);
  BL.map.set(bkey(i, j, k), { type, owner: f.id });
  BL.ver++;
  NET.blk(type === 'spike' ? [i, j, k, BTYPES.indexOf(type), f.id] : [i, j, k, BTYPES.indexOf(type)]);
  Sfx.play('place', (i + .5) * B, (k + .5) * B, j * B);
  return true;
}
// Block changes made on another player's machine
function applyBlockOps(ops) {
  for (const [i, j, k, t, owner] of ops) {
    if (t < 0) BL.map.delete(bkey(i, j, k));
    else BL.map.set(bkey(i, j, k), { type: BTYPES[t], owner: owner || null });
  }
  BL.ver++;
}
function breakBlock(i, j, k, f) {
  const key = bkey(i, j, k), b = BL.map.get(key);
  if (!b) return;
  BL.map.delete(key); BL.ver++;
  NET.blk([i, j, k, -1]);
  if (f) { const l = give(f, b.type, 1); if (l) dropStacks(f, [{ id: b.type, n: 1 }]); }
  addFx('chip', (i + .5) * B, (k + .5) * B, 0, { col: BLOCKS[b.type].color, z: j * B + 12 });
  Sfx.play('break', (i + .5) * B, (k + .5) * B, j * B);
}
// Lightning and similar: wipe every block in a vertical cylinder.
function strikeBlocks(x, y, rad) {
  let n = 0;
  for (const [key, b] of BL.map) {
    const [i, j, k] = key.split(',').map(Number);
    if (hyp((i + .5) * B - x, (k + .5) * B - y) < rad) { BL.map.delete(key); NET.blk([i, j, k, -1]); n++; if (n % 3 === 0) addFx('chip', (i + .5) * B, (k + .5) * B, 0, { col: BLOCKS[b.type].color, z: j * B }); }
  }
  if (n) BL.ver++;
  return n;
}
function trapAt(f) {
  if (f.layer || !BL.map.size) return null;
  const i = Math.floor(f.x / B), k = Math.floor(f.y / B), j = Math.floor((f.z + 1) / B);
  const b = blockAt(i, j, k);
  return b && b.type === 'spike' ? b : null;
}
