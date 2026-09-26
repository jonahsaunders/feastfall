'use strict';
// Bots stand in for the other players. Each gets a playstyle from the design doc:
// hunter (seeks people), miner (rats and iron underground), trapper (spike traps near potions and tunnels),
// tower (pillars up and shoots from above), balanced.
const STYLES = ['hunter', 'miner', 'miner', 'trapper', 'tower', 'tower', 'hunter', 'balanced'];

function sightRange(b) {
  if (b.layer === 1) return 300;
  return b.biome === 2 && G.settings.snow && b.kit !== 'yeti' ? 240 : 460;
}
function nearestEntrance(x, y) {
  let best = null, bd = 1e12;
  for (const e of world.entrances) { const d = hyp(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}
const canShoot = b => b.bow && b.arrows > 0;

function botThink(b) {
  // On a motorcycle: keep riding unless someone's close, then stop and get off to fight
  if (b.bike) {
    const foe = G.fighters.find(o => o !== b && o.alive && !o.isClone && o.layer === 0 && !allied(o, b) && hyp(o.x - b.x, o.y - b.y) < 260);
    if ((foe && pvpOn()) || !b.plan || b.plan.type !== 'bike') b.plan = { ...(b.plan || {}), type: 'bike', k: b.bike, stop: true };
    return;
  }
  // Crafting happens instantly whenever a bot can afford something it wants
  for (const [id, t] of [['sword3', 3], ['sword2', 2], ['sword1', 1]]) if (b.weapon < t && craft(b, recipe(id))) break;
  for (const id of ['hide_chest', 'hide_legs', 'hide_head', 'hide_feet']) if (!b.equip[ITEMS[id].slot]) craft(b, recipe(id));
  if ((b.style === 'hunter' || b.style === 'tower') && count(b, 'wood') >= 3 && b.weapon >= 1) craft(b, recipe('bow'));
  if (b.bow && b.arrows < 8 && (b.style === 'tower' || b.arrows < 4)) craft(b, recipe('arrow'));
  if (b.style === 'tower' && b.bow && count(b, 'wood') >= (b.arrows < 6 && count(b, 'stone') ? 2 : 1) && count(b, 'plank') < 16) craft(b, recipe('plank'));
  if (b.style === 'trapper' && count(b, 'spike') < 3) craft(b, recipe('spike'));
  if (b.style === 'trapper' && count(b, 'pitfall') < 2) craft(b, recipe('pitfall'));
  if (count(b, 'reed') >= 3 && count(b, 'hide') >= 1 && !count(b, 'charm')) craft(b, recipe('charm'));

  let enemy = null, ed = 1e9, reach = true;
  const sight = sightRange(b);
  for (const o of G.fighters) {
    if (o === b || !o.alive || o.layer !== b.layer || o.owner === b || allied(o, b)) continue;
    const d = hyp(o.x - b.x, o.y - b.y);
    if (o.hidden && d > 55) continue;
    const reachable = Math.abs(o.z - b.z) < 45;
    if (!reachable && !(canShoot(b) && d < 440)) continue;   // can't touch them: ignore
    if (d < sight && d < ed) { enemy = o; ed = d; reach = reachable; }
  }
  // Up a tower: keep building, or stay on top and pick people off
  const elevated = b.layer === 0 && b.z > heightAt(b.x, b.y) + 60;
  if (elevated && b.plan && b.plan.type === 'tower') return;
  if (elevated && b.onGround && (b.towerDone || (b.plan && b.plan.type === 'perch'))) { b.plan = { type: 'perch', target: enemy }; return; }
  if (enemy && pvpOn()) {
    const brave = b.style === 'hunter' ? 0.6 : b.style === 'trapper' ? 1.1 : 0.85;
    const cornered = ed < 80 && b.hp > 5;
    if (!reach) b.plan = { type: 'fight', target: enemy, ranged: true };
    else b.plan = (power(b) >= power(enemy) * brave || cornered || G.pit) ? { type: 'fight', target: enemy } : { type: 'flee', target: enemy };
    return;
  }
  // Allies: join a partner's fight, otherwise keep up with the leader
  if (b.team) {
    const mates = b.team.m.filter(f => f !== b && f.alive);
    const busy = mates.find(f => f.plan && f.plan.type === 'fight' && f.plan.target && f.plan.target.alive && !allied(f.plan.target, b) && hyp(f.x - b.x, f.y - b.y) < 500);
    if (busy && pvpOn()) { b.plan = { type: 'fight', target: busy.plan.target }; return; }
    const lead = b.team.m.find(f => f.alive);
    if (lead && lead !== b && lead.layer === b.layer && hyp(lead.x - b.x, lead.y - b.y) > 220) { b.plan = { type: 'go', x: lead.x + rr(-60, 60), y: lead.y + rr(-60, 60), layer: lead.layer }; return; }
  }
  if (hotPots(b) < 4 && bagPots(b) > 0 && hotbarEmpty(b) >= 0) { b.plan = { type: 'refill' }; return; }
  if (G.pit) { b.plan = { type: 'go', x: PIT.x + rr(-120, 120), y: PIT.y + rr(-120, 120), layer: 0 }; return; }

  // Water left under a bot after a clutch landing goes back in the bucket
  if (b.inLiq === 'water' && b.onGround && count(b, 'bucket')) {
    const w = liquidAt(b);
    if (w && w.owner === b.id) { removeLiquid(w.src); fillBucket(b, 'water'); }
  }
  // A landed supply crate nearby: worth the trip for most bots
  const sup = G.items.find(i => i.kind === 'supply' && !i.gone && hyp(i.x - b.x, i.y - b.y) < 1500);
  if (sup && b.layer === 0 && (b.style !== 'miner' || b.armor >= 2)) { b.plan = { type: 'go', x: sup.x, y: sup.y, layer: 0 }; return; }
  const f = G.feast;
  if (f && f.state === 'spawned' && b.weapon < 4 && (b.style !== 'miner' || b.armor >= 2)) {
    const chest = G.items.find(i => i.kind === 'feast' && !i.gone);
    if (chest) { b.plan = { type: 'go', x: chest.x, y: chest.y, layer: 0 }; return; }
  }
  if (b.weapon < 1 || (b.style === 'hunter' && count(b, 'wood') < 3 && !b.bow)) {
    const t = nearestResource(b, 'tree');
    if (t) { b.plan = { type: 'gather', obj: t, layer: 0 }; return; }
  }
  // Tower prep: bow, some arrows, then a stack of planks
  if (b.style === 'tower' && !b.towerDone && b.layer === 0) {
    const need = !b.bow || count(b, 'plank') < 12 ? 'tree' : null;
    if (need) { const t = nearestResource(b, need); if (t) { b.plan = { type: 'gather', obj: t, layer: 0 }; return; } }
  }
  if (b.style === 'trapper' && count(b, 'spike') < 2 && b.layer === 0) {
    const need = count(b, 'stone') < 2 ? 'rock' : count(b, 'wood') < 1 ? 'tree' : null;
    if (need) { const t = nearestResource(b, need); if (t) { b.plan = { type: 'gather', obj: t, layer: 0 }; return; } }
  }
  if (totalPots(b) < (b.style === 'tower' || b.style === 'trapper' ? 1 : 4)) {
    const p = nearestItem(b, 'pot', 0);
    const s = SWAMPS.reduce((a, s) => hyp(s.x - b.x, s.y - b.y) < hyp(a.x - b.x, a.y - b.y) ? s : a);
    b.plan = p ? { type: 'go', x: p.x, y: p.y, layer: 0 } : { type: 'go', x: s.x + rr(-150, 150), y: s.y + rr(-150, 150), layer: 0 };
    return;
  }
  // Towering: pillar up somewhere open, then shoot from the top
  if (b.style === 'tower' && !b.towerDone && count(b, 'plank') >= 10 && b.layer === 0) {
    if (!b.towerSpot) {
      for (let i = 0; i < 20 && !b.towerSpot; i++) {
        const x = b.x + rr(-400, 400), y = b.y + rr(-400, 400);
        if (x < 100 || y < 100 || x > WORLD - 100 || y > WORLD - 100 || biomeAt(x, y) === 3 || hyp(x - PIT.x, y - PIT.y) < PIT.r + 80) continue;
        if (nearObjs(x, y, 60).some(o => o.kind !== 'reed' && o.amt > 0 && hyp(o.x - x, o.y - y) < 55)) continue;
        b.towerSpot = { x: (Math.floor(x / B) + .5) * B, y: (Math.floor(y / B) + .5) * B };
      }
    }
    if (b.towerSpot) { b.plan = { type: 'tower', goal: rr(8, 13) * B }; return; }
  }
  const trapId = ['blast', 'pad', 'pitfall', 'spike'].find(id => count(b, id) > 0);
  if (b.style === 'trapper' && trapId && b.layer === 0) {
    const spots = [...SWAMPS, ...world.entrances];
    const s = spots.reduce((a, s) => hyp(s.x - b.x, s.y - b.y) < hyp(a.x - b.x, a.y - b.y) ? s : a);
    if (hyp(s.x - b.x, s.y - b.y) < 220) {
      if (rng() < 0.6) {
        const i = Math.floor(b.x / B), j = Math.floor((b.z + 1) / B), k = Math.floor(b.y / B);
        if (placeBlock(b, trapId, i, j, k) && trapId === 'spike' && count(b, 'turf')) placeBlock(b, 'turf', i, j + 1, k); // Snare hides its spikes
      }
    } else { b.plan = { type: 'go', x: s.x + rr(-120, 120), y: s.y + rr(-120, 120), layer: 0 }; return; }
  }
  if (count(b, 'reed') < 3 && b.style === 'balanced' && !count(b, 'charm')) {
    const r = nearestResource(b, 'reed');
    if (r && hyp(r.x - b.x, r.y - b.y) < 600) { b.plan = { type: 'gather', obj: r, layer: 0 }; return; }
  }
  const wantArmor = b.style === 'miner' ? 4 : b.style === 'hunter' ? 1 : 2;
  if (b.armor < wantArmor || (b.style === 'miner' && b.weapon < 3)) {
    if (b.layer === 1) {
      const hide = nearestItem(b, 'hide', 1);
      if (hide && hyp(hide.x - b.x, hide.y - b.y) < 500) { b.plan = { type: 'go', x: hide.x, y: hide.y, layer: 1 }; return; }
      if (b.armor >= 2 && b.weapon < 3) {
        const ore = world.ores.filter(o => o.amt > 0).sort((p, q) => hyp(p.x - b.x, p.y - b.y) - hyp(q.x - b.x, q.y - b.y))[0];
        if (ore) { b.plan = { type: 'gather', obj: ore, layer: 1 }; return; }
      }
      let rat = null, rd = 900;
      for (const r of G.rats) { const d = hyp(r.x - b.x, r.y - b.y); if (d < rd) { rd = d; rat = r; } }
      b.plan = rat ? { type: 'rat', target: rat, layer: 1 } : { type: 'go', x: pick(world.nodes).x, y: pick(world.nodes).y, layer: 1 };
    } else {
      const e = nearestEntrance(b.x, b.y);
      b.plan = { type: 'go', x: e.x, y: e.y, layer: 1 };
    }
    return;
  }
  if (b.weapon < 2) {
    const t = nearestResource(b, 'rock');
    if (t) { b.plan = { type: 'gather', obj: t, layer: 0 }; return; }
  }
  // Loot a ruin chest that can be reached from the ground (watchtower chests need climbing)
  if (!G.pit && b.layer === 0 && (b.style !== 'tower' || b.towerDone)) {
    let best = null, bd = 900;
    for (const it of G.items) if (!it.gone && (it.kind === 'chest' || it.kind === 'relic' || it.kind === 'supply') && it.layer === 0 && it.z < heightAt(it.x, it.y) + 30) { const d = hyp(it.x - b.x, it.y - b.y); if (d < bd) { bd = d; best = it; } }
    if (best) { b.plan = { type: 'go', x: best.x, y: best.y, layer: 0 }; return; }
  }
  // The bounty: hunters (and some others) go for where the target was last seen
  const bs = G.bountySeen, bt = G.bounty;
  if (bs && bt && bt !== b && bt.alive && !allied(bt, b) && hyp(bs.x - b.x, bs.y - b.y) < 2200 && (b.style === 'hunter' || b.style === 'balanced' || b.bountyKeen)) {
    if (hyp(bs.x - b.x, bs.y - b.y) > 60) { b.plan = { type: 'go', x: bs.x, y: bs.y, layer: bs.layer }; return; }
  }
  // Hunt: chase a fresh rat-kill ping, otherwise head toward someone
  const ping = G.pings.find(p => p.src !== b && hyp(p.x - b.x, p.y - b.y) < 1600);
  if (ping && (b.style === 'hunter' || rng() < 0.4)) { b.plan = { type: 'go', x: ping.x, y: ping.y, layer: ping.layer }; return; }
  if (!b.plan || b.plan.type !== 'hunt' || rng() < 0.05) {
    const prey = pick(G.fighters.filter(o => o !== b && o.alive && !o.isClone));
    b.plan = prey ? { type: 'hunt', x: prey.x + rr(-200, 200), y: prey.y + rr(-200, 200), layer: prey.layer } : null;
  }
}

// ---- motorcycles ----
function bikeFor(b, x, y) {
  if (b.layer || isTitan(b) || b.noBikeT > G.t || hyp(x - b.x, y - b.y) < 1000) return null;
  return (G.bikes || []).find(k => !k.gone && !k.rider && bikeStill(k) && k.hp > 35 && hyp(k.x - b.x, k.y - b.y) < 320) || null;
}
// Ride toward the goal, looking ahead for trees, rocks, walls and lava; slow down and get off near the end.
// Bots ride a little slower than their top speed, but they still crash sometimes.
function botDrive(b, dt) {
  const k = b.bike, p = b.plan || {};
  const d = p.x === undefined ? 0 : hyp(p.x - k.x, p.y - k.y);
  if (p.stop || d < 170) {
    Object.assign(k, { throttle: 0, steer: 0, brake: Math.abs(k.speed) > 40 });
    if (Math.abs(k.speed) < 70 && !k.air) { dismountBike(b); b.plan = null; b.noBikeT = G.t + 25; }
    return;
  }
  let a = angDiff(k.face, Math.atan2(p.y - k.y, p.x - k.x));
  const look = 50 + Math.abs(k.speed) * 0.4;
  const blocked = off => { const x = k.x + Math.cos(k.face + off) * look, y = k.y + Math.sin(k.face + off) * look; return !!(bikeObstacle(k, x, y) || lavaPoolAt(x, y, 25)); };
  const ahead = blocked(0);
  if (ahead) a = !blocked(0.6) ? 0.9 : !blocked(-0.6) ? -0.9 : a;
  k.steer = clamp(a * 2.2, -1, 1);
  k.throttle = Math.abs(a) > 1.1 ? 0.25 : ahead ? 0.15 : 1;
  k.brake = ahead && k.speed > 240;
  // Stuck against something: give up on the bike for a while
  b.bikeStuck = Math.abs(k.speed) < 25 ? (b.bikeStuck || 0) + dt : 0;
  if (b.bikeStuck > 2.5) { dismountBike(b); b.plan = null; b.noBikeT = G.t + 25; b.bikeStuck = 0; }
}

// ---- alliances: bots near each other sometimes team up for a minute or two, then one turns on the other ----
// Run where the bots are simulated (solo, or the host); other players hear about it through NET.fx.
const TEAM_COLS = ['#5aa9c7', '#c4c24a', '#b670c9', '#6fc27a', '#e28fb3', '#d8a45a', '#7f8fe0'];
function updateAlliances(dt) {
  if (NET.on && !NET.isHost()) return;
  if ((G.allyT = (G.allyT || 0) - dt) > 0) return;
  G.allyT = 2;
  const alive = G.fighters.filter(f => f.alive && !f.isClone);
  for (const tm of G.teams) {
    const live = tm.m.filter(f => f.alive);
    if (live.length < 2) endTeam(tm, null);
    else if (G.t > tm.until || alive.length <= 6 || G.pit) endTeam(tm, live);
  }
  G.teams = G.teams.filter(t => !t.done);
  if (!pvpOn() || G.pit || alive.length <= 8 || G.teams.length >= Math.ceil(alive.length / 10)) return;
  const free = alive.filter(f => f.bot && !f.remote && !f.team && f.layer === 0 && f.id[0] === 'b');
  for (const a of free) {
    if (rng() > 0.15) continue;
    const near = free.filter(o => o !== a && hyp(o.x - a.x, o.y - a.y) < 260);
    if (!near.length) continue;
    const m = [a, near[0]];
    if (near[1] && rng() < 0.4) m.push(near[1]);
    const tm = { m, until: G.t + rr(60, 130), col: TEAM_COLS[(G.teamSeq = (G.teamSeq || 0) + 1) % TEAM_COLS.length] };
    for (const f of m) { f.team = tm; if (f.plan && f.plan.target && m.includes(f.plan.target)) f.plan = null; }
    G.teams.push(tm);
    const ids = m.map(f => f.id);
    announceTeam(ids, tm.col);
    NET.fx({ k: 'team', ids, c: tm.col });
    return; // one new alliance per check
  }
}
// The alliance is over. If two or more are left, the strongest turns on the nearest partner.
function endTeam(tm, live) {
  tm.done = true;
  for (const f of tm.m) f.team = null;
  const ids = tm.m.map(f => f.id);
  if (live && live.length >= 2 && pvpOn()) {
    const tr = live.reduce((p, q) => power(q) > power(p) ? q : p);
    const v = live.filter(f => f !== tr).sort((p, q) => hyp(p.x - tr.x, p.y - tr.y) - hyp(q.x - tr.x, q.y - tr.y))[0];
    tr.plan = { type: 'fight', target: v }; tr.thinkT = 1.5;
    announceBetrayal(ids, tr, v);
    NET.fx({ k: 'betray', ids, a: tr.id, v: v.id });
  } else { announceTeam(ids, null); NET.fx({ k: 'team', ids, c: null }); }
}
// Shared by the host and everyone it tells: team colours show next to names
function announceTeam(ids, col) {
  const fs = ids.map(fighterById).filter(Boolean);
  for (const f of fs) f.teamCol = col;
  const names = fs.map(f => f.name);
  if (col && fs.length >= 2) G.feed.unshift({ txt: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} teamed up`, t: 7, team: col });
}
function announceBetrayal(ids, a, v) {
  announceTeam(ids, null);
  if (a && v) {
    G.feed.unshift({ txt: `${a.name} turned on ${v.name}!`, t: 8, streak: true });
    if (v === G.human || a === G.human || hyp(a.x - G.human.x, a.y - G.human.y) < 700) toast(`${a.name} betrayed ${v.name}`);
  }
}

function nearestResource(b, kind) {
  let best = null, bd = 1e12;
  for (const o of nearObjs(b.x, b.y, 700)) {
    if (o.kind !== kind || o.amt <= 0) continue;
    const d = hyp(o.x - b.x, o.y - b.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) best = world.objs.find(o => o.kind === kind && o.amt > 0);
  return best;
}
function nearestItem(b, kind, layer) {
  let best = null, bd = 1e12;
  for (const i of G.items) {
    if (i.gone || i.kind !== kind || i.layer !== layer) continue;
    const d = hyp(i.x - b.x, i.y - b.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Walk toward (x, y) on a given layer, switching layers through the nearest entrance if needed.
function steer(b, x, y, layer, dt) {
  if (layer !== undefined && layer !== b.layer && !G.pit) {
    const e = b.layer === 0 ? nearestEntrance(x, y) : nearestEntrance(b.x, b.y);
    if (hyp(e.x - b.x, e.y - b.y) < 40) { toggleLayer(b); return; }
    x = e.x; y = e.y;
  }
  if (b.layer === 1) {
    const goal = nearestNode(x, y);
    if (!b.path || b.pathGoal !== goal) { b.path = navPath(nearestNode(b.x, b.y), goal); b.pathGoal = goal; }
    while (b.path.length > 1 && hyp(world.nodes[b.path[0]].x - b.x, world.nodes[b.path[0]].y - b.y) < 30) b.path.shift();
    if (b.path.length > 1 || hyp(x - b.x, y - b.y) > 200) { const n = world.nodes[b.path[0]]; x = n.x; y = n.y; }
  }
  let a = Math.atan2(y - b.y, x - b.x);
  // Walk around lava pools and poured lava
  if (b.layer === 0) {
    const ax = b.x + Math.cos(a) * 60, ay = b.y + Math.sin(a) * 60, lv = blockAt(Math.floor(ax / B), Math.floor((b.z + 1) / B), Math.floor(ay / B));
    if ((lavaPoolAt(ax, ay, 24) || (lv && lv.type === 'lava')) && !(b.detourT > 0)) { b.detourT = 0.9; b.side = b.side || 1; }
  }
  if (b.detourT > 0) { b.detourT -= dt; a += b.side * 1.3; }
  b.mx = Math.cos(a); b.my = Math.sin(a);
  // Unstick: hop, break a block in the way, or walk sideways for a moment
  const moved = hyp(b.x - (b.lx ?? b.x), b.y - (b.ly ?? b.y));
  b.lx = b.x; b.ly = b.y;
  b.stuck = moved < 40 * dt ? (b.stuck || 0) + dt : 0;
  if (b.stuck > 0.3 && b.layer === 0) jump(b);
  if (b.stuck > 0.7) {
    if (b.layer === 0) {
      const fx = b.x + Math.cos(a) * (b.r + 8), fy = b.y + Math.sin(a) * (b.r + 8);
      for (const dz of [10, 40]) {
        const i = Math.floor(fx / B), j = Math.floor((b.z + dz) / B), k = Math.floor(fy / B);
        if (solidAt(i, j, k) && !BLOCKS[blockAt(i, j, k).type].unbreakable) { b.face = a; b.swingT = 0.14; breakBlock(i, j, k, null); }
      }
    }
    b.detourT = 0.8; b.side = rng() < 0.5 ? -1 : 1; b.stuck = 0; b.path = null;
  }
}

// Pillar-jump: hop, and at the top of the hop put a block under your feet.
function pillarStep(b, type) {
  if (!count(b, type)) return false;
  if (b.onGround) { b.pillarBase = b.z; jump(b); return true; }
  const j = Math.floor((b.pillarBase + 0.5) / B);
  if (b.z >= (j + 1) * B + 0.5) placeBlock(b, type, Math.floor(b.x / B), j, Math.floor(b.y / B));
  return true;
}

function aimPitch(b, t) {
  const d = hyp(t.x - b.x, t.y - b.y);
  return Math.atan2(t.z + 30 - (b.z + 46), d) + d * 0.00055;
}

function botUpdate(b, dt) {
  b.mx = b.my = 0;
  if (b.isClone) {
    b.life -= dt;
    if (b.life <= 0) { b.alive = false; addFx('puff', b.x, b.y, b.layer, { col: b.color, z: b.z + 30 }); return; }
    b.face = b.cdir; b.mx = Math.cos(b.cdir); b.my = Math.sin(b.cdir);
    if (rng() < dt * 0.8) b.cdir += rr(-1, 1);
    return;
  }
  // Falling fast with a water bucket: pour it just before hitting the ground
  if (b.layer === 0 && !b.onGround && b.vz < -420) {
    const ws = b.slots.findIndex(s => s && s.id === 'bucket_water'), sup = supportAt(b.x, b.y, b.z, b.r, 0);
    if (ws >= 0 && b.z - sup < 70) pourBucket(b, ws, Math.floor(b.x / B), Math.floor((sup + 1) / B), Math.floor(b.y / B));
  }
  b.thinkT = (b.thinkT || 0) - dt;
  if (b.thinkT <= 0) { b.thinkT = rr(0.3, 0.45); botThink(b); }
  if (b.bike) { botDrive(b, dt); return; }
  const p = b.plan;
  if (!p) return;
  if (p.type === 'bike') { // walk to the bike and get on
    const k = p.k;
    if (!k || k.gone || k.rider || !bikeStill(k)) { b.plan = null; return; }
    if (hyp(k.x - b.x, k.y - b.y) < 36) { if (!mountBike(b, k)) b.plan = null; }
    else steer(b, k.x, k.y, 0, dt);
    return;
  }
  // Long trip on the surface with a bike parked nearby: take it
  if ((p.type === 'go' || p.type === 'hunt') && p.layer === 0) {
    const k = bikeFor(b, p.x, p.y);
    if (k) { b.plan = { type: 'bike', k, x: p.x, y: p.y }; return; }
  }
  if (p.type !== 'gather') b.gather = null;
  if (b.hp < 9 && hotPots(b) > 0 && b.drinkCd <= 0 && b.refillT <= 0) { if (drink(b)) b.drinkCd = rr(0.25, 0.5); }

  if (p.type === 'tower') {
    const s = b.towerSpot, d = hyp(s.x - b.x, s.y - b.y);
    if (b.z - heightAt(s.x, s.y) >= p.goal || (!count(b, 'plank') && b.onGround)) {
      b.towerDone = true; b.plan = { type: 'perch' }; return;
    }
    if (d > 4 && b.onGround && b.z < heightAt(s.x, s.y) + 20) { steer(b, s.x, s.y, 0, dt); return; }
    if (d > 4 && b.onGround) { b.mx = (s.x - b.x) / d * 0.3; b.my = (s.y - b.y) / d * 0.3; }
    pillarStep(b, 'plank');
    return;
  }
  if (p.type === 'perch') {
    const t = p.target;
    if (b.z < heightAt(b.x, b.y) + 40) { b.plan = null; return; }  // knocked off
    if (!t || !t.alive) { b.charge = -1; b.face += dt * 0.4; return; }
    const d = hyp(t.x - b.x, t.y - b.y);
    b.face = Math.atan2(t.y - b.y, t.x - b.x);
    if (d < b.r + t.r + 30 && Math.abs(t.z - b.z) < 45) { b.swingWait = (b.swingWait || 0) - dt; if (b.swingWait <= 0) { swing(b); b.swingWait = b.react; } return; }
    if (canShoot(b)) {
      if (b.charge < 0) b.charge = 0;
      else if (b.charge > 0.85) { shoot(b, b.charge, aimPitch(b, t) + rr(-0.03, 0.03)); b.charge = -1; }
    }
    if (b.kit === 'lightning') useKit(b, t.x, t.y);
    if (b.kit === 'mage' && d < 500) useKit(b, t.x, t.y);
    return;
  }
  if (p.type === 'fight' || p.type === 'flee') {
    const t = p.target;
    if (!t.alive || t.layer !== b.layer) { b.plan = null; return; }
    const d = hyp(t.x - b.x, t.y - b.y), a = Math.atan2(t.y - b.y, t.x - b.x);
    b.face = a + rr(-0.12, 0.12);
    if (p.type === 'flee') {
      b.mx = -Math.cos(a) + Math.cos(a + Math.PI / 2) * 0.4 * b.side2; b.my = -Math.sin(a) + Math.sin(a + Math.PI / 2) * 0.4 * b.side2;
      if (['runner', 'jumper', 'faker'].includes(b.kit)) useKit(b, b.x - Math.cos(a) * 200, b.y - Math.sin(a) * 200);
      if (b.kit === 'hidden' && d > 220 && !b.hidden) useKit(b, b.x, b.y);
      if (b.kit === 'hidden' && b.hidden) { b.mx = b.my = 0; }
      return;
    }
    const reachable = Math.abs(t.z - b.z) < 45;
    if (p.ranged || !reachable) {
      // Target is up a tower (or we're up one): keep distance and shoot
      if (d < 150) { b.mx = -Math.cos(a); b.my = -Math.sin(a); }
      else if (d > 380) steer(b, t.x, t.y, t.layer, dt);
      if (canShoot(b)) {
        if (b.charge < 0) b.charge = 0;
        else if (b.charge > 0.8) { shoot(b, b.charge, aimPitch(b, t)); b.charge = -1; }
      }
      if (b.kit === 'lightning') useKit(b, t.x, t.y);
      if (b.kit === 'fisherman' && d < 380) { b.pitch = aimPitch(b, t); useKit(b, t.x, t.y); }
      if (b.kit === 'trickster' && d < 420) { b.pitch = aimPitch(b, t) + 0.12; useKit(b, t.x, t.y); }
      if (b.kit === 'sapper' && d < 90 && t.z > b.z + 40) { b.sapTarget = { i: Math.floor(t.x / B), k: Math.floor(t.y / B) }; useKit(b, t.x, t.y); }
      return;
    }
    // Melee: close in, circle-strafe, swing when lined up
    const mreach = b.r + t.r + 34;
    if (d > mreach) { steer(b, t.x, t.y, t.layer, dt); }
    else { b.mx = Math.cos(a + Math.PI / 2) * b.side2 * 0.8; b.my = Math.sin(a + Math.PI / 2) * b.side2 * 0.8; if (rng() < dt * 0.7) b.side2 *= -1; }
    if (canShoot(b) && d > 190 && d < 420) {
      if (b.charge < 0) b.charge = 0;
      else if (b.charge > 0.7) { shoot(b, b.charge, aimPitch(b, t)); b.charge = -1; }
    } else b.charge = -1;
    b.swingWait = (b.swingWait || 0) - dt;
    if (d < mreach + 8 && b.swingWait <= 0) { swing(b); b.swingWait = b.react; }
    if (rng() < dt * 0.4) jump(b);
    const K = b.kit;
    if (K === 'runner' && d > 200) useKit(b, t.x, t.y);
    if (K === 'jumper' && d > 150 && d < 300) useKit(b, t.x, t.y);
    if (K === 'lightning' && d < 480) useKit(b, t.x, t.y);
    if (K === 'mage' && d > 180) useKit(b, t.x, t.y);
    if (K === 'fisherman' && d > 110 && d < 380) useKit(b, t.x, t.y);
    if (K === 'puncher' && d < 110 && b.punchT <= 0) useKit(b, t.x, t.y);
    if (K === 'duelist' && d < 100 && power(b) > power(t) * 1.1) useKit(b, t.x, t.y);
    if (K === 'jinx' && d < 90) useKit(b, t.x, t.y);
    if (K === 'shade' && d > 110 && G.t - (b.lastVictimT || -99) < 10) useKit(b, t.x, t.y);
    if (K === 'trickster' && d > 160 && d < 420) { b.pitch = aimPitch(b, t) + 0.12; useKit(b, t.x, t.y); }
    if (K === 'titan' && d < 240 && !isTitan(b)) useKit(b, t.x, t.y);
    // Pour lava at someone's feet
    const lavaSlot = b.slots.findIndex(s => s && s.id === 'bucket_lava');
    if (lavaSlot >= 0 && d < 90 && pvpOn() && t.layer === 0 && rng() < dt * 2)
      pourBucket(b, lavaSlot, Math.floor(t.x / B), Math.floor((t.z + 1) / B), Math.floor(t.y / B));
    return;
  }
  if (p.type === 'refill') { if (b.refillT <= 0 && hotbarEmpty(b) >= 0 && bagPots(b) > 0) b.refillT = 0.22; return; }
  if (p.type === 'gather') {
    const o = p.obj;
    if (o.amt <= 0) { b.plan = null; return; }
    if (hyp(o.x - b.x, o.y - b.y) < o.r + b.r + 16 && b.layer === p.layer) {
      if (!b.gather) { b.gather = o; b.gatherT = 0; }
    } else steer(b, o.x, o.y, p.layer, dt);
    return;
  }
  if (p.type === 'rat') {
    const r = p.target;
    if (r.dead) { b.plan = null; return; }
    b.face = Math.atan2(r.y - b.y, r.x - b.x);
    if (hyp(r.x - b.x, r.y - b.y) < 44) { b.swingWait = (b.swingWait || 0) - dt; if (b.swingWait <= 0) { swing(b); b.swingWait = b.react; } }
    else steer(b, r.x, r.y, 1, dt);
    return;
  }
  if (p.type === 'go' || p.type === 'hunt') {
    if (hyp(p.x - b.x, p.y - b.y) < 30 && b.layer === p.layer) { b.plan = null; return; }
    steer(b, p.x, p.y, p.layer, dt);
    if (b.mx || b.my) b.face = Math.atan2(b.my, b.mx);
  }
}
