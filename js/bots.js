'use strict';
// Bots stand in for the other players. Each gets a playstyle from the design doc:
// hunter (seeks people), miner (rats and iron underground), trapper (spike traps near potions and tunnels),
// tower (pillars up and shoots from above), balanced.
const STYLES = ['hunter', 'miner', 'miner', 'trapper', 'tower', 'tower', 'hunter', 'balanced'];
// Difficulty: how fast bots react, how far they see, how well they aim, when they drink, how brave they are
// hear: how far noises carry for them; mem: seconds they remember someone; lead: how well they aim ahead of a
// moving target; retreatAt: health at which they back off to heal (0 = never); notice: how long a first sighting
// takes to register (times their reaction time); backoff: step out of reach while the sword recharges
const BOT_LVL = [
  { name: 'Easy', react: [0.55, 0.85], sight: 0.75, jitter: 1.9, aim: 0.09, drinkAt: 6, brave: 1.25, kitCd: 2, hear: 0.7, mem: 8, lead: 0.2, retreatAt: 0, notice: 1.6, backoff: false },
  { name: 'Normal', react: [0.3, 0.5], sight: 1, jitter: 1, aim: 0.03, drinkAt: 9, brave: 1, kitCd: 1, hear: 1, mem: 12, lead: 0.7, retreatAt: 7, notice: 1, backoff: true },
  { name: 'Brutal', react: [0.16, 0.28], sight: 1.25, jitter: 0.45, aim: 0.008, drinkAt: 11.5, brave: 0.85, kitCd: 0.75, hear: 1.3, mem: 18, lead: 1, retreatAt: 9, notice: 0.6, backoff: true },
];
const botLvl = () => BOT_LVL[G.botLevel ?? 1] || BOT_LVL[1];
// Personalities, on top of the playstyle: cowards run, campers dig in and wait, rushers chase anyone, looters go for chests
const PERS = {
  steady: { brave: 1 }, coward: { brave: 1.6 }, camper: { brave: 1 }, rusher: { brave: 0.45 }, looter: { brave: 1.2 },
};
const PERS_LIST = ['steady', 'steady', 'coward', 'camper', 'rusher', 'looter'];

function sightRange(b) {
  if (b.layer === 1) return 300;
  return (b.biome === 2 && G.settings.snow && b.kit !== 'yeti' ? 240 : 460) * botLvl().sight;
}
function nearestEntrance(x, y) {
  let best = null, bd = 1e12;
  for (const e of world.entrances) { const d = hyp(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}
const canShoot = b => b.bow && b.arrows > 0;

function botThink(b) {
  // On a motorcycle: keep riding unless someone's close, then stop and get off to fight
  if (b.heli) return; // riding along as a gunner (helis.js)
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
  if (b.weapon >= 2 && count(b, 'stone') >= 5 && count(b, 'shockbomb') < 2) craft(b, recipe('shockbomb'));

  // Look and listen (only what's in line of sight, plus noises), then pick a target
  const L = botLvl(), was = b.plan && b.plan.type;
  const ignore = b.ignore || (b.ignore = new Map());
  const vis = perceive(b).filter(v => !(ignore.get(v.o) > G.t) && (v.reach || canShoot(b) || v.o.z > b.z) // unreachable & below us: not worth it
    && !(v.o.heli && v.o.heli.air && !canShoot(b))); // a helicopter overhead: only worth it with a bow
  // Up a tower: keep building, or stay on top and pick people off
  const elevated = b.layer === 0 && b.z > heightAt(b.x, b.y) + 60;
  if (elevated && b.plan && b.plan.type === 'tower') return;
  if (elevated && b.onGround && (b.towerDone || (b.plan && b.plan.type === 'perch'))) { b.plan = { type: 'perch', target: vis[0] && vis[0].o }; return; }
  if (was === 'climb' && b.plan.target.alive && b.plan.target.z > b.z + 30 && blockStock(b)) return; // mid-climb: keep building
  if (vis.length && pvpOn()) {
    vis.sort((p, q) => targetScore(b, p) - targetScore(b, q));
    const v = vis[0], enemy = v.o, ed = v.d, reach = v.reach;
    const m = b.mem.get(enemy), fighting = b.plan && (b.plan.type === 'fight' || b.plan.type === 'retreat' || b.plan.type === 'climb') && b.plan.target === enemy;
    // Just spotted: take a moment to react (longer on Easy)
    if (!fighting && m && G.t - m.first < b.react * L.notice) { b.plan = { type: 'notice', target: enemy }; return; }
    // Hurt, with potions: back off behind cover and drink, then come back
    const pots = hotPots(b) + bagPots(b);
    if (L.retreatAt && b.hp < L.retreatAt && pots > 0 && !G.pit && ed > 40 && b.pers !== 'rusher') {
      if (was !== 'retreat') { b.plan = { type: 'retreat', target: enemy, until: G.t + 7, cover: coverPoint(b, enemy) }; botSay(b, 'flee', enemy); }
      return;
    }
    if (was === 'retreat' && b.hp < 14 && pots > 0 && G.t < b.plan.until) return; // still healing up
    // Out of reach up a tower: shoot, use a kit that reaches, pillar up next to them, or leave them to it
    if (!reach && enemy.z > b.z + 40) {
      if (canShoot(b) || ['lightning', 'sapper', 'trickster', 'fisherman', 'mage'].includes(b.kit)) { b.plan = { type: 'fight', target: enemy, ranged: true }; return; }
      const need = Math.ceil((enemy.z - b.z) / B) + 1;
      while (blockStock(b) < need && count(b, 'wood') > 0 && craft(b, recipe('plank')));
      const spot = blockStock(b) >= need && climbSpot(b, enemy);
      if (spot) { b.plan = { type: 'climb', target: enemy, spot }; if (was !== 'climb') botSay(b, 'engage', enemy); return; }
      const tree = blockStock(b) < need && nearestResource(b, 'tree');
      if (tree && hyp(tree.x - b.x, tree.y - b.y) < 450) { ignore.set(enemy, G.t + 5); b.plan = { type: 'gather', obj: tree, layer: 0 }; return; } // short of blocks: chop some wood and come back
      ignore.set(enemy, G.t + 25); b.plan = null; // can't get at them: go do something else for a while
    } else if (!reach) { b.plan = { type: 'fight', target: enemy, ranged: true }; return; }
    else {
      const brave = (b.style === 'hunter' ? 0.6 : b.style === 'trapper' ? 1.1 : 0.85) * (PERS[b.pers] || PERS.steady).brave * L.brave;
      const cornered = ed < 80 && b.hp > 5;
      let fight = power(b) >= power(enemy) * brave || cornered || G.pit || (b.rival && enemy === G.human);
      // Outnumbered: two or more close enemies are only worth it if we're much stronger than them together
      const near = vis.filter(q => q.d < 260 && q.reach);
      if (near.length >= 2 && !cornered && !G.pit && power(b) < near.reduce((s, q) => s + power(q.o), 0) * 0.8 * brave) fight = false;
      if (b.pers === 'coward' && b.hp < 10 && !cornered && !G.pit) fight = false;
      b.plan = fight ? { type: 'fight', target: enemy } : { type: 'flee', target: enemy, away: coverPoint(b, enemy) };
      if (b.plan.type !== was) botSay(b, b.plan.type === 'flee' ? 'flee' : 'engage', enemy);
      return;
    }
  }
  if (b.plan && b.plan.type === 'camp' && G.t < b.plan.until && b.layer === 0) return; // campers sit tight
  if (was === 'retreat' && G.t < b.plan.until && b.hp < 14 && hotPots(b) + bagPots(b) > 0) return; // out of sight: keep healing
  // Nothing in sight: check out where we last saw someone, or a noise we just heard
  if (pvpOn() && !G.pit) {
    const lk = lastKnown(b);
    if (lk && lk.m.layer === b.layer && !(ignore.get(lk.o) > G.t)) {
      const d = hyp(lk.m.x - b.x, lk.m.y - b.y), fresh = G.t - lk.m.t;
      const chasing = was === 'fight' || was === 'notice' || was === 'search';
      const keen = b.pers === 'rusher' || b.style === 'hunter' || power(b) > 45 || b.rival;
      if (b.pers === 'coward' && d < 320 && fresh < 3) { b.plan = { type: 'flee', target: lk.o, away: coverPoint(b, lk.m) }; return; }
      if (d > 40 && ((chasing && fresh < L.mem) || (!lk.m.seen && fresh < 2 && keen))) { b.plan = { type: 'search', x: lk.m.x, y: lk.m.y, layer: lk.m.layer, target: lk.o, until: G.t + 10 }; return; }
    }
  }
  // Rivals come looking for you
  if (b.rival && pvpOn() && G.human.alive && G.human.isFighter && hyp(G.human.x - b.x, G.human.y - b.y) > 350 && b.weapon >= 1) {
    b.plan = { type: 'go', x: G.human.x + rr(-150, 150), y: G.human.y + rr(-150, 150), layer: G.human.layer }; return;
  }
  // Rushers go straight for whoever's nearest once they have a weapon
  if (b.pers === 'rusher' && pvpOn() && b.weapon >= 1) {
    let prey = null, pd = 2500;
    for (const o of G.fighters) if (o !== b && o.alive && !o.isClone && !allied(o, b)) { const d = hyp(o.x - b.x, o.y - b.y); if (d < pd) { pd = d; prey = o; } }
    if (prey) { b.plan = { type: 'go', x: prey.x, y: prey.y, layer: prey.layer }; return; }
  }
  // Looters go for death bags and chests before anything else
  if (b.pers === 'looter' && b.layer === 0 && !G.pit) {
    let best = null, bd = 1200;
    for (const it of G.items) if (!it.gone && it.layer === 0 && ['bag', 'chest', 'supply', 'feast', 'relic'].includes(it.kind) && it.z < heightAt(it.x, it.y) + 30) { const d = hyp(it.x - b.x, it.y - b.y); if (d < bd) { bd = d; best = it; } }
    if (best) { b.plan = { type: 'go', x: best.x, y: best.y, layer: 0 }; return; }
  }
  // Campers with decent gear pick a spot near somewhere people go, and wait there
  if (b.pers === 'camper' && b.layer === 0 && !G.pit && (b.weapon >= 2 || b.armor >= 2)) {
    if (b.campSpot && hyp(b.campSpot.x - b.x, b.campSpot.y - b.y) < 40) {
      b.plan = { type: 'camp', until: G.t + rr(40, 80) }; b.campSpot = null;
      if (b.kit === 'hidden' && !b.hidden) useKit(b, b.x, b.y);
      return;
    }
    if (!b.campSpot) {
      const spots = [...world.ruins, ...FEAST_SITES, ...world.landmarks.filter(m => !m.layer)];
      const s = spots.filter(p => hyp(p.x - b.x, p.y - b.y) < 1500).sort(() => rng() - 0.5)[0];
      if (s) { const a = rr(0, 6.28); b.campSpot = { x: s.x + Math.cos(a) * rr(90, 160), y: s.y + Math.sin(a) * rr(90, 160) }; }
    }
    if (b.campSpot) { b.plan = { type: 'go', x: b.campSpot.x, y: b.campSpot.y, layer: 0 }; return; }
  }
  // Duos: revive a downed partner, back them up, stay close
  if (G.duo && squadPlan(b)) return;
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
      const here = compAt(b.x, b.y); // only what's reachable from this tunnel network or cave
      if (b.armor >= 2 && b.weapon < 3) {
        const ore = world.ores.filter(o => o.amt > 0 && compAt(o.x, o.y) === here).sort((p, q) => hyp(p.x - b.x, p.y - b.y) - hyp(q.x - b.x, q.y - b.y))[0];
        if (ore) { b.plan = { type: 'gather', obj: ore, layer: 1 }; return; }
      }
      let rat = null, rd = 900;
      for (const r of G.rats) { const d = hyp(r.x - b.x, r.y - b.y); if (d < rd && world.nodes[r.node].comp === here) { rd = d; rat = r; } }
      const n = pick(world.nodes.filter(q => q.comp === here));
      b.plan = rat ? { type: 'rat', target: rat, layer: 1 } : { type: 'go', x: n.x, y: n.y, layer: 1 };
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
  if ((NET.on && !NET.isHost()) || G.duo) return; // no side deals in duos
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
    botSay(a, 'team', near[0]);
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
    botSay(tr, 'betray', v);
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
    const e = b.layer === 0 ? entranceFor(x, y, x, y) : entranceFor(b.x, b.y, b.x, b.y); // caves have their own way in
    if (hyp(e.x - b.x, e.y - b.y) < 40) { toggleLayer(b); return; }
    x = e.x; y = e.y;
  }
  if (b.layer === 1) {
    const goal = nearestNode(x, y);
    if (!b.path || b.pathGoal !== goal) { b.path = navPath(nearestNode(b.x, b.y), goal); b.pathGoal = goal; }
    while (b.path.length > 1 && hyp(world.nodes[b.path[0]].x - b.x, world.nodes[b.path[0]].y - b.y) < 30) b.path.shift();
    if (b.path.length > 1 || hyp(x - b.x, y - b.y) > 200) { const n = world.nodes[b.path[0]]; x = n.x; y = n.y; }
  } else if (b.z < heightAt(b.x, b.y) + 20) { // on the surface: route around trees, rocks, walls and lava
    const w = nextWaypoint(b, x, y); x = w.x; y = w.y;
  }
  let a = Math.atan2(y - b.y, x - b.x);
  // Walk around lava pools and poured lava
  if (b.layer === 0) {
    const ax = b.x + Math.cos(a) * 60, ay = b.y + Math.sin(a) * 60, lv = blockAt(Math.floor(ax / B), Math.floor((b.z + 1) / B), Math.floor(ay / B));
    if ((lavaPoolAt(ax, ay, 24) || (lv && lv.type === 'lava')) && !(b.detourT > 0)) { b.detourT = 0.9; b.side = b.side || 1; }
  }
  if (b.detourT > 0) { b.detourT -= dt; a += b.side * 1.3; }
  b.mx = Math.cos(a); b.my = Math.sin(a);
  // Doors: open a shut one that's in the way (on either layer)
  if (BL.map.size && !(b.doorCd > G.t)) {
    const i = Math.floor((b.x + b.mx * (b.r + 12)) / B), j = lj(b.z + 10, b.layer), k = Math.floor((b.y + b.my * (b.r + 12)) / B), d = blockAt(i, j, k);
    if (d && BLOCKS[d.type].door && !BLOCKS[d.type].hatch && !d.open) { b.doorCd = G.t + 0.6; toggleDoor(i, j, k, b, true); }
  }
  // Unstick: hop, break a block in the way, or walk sideways for a moment
  const moved = hyp(b.x - (b.lx ?? b.x), b.y - (b.ly ?? b.y));
  b.lx = b.x; b.ly = b.y;
  b.stuck = moved < 40 * dt ? (b.stuck || 0) + dt : 0;
  if (b.stuck > 0.3) jump(b);
  if (b.stuck > 0.7) { // a wall, a barricade or a cave-in in the way: break through
    const fx = b.x + Math.cos(a) * (b.r + 8), fy = b.y + Math.sin(a) * (b.r + 8);
    for (const dz of [10, 40]) {
      const i = Math.floor(fx / B), j = lj(b.z + dz, b.layer), k = Math.floor(fy / B);
      if (solidAt(i, j, k) && !BLOCKS[blockAt(i, j, k).type].unbreakable) { b.face = a; b.swingT = 0.14; breakBlock(i, j, k, null); }
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
  return Math.atan2(t.z + 30 - (b.z + 46), d) + d * 0.00055 + rr(-1, 1) * botLvl().aim;
}
// Draw, and release at `full` charge, aimed where the target will be when the arrow gets there
function botShoot(b, t, full) {
  if (b.charge < 0) { b.charge = 0; return; }
  if (b.charge <= full) return;
  const p = leadPoint(b, t, b.charge);
  b.face = Math.atan2(p.y - b.y, p.x - b.x) + rr(-0.02, 0.02) * botLvl().jitter;
  shoot(b, b.charge, aimPitch(b, p));
  b.charge = -1;
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
  if (b.heli) { botGunner(b, dt); return; }
  b.thinkT = (b.thinkT || 0) - dt;
  if (b.thinkT <= 0) { b.thinkT = rr(0.3, 0.45); botThink(b); }
  if (b.bike) { botDrive(b, dt); return; }
  const p = b.plan;
  if (!p) return;
  if (p.type === 'revive') { botRevive(b, dt); return; }
  if (p.type === 'heli') { botBoard(b, dt); return; }
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
  if (p.type === 'camp') { // stand still, crouched, looking around
    b.sneak = true; if (rng() < dt * 0.6) b.face += rr(-1.2, 1.2);
    if (G.t > p.until) { b.plan = null; b.sneak = false; }
    return;
  }
  b.sneak = false;
  // Drinking: bots that know how to retreat don't stand and drink in the middle of a fight unless it's an emergency
  const inFight = (p.type === 'fight' || p.type === 'notice') && p.target && p.target.alive && hyp(p.target.x - b.x, p.target.y - b.y) < 260;
  if (b.hp < botLvl().drinkAt && hotPots(b) > 0 && b.drinkCd <= 0 && b.refillT <= 0 && (!inFight || !botLvl().retreatAt || b.hp < 3.5)) { if (drink(b)) b.drinkCd = rr(0.25, 0.5); }

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
    if (canShoot(b)) botShoot(b, t, 0.85);
    if (b.kit === 'lightning') useKit(b, t.x, t.y);
    if (b.kit === 'mage' && d < 500) useKit(b, t.x, t.y);
    return;
  }
  if (p.type === 'notice') { // just spotted someone: turn to look, freeze for a moment
    const t = p.target;
    if (!t || !t.alive) { b.plan = null; return; }
    b.face += angDiff(b.face, Math.atan2(t.y - b.y, t.x - b.x)) * Math.min(1, dt * 8);
    return;
  }
  if (p.type === 'search') { // go and look where they were last seen or heard
    if (G.t > p.until || (p.target && !p.target.alive)) { b.plan = null; return; }
    if (hyp(p.x - b.x, p.y - b.y) < 40 && b.layer === p.layer) { if (b.mem) b.mem.delete(p.target); b.plan = { type: 'lookaround', until: G.t + rr(1.2, 2.2) }; return; }
    steer(b, p.x, p.y, p.layer, dt);
    if (b.mx || b.my) b.face = Math.atan2(b.my, b.mx);
    return;
  }
  if (p.type === 'lookaround') { b.face += dt * 2.4 * b.side2; if (G.t > p.until) b.plan = null; return; }
  if (p.type === 'retreat') { // get behind cover, then drink up
    const t = p.target;
    const d = t && t.alive ? hyp(t.x - b.x, t.y - b.y) : 1e9;
    if (d < 55 && t) { b.plan = { type: 'fight', target: t }; return; } // caught: fight back
    const safe = d > 240 || (b.hidT > G.t) || (hyp(p.cover.x - b.x, p.cover.y - b.y) < 30 && !(b.seenT > G.t));
    if ((b.losT || 0) < G.t && t) { b.losT = G.t + 0.3; if (!canSee(t, b)) b.hidT = G.t + 0.6; else b.seenT = G.t + 0.4; }
    if (safe) {
      if (hotPots(b) > 0) { if (b.drinkCd <= 0 && drink(b)) b.drinkCd = rr(0.3, 0.5); }
      else if (bagPots(b) > 0 && b.refillT <= 0 && hotbarEmpty(b) >= 0) b.refillT = 0.22;
      if (t) b.face = Math.atan2(t.y - b.y, t.x - b.x);
    } else { steer(b, p.cover.x, p.cover.y, b.layer, dt); if (b.mx || b.my) b.face = Math.atan2(b.my, b.mx); }
    if (b.hp >= 14 || G.t > p.until || hotPots(b) + bagPots(b) === 0) b.plan = t && t.alive ? { type: 'fight', target: t } : null;
    return;
  }
  if (p.type === 'climb') { // pillar up right next to a tower camper, then fight them at the top
    const t = p.target, s = p.spot, type = blockType(b);
    if (!t.alive || !type || t.z < b.z + 20) { b.plan = t.alive ? { type: 'fight', target: t } : null; return; }
    const d = hyp(s.x - b.x, s.y - b.y);
    b.face = Math.atan2(t.y - b.y, t.x - b.x);
    if (d > 8 && b.onGround && b.z < heightAt(s.x, s.y) + 20) { steer(b, s.x, s.y, 0, dt); return; }
    if (d > 4 && b.onGround) { b.mx = (s.x - b.x) / d * 0.3; b.my = (s.y - b.y) / d * 0.3; }
    pillarStep(b, type);
    if (Math.abs(t.z - b.z) < 45 && hyp(t.x - b.x, t.y - b.y) < b.r + t.r + 40) { b.swingWait = (b.swingWait || 0) - dt; if (b.swingWait <= 0) { swing(b); b.swingWait = b.react; } }
    return;
  }
  if (p.type === 'fight' || p.type === 'flee') {
    const t = p.target;
    if (!t.alive || t.layer !== b.layer) { b.plan = null; return; }
    const d = hyp(t.x - b.x, t.y - b.y), a = Math.atan2(t.y - b.y, t.x - b.x);
    b.face = a + rr(-0.12, 0.12) * botLvl().jitter;
    botShockbomb(b, t);
    if (p.type === 'flee') { // run for cover, not just straight away
      const aw = p.away || { x: b.x - Math.cos(a) * 300, y: b.y - Math.sin(a) * 300 };
      if (hyp(aw.x - b.x, aw.y - b.y) < 30) p.away = coverPoint(b, t);
      steer(b, aw.x, aw.y, b.layer, dt);
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
      if (canShoot(b)) botShoot(b, t, 0.8);
      if (b.kit === 'lightning') useKit(b, t.x, t.y);
      if (b.kit === 'fisherman' && d < 380) { b.pitch = aimPitch(b, t); useKit(b, t.x, t.y); }
      if (b.kit === 'trickster' && d < 420) { b.pitch = aimPitch(b, t) + 0.12; useKit(b, t.x, t.y); }
      if (b.kit === 'sapper' && d < 90 && t.z > b.z + 40) { b.sapTarget = { i: Math.floor(t.x / B), k: Math.floor(t.y / B) }; useKit(b, t.x, t.y); }
      return;
    }
    // Melee: close in, circle-strafe, swing when lined up; better bots step back out of reach while the sword recharges
    const mreach = b.r + t.r + 34;
    const backing = botLvl().backoff && b.swingWait > 0.12 && d < mreach + 12 && !(t.charge >= 0);
    if (backing) { b.mx = -Math.cos(a) * 0.8 + Math.cos(a + Math.PI / 2) * b.side2 * 0.6; b.my = -Math.sin(a) * 0.8 + Math.sin(a + Math.PI / 2) * b.side2 * 0.6; }
    else if (d > mreach) { steer(b, t.x, t.y, t.layer, dt); }
    else { b.mx = Math.cos(a + Math.PI / 2) * b.side2 * 0.8; b.my = Math.sin(a + Math.PI / 2) * b.side2 * 0.8; if (rng() < dt * 0.7) b.side2 *= -1; }
    if (canShoot(b) && d > 190 && d < 420) botShoot(b, t, 0.7);
    else b.charge = -1;
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
