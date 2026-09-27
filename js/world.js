'use strict';
// World: seeded RNG, a randomized biome layout, surface objects, tunnel network, ground mesh.
// Everything comes from the match seed, so every player in an online match builds the same map.
let WORLD = 4800;
const TUN_R = 46, CELL = 160;
const MAP_SIZES = { 3200: 'Standard', 4800: 'Large', 6400: 'Huge' };
const PIT = { x: 2400, y: 2400, r: 380 };
const BIOME_NAME = ['Forest', 'Desert', 'Mountains', 'Swamp'];
// Map types: the usual mix, islands in a shallow sea, mostly desert, or a snowbound winter map
const MAP_TYPES = { mixed: 'Mixed', islands: 'Islands', desert: 'Desert', winter: 'Winter', random: 'Random' };
const pickMapType = (type, seed) => type === 'random' || !MAP_TYPES[type] ? ['mixed', 'islands', 'desert', 'winter'][seed % 4] : type;
let SWAMPS = [], FEAST_SITES = [];
const FEAST_NAMES = ['Old Clearing', 'Dune Hollow', 'Summit Pass', 'Split Rock', 'Ashen Field', 'Long Meadow', 'Stone Circle', 'Salt Flat', 'High Pass', 'Crow Hollow'];

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rng = Math.random;
const rr = (a, b) => a + rng() * (b - a);
const pick = a => a[Math.floor(rng() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hyp = Math.hypot;
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

function makeNoise(seed, N) {
  const r = mulberry32(seed), g = [];
  for (let i = 0; i < (N + 1) * (N + 1); i++) g.push(r());
  return (x, y) => {
    const fx = clamp(x, 0, 1) * N, fy = clamp(y, 0, 1) * N;
    const ix = Math.min(N - 1, Math.floor(fx)), iy = Math.min(N - 1, Math.floor(fy));
    const s = t => t * t * (3 - 2 * t), u = s(fx - ix), v = s(fy - iy);
    const a = g[iy * (N + 1) + ix], b = g[iy * (N + 1) + ix + 1], c = g[(iy + 1) * (N + 1) + ix], d = g[(iy + 1) * (N + 1) + ix + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

let world = null;

const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// Regions (mountain ranges, deserts, swamps) are circles bent by noise, so their borders come out ragged.
function warp(x, y) {
  const u = clamp(x / WORLD, 0, 1), v = clamp(y / WORLD, 0, 1), k = 520 * WORLD / 3200;
  return [x + (world.n1(u, v) - .5) * k, y + (world.n1(1 - v, u) - .5) * k];
}
function regionFactor(list, x, y, core) {
  let m = 0;
  for (const o of list) { const d = hyp(x - o.x, y - o.y); if (d < o.r) m = Math.max(m, sstep(o.r, o.r * core, d)); }
  return m;
}
// Islands maps: how much of an island (0 open sea, 1 solid land) a warped point is
function isleFactor(wx, wy) {
  let m = 0;
  for (const o of world.isles) { const d = hyp(wx - o.x, wy - o.y); if (d < o.r) m = Math.max(m, sstep(o.r, o.r * 0.72, d)); }
  return m;
}
function seaAt(x, y) { if (!world.sea) return false; const [wx, wy] = warp(x, y); return isleFactor(wx, wy) < 0.35; }
// What to call where someone is standing
const placeName = f => f.layer ? (world.nodes[nearestNode(f.x, f.y)].cave ? 'Cave' : 'Tunnels') : G.pit ? 'The Pit' : seaAt(f.x, f.y) ? 'Sea' : BIOME_NAME[biomeAt(f.x, f.y)];
function biomeAt(x, y) {
  const [wx, wy] = warp(x, y);
  if (world.sea && isleFactor(wx, wy) < 0.35) return 3; // the sea wades like a swamp
  for (const s of SWAMPS) if (hyp(wx - s.x, wy - s.y) < s.r) return 3;
  if (regionFactor(world.mts, wx, wy, 0.3) > 0.3) return 2;
  if (regionFactor(world.deserts, wx, wy, 0.5) > 0.4) return 1;
  return 0;
}
function heightAt(x, y) {
  const u = clamp(x / WORLD, 0, 1), v = clamp(y / WORLD, 0, 1);
  const a = world.n1(u, v), b = world.n2(u, v), [wx, wy] = warp(x, y);
  let h = (a - .5) * 46 + (b - .5) * 18;
  h += Math.pow(regionFactor(world.mts, wx, wy, 0.3), 1.3) * (40 + b * 240);        // mountain ranges
  h += regionFactor(world.deserts, wx, wy, 0.5) * Math.sin(x / 150 + a * 7) * 13; // dunes
  for (const s of SWAMPS) {
    const d = hyp(wx - s.x, wy - s.y) / s.r;
    if (d < 1.25) h += (-7 + (b - .5) * 14 - h) * sstep(1.25, 0.8, d);
  }
  if (world.sea) h = -26 + (h + 32) * isleFactor(wx, wy); // islands rise out of a shallow sea
  const dp = hyp(x - PIT.x, y - PIT.y) / PIT.r;
  if (dp < 1.3) h += (-34 - h) * sstep(1.3, 1.0, dp);
  return h;
}

// ---- spatial grid for trees and rocks ----
function gridKey(cx, cy) { return cx * 1000 + cy; }
function gridAdd(o) {
  const k = gridKey(Math.floor(o.x / CELL), Math.floor(o.y / CELL));
  if (!world.grid.has(k)) world.grid.set(k, []);
  world.grid.get(k).push(o);
}
function nearObjs(x, y, rad) {
  const out = [];
  const x0 = Math.floor((x - rad) / CELL), x1 = Math.floor((x + rad) / CELL);
  const y0 = Math.floor((y - rad) / CELL), y1 = Math.floor((y + rad) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const a = world.grid.get(gridKey(cx, cy));
    if (a) for (const o of a) out.push(o);
  }
  return out;
}

// ---- tunnels ----
function psd(px, py, s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - s.ax) * dx + (py - s.ay) * dy) / l, 0, 1) : 0;
  return hyp(px - (s.ax + dx * t), py - (s.ay + dy * t));
}
function walkUnder(x, y, r) {
  for (const s of world.segs) if (psd(x, y, s) < TUN_R - r) return true;
  return false;
}
function nearestNode(x, y) {
  let best = 0, bd = 1e12;
  world.nodes.forEach((n, i) => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
function navPath(a, b) {
  if (a === b) return [b];
  const prev = new Map([[a, -1]]), q = [a];
  while (q.length) {
    const c = q.shift();
    if (c === b) break;
    for (const n of world.nodes[c].adj) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
  }
  if (!prev.has(b)) return [b];
  const path = [];
  for (let c = b; c !== -1; c = prev.get(c)) path.unshift(c);
  return path;
}

// Shortest distance between two segments (sampled, close enough for spacing checks)
function segDist(s, o) {
  let m = 1e9;
  for (let t = 0; t <= 1; t += 0.125) m = Math.min(m, psd(s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t, o), psd(o.ax + (o.bx - o.ax) * t, o.ay + (o.by - o.ay) * t, s));
  return m;
}
// Caves: short dead-end passages into each mountain range, with more iron and a chest at the end.
// They're on the underground layer but never touch the main tunnel network, so each is its own little world.
function genCaves() {
  for (const m of world.mts) for (let tries = 0; tries < 80; tries++) {
    const a = rr(0, 6.28), d = m.r * rr(0.5, 0.78), ex = m.x + Math.cos(a) * d, ey = m.y + Math.sin(a) * d;
    if (ex < 300 || ey < 300 || ex > WORLD - 300 || ey > WORLD - 300 || seaAt(ex, ey) || biomeAt(ex, ey) !== 2) continue;
    if (world.entrances.some(e => hyp(e.x - ex, e.y - ey) < 450) || hyp(ex - PIT.x, ey - PIT.y) < PIT.r + 300) continue;
    const pts = [{ x: ex, y: ey }];
    let dir = Math.atan2(m.y - ey, m.x - ex);
    for (let k = 0; k < 3; k++) { dir += rr(-0.7, 0.7); const p = pts[k], L = rr(170, 240); pts.push({ x: p.x + Math.cos(dir) * L, y: p.y + Math.sin(dir) * L }); }
    if (pts.some(p => p.x < 150 || p.y < 150 || p.x > WORLD - 150 || p.y > WORLD - 150)) continue;
    const segs = pts.slice(1).map((p, k) => ({ ax: pts[k].x, ay: pts[k].y, bx: p.x, by: p.y }));
    if (segs.some(s => world.segs.some(o => segDist(s, o) < TUN_R * 2 + 40))) continue;
    const base = world.nodes.length;
    pts.forEach((p, k) => world.nodes.push({ x: p.x, y: p.y, adj: [], cave: true, ent: k === 0 }));
    for (let k = 1; k < pts.length; k++) { world.nodes[base + k - 1].adj.push(base + k); world.nodes[base + k].adj.push(base + k - 1); }
    world.segs.push(...segs); world.tunnels.push(pts);
    world.entrances.push({ x: ex, y: ey, node: base, cave: true });
    for (const s of segs) for (let q = 0; q < 2; q++) { // iron in the walls, and more in the chamber at the end
      const L = hyp(s.bx - s.ax, s.by - s.ay), t = rr(0.2, 0.85), side = rng() < .5 ? -1 : 1;
      const nx = -(s.by - s.ay) / L * side, ny = (s.bx - s.ax) / L * side;
      world.ores.push({ kind: 'ore', x: s.ax + (s.bx - s.ax) * t + nx * (TUN_R - 6), y: s.ay + (s.by - s.ay) * t + ny * (TUN_R - 6), r: 14, amt: 3 });
    }
    const end = pts[pts.length - 1], back = Math.atan2(pts[pts.length - 2].y - end.y, pts[pts.length - 2].x - end.x);
    for (let q = 0; q < 3; q++) { const oa = back + Math.PI * (0.55 + q * 0.45); world.ores.push({ kind: 'ore', x: end.x + Math.cos(oa) * (TUN_R - 6), y: end.y + Math.sin(oa) * (TUN_R - 6), r: 14, amt: 3 }); }
    world.caves.push({ x: end.x, y: end.y });
    break;
  }
  // Which tunnel network each junction belongs to (the main one, or one of the caves)
  world.nodes.forEach(n => { n.comp = -1; });
  let c = 0;
  for (const [i, n] of world.nodes.entries()) {
    if (n.comp >= 0) continue;
    const q = [i]; n.comp = c;
    while (q.length) for (const j of world.nodes[q.shift()].adj) if (world.nodes[j].comp < 0) { world.nodes[j].comp = c; q.push(j); }
    c++;
  }
}
const compAt = (x, y) => world.nodes[nearestNode(x, y)].comp;
// The way down to the underground point (x, y), or up from it: the entrance nearest (px, py) on the same network
function entranceFor(px, py, x, y) {
  const c = compAt(x, y);
  let best = null, bd = 1e12;
  for (const e of world.entrances) { if (world.nodes[e.node].comp !== c) continue; const d = hyp(e.x - px, e.y - py); if (d < bd) { bd = d; best = e; } }
  return best || world.entrances[0];
}
function genWorld(seed, size = 4800, type = 'mixed') {
  WORLD = size; PIT.x = PIT.y = size / 2;
  const A = size / 3200; // 1 for Standard, 1.5 Large, 2 Huge
  type = pickMapType(type, seed);
  rng = mulberry32(seed);
  world = {
    seed, size, type, sea: type === 'islands', winter: type === 'winter', isles: [],
    n1: makeNoise(seed + 1, Math.round(5 * A)), n2: makeNoise(seed + 2, Math.round(13 * A)),
    grid: new Map(), objs: [], entrances: [], nodes: [], segs: [], tunnels: [], ores: [], mts: [], deserts: [], caves: [],
  };

  // Islands: a big central island around the pit, and a ring of others in a shallow sea
  if (world.sea) {
    world.isles.push({ x: PIT.x, y: PIT.y, r: (PIT.r + 520) * Math.sqrt(A) });
    for (let t = 0; world.isles.length < Math.round(5 * A) + 1 && t < 600; t++) {
      const r = rr(420, 640) * Math.sqrt(A), x = rr(r * 0.55, size - r * 0.55), y = rr(r * 0.55, size - r * 0.55);
      if (world.isles.some(o => hyp(o.x - x, o.y - y) < (o.r + r) * 0.78)) continue;
      world.isles.push({ x, y, r });
    }
  }
  const onLand = (x, y, r) => !world.sea || world.isles.some(o => hyp(o.x - x, o.y - y) < o.r * 0.7 - r * 0.25);
  // Regions: a few mountain ranges, deserts and swamps, placed at random, not on top of each other or the pit
  SWAMPS = [];
  const placeRegions = (list, n, rmin, rmax) => {
    for (let t = 0; list.length < n && t < 500; t++) {
      const r = rr(rmin, rmax) * Math.sqrt(A), x = rr(r * 0.4, size - r * 0.4), y = rr(r * 0.4, size - r * 0.4);
      if (hyp(x - PIT.x, y - PIT.y) < PIT.r + r * 0.7 + 150 || !onLand(x, y, r)) continue;
      if ([...world.mts, ...world.deserts, ...SWAMPS].some(o => hyp(o.x - x, o.y - y) < (o.r + r) * 0.8)) continue;
      list.push({ x, y, r });
    }
  };
  if (type === 'desert') { // mostly sand, a few oases, one range of hills
    placeRegions(world.mts, Math.max(1, Math.round(0.8 * A)), 460, 620);
    placeRegions(world.deserts, Math.round(5 * A), 700, 980);
    placeRegions(SWAMPS, Math.max(2, Math.round(1.6 * A)), 150, 230);
  } else if (type === 'winter') { // big mountain ranges; the forest between them is snowed in
    placeRegions(world.mts, Math.max(2, Math.round(rr(2.4, 3.2) * A)), 600, 860);
    placeRegions(SWAMPS, Math.max(2, Math.round(1.8 * A)), 220, 340);
  } else if (world.sea) { // smaller regions, all on the islands
    placeRegions(world.mts, Math.max(1, Math.round(1.2 * A)), 360, 480);
    placeRegions(world.deserts, Math.max(1, Math.round(1.2 * A)), 360, 480);
    placeRegions(SWAMPS, Math.max(1, Math.round(1.2 * A)), 170, 240);
  } else {
    placeRegions(world.mts, Math.max(1, Math.round(rr(1.3, 2.4) * A)), 560, 820);
    placeRegions(world.deserts, Math.max(1, Math.round(rr(1, 1.9) * A)), 600, 860);
    placeRegions(SWAMPS, Math.max(2, Math.round(rr(2, 3) * A)), 240, 420);
  }
  if (!SWAMPS.length) SWAMPS.push({ x: PIT.x + PIT.r + 260, y: PIT.y, r: 180 }); // the Drowned Altar needs a swamp
  SWAMPS.sort((p, q) => q.r - p.r);
  // Feast sites: three open spots, well apart
  const names = [...FEAST_NAMES];
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  FEAST_SITES = [];
  for (let t = 0; FEAST_SITES.length < 3 && t < 800; t++) {
    const x = rr(350, size - 350), y = rr(350, size - 350);
    if (biomeAt(x, y) === 3 || hyp(x - PIT.x, y - PIT.y) < PIT.r + 400 || FEAST_SITES.some(f => hyp(f.x - x, f.y - y) < size * 0.28)) continue;
    FEAST_SITES.push({ x, y, name: names[FEAST_SITES.length] });
  }

  // Tunnel entrances, spread across the map
  const ents = [];
  for (let tries = 0; ents.length < Math.round(9 * A) && tries < 1500; tries++) {
    const x = rr(260, WORLD - 260), y = rr(260, WORLD - 260);
    if (hyp(x - PIT.x, y - PIT.y) < PIT.r + 160 || seaAt(x, y)) continue;
    if (ents.some(e => hyp(e.x - x, e.y - y) < 700)) continue;
    ents.push({ x, y, node: ents.length });
  }
  world.entrances = ents;
  const nodes = world.nodes = ents.map(e => ({ x: e.x, y: e.y, adj: [], ent: true }));
  const linked = new Set();
  const parent = ents.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  function link(i, j) {
    const key = Math.min(i, j) + ':' + Math.max(i, j);
    if (linked.has(key)) return;
    linked.add(key);
    parent[find(i)] = find(j);
    const a = nodes[i], b = nodes[j], L = hyp(b.x - a.x, b.y - a.y);
    const px = -(b.y - a.y) / L, py = (b.x - a.x) / L;
    let last = i;
    const line = [{ x: a.x, y: a.y }];
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, off = rr(-110, 110);
      nodes.push({ x: a.x + (b.x - a.x) * t + px * off, y: a.y + (b.y - a.y) * t + py * off, adj: [] });
      const n = nodes.length - 1;
      nodes[last].adj.push(n); nodes[n].adj.push(last);
      line.push({ x: nodes[n].x, y: nodes[n].y });
      last = n;
    }
    nodes[last].adj.push(j); nodes[j].adj.push(last);
    line.push({ x: b.x, y: b.y });
    world.tunnels.push(line);
    for (let k = 0; k < line.length - 1; k++)
      world.segs.push({ ax: line[k].x, ay: line[k].y, bx: line[k + 1].x, by: line[k + 1].y });
  }
  ents.forEach((e, i) => {
    const order = ents.map((o, j) => [j, hyp(o.x - e.x, o.y - e.y)]).filter(p => p[0] !== i).sort((p, q) => p[1] - q[1]);
    link(i, order[0][0]);
    if (rng() < 0.6) link(i, order[1][0]);
  });
  // Join any disconnected groups
  for (;;) {
    const roots = new Set(ents.map((_, i) => find(i)));
    if (roots.size <= 1) break;
    let best = null;
    ents.forEach((a, i) => ents.forEach((b, j) => {
      if (find(i) === find(j)) return;
      const d = hyp(a.x - b.x, a.y - b.y);
      if (!best || d < best[2]) best = [i, j, d];
    }));
    link(best[0], best[1]);
  }

  // Iron ore embedded in tunnel walls
  for (let k = 0; k < Math.round(30 * A); k++) {
    const s = pick(world.segs), t = rr(0.15, 0.85);
    const L = hyp(s.bx - s.ax, s.by - s.ay), side = rng() < .5 ? -1 : 1;
    const nx = -(s.by - s.ay) / L * side, ny = (s.bx - s.ax) / L * side;
    world.ores.push({ kind: 'ore', x: s.ax + (s.bx - s.ax) * t + nx * (TUN_R - 6), y: s.ay + (s.by - s.ay) * t + ny * (TUN_R - 6), r: 14, amt: 3 });
  }
  genCaves();

  // Trees and rocks by biome
  const place = { 0: [0.5, 0.05], 1: [0.07, 0.07], 2: [0.22, 0.28], 3: [0.14, 0.0] };
  for (let k = 0; k < Math.round(5200 * A * A); k++) {
    const x = rr(40, WORLD - 40), y = rr(40, WORLD - 40), b = biomeAt(x, y);
    if (hyp(x - PIT.x, y - PIT.y) < PIT.r + 60 || seaAt(x, y)) continue;
    if (ents.some(e => hyp(e.x - x, e.y - y) < 110)) continue;
    if (FEAST_SITES.some(f => hyp(f.x - x, f.y - y) < 190)) continue;
    const roll = rng(), [pt, pr] = place[b];
    let o = null;
    if (roll < pt * 0.35) o = { kind: 'tree', style: b, r: b === 1 ? 12 : 17, amt: b === 1 ? 2 : 4 };
    else if (roll < (pt + pr) * 0.35 && roll >= pt * 0.35) o = { kind: 'rock', style: b, r: rr(16, 24), amt: 5 };
    if (!o) continue;
    if (world.winter && b === 0) o.style = 2; // snowed-in pines and rocks
    o.x = x; o.y = y; o.seed = rng();
    if (nearObjs(x, y, 70).some(q => hyp(q.x - x, q.y - y) < q.r + o.r + 26)) continue;
    world.objs.push(o); gridAdd(o);
  }
  // Swamp reeds: cut them for hay bales and feather charms
  for (let k = 0; k < Math.round(450 * SWAMPS.length); k++) {
    const s = pick(SWAMPS), a = rr(0, 6.28), d = rr(0, s.r * 1.05);
    const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
    if (biomeAt(x, y) !== 3 || nearObjs(x, y, 40).some(q => hyp(q.x - x, q.y - y) < q.r + 22)) continue;
    const o = { kind: 'reed', style: 3, r: 6, amt: 2, x, y, seed: rng() };
    world.objs.push(o); gridAdd(o);
  }
  // Ruins: cabins, broken walls and watchtowers with a loot chest (built from blocks in buildRuins)
  world.ruins = [];
  const kinds = Array.from({ length: Math.round(8 * A) }, (_, i) => ['tower', 'cabin', 'ruin', 'cabin', 'tower', 'ruin', 'cabin', 'ruin'][i % 8]);
  for (let tries = 0; world.ruins.length < kinds.length && tries < 3000; tries++) {
    const x = rr(300, WORLD - 300), y = rr(300, WORLD - 300);
    if (biomeAt(x, y) === 3 || hyp(x - PIT.x, y - PIT.y) < PIT.r + 250) continue;
    if (ents.some(e => hyp(e.x - x, e.y - y) < 260) || FEAST_SITES.some(f => hyp(f.x - x, f.y - y) < 320)) continue;
    if (world.ruins.some(r => hyp(r.x - x, r.y - y) < 550)) continue;
    if (nearObjs(x, y, 110).some(o => o.kind !== 'reed' && hyp(o.x - x, o.y - y) < 100)) continue;
    const h0 = heightAt(x - 75, y - 75), h1 = heightAt(x + 75, y + 75), h2 = heightAt(x + 75, y - 75), h3 = heightAt(x - 75, y + 75);
    if (Math.max(h0, h1, h2, h3) - Math.min(h0, h1, h2, h3) > 45) continue; // too steep to build on
    world.ruins.push({ x, y, kind: kinds[world.ruins.length] });
  }
  // Landmarks: one legendary item each, once per match
  world.landmarks = [];
  const clear = (x, y, r) => !nearObjs(x, y, r + 20).some(o => o.kind !== 'reed' && o.amt > 0 && hyp(o.x - x, o.y - y) < r)
    && !world.ruins.some(q => hyp(q.x - x, q.y - y) < 400) && !ents.some(e => hyp(e.x - x, e.y - y) < 200)
    && !world.landmarks.some(q => q.layer === 0 && hyp(q.x - x, q.y - y) < 500) && !FEAST_SITES.some(f => hyp(f.x - x, f.y - y) < 300);
  const flatness = (x, y, d) => { const hs = [[-d, -d], [d, -d], [-d, d], [d, d], [0, 0]].map(([a, b]) => heightAt(x + a, y + b)); return Math.max(...hs) - Math.min(...hs); };
  let best = null;
  const inRegion = list => { const o = pick(list), a = rr(0, 6.28), d = rr(0, o.r * 0.75); return [clamp(o.x + Math.cos(a) * d, 250, WORLD - 250), clamp(o.y + Math.sin(a) * d, 250, WORLD - 250)]; };
  for (let i = 0; i < 900 && world.mts.length; i++) { // Frostpeak Shrine: the highest open ground in the mountains
    const [x, y] = inRegion(world.mts);
    if (biomeAt(x, y) !== 2 || !clear(x, y, 60) || flatness(x, y, 40) > 40) continue;
    const h = heightAt(x, y); if (!best || h > best.h) best = { x, y, h };
  }
  if (best) world.landmarks.push({ id: 'peak', x: best.x, y: best.y, layer: 0 });
  world.landmarks.push({ id: 'altar', x: SWAMPS[0].x, y: SWAMPS[0].y, layer: 0 });
  best = null;
  const forgeB = world.deserts.length ? 1 : 0; // no desert (winter): the forge stands in the forest
  for (let i = 0; i < 900; i++) { // Sunken Forge: flat desert, away from everything
    const [x, y] = forgeB ? inRegion(world.deserts) : [rr(300, WORLD - 300), rr(300, WORLD - 300)];
    if (biomeAt(x, y) !== forgeB || seaAt(x, y) || !clear(x, y, 110)) continue;
    const fl = flatness(x, y, 90); if (!best || fl < best.fl) best = { x, y, fl };
  }
  if (best) world.landmarks.push({ id: 'forge', x: best.x, y: best.y, layer: 0 });
  best = null;
  for (let i = 0; i < 900; i++) { // Crow's Nest: a clearing in the forest
    const x = rr(300, WORLD - 300), y = rr(300, WORLD - 300);
    if (biomeAt(x, y) !== 0 || hyp(x - PIT.x, y - PIT.y) < PIT.r + 250 || !clear(x, y, 55)) continue;
    const fl = flatness(x, y, 40); if (!best || fl < best.fl) best = { x, y, fl };
  }
  if (best) world.landmarks.push({ id: 'crowsnest', x: best.x, y: best.y, layer: 0 });
  // Rat King's Nest: the tunnel junction with the most branches, furthest from any entrance
  const junction = world.nodes.map((n, i) => ({ i, n, score: n.adj.length * 1000 + Math.min(...ents.map(e => hyp(e.x - n.x, e.y - n.y))) }))
    .filter(q => !q.n.ent && !q.n.cave).sort((a, b) => b.score - a.score)[0];
  if (junction) world.landmarks.push({ id: 'nest', x: junction.n.x, y: junction.n.y, layer: 1, node: junction.i });
  // Lava pools: glowing vents on flat ground in the mountains and deserts. They burn, and fill buckets.
  world.lavas = [];
  const hot = [...world.mts, ...world.deserts];
  for (let t = 0; hot.length && world.lavas.length < Math.round(2 * A) + 1 && t < 2000; t++) {
    const [x, y] = inRegion(hot), r = rr(34, 46), bi = biomeAt(x, y);
    if ((bi !== 1 && bi !== 2) || flatness(x, y, r) > 10 || !clear(x, y, r + 30) || world.lavas.some(p => hyp(p.x - x, p.y - y) < 700)) continue;
    const hs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].map(([a, b]) => heightAt(x + a, y + b));
    world.lavas.push({ x, y, r, z: Math.max(...hs) + 1 });
  }
  // Supply drops: three crates parachute in during the match, each announced three minutes ahead
  world.drops = [];
  for (const min of [11, 31, 47]) for (let t = 0; t < 400; t++) {
    const x = rr(400, WORLD - 400), y = rr(400, WORLD - 400);
    if ([[0, 0], [250, 0], [-250, 0], [0, 250], [0, -250]].some(([a, b]) => biomeAt(x + a, y + b) >= 2) || hyp(x - PIT.x, y - PIT.y) < PIT.r + 200 || !clear(x, y, 50) || world.lavas.some(p => hyp(p.x - x, p.y - y) < p.r + 150)) continue;
    world.drops.push({ x, y, min: min + rr(-1, 1), st: '' });
    break;
  }
  // Motorcycles: a few parked on open, flat ground in the forest and desert
  world.bikes = [];
  for (let t = 0; world.bikes.length < Math.round(3 * A) && t < 3000; t++) {
    const x = rr(300, WORLD - 300), y = rr(300, WORLD - 300), bi = biomeAt(x, y);
    if (bi >= 2 || hyp(x - PIT.x, y - PIT.y) < PIT.r + 150 || !clear(x, y, 45) || flatness(x, y, 30) > 8) continue;
    if (world.bikes.some(b => hyp(b.x - x, b.y - y) < 700) || world.lavas.some(p => hyp(p.x - x, p.y - y) < p.r + 200)) continue;
    world.bikes.push({ x, y, face: rr(0, 6.28) });
  }
  world.ground = renderGround();
}
const LANDMARKS = {
  crowsnest: { name: 'The Crow’s Nest', item: 'skyhook', hint: 'A spire in the forest. The Skyhook waits at the top.' },
  forge: { name: 'The Sunken Forge', item: 'maul', hint: 'Walled ruins in the desert, ringed with spikes. The Quake Maul lies inside.' },
  altar: { name: 'The Drowned Altar', item: 'everflask', hint: 'A platform in the heart of the swamp holds the Everflask.' },
  peak: { name: 'Frostpeak Shrine', item: 'boots_wind', hint: 'The highest point in the mountains. The Windwalker Boots are in the shrine.' },
  nest: { name: 'The Rat King’s Nest', item: 'crown', hint: 'The deepest tunnel junction, guarded by biting rats. The Rat King’s Crown is there.' },
};

// Low-poly ground: a jittered triangle mesh, each face coloured by biome.
function renderGround() {
  const S = Math.min(0.5, 2048 / WORLD), c = document.createElement('canvas');
  c.width = c.height = Math.round(WORLD * S);
  const g = c.getContext('2d');
  const step = 80, n = WORLD / step, V = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const edge = i === 0 || j === 0 || i === n || j === n;
    V.push([i * step + (edge ? 0 : rr(-26, 26)), j * step + (edge ? 0 : rr(-26, 26))]);
  }
  const base = [[112, 26, 23], [38, 42, 55], [205, 16, 84], [158, 22, 24]];
  function tri(a, b, d) {
    const cx = (a[0] + b[0] + d[0]) / 3, cy = (a[1] + b[1] + d[1]) / 3;
    const bi = biomeAt(cx, cy);
    let [h, s, l] = base[bi];
    if (bi === 0 && world.winter) [h, s, l] = [205, 14, 80];
    if (seaAt(cx, cy)) [h, s, l] = [200, 42, 34];
    const nz = world.n2(cx / WORLD * 1.7 % 1, cy / WORLD * 1.7 % 1);
    l += (nz - .5) * 8 + rr(-2.5, 2.5);
    if (bi === 2 && nz > 0.62) { h = 215; s = 8; l = 52 + rr(-4, 4); }
    if (bi === 3 && rng() < 0.22 && !seaAt(cx, cy)) { h = 172; s = 30; l = 17; }
    if (bi === 0 && nz < 0.3) { l -= 3; h = 120; }
    g.fillStyle = `hsl(${h} ${s}% ${l}%)`;
    g.strokeStyle = g.fillStyle;
    g.beginPath(); g.moveTo(a[0] * S, a[1] * S); g.lineTo(b[0] * S, b[1] * S); g.lineTo(d[0] * S, d[1] * S); g.closePath();
    g.fill(); g.lineWidth = 0.8; g.stroke();
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = V[j * (n + 1) + i], b = V[j * (n + 1) + i + 1], d = V[(j + 1) * (n + 1) + i], e = V[(j + 1) * (n + 1) + i + 1];
    if ((i + j) % 2) { tri(a, b, e); tri(a, e, d); } else { tri(a, b, d); tri(b, e, d); }
  }
  // The pit: a sunken stone arena in the middle of the map
  g.save(); g.translate(PIT.x * S, PIT.y * S);
  for (let k = 0; k < 28; k++) {
    const a0 = k / 28 * Math.PI * 2, a1 = (k + 1) / 28 * Math.PI * 2;
    g.fillStyle = `hsl(30 8% ${34 + (k % 3) * 3}%)`;
    g.beginPath(); g.moveTo(0, 0);
    g.lineTo(Math.cos(a0) * PIT.r * S, Math.sin(a0) * PIT.r * S);
    g.lineTo(Math.cos(a1) * PIT.r * S, Math.sin(a1) * PIT.r * S);
    g.closePath(); g.fill();
  }
  g.strokeStyle = 'hsl(30 10% 20%)'; g.lineWidth = 7;
  g.beginPath(); g.arc(0, 0, PIT.r * S, 0, Math.PI * 2); g.stroke();
  g.restore();
  for (const p of world.lavas) {
    g.fillStyle = 'hsl(20 20% 18%)'; g.beginPath(); g.arc(p.x * S, p.y * S, (p.r + 16) * S, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'hsl(22 100% 55%)'; g.beginPath(); g.arc(p.x * S, p.y * S, p.r * S, 0, Math.PI * 2); g.fill();
  }
  return c;
}
