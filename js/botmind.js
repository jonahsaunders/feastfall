'use strict';
// What bots notice and how they get around.
// Perception: bots only see what's in line of sight (terrain, trees, rocks and blocks get in the way), hear noises
// (swings, hits, arrows, building, chopping, explosions, engines, footsteps), and remember where they last saw or
// heard someone for a while. Pathfinding: a coarse grid search around obstacles on the surface.

// ---------- noises ----------
// Anything loud leaves a noise for a moment; bots within its radius hear where it came from.
function noise(x, y, layer, r, src) {
  if (NET.on && !NET.isHost()) return; // only the machine that runs the bots needs them
  G.noises.push({ x, y, layer, r, src: src && src.isFighter ? (src.owner || src) : null, t: G.t });
}
function pruneNoises() { if (G.noises.length) G.noises = G.noises.filter(n => G.t - n.t < 1.5); }

// ---------- line of sight ----------
const EYE_Z = f => f.z + 46 * (f.size || 1), CHEST_Z = f => f.z + 34 * (f.size || 1);
function canSee(a, o) {
  if (a.layer !== o.layer) return false;
  const dx = o.x - a.x, dy = o.y - a.y, d = hyp(dx, dy);
  if (d < 60) return true;
  if (a.layer === 1) { // underground: the whole line has to stay inside the tunnels, and walls of blocks hide you
    for (let t = 30; t < d; t += 30) {
      const x = a.x + dx * t / d, y = a.y + dy * t / d;
      if (!walkUnder(x, y, 2)) return false;
      if (BL.map.size) { const b = blockAt(Math.floor(x / B), UJ + 1, Math.floor(y / B)); if (blockSolid(b) && !BLOCKS[b.type].glass) return false; }
    }
    return true;
  }
  const z0 = EYE_Z(a), z1 = CHEST_Z(o);
  // hills and placed blocks
  for (let t = 25; t < d - 20; t += 25) {
    const k = t / d, x = a.x + dx * k, y = a.y + dy * k, z = z0 + (z1 - z0) * k;
    if (z < heightAt(x, y) + 2) return false;
    if (BL.map.size) { const b = blockAt(Math.floor(x / B), Math.floor(z / B), Math.floor(y / B)); if (blockSolid(b) && !BLOCKS[b.type].glass && !BLOCKS[b.type].hatch) return false; }
  }
  // trees, rocks and cacti near the line
  for (const ob of nearObjs(a.x + dx / 2, a.y + dy / 2, d / 2 + 40)) {
    if (ob.amt <= 0 || ob.kind === 'reed') continue;
    const k = clamp(((ob.x - a.x) * dx + (ob.y - a.y) * dy) / (d * d), 0, 1);
    if (k < 0.04 || k > 0.96) continue;
    const px = a.x + dx * k, py = a.y + dy * k;
    if (hyp(ob.x - px, ob.y - py) > ob.r * 0.85) continue;
    const top = heightAt(ob.x, ob.y) + (ob.kind === 'tree' ? 115 : ob.kind === 'rock' ? ob.r * 1.2 : 70);
    if (z0 + (z1 - z0) * k < top) return false;
  }
  return true;
}

// ---------- memory ----------
// b.mem: fighter -> { x, y, layer, t, seen } — the last place this bot saw (or heard) them
function remember(b, o, seen, x = o.x, y = o.y) {
  const m = b.mem || (b.mem = new Map()), p = m.get(o);
  m.set(o, { x, y, layer: o.layer, t: G.t, seen, first: seen && !(p && p.seen && G.t - p.t < 2.5) ? G.t : (p ? p.first : G.t) });
}
function forget(b) {
  if (!b.mem) return;
  const keep = botLvl().mem;
  for (const [o, m] of b.mem) if (!o.alive || G.t - m.t > keep) b.mem.delete(o);
}
// Look and listen: returns the enemies this bot can see right now, nearest first, with distances
function perceive(b) {
  forget(b);
  const L = botLvl(), sight = sightRange(b), vis = [];
  const cand = [];
  for (const o of G.fighters) {
    if (o === b || !o.alive || o.layer !== b.layer || o.owner === b || allied(o, b)) continue;
    const d = hyp(o.x - b.x, o.y - b.y);
    if (d > sight) continue;
    if (o.hidden && d > 55) continue;
    cand.push([o, d]);
    // footsteps: someone moving close by, not sneaking, gets heard even out of sight
    if (d < 170 * L.hear && !o.sneak && !(o.net && o.net.sn) && hyp(o.mx || 0, o.my || 0) > 0.1 && !o.bike && !o.heli) remember(b, o, false, o.x + rr(-30, 30), o.y + rr(-30, 30));
  }
  cand.sort((p, q) => p[1] - q[1]);
  let checks = 0;
  for (const [o, d] of cand) {
    if (checks >= 5) break; // only the closest few get a full line-of-sight check
    checks++;
    if (!canSee(b, o)) continue;
    remember(b, o, true);
    vis.push({ o, d, reach: Math.abs(o.z - b.z) < 45 * Math.max(b.size || 1, o.size || 1) });
  }
  // noises: remember roughly where they came from (and who made them, if it's an enemy)
  for (const n of G.noises) {
    if (n.layer !== b.layer || !n.src || n.src === b || !n.src.alive || allied(n.src, b)) continue;
    const d = hyp(n.x - b.x, n.y - b.y);
    if (d > n.r * L.hear) continue;
    const m = b.mem && b.mem.get(n.src);
    if (!m || (!m.seen && G.t - m.t > 0.5) || G.t - m.t > 1.5) remember(b, n.src, false, n.x + rr(-40, 40) * d / n.r, n.y + rr(-40, 40) * d / n.r);
  }
  return vis;
}
// The most recent thing worth checking out: someone seen or heard but not visible now
function lastKnown(b) {
  let best = null;
  if (b.mem) for (const [o, m] of b.mem) if (o.alive && m.layer === b.layer && (!best || m.t > best.m.t)) best = { o, m };
  return best;
}

// ---------- surface pathfinding ----------
// A 50-unit grid: a cell is blocked by a tree, rock or cactus, a wall of blocks, lava, the pit wall, or the map edge.
// Swamp and sea cost more. Cells are cached for a few seconds (blocks change).
const PG = 50;
const pgCache = new Map();
function cellCost(ci, ck) {
  const key = ci * 8192 + ck, c = pgCache.get(key);
  if (c && G.t - c.t < 4 && c.w === world) return c.v;
  const x = (ci + .5) * PG, y = (ck + .5) * PG;
  let v = 1;
  if (x < 30 || y < 30 || x > WORLD - 30 || y > WORLD - 30 || lavaPoolAt(x, y, 25)) v = 0;
  else if (G.pit && hyp(x - PIT.x, y - PIT.y) > PIT.r - 20) v = 0;
  else {
    for (const o of nearObjs(x, y, 60)) if (o.kind !== 'reed' && o.amt > 0 && hyp(o.x - x, o.y - y) < o.r + 14) { v = 0; break; }
    // Blocks: any wall closes the cell, unless there's a door in it (a doorway is a way through)
    let walls = 0, door = false;
    if (v && BL.map.size) for (let i = ci * 2; i <= ci * 2 + 1 && v; i++) for (let k = ck * 2; k <= ck * 2 + 1; k++) {
      const j = baseJ(i, k), d = blockAt(i, j + 1, k) || blockAt(i, j, k);
      if (d && BLOCKS[d.type].door && !BLOCKS[d.type].hatch) door = true;
      if (wallAt(i, j, k) || wallAt(i, j + 1, k, true)) walls++;
      const lv = blockAt(i, j, k); if (lv && lv.type === 'lava') { v = 0; break; }
    }
    if (walls && !door) v = 0;
    if (v && biomeAt(x, y) === 3) v = 2.2;
  }
  pgCache.set(key, { v, t: G.t, w: world });
  return v;
}
// A block bots can't just walk through: doors don't count (they open them), nor do slabs and stairs at foot level
function wallAt(i, j, k, head) {
  const b = blockAt(i, j, k);
  if (!blockSolid(b) || BLOCKS[b.type].door) return false;
  const x = (i + .5) * B, y = (k + .5) * B;
  return head || blockTop(b, i, j, k, x, y) > Math.max(j * B, heightAt(x, y)) + STEP; // sticks up too far to step onto
}
function resetPaths() { pgCache.clear(); }
// Grid line check: every cell the segment passes through is open
function gridClear(x0, y0, x1, y1) {
  const d = hyp(x1 - x0, y1 - y0), n = Math.ceil(d / 20);
  for (let s = 1; s <= n; s++) { const k = s / n; if (!cellCost(Math.floor((x0 + (x1 - x0) * k) / PG), Math.floor((y0 + (y1 - y0) * k) / PG))) return false; }
  return true;
}
// A*, 8 directions, capped; returns smoothed waypoints to (x1, y1) or as close as it got
function findPath(x0, y0, x1, y1) {
  const si = Math.floor(x0 / PG), sk = Math.floor(y0 / PG), gi = Math.floor(x1 / PG), gk = Math.floor(y1 / PG);
  const key = (i, k) => i * 8192 + k, h = (i, k) => { const a = Math.abs(i - gi), c = Math.abs(k - gk); return (a + c) + (Math.SQRT2 - 2) * Math.min(a, c); };
  const g = new Map([[key(si, sk), 0]]), from = new Map(), heap = [[h(si, sk), si, sk]];
  const push = n => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let best = [si, sk], bh = h(si, sk), n = 0;
  while (heap.length && n++ < 2600) {
    const [, i, k] = pop(), gk0 = g.get(key(i, k));
    if (i === gi && k === gk) { best = [i, k]; break; }
    const hh = h(i, k); if (hh < bh) { bh = hh; best = [i, k]; }
    for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
      if (!di && !dk) continue;
      const ni = i + di, nk = k + dk, c = (ni === gi && nk === gk) ? 1 : cellCost(ni, nk);
      if (!c) continue;
      if (di && dk && (!cellCost(i + di, k) || !cellCost(i, k + dk))) continue; // no cutting corners
      const ng = gk0 + c * (di && dk ? Math.SQRT2 : 1), nkey = key(ni, nk);
      if (ng >= (g.get(nkey) ?? Infinity)) continue;
      g.set(nkey, ng); from.set(nkey, [i, k]); push([ng + h(ni, nk), ni, nk]);
    }
  }
  const cells = [];
  for (let c = best; c && !(c[0] === si && c[1] === sk); c = from.get(key(c[0], c[1]))) cells.unshift(c);
  const pts = cells.map(([i, k]) => ({ x: (i + .5) * PG, y: (k + .5) * PG }));
  if (best[0] === gi && best[1] === gk && pts.length) pts[pts.length - 1] = { x: x1, y: y1 };
  // string-pull: skip waypoints that can be reached in a straight line
  const out = [];
  let from0 = { x: x0, y: y0 };
  for (let i = 0; i < pts.length; i++) {
    let j = i;
    while (j + 1 < pts.length && gridClear(from0.x, from0.y, pts[j + 1].x, pts[j + 1].y)) j++;
    out.push(pts[j]); from0 = pts[j]; i = j;
  }
  return out;
}
// Where to head next on the way to (x, y): straight there if the way is clear, otherwise along a path
function nextWaypoint(b, x, y) {
  const d = hyp(x - b.x, y - b.y);
  if (d < 70) { b.spath = null; return { x, y }; }
  if (!(b.lcT > G.t) || !b.lcGoal || hyp(b.lcGoal.x - x, b.lcGoal.y - y) > 60) {
    const ahead = Math.min(d, 350), k = ahead / d;
    b.lcClear = gridClear(b.x, b.y, b.x + (x - b.x) * k, b.y + (y - b.y) * k);
    b.lcT = G.t + 0.35; b.lcGoal = { x, y };
  }
  if (b.lcClear && !(b.stuck > 0.4)) { b.spath = null; return { x, y }; }
  const stale = !b.spath || !b.spath.length || hyp(b.spathGoal.x - x, b.spathGoal.y - y) > 140 || G.t > b.spathT + 4 || b.stuck > 0.5;
  if (stale && G.pathBudget > 0) { G.pathBudget--; b.spath = findPath(b.x, b.y, x, y); b.spathGoal = { x, y }; b.spathT = G.t; }
  if (!b.spath || !b.spath.length) return { x, y };
  while (b.spath.length > 1 && hyp(b.spath[0].x - b.x, b.spath[0].y - b.y) < 32) b.spath.shift();
  return b.spath[0];
}

// ---------- combat helpers ----------
// Everyone's rough velocity, for leading shots
function trackVelocities(dt) {
  for (const f of G.fighters) {
    if (f.vpx !== undefined && dt > 0) { const k = Math.min(1, dt * 8); f.vx = (f.vx || 0) + ((f.x - f.vpx) / dt - (f.vx || 0)) * k; f.vy = (f.vy || 0) + ((f.y - f.vpy) / dt - (f.vy || 0)) * k; }
    f.vpx = f.x; f.vpy = f.y;
  }
}
// Where to aim so the arrow meets them: their position plus their velocity over the arrow's flight
function leadPoint(b, t, charge) {
  const speed = 420 + 560 * charge, d = hyp(t.x - b.x, t.y - b.y), fly = d / speed * botLvl().lead;
  return { x: t.x + (t.vx || 0) * fly, y: t.y + (t.vy || 0) * fly, z: t.z };
}
// Somewhere behind a tree, rock or wall, away from the threat; or just away
function coverPoint(b, from) {
  let best = null, bd = 1e9;
  for (const o of nearObjs(b.x, b.y, 240)) {
    if (o.amt <= 0 || o.kind === 'reed') continue;
    const ax = o.x - from.x, ay = o.y - from.y, al = hyp(ax, ay) || 1;
    const px = o.x + ax / al * (o.r + 22), py = o.y + ay / al * (o.r + 22);
    const d = hyp(px - b.x, py - b.y), toward = ((px - b.x) * (from.x - b.x) + (py - b.y) * (from.y - b.y)) / (d * hyp(from.x - b.x, from.y - b.y) || 1);
    if (toward > 0.6) continue; // don't run past them to get there
    if (d < bd) { bd = d; best = { x: px, y: py }; }
  }
  if (best) return best;
  const a = Math.atan2(b.y - from.y, b.x - from.x);
  return { x: clamp(b.x + Math.cos(a) * 300, 60, WORLD - 60), y: clamp(b.y + Math.sin(a) * 300, 60, WORLD - 60) };
}
// Who to go for: close, hurt, already fighting someone else, or coming for us
function targetScore(b, v) {
  const o = v.o, fightingOther = o.lastHitT !== undefined && G.t - o.lastHitT < 3 && o.lastHitBy && o.lastHitBy !== b;
  const onMe = o.plan && o.plan.target === b || (b.lastHitBy === o && G.t - b.lastHitT < 4);
  return v.d + o.hp * 12 - (fightingOther ? 90 : 0) - (onMe ? 120 : 0) + (v.reach ? 0 : 150);
}
// Someone camping up a tower: a spot right next to it to pillar up from
function climbSpot(b, t) {
  const ti = Math.floor(t.x / B), tk = Math.floor(t.y / B);
  let best = null, bd = 1e9;
  for (const [di, dk] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, -1], [1, 2], [-1, -2]]) {
    const i = ti + di, k = tk + dk, j = baseJ(i, k);
    if (solidAt(i, j, k) || solidAt(i, j + 1, k) || lavaPoolAt((i + .5) * B, (k + .5) * B)) continue;
    const x = (i + .5) * B, y = (k + .5) * B;
    if (nearObjs(x, y, 40).some(o => o.amt > 0 && o.kind !== 'reed' && hyp(o.x - x, o.y - y) < o.r + 14)) continue;
    const d = hyp(x - b.x, y - b.y); if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}
const blockStock = b => ['cobble', 'plank', 'hay'].reduce((n, id) => n + count(b, id), 0);
const blockType = b => ['cobble', 'plank', 'hay'].find(id => count(b, id) > 0);
