'use strict';
// Placeable blocks on a 25-unit grid (surface only): towers, walls, bunkers, traps.
// Cell (i, j, k): i = floor(x / B), k = floor(y / B) horizontally, j = floor(z / B) vertically.
const B = 25, FH = 62, STEP = 8, GRAV = 1100, JUMP_V = 285, REACH = 130, MAX_BLOCKS = 8000;
const BLOCKS = {
  plank:  { name: 'Planks',      solid: true,  hard: 0.5,  color: '#a2774a' },
  cobble: { name: 'Cobblestone', solid: true,  hard: 1.2,  color: '#8c8e8a' },
  hay:    { name: 'Hay Bale',    solid: true,  hard: 0.2,  color: '#d6b248', soft: true },
  spike:  { name: 'Spike Trap',  solid: false, hard: 0.35, color: '#6b5a48', trap: true },
  ladder: { name: 'Ladder',      solid: false, hard: 0.3,  color: '#8a6a44', ladder: true },
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
  const g = heightAt((i + .5) * B, (k + .5) * B), grounded = solidAt(i, j - 1, k) || g >= j * B - 4;
  if (BLOCKS[type].ladder) { // ladders lean on a wall, sit on the ground, or continue a ladder below
    const b = blockAt(i, j - 1, k);
    if (!grounded && !(b && b.type === 'ladder') && !ladderWall(i, j, k)) return false;
  } else if (!BLOCKS[type].solid && !grounded) return false; // traps sit on something
  return true;
}
// Which side of a ladder cell has a wall to lean on: 0 +x, 1 -x, 2 +y, 3 -y (null if none)
// Prefers a wall whose opposite side is open, so the ladder faces the way you climb it.
function ladderWall(i, j, k) {
  let best = null, score = -1;
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dk], n) => {
    if (!solidAt(i + di, j, k + dk)) return;
    const s = solidAt(i - di, j, k - dk) ? 0 : 1;
    if (s > score) { score = s; best = n; }
  });
  return best;
}
// Standing in a ladder cell (anywhere from the feet to the chest)
function ladderAt(f) {
  if (f.layer || !BL.map.size) return false;
  const hr = f.r * 0.7;
  for (let j = Math.floor(f.z / B); j <= Math.floor((f.z + FH * 0.5) / B); j++)
    for (const [ox, oy] of [[0, 0], [-hr, -hr], [hr, -hr], [-hr, hr], [hr, hr]]) {
      const b = blockAt(Math.floor((f.x + ox) / B), j, Math.floor((f.y + oy) / B));
      if (b && b.type === 'ladder') return true;
    }
  return false;
}
const BTYPES = Object.keys(BLOCKS);
function placeBlock(f, type, i, j, k) {
  if (count(f, type) <= 0 || !canPlace(type, i, j, k)) return false;
  take(f, type, 1, heldId(f) === type ? f.sel : null);
  BL.map.set(bkey(i, j, k), { type, owner: f.id });
  BL.ver++;
  if (f === G.human && G.stats) G.stats.blocks++;
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
  if (f === G.human && G.stats) G.stats.broken++;
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

// ---- ruins: built from blocks at match start, the same on every player's machine ----
function buildRuins() {
  const set = (i, j, k, type) => BL.map.set(bkey(i, j, k), { type, owner: null });
  const base = (i, k) => Math.floor(heightAt((i + .5) * B, (k + .5) * B) / B);
  for (const [n, r] of world.ruins.entries()) {
    const rnd = mulberry32(world.seed ^ (n * 9973 + 17));
    const ci = Math.floor(r.x / B), ck = Math.floor(r.y / B);
    let top = -99;
    if (r.kind === 'cabin') {
      for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) top = Math.max(top, base(ci + di, ck + dk));
      const door = Math.floor(rnd() * 4);
      for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) {
        const edge = Math.abs(di) === 2 || Math.abs(dk) === 2;
        if (edge) {
          const isDoor = [di === 2 && dk === 0, di === -2 && dk === 0, dk === 2 && di === 0, dk === -2 && di === 0][door];
          for (let j = base(ci + di, ck + dk); j < top + 3; j++) {
            if (isDoor && j < top + 2 && j >= base(ci + di, ck + dk)) continue;
            if (rnd() < 0.08) continue; // weathered gaps
            set(ci + di, j, ck + dk, 'cobble');
          }
        }
        if (rnd() > 0.15) set(ci + di, top + 3, ck + dk, 'plank'); // roof with a few holes
      }
      r.chestZ = heightAt(r.x, r.y);
    } else if (r.kind === 'ruin') {
      for (let di = -3; di <= 2; di++) for (let dk = -3; dk <= 2; dk++) {
        if (!(di === -3 || di === 2 || dk === -3 || dk === 2)) continue;
        const h = 1 + Math.floor(rnd() * 3);
        for (let q = 0; q < h; q++) if (rnd() > 0.3) set(ci + di, base(ci + di, ck + dk) + q, ck + dk, 'cobble');
      }
      r.chestZ = heightAt(r.x, r.y);
    } else r.chestZ = buildTower(ci, ck, 9 + Math.floor(rnd() * 3), 'plank');
  }
  BL.ver++;
}
const setB = (i, j, k, type) => BL.map.set(bkey(i, j, k), { type, owner: null });
const baseJ = (i, k) => Math.floor(heightAt((i + .5) * B, (k + .5) * B) / B);
// Watchtower: corner posts, a solid core with a ladder up one side, a platform with a hatch. Returns the platform height.
function buildTower(ci, ck, H, mat) {
  let top = -99;
  for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) top = Math.max(top, baseJ(ci + di, ck + dk));
  const plat = top + H;
  for (const [di, dk] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let j = baseJ(ci + di, ck + dk); j < plat; j++) setB(ci + di, j, ck + dk, mat);
  for (let j = baseJ(ci, ck); j < plat; j++) setB(ci, j, ck, mat); // solid core the ladder leans on
  for (let j = baseJ(ci, ck + 1); j <= plat; j++) setB(ci, j, ck + 1, 'ladder'); // runs up through the hatch
  for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) if (!(di === 0 && dk === 1)) setB(ci + di, plat, ck + dk, 'plank');
  for (const [di, dk] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) setB(ci + di, plat + 1, ck + dk, 'plank'); // railing posts
  return (plat + 1) * B;
}

// ---- landmarks: one legendary item each ----
function buildLandmarks() {
  for (const m of world.landmarks) {
    const ci = Math.floor(m.x / B), ck = Math.floor(m.y / B);
    m.chestZ = m.layer ? 0 : heightAt(m.x, m.y);
    if (m.id === 'crowsnest') {
      m.chestZ = buildTower(ci, ck, 16, 'cobble');
    } else if (m.id === 'peak') { // shrine: four pillars and a roof
      let top = -99;
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) top = Math.max(top, baseJ(ci + di, ck + dk));
      for (const [di, dk] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let j = baseJ(ci + di, ck + dk); j < top + 3; j++) setB(ci + di, j, ck + dk, 'cobble');
      for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) if (Math.abs(di) + Math.abs(dk) < 4) setB(ci + di, top + 3, ck + dk, 'cobble');
    } else if (m.id === 'altar') { // raised platform in the swamp with four posts
      for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) {
        for (let j = baseJ(ci + di, ck + dk); j < 0; j++) setB(ci + di, j, ck + dk, 'plank');
        if (Math.abs(di) === 2 && Math.abs(dk) === 2) { setB(ci + di, 0, ck + dk, 'cobble'); setB(ci + di, 1, ck + dk, 'cobble'); }
      }
      m.chestZ = 0;
    } else if (m.id === 'forge') { // walled ring with two gaps, spike traps just inside each gap
      for (let di = -4; di <= 4; di++) for (let dk = -4; dk <= 4; dk++) {
        const ring = Math.max(Math.abs(di), Math.abs(dk)) === 4;
        if (!ring) continue;
        const gap = (dk === 0 && Math.abs(di) === 4);
        if (gap) { setB(ci + di - Math.sign(di), baseJ(ci + di - Math.sign(di), ck), ck, 'spike'); continue; }
        for (let q = 0; q < 2; q++) setB(ci + di, baseJ(ci + di, ck + dk) + q, ck + dk, 'cobble');
      }
      for (const [di, dk] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) setB(ci + di, baseJ(ci + di, ck + dk), ck + dk, 'cobble'); // the anvil around the chest
    }
  }
  BL.ver++;
}
