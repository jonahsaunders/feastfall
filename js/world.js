'use strict';
// World: seeded RNG, biome layout, surface objects, tunnel network, ground mesh.
const WORLD = 3200, TUN_R = 46, CELL = 160;
const PIT = { x: 1600, y: 1600, r: 380 };
const BIOME_NAME = ['Forest', 'Desert', 'Mountains', 'Swamp'];
const SWAMPS = [{ x: 620, y: 2450, r: 430 }, { x: 2050, y: 2150, r: 300 }];
const FEAST_SITES = [
  { x: 900, y: 1150, name: 'Old Clearing' },
  { x: 2620, y: 2700, name: 'Dune Hollow' },
  { x: 1750, y: 480, name: 'Summit Pass' },
];

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

function biomeAt(x, y) {
  const u = x / WORLD, v = y / WORLD;
  const w = (world.n1(u, v) - .5) * 0.16 + (world.n2(u, v) - .5) * 0.06;
  for (const s of SWAMPS) if (hyp(x - s.x, y - s.y) < s.r * (1 + w * 2.5)) return 3;
  if (v + w < 0.27) return 2;
  if (u + w > 0.68) return 1;
  return 0;
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

function genWorld(seed) {
  rng = mulberry32(seed);
  world = {
    seed, n1: makeNoise(seed + 1, 5), n2: makeNoise(seed + 2, 13),
    grid: new Map(), objs: [], entrances: [], nodes: [], segs: [], tunnels: [], ores: [],
  };

  // Tunnel entrances, spread across the map
  const ents = [];
  for (let tries = 0; ents.length < 9 && tries < 800; tries++) {
    const x = rr(260, WORLD - 260), y = rr(260, WORLD - 260);
    if (hyp(x - PIT.x, y - PIT.y) < PIT.r + 160) continue;
    if (ents.some(e => hyp(e.x - x, e.y - y) < 700)) continue;
    ents.push({ x, y });
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
  for (let k = 0; k < 30; k++) {
    const s = pick(world.segs), t = rr(0.15, 0.85);
    const L = hyp(s.bx - s.ax, s.by - s.ay), side = rng() < .5 ? -1 : 1;
    const nx = -(s.by - s.ay) / L * side, ny = (s.bx - s.ax) / L * side;
    world.ores.push({ kind: 'ore', x: s.ax + (s.bx - s.ax) * t + nx * (TUN_R - 6), y: s.ay + (s.by - s.ay) * t + ny * (TUN_R - 6), r: 14, amt: 3 });
  }

  // Trees and rocks by biome
  const place = { 0: [0.5, 0.05], 1: [0.07, 0.07], 2: [0.22, 0.28], 3: [0.14, 0.0] };
  for (let k = 0; k < 5200; k++) {
    const x = rr(40, WORLD - 40), y = rr(40, WORLD - 40), b = biomeAt(x, y);
    if (hyp(x - PIT.x, y - PIT.y) < PIT.r + 60) continue;
    if (ents.some(e => hyp(e.x - x, e.y - y) < 110)) continue;
    if (FEAST_SITES.some(f => hyp(f.x - x, f.y - y) < 190)) continue;
    const roll = rng(), [pt, pr] = place[b];
    let o = null;
    if (roll < pt * 0.35) o = { kind: 'tree', style: b, r: b === 1 ? 12 : 17, amt: b === 1 ? 2 : 4 };
    else if (roll < (pt + pr) * 0.35 && roll >= pt * 0.35) o = { kind: 'rock', style: b, r: rr(16, 24), amt: 5 };
    if (!o) continue;
    o.x = x; o.y = y; o.seed = rng();
    if (nearObjs(x, y, 70).some(q => hyp(q.x - x, q.y - y) < q.r + o.r + 26)) continue;
    world.objs.push(o); gridAdd(o);
  }
  // Swamp reeds: cut them for hay bales and feather charms
  for (let k = 0; k < 900; k++) {
    const s = pick(SWAMPS), a = rr(0, 6.28), d = rr(0, s.r * 1.05);
    const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
    if (biomeAt(x, y) !== 3 || nearObjs(x, y, 40).some(q => hyp(q.x - x, q.y - y) < q.r + 22)) continue;
    const o = { kind: 'reed', style: 3, r: 6, amt: 2, x, y, seed: rng() };
    world.objs.push(o); gridAdd(o);
  }
  world.ground = renderGround();
}

// Low-poly ground: a jittered triangle mesh, each face coloured by biome.
function renderGround() {
  const S = 0.5, c = document.createElement('canvas');
  c.width = c.height = WORLD * S;
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
    const nz = world.n2(cx / WORLD * 1.7 % 1, cy / WORLD * 1.7 % 1);
    l += (nz - .5) * 8 + rr(-2.5, 2.5);
    if (bi === 2 && nz > 0.62) { h = 215; s = 8; l = 52 + rr(-4, 4); }
    if (bi === 3 && rng() < 0.22) { h = 172; s = 30; l = 17; }
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
  return c;
}
