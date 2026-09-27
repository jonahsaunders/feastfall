'use strict';
// Tunnels you can change: dig new passages through the rock, and bring the roof down in cave-ins.
// A dig is a circle of open floor. The walkable underground is the original passages plus every dig (walkUnder asks
// digAt), so fighters, rats, arrows and line of sight all follow new passages without knowing about them.
// Cave-ins fill the passage with rubble blocks, which break like any block and give you stone.
const DIG_R = 34, DIG_STEP = 20, DIG_CELL = 100, MAX_DIGS = 3000, CAVE_R = 58;

function resetDigs() { world.digs = []; world.digGrid = new Map(); }
// Is (x, y) at least r inside a dug-out circle? (r can be negative: within -r of one)
function digAt(x, y, r) {
  const g = world.digGrid;
  if (!g || !g.size) return false;
  const cx = Math.floor(x / DIG_CELL), cy = Math.floor(y / DIG_CELL);
  for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
    const list = g.get(a + ',' + b);
    if (list) for (const d of list) if (hyp(d.x - x, d.y - y) < d.r - r) return true;
  }
  return false;
}
function addDig(x, y, send) {
  if (!world.digs) resetDigs();
  if (world.digs.length >= MAX_DIGS) return false;
  const d = { x, y, r: DIG_R }, key = Math.floor(x / DIG_CELL) + ',' + Math.floor(y / DIG_CELL);
  world.digs.push(d);
  if (!world.digGrid.has(key)) world.digGrid.set(key, []);
  world.digGrid.get(key).push(d);
  tunnelDug(d); // open up the rock walls (scene3d)
  if (send) NET.fx({ k: 'dig', a: [Math.round(x), Math.round(y)] });
  return true;
}
// How long one stride of digging takes: quicker with a stone sword or better, almost instant with the Quake Maul
const digTime = def => def && def.tier === 5 ? 0.15 : def && def.tier >= 2 ? 0.6 : 0.9;
// Up against the rock: dig a stride forward. The new circle always contains where you stand, so it joins up.
function digWall(f) {
  const c = Math.cos(f.face), s = Math.sin(f.face), x = f.x + c * DIG_STEP, y = f.y + s * DIG_STEP;
  if (x < 80 || y < 80 || x > WORLD - 80 || y > WORLD - 80 || !addDig(x, y, true)) {
    if (f === G.human) toast('The rock here is too hard to dig');
    return false;
  }
  const wx = x + c * DIG_R, wy = y + s * DIG_R;
  addFx('chip', wx, wy, 1, { col: '#6b5f52', z: 40 }); addFx('puff', wx, wy, 1, { col: '#5e544a', z: 30 });
  Sfx.play('break', wx, wy, 30);
  noise(x, y, 1, 350, f);
  if (rng() < 0.5) { const l = give(f, 'stone', 1); if (l) dropStacks(f, [{ id: 'stone', n: 1 }]); }
  if (f === G.human && G.stats) G.stats.dug = (G.stats.dug || 0) + 1;
  return true;
}
// A cave-in around (x, y): rubble fills the passage, three blocks high right across it (too high to climb over under
// the roof) and two at the fringes, leaving a pocket around anyone caught in it. Everyone close is hit by falling
// rock. Blast traps and the Sapper cause them.
function caveIn(x, y, by, R = CAVE_R) {
  const ci = Math.floor(x / B), ck = Math.floor(y / B), n = Math.ceil(R / B), t = BTYPES.indexOf('rubble');
  let placed = 0;
  for (let di = -n; di <= n; di++) for (let dk = -n; dk <= n; dk++) {
    const i = ci + di, k = ck + dk, d = hyp((i + .5) * B - x, (k + .5) * B - y);
    if (d > R || !underCellOk(i, UJ, k)) continue;
    const h = d < R * 0.8 ? 3 : 2;
    for (let j = UJ; j < UJ + h; j++) {
      if (blockAt(i, j, k)) continue;
      if (cellBlockedByBody(i, j, k) || BL.map.size >= MAX_BLOCKS || (j > UJ && !blockAt(i, j - 1, k))) break; // rubble only piles on rubble
      BL.map.set(bkey(i, j, k), { type: 'rubble', owner: null });
      NET.blk([i, j, k, t]);
      placed++;
    }
  }
  BL.ver++;
  for (const f of G.fighters) {
    if (!f.alive || f.layer !== 1) continue;
    const d = hyp(f.x - x, f.y - y);
    if (d > R + 20) continue;
    if (!f.remote) f.diedTo = 'cavein';
    withKind('cavein', () => hurt(f, 4 * (1 - d / (R + 60)), by && by !== f ? by : null, Math.atan2(f.y - y, f.x - x), 240, 120));
    if (f.alive && !f.remote) f.diedTo = null;
  }
  caveFx(x, y);
  noise(x, y, 1, 1000, by);
  NET.fx({ k: 'cave', x: Math.round(x), y: Math.round(y) });
  return placed;
}
function caveFx(x, y) {
  for (let q = 0; q < 6; q++) addFx('puff', x + rr(-40, 40), y + rr(-40, 40), 1, { col: q % 2 ? '#6b5f52' : '#8a7a68', big: true, z: rr(20, 100), t: 0.9 });
  addFx('ring', x, y, 1, { col: '#8a7a68', big: true, z: 2 });
  Sfx.play('stomp', x, y, 40); Sfx.play('break', x, y, 60);
}
