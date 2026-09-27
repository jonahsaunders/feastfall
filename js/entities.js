'use strict';
// Fighters, combat, kits, falling, traps, rats, projectiles, ground items.
// Sim coordinates: (x, y) on the ground plane, z is height.
// A fighter with `remote` set is simulated on another player's machine; we only mirror it,
// and anything we do to it (damage, knockback, teleport) is sent through NET.
const KITS = {
  killer:    { name: 'Killer',    desc: '+1 damage on every melee hit.', passive: true },
  mage:      { name: 'Mage',      desc: 'Pull the nearest enemy to you. From the top of a tower, they arrive in mid-air. You are invincible for 2s.', cd: 35, item: 'Tome' },
  jumper:    { name: 'Jumper',    desc: 'Launch yourself about seven blocks up and forward. Your own jumps never cause fall damage.', cd: 8, item: 'Spring' },
  runner:    { name: 'Runner',    desc: 'Sprint at 1.8× speed for 3.5 seconds.', cd: 16, item: 'Feather' },
  puncher:   { name: 'Puncher',   desc: 'Charge your fist: the next hit deals +8. Three uses.', uses: 3, item: 'Gauntlet' },
  thrower:   { name: 'Thrower',   desc: 'Start with a bow and 12 arrows.', passive: true },
  faller:    { name: 'Faller',    desc: 'Fall damage you would take goes to the player you land next to, unless they are sneaking (Shift).', passive: true },
  cutter:    { name: 'Cutter',    desc: 'Chop trees four times faster, with a chance of extra wood.', passive: true },
  hidden:    { name: 'Hidden',    desc: 'Disguise yourself as a bush, rock or cactus that fits the biome. Moving breaks it.', cd: 4, item: 'Leaf Cloak' },
  faker:     { name: 'Faker',     desc: 'Send out two decoy clones that die in one hit. Three uses.', uses: 3, item: 'Mirror' },
  finder:    { name: 'Finder',    desc: 'Spawn inside the swamp, next to the health potions.', passive: true },
  lightning: { name: 'Lightning', desc: 'Strike where you aim: 5 damage and every block in the area is destroyed. Brings towers down.', cd: 20, item: 'Rod' },
  heavy:     { name: 'Heavy',     desc: 'You take no knockback.', passive: true },
  fisherman: { name: 'Fisherman', desc: 'Cast a hook that drags a player to you, even off a tower. Deals no damage.', cd: 4, item: 'Hook' },
  duelist:   { name: 'Duelist',   desc: 'Challenge an enemy within 4 blocks: you’re both locked in a glass arena 16 blocks up for 45 seconds. When it ends, the floor goes and you both fall.', cd: 70, item: 'Challenge' },
  trickster: { name: 'Trickster', desc: 'Throw a snowball: you swap places with whoever it hits. Pull a tower camper down to your spot and take theirs.', cd: 12, item: 'Swap Snowball' },
  jinx:      { name: 'Jinx',      desc: 'Hex the enemy in front of you: their hotbar gets shuffled with their backpack, potions and sword included.', cd: 18, item: 'Hex Charm' },
  bulwark:   { name: 'Bulwark',   desc: 'Arrows, hooks, Mage pulls, swaps, hexes and duels don’t work on you.', passive: true },
  sapper:    { name: 'Sapper',    desc: 'Use on a block to bring down its whole column at once. Five charges. Built for toppling towers.', uses: 5, item: 'Charges' },
  tripwire:  { name: 'Tripwire',  desc: 'Start with 4 Blast Traps (and a recipe for more): they blow apart nearby blocks and launch whoever steps on them.', passive: true, start: [['blast', 4]] },
  snare:     { name: 'Snare',     desc: 'Start with 16 Snare Turf and 2 spike traps. Turf looks like ground but vanishes under anyone but you: hide spikes under it, or build fake floors.', passive: true, start: [['turf', 16], ['spike', 2]] },
  blight:    { name: 'Blight',    desc: 'One hit in three poisons the target (damage over 4 seconds) or slows them.', passive: true },
  leech:     { name: 'Leech',     desc: 'Every kill heals 4 hearts, and your melee hits heal you a little.', passive: true },
  shade:     { name: 'Shade',     desc: 'Within 10 seconds of hitting someone, blink behind them.', cd: 14, item: 'Shadowstep' },
  yeti:      { name: 'Yeti',      desc: 'The snowstorm doesn’t blind you, and you move faster on snow.', passive: true },
  bogwalker: { name: 'Bogwalker', desc: 'In the swamp you move fast instead of slow, and slowly regenerate health.', passive: true },
  recluse:   { name: 'Recluse',   desc: 'Spawn in the loneliest spot on the map, and your minimap shows anyone within 36 blocks.', passive: true },
  updraft:   { name: 'Updraft',   desc: 'Start with 6 launch pads (and a recipe for more). They fling anyone into the sky; off your own, you land safely.', passive: true, start: [['pad', 6]] },
  titan:     { name: 'Titan',     desc: 'Grow to more than twice your size for 8 seconds: longer reach, heavier hits, no knockback or fall damage, and landing from a jump knocks everyone near you flying. You’re also a much bigger target.', cd: 40, item: 'Growth Tonic' },
};
const TITAN_SIZE = 2.2, TITAN_TIME = 8;
const isTitan = f => (f.size || 1) > 1.5;
// Bulwark shrugs off tricks that move or hex you
const resists = t => !!t && t.kit === 'bulwark';
const BOT_NAMES = ['Brenno', 'kaiquezin', 'Rafa_BR', 'moss_boss', 'TheFeastGuy', 'lowpoly', 'sopa', 'Vitor77', 'ratcatcher',
  'NoArmourNate', 'pitdweller', 'Juju', 'towerboi', 'quietfox', 'Marina', 'hookline', 'DuneRat', 'k1ller', 'pedrao', 'swampqueen',
  'Oskar', 'Lia', 'Tamsin', 'skybridge', 'Duda', 'pillarman', 'Keko', 'Anouk', 'rust', 'Beto', 'Mirela', 'haybale', 'Ines', 'grr', 'Theo', 'Sasha', 'cobble_kid', 'Yuri', 'Nell',
  'Pim', 'Zeca', 'Ruth', 'arrowstorm', 'Joca', 'Mael', 'Ilka', 'ponte', 'Fern', 'Oto', 'Sunny', 'tatu', 'Ravi', 'Kasia', 'Luan', 'Wen', 'Bia', 'Emil', 'Nia', 'Dario', 'Olga'];
const COLORS = ['#e2733b', '#5aa9c7', '#c4c24a', '#b670c9', '#6fc27a', '#d65a5a', '#d8a45a', '#7f8fe0', '#58c2a8', '#e28fb3', '#9fb35a', '#c98a6a'];

const G = { fighters: [], rats: [], proj: [], fx: [], items: [], pings: [], feed: [], itemSeq: 0 };

class Fighter {
  constructor(name, kit, bot, id) {
    Object.assign(this, {
      id: id || name, name, kit, bot, alive: true, isFighter: true, r: 13, hp: 20, maxHp: 20, x: 0, y: 0, z: 0, vz: 0, onGround: true, peakZ: 0, layer: 0,
      mx: 0, my: 0, kbx: 0, kby: 0, face: 0, sel: 0,
      atkCd: 0, kitCd: 0, uses: KITS[kit].uses || 0, invuln: 0, speedT: 0, hurtT: 0, swingT: 0, swings: 0, punchT: 0,
      drinkCd: 0, charge: -1, gather: null, gatherT: 0, refillT: 0, hidden: false, disguise: 'bush', kills: 0, biome: 0,
      sneak: false, slowT: 0, spikeCd: 0, noFallT: 0, lastHitT: -99, net: {}, size: 1, titanT: 0, burnT: 0, inLiq: null,
      color: bot ? pick(COLORS) : '#f2ead6',
    });
    newInv(this);
    if (KITS[kit].item) this.slots[1] = { id: 'kit', n: 1 };
    if (kit === 'thrower') { this.slots[2] = { id: 'bow', n: 1 }; give(this, 'arrow', 12); }
    for (const [id, n] of KITS[kit].start || []) give(this, id, n);
  }
  get weapon() { return weaponTier(this); }
  get armor() { return armorPieces(this); }
  get bow() { return !this.remote && count(this, 'bow') > 0; }
  get arrows() { return count(this, 'arrow'); }
}

function power(f) {
  if (f.isClone) return 6;
  return (f.hp + totalPots(f) * 5) * (1 + armorDef(f) * 1.5) * (WDMG[f.weapon] + (f.kit === 'killer' ? 1 : 0) + 0.5);
}
function pvpOn() { return G.clockMin >= G.grace; }
function jump(f, v = JUMP_V) {
  if (!f.onGround || f.pitT > 0) return false;
  if (isTitan(f)) v *= 1.3;
  f.vz = v; f.onGround = false; f.peakZ = f.z;
  return true;
}
const srcId = s => s && s.isFighter ? (s.owner || s).id : null;
const fighterById = id => G.fighters.find(f => f.id === id && !f.isClone);

// ---- damage and death ----
function hurt(t, amt, src, ang, kb, up = 0) {
  if (!t.alive || t.invuln > 0) return false;
  if (t.isFighter && src && src.isFighter && !pvpOn()) return false;
  if (t.isClone) { t.alive = false; addFx('puff', t.x, t.y, t.layer, { col: t.color, z: t.z + 30 }); return true; }
  const byMe = src && (src.owner || src) === G.human && t !== G.human && G.stats;
  if (t.remote) { if (byMe) G.stats.dmg += amt; NET.hit(t, { d: +amt.toFixed(2), a: +ang.toFixed(2), kb: Math.round(kb || 0), up: up || undefined, by: srcId(src) }); t.hurtT = 0.2; return true; }
  amt *= 1 - armorDef(t);
  if (byMe) G.stats.dmg += amt;
  noteDamage(t, src, amt);
  noise(t.x, t.y, t.layer, 420, src); // a fight is loud: whoever's nearby hears where
  if (t.emoteT > 0) stopEmote(t);
  if (t === G.human && src && src.isFighter) G.dmgDir = { a: Math.atan2(src.y - t.y, src.x - t.x), t: 1 };
  t.hp -= amt; t.hurtT = 0.2; t.gather = null; t.refillT = 0; t.hidden = false;
  const steady = t.kit === 'heavy' || isTitan(t);
  if (t.bike && !steady && (up || kb > 600)) dismountBike(t, true); // a big hit knocks you off your bike
  if (!steady && kb) { t.kbx += Math.cos(ang) * kb; t.kby += Math.sin(ang) * kb; }
  if (up && !steady) { if (t.onGround) jump(t, up); else t.vz = Math.max(t.vz, up * 0.6); }
  if (G.settings.dmgNums) addFx('num', t.x, t.y, t.layer, { txt: amt.toFixed(1), z: t.z + 70 });
  if (src && src.isFighter) { t.lastHitBy = src.owner || src; t.lastHitT = G.t; }
  Sfx.play(t === G.human ? 'hurt' : 'hit', t.x, t.y, t.z);
  if (t.hp <= 0) killFighter(t, src);
  return true;
}
// Fall and trap damage ignores armour; a recent attacker gets credit for knocking you off.
function hurtRaw(t, amt, src) {
  if (!t.alive || t.invuln > 0) return;
  if (t.remote) { NET.hit(t, { d: +amt.toFixed(2), raw: 1, by: srcId(src) }); return; }
  t.hp -= amt; t.hurtT = 0.25; t.gather = null; t.hidden = false;
  noteDamage(t, src, amt);
  if (G.settings.dmgNums) addFx('num', t.x, t.y, t.layer, { txt: amt.toFixed(1), z: t.z + 70 });
  if (t.hp <= 0) killFighter(t, src || (G.t - t.lastHitT < 8 ? t.lastHitBy : null));
}
// Who's hurt this fighter lately, for assists (kept on the victim's own machine, which sees every hit)
function noteDamage(t, src, amt) {
  const s = src && src.isFighter ? (src.owner || src) : null;
  if (!s || s === t || t.isClone) return;
  const m = t.dmgBy || (t.dmgBy = new Map()), p = m.get(s);
  m.set(s, { d: (p && G.t - p.t < 15 ? p.d : 0) + amt, t: G.t });
}
// A hit another player's machine sent us, for a fighter we simulate.
function applyHit(t, m) {
  if (!t.alive) return;
  const src = m.by ? fighterById(m.by) : null;
  if (m.nofall) { t.noFallT = m.nofall; if (t === G.human) toast('You won the duel: you’ll land safely'); }
  if (src) { t.lastHitBy = src; t.lastHitT = G.t; }
  if (m.shrink) shrinkNow(t);
  if (m.tp && t.bike) dismountBike(t, true);
  if (m.tp) Object.assign(t, { x: m.tp[0], y: m.tp[1], z: m.tp[2], vz: 0, onGround: false, peakZ: m.tp[2], kbx: 0, kby: 0, gather: null });
  if (m.pull) {
    t.kbx = Math.cos(m.pull[0]) * m.pull[1]; t.kby = Math.sin(m.pull[0]) * m.pull[1]; t.gather = null; t.hidden = false;
    if (m.pull[2]) jump(t, m.pull[2]);
  }
  if (m.d) { if (m.raw) hurtRaw(t, m.d, src); else hurt(t, m.d, src, m.a || 0, m.kb || 0, m.up || 0); }
  if (m.jinx) shuffleHotbar(t);
  if (m.poison) { t.poisonT = m.poison; t.poisonBy = src; }
  if (m.slow) t.slowT = Math.max(t.slowT || 0, m.slow);
}
function killFighter(t, src) {
  if (t.deadDone) return;
  if (t.bike) dismountBike(t, true); // the bike rolls on without you
  t.alive = false; t.hp = 0; t.deadDone = true;
  let killer = src && src.isFighter && (src.owner || src) !== t ? (src.owner || src) : null;
  if (!killer && t.lastHitBy && G.t - t.lastHitT < 8) killer = t.lastHitBy;
  if (t.isClone) return;
  dropStacks(t, allStacks(t), 'bag');
  addFx('puff', t.x, t.y, t.layer, { col: t.color, big: true, z: t.z + 30 });
  // Assists: anyone else who did 2+ damage in the last 15 seconds
  const assists = [...(t.dmgBy || [])].filter(([s, v]) => s !== killer && s.alive !== undefined && !s.isClone && G.t - v.t < 15 && v.d >= 2).map(([s]) => s);
  announceKill(t, killer, t.fellLast, assists);
  NET.kill(t, killer, t.fellLast, assists);
}
// Shared by local deaths and deaths reported over the network
function announceKill(t, killer, fell, assists = []) {
  t.alive = false;
  if (killer) {
    if (!killer.remote) killer.kills++;
    if (!killer.remote && killer.kit === 'leech' && killer.alive) killer.hp = Math.min(killer.maxHp, killer.hp + 8);
    if (killer === G.human) { G.coinsEarned += 50; Sfx.play('kill'); toast(`You eliminated ${t.name}`); G.killFlash = 0.6; }
  }
  const how = fell || t.diedTo === 'pitfall' ? 'fell' : t.diedTo === 'lava' ? 'burned' : t.diedTo === 'crash' ? 'crashed' : 'died';
  const help = assists.length ? ` + ${assists.map(a => a.name).join(', ')}` : '';
  G.feed.unshift({ txt: killer ? `${killer.name}${help} ⟶ ${t.name}` : `${t.name} ${how}${help ? ` (${help.slice(3)} helped)` : ''}`, t: 7, you: t === G.human || killer === G.human || assists.includes(G.human) });
  if (assists.includes(G.human) && t !== G.human) { G.coinsEarned += 20; if (G.stats) G.stats.assists = (G.stats.assists || 0) + 1; toast(`Assist on ${t.name} · +20 coins`); }
  if (killer) streakCallout(killer, t, fell);
  if (killer && killer.bot) botSay(killer, 'kill', t);
  if (t.bot) botSay(t, 'die', killer);
  if (t === G.human && killer) noteRival(killer);
  if (killer === G.human && t.rival) beatRival(t);
  if (G.bounty === t) claimBounty(t, killer);
  if (t === G.human) { G.killer = killer; G.killedBy = killer ? killer.name : fell ? 'a long fall' : { lava: 'lava', pitfall: 'a pitfall', crash: 'a motorcycle crash', bike: 'an exploding motorcycle' }[t.diedTo] || 'the pit'; endGame(false); }
  checkWin();
}
// Kill streaks and special kills: everyone sees them in the feed, and your own get a callout and 25 coins
const MULTI = ['', '', 'Double kill', 'Triple kill', 'Quadra kill', 'Rampage'];
const SPREE = { 3: 'Killing spree', 5: 'Rampage', 8: 'Unstoppable', 12: 'Legendary' };
function streakCallout(k, t, fell) {
  k.streak = (k.streak || 0) + 1;
  k.multi = G.t - (k.lastKillT ?? -99) < 10 ? (k.multi || 1) + 1 : 1;
  k.lastKillT = G.t;
  const calls = [];
  if (k.multi >= 2) calls.push(MULTI[Math.min(5, k.multi)]);
  if (SPREE[k.streak]) calls.push(`${SPREE[k.streak]}: ${k.streak} kills`);
  if (t.diedTo === 'pitfall') calls.push('Pitfall');
  else if (t.diedTo === 'ram') calls.push('Road kill');
  else if (t.diedTo === 'bike') calls.push('Wrecked');
  else if (fell) calls.push('Knocked off');
  else if (t.diedTo === 'lava') calls.push('Burned');
  else if (hyp(k.x - t.x, k.y - t.y) > 750) calls.push('Long shot');
  if (!calls.length) return;
  G.feed.unshift({ txt: `${k.name}: ${calls.join(' · ')}`, t: 6, you: k === G.human, streak: true });
  if (k === G.human) {
    showStreak(calls[0], calls.slice(1).join(' · '));
    if (k.multi >= 2 || SPREE[k.streak]) G.coinsEarned += 25;
  }
}
// Allies (bots that have teamed up) don't hurt each other
const allied = (a, b) => !!(a && b && a.team && a.team === b.team);
function checkWin() {
  const alive = G.fighters.filter(f => f.alive && !f.isClone);
  if (alive.length !== 1) return;
  if (!NET.on) {
    if (G.human.alive) endGame(true);
    else if (!G.winShown) { G.winShown = true; banner(`${alive[0].name} wins`, 'Last one standing.'); }
  }
  else if (NET.isHost()) NET.end(alive[0]);
}
function hitRat(rat, dmg, src, ang) {
  rat.hp -= dmg; rat.kbx += Math.cos(ang) * 260; rat.kby += Math.sin(ang) * 260;
  if (rat.hp <= 0) {
    rat.dead = true;
    G.items.push({ id: 'l' + (++G.itemSeq), kind: 'drop', local: true, x: rat.x, y: rat.y, z: 0, layer: 1, stacks: [{ id: 'hide', n: 1 }] });
    // The squeal gives you away: everyone gets a ping on this spot (unless you wear the Rat King's Crown)
    if (!(src && wears(src.owner || src, 'crown'))) {
      G.pings.push({ x: rat.x, y: rat.y, layer: 1, t: 12, src });
      NET.fx({ k: 'ping', x: Math.round(rat.x), y: Math.round(rat.y) });
    }
    addFx('puff', rat.x, rat.y, 1, { col: '#8a7a6a', z: 6 });
    Sfx.play('squeak', rat.x, rat.y, 0);
  }
}

// ---- actions ----
function swing(f, armed = true) {
  if (f.atkCd > 0) return false;
  const tier = armed ? f.weapon : 0, maul = tier === 5, big = f.size || 1, titan = isTitan(f);
  f.atkCd = maul ? 0.62 : 0.28; f.swingT = 0.14; f.swings++; f.hidden = false;
  noise(f.x, f.y, f.layer, 320, f);
  let dmg = WDMG[tier] + (f.kit === 'killer' ? 1 : 0) + (titan ? 1.5 : 0);
  const punching = f.punchT > 0;
  if (punching) dmg += 8;
  const reach = f.r + 44 * big, kb = (maul ? 720 : 300) * (titan ? 1.8 : 1);
  let hit = false;
  for (const t of G.fighters) {
    if (t === f || !t.alive || t.layer !== f.layer || t.owner === f || allied(t, f)) continue;
    if (t.z - f.z > 50 * big || f.z - t.z > 50 * (t.size || 1)) continue;
    const a = Math.atan2(t.y - f.y, t.x - f.x);
    if (hyp(t.x - f.x, t.y - f.y) - t.r < reach && Math.abs(angDiff(f.face, a)) < 1.0 && hurt(t, dmg, f, a, kb, maul ? 400 : 0)) {
      hit = true;
      if (!t.isClone) { f.lastVictim = t; f.lastVictimT = G.t; }
      if (f.kit === 'leech') f.hp = Math.min(f.maxHp, f.hp + dmg * 0.15);
      if (f.kit === 'blight' && !t.isClone && rng() < 0.33) {
        const m = rng() < 0.5 ? { poison: 4, by: f.id } : { slow: 1.6, by: f.id };
        if (t.remote) NET.hit(t, m); else applyHit(t, m);
        addFx('ring', t.x, t.y, t.layer, { col: m.poison ? '#7bd04a' : '#8fa3a8', z: t.z + 30 });
      }
    }
  }
  // Rats are small: you have to actually aim at them
  if (f.layer === 1) for (const rat of G.rats) {
    const a = Math.atan2(rat.y - f.y, rat.x - f.x);
    if (!rat.dead && hyp(rat.x - f.x, rat.y - f.y) - 7 < reach && Math.abs(angDiff(f.face, a)) < 0.45) { hitRat(rat, WDMG[tier] + 1, f, a); hit = true; }
  }
  if (punching && hit) { f.punchT = 0; addFx('ring', f.x, f.y, f.layer, { col: '#f0b43c', z: f.z + 2 }); }
  if (f === G.human || hyp(f.x - G.human.x, f.y - G.human.y) < 300) Sfx.play('swing', f.x, f.y, f.z);
  f.gather = null;
  return hit;
}
const flaskReady = s => !!s && s.id === 'everflask' && !(s.ready > G.t);
function drink(f) {
  if (f.drinkCd > 0 || f.hp >= f.maxHp) return false;
  let i = heldId(f) === 'pot' || flaskReady(f.slots[f.sel]) ? f.sel : -1;
  if (i < 0) for (let k = 0; k < HOTBAR; k++) if (f.slots[k] && f.slots[k].id === 'pot') { i = k; break; }
  if (i < 0) for (let k = 0; k < HOTBAR; k++) if (flaskReady(f.slots[k])) { i = k; break; }
  if (i < 0) return false;
  if (f.slots[i].id === 'everflask') f.slots[i].ready = G.t + 25; // refills instead of being used up
  else f.slots[i] = null;
  bump(f); f.drinkCd = 0.2; f.hp = Math.min(f.maxHp, f.hp + 7);
  if (f === G.human && G.stats) G.stats.pots++;
  addFx('ring', f.x, f.y, f.layer, { col: '#e0506a', z: f.z + 2 });
  Sfx.play('drink', f.x, f.y, f.z);
  return true;
}
function spawnProj(p, ghost) {
  G.proj.push(p);
  if (!ghost) NET.fx({ k: 'p', t: p.kind, o: p.owner.id, l: p.layer, v: [p.x, p.y, p.z, p.vx, p.vy, p.vz].map(Math.round) });
}
function shoot(f, charge, pitch = 0) {
  if (!f.bow || !take(f, 'arrow', 1)) return;
  const s = 420 + 560 * charge, c = Math.cos(pitch);
  noise(f.x, f.y, f.layer, 480, f);
  spawnProj({ kind: 'arrow', x: f.x, y: f.y, z: f.z + 46, vx: Math.cos(f.face) * s * c, vy: Math.sin(f.face) * s * c, vz: Math.sin(pitch) * s, owner: f, layer: f.layer, life: 2, dmg: 0.8 + charge * 1.4, kb: 150 + 380 * charge });
  Sfx.play('shoot', f.x, f.y, f.z);
}
function useKit(f, ax, ay) {
  const K = KITS[f.kit];
  if (!K.item || f.kitCd > 0 || (K.uses && f.uses <= 0) || f.bike) return false;
  const aim = Math.atan2(ay - f.y, ax - f.x);
  switch (f.kit) {
    case 'mage': {
      let e = null, ed = 600;
      for (const o of G.fighters) if (o !== f && o.alive && o.layer === f.layer && !o.isClone && !resists(o) && hyp(o.x - f.x, o.y - f.y) < ed) { e = o; ed = hyp(o.x - f.x, o.y - f.y); }
      if (!e || !pvpOn()) return false;
      addFx('ring', e.x, e.y, e.layer, { col: '#9d7cf0', z: e.z + 2 });
      // Arrive next to the mage, slightly above: from a tower that means a long drop
      const tp = [f.x + Math.cos(f.face) * 36, f.y + Math.sin(f.face) * 36, f.z + 20].map(v => Math.round(v));
      if (e.remote) NET.hit(e, { tp, by: f.id });
      else applyHit(e, { tp, by: f.id });
      f.invuln = 2; addFx('ring', f.x, f.y, f.layer, { col: '#9d7cf0', big: true, z: f.z + 2 });
      break;
    }
    case 'jumper':
      f.onGround = true; jump(f, 620);
      f.kbx = Math.cos(aim) * 300; f.kby = Math.sin(aim) * 300; f.noFallT = 4;
      break;
    case 'runner': f.speedT = 3.5; break;
    case 'puncher': f.punchT = 6; f.uses--; break;
    case 'hidden':
      f.hidden = !f.hidden;
      f.disguise = f.layer ? 'rock' : [0, 3].includes(f.biome) ? 'bush' : f.biome === 1 ? 'cactus' : 'snowrock';
      addFx('puff', f.x, f.y, f.layer, { col: '#4f7a3f', z: f.z + 20 });
      break;
    case 'faker':
      f.uses--;
      for (const d of [-0.7, 0.7]) spawnClone(f, f.face + d);
      NET.fx({ k: 'c', o: f.id, f: +f.face.toFixed(2) });
      break;
    case 'lightning': {
      const d = Math.min(520, hyp(ax - f.x, ay - f.y));
      const x = f.x + Math.cos(aim) * d, y = f.y + Math.sin(aim) * d;
      addFx('strike', x, y, f.layer, { owner: f, t: 0.6 });
      NET.fx({ k: 's', x: Math.round(x), y: Math.round(y), l: f.layer });
      break;
    }
    case 'fisherman':
      spawnProj({ kind: 'hook', x: f.x, y: f.y, z: f.z + 44, vx: Math.cos(aim) * 820, vy: Math.sin(aim) * 820, vz: Math.sin(f.pitch || 0) * 820, owner: f, layer: f.layer, life: 0.6 });
      break;
    case 'trickster': {
      const p = f.pitch || 0, c = Math.cos(p);
      spawnProj({ kind: 'swap', x: f.x, y: f.y, z: f.z + 46, vx: Math.cos(aim) * 760 * c, vy: Math.sin(aim) * 760 * c, vz: Math.sin(p) * 760 + 60, owner: f, layer: f.layer, life: 1.6 });
      Sfx.play('shoot', f.x, f.y, f.z);
      break;
    }
    case 'jinx': {
      const t = nearestInFront(f, 100, 0.9);
      if (!t || !pvpOn()) return false;
      if (resists(t)) { if (f === G.human) toast(`${t.name} is a Bulwark: hexes don’t work`); return false; }
      if (t.remote) NET.hit(t, { jinx: 1, by: f.id }); else applyHit(t, { jinx: 1, by: f.id });
      addFx('ring', t.x, t.y, t.layer, { col: '#b670c9', big: true, z: t.z + 30 });
      if (f === G.human) toast(`Hexed ${t.name}: their hotbar is scrambled`);
      break;
    }
    case 'duelist': {
      const t = nearestInFront(f, 110, Math.PI);
      if (!t || !pvpOn() || f.layer) return false;
      if (resists(t)) { if (f === G.human) toast(`${t.name} is a Bulwark: duels don’t work`); return false; }
      startDuel(f, t);
      break;
    }
    case 'sapper': {
      const a = f === G.human ? G.aim : f.sapTarget;
      if (!a || f.layer) return false;
      if (!sapColumn(a.i, a.k)) { if (f === G.human) toast('Aim at a block to bring its column down'); return false; }
      f.uses--;
      break;
    }
    case 'titan':
      if (f.layer) { if (f === G.human) toast('There’s no room to grow down here'); return false; }
      if (inDuel(f)) { if (f === G.human) toast('You can’t grow inside a duel arena'); return false; }
      if (!roomToGrow(f)) { if (f === G.human) toast('Not enough room to grow here'); return false; }
      f.titanT = TITAN_TIME;
      addFx('ring', f.x, f.y, f.layer, { col: '#e2733b', big: true, z: f.z + 2 });
      Sfx.play('grow', f.x, f.y, f.z);
      break;
    case 'shade': {
      const v = f.lastVictim;
      if (!v || !v.alive || G.t - f.lastVictimT > 10 || v.layer !== f.layer) { if (f === G.human) toast('Hit someone first, then blink behind them within 10 seconds'); return false; }
      addFx('puff', f.x, f.y, f.layer, { col: '#2a2440', z: f.z + 30 });
      Object.assign(f, { x: v.x - Math.cos(v.face) * 32, y: v.y - Math.sin(v.face) * 32, z: v.z + 2, vz: 0, onGround: false, peakZ: v.z + 2, kbx: 0, kby: 0, face: v.face });
      addFx('puff', f.x, f.y, f.layer, { col: '#2a2440', z: f.z + 30 });
      break;
    }
  }
  if (K.cd) f.kitCd = K.cd * (f.bot ? botLvl().kitCd : 1); // easy bots use their kits less often
  if (K.uses) f.kitCd = 0.5;
  return true;
}
// Skyhook: grapple to whatever the crosshair is on, up to 22 blocks away
function fireSkyhook(f, pitch) {
  if (f.skyCd > 0 || f.layer || f.bike) return false;
  const cp = Math.cos(pitch), eye = f.z + EYE * (f.size || 1), dx = Math.cos(f.face) * cp, dy = Math.sin(f.face) * cp, dz = Math.sin(pitch);
  const a = rayPick(f.x, f.y, eye, dx, dy, dz, 550);
  if (!a) return false;
  const x = f.x + dx * a.t, y = f.y + dy * a.t, z = eye + dz * a.t;
  f.hook = { x, y, z, t: 1.4, best: 1e9, stuck: 0 };
  f.skyCd = 6; f.gather = null;
  addFx('rope', x, y, 0, { owner: f, t: 1.4, az: z });
  NET.fx({ k: 'rope', o: f.id, a: [x, y, z].map(Math.round) });
  Sfx.play('shoot', f.x, f.y, f.z);
  return true;
}
// Who took a legendary: everyone hears about it
function relicTaken(f, it) {
  const s = it.stacks.find(s => ITEMS[s.id].legendary);
  if (!s) return;
  announceRelic(f, s.id);
  NET.fx({ k: 'relic', o: f.id, i: s.id });
}
function announceRelic(f, id) {
  if (!f || !ITEMS[id]) return;
  G.feed.unshift({ txt: `${f.name} took the ${ITEMS[id].name}`, t: 12, you: f === G.human, relic: true });
  if (f === G.human) banner(ITEMS[id].name, ITEMS[id].desc); else toast(`${f.name} has the ${ITEMS[id].name}`);
}
function nearestInFront(f, range, cone) {
  let best = null, bd = range;
  for (const o of G.fighters) {
    if (o === f || !o.alive || o.isClone || o.layer !== f.layer || Math.abs(o.z - f.z) > 60 * (f.size || 1)) continue;
    const d = hyp(o.x - f.x, o.y - f.y);
    if (d < bd && Math.abs(angDiff(f.face, Math.atan2(o.y - f.y, o.x - f.x))) < cone) { bd = d; best = o; }
  }
  return best;
}
// Jinx: swap every hotbar slot with a random backpack slot
function shuffleHotbar(t) {
  if (!t.slots) return;
  for (let i = 0; i < HOTBAR; i++) { const j = HOTBAR + Math.floor(Math.random() * (SLOTS - HOTBAR)); [t.slots[i], t.slots[j]] = [t.slots[j], t.slots[i]]; }
  bump(t); t.charge = -1;
  if (t === G.human) toast('You’ve been hexed: your hotbar is scrambled (Tab to fix it)');
}
// Trickster: trade places
function swapPlaces(o, t) {
  if (o.bike) dismountBike(o, true);
  const op = [o.x, o.y, o.z], layer = t.layer;
  Object.assign(o, { x: t.x, y: t.y, z: t.z, layer, vz: 0, onGround: false, peakZ: t.z, kbx: 0, kby: 0, gather: null });
  const m = { tp: op.map(Math.round), by: o.id };
  if (t.remote) NET.hit(t, m); else applyHit(t, m);
  addFx('puff', o.x, o.y, o.layer, { col: '#e8f4ff', z: o.z + 30 }); addFx('puff', op[0], op[1], o.layer, { col: '#e8f4ff', z: op[2] + 30 });
}
// Titans need clear space above and around them: a roof or the duel cage would trap them
const inDuel = f => (G.duels || []).some(d => d.a === f || d.b === f);
function roomToGrow(f) {
  const r = 13 * TITAN_SIZE;
  for (let i = Math.floor((f.x - r) / B); i <= Math.floor((f.x + r) / B); i++)
    for (let k = Math.floor((f.y - r) / B); k <= Math.floor((f.y + r) / B); k++)
      for (let j = Math.floor((f.z + STEP) / B); j <= Math.floor((f.z + FH * TITAN_SIZE) / B); j++)
        if (solidAt(i, j, k)) return false;
  return true;
}
// Back to normal size at once (a duel is starting)
function shrinkNow(f) { f.titanT = 0; f.size = 1; f.r = 13; }
// Duelist: a glass box in the sky around both fighters. The duelist's machine removes it when the duel ends.
// Titans shrink straight away: the box is only 4 blocks tall inside.
function startDuel(f, t) {
  shrinkNow(f);
  if (f.bike) dismountBike(f, true);
  const cx = (f.x + t.x) / 2, cy = (f.y + t.y) / 2, ci = Math.floor(cx / B), ck = Math.floor(cy / B);
  const base = Math.floor(Math.max(heightAt(cx, cy), f.z, t.z) / B) + 16, cells = [];
  for (let di = -3; di <= 3; di++) for (let dk = -3; dk <= 3; dk++) for (let j = base; j <= base + 5; j++) {
    if (Math.abs(di) === 3 || Math.abs(dk) === 3 || j === base || j === base + 5) cells.push([ci + di, j, ck + dk]);
  }
  for (const [i, j, k] of cells) setArena(i, j, k);
  const floor = (base + 1) * B;
  Object.assign(f, { x: (ci - 1.5) * B, y: (ck + .5) * B, z: floor, vz: 0, onGround: false, peakZ: floor, kbx: 0, kby: 0 });
  const m = { tp: [Math.round((ci + 2.5) * B), Math.round((ck + .5) * B), floor], by: f.id, shrink: 1 };
  if (t.remote) NET.hit(t, m); else applyHit(t, m);
  G.duels = G.duels || [];
  G.duels.push({ owner: f, a: f, b: t, cells, t: 45 });
  if (f === G.human || t === G.human) banner('Duel', `${f.name} vs ${t.name} · 45 seconds, then the floor goes`);
}
function updateDuels(dt) {
  for (const d of G.duels || []) {
    if (d.owner.remote && d.owner.alive) continue; // the duelist's own machine ends it
    d.t -= dt;
    if (d.t <= 0 || !d.a.alive || !d.b.alive) {
      // A winner is lowered safely; if time runs out, both fall
      const winner = d.a.alive && !d.b.alive ? d.a : d.b.alive && !d.a.alive ? d.b : null;
      if (winner) { if (winner.remote) NET.hit(winner, { nofall: 6 }); else applyHit(winner, { nofall: 6 }); }
      else if (d.a === G.human || d.b === G.human) toast('Time’s up: the arena floor is gone');
      for (const [i, j, k] of d.cells) if (blockAt(i, j, k)) breakBlock(i, j, k, null);
      d.done = true;
    }
  }
  if (G.duels) G.duels = G.duels.filter(d => !d.done);
}
function spawnClone(f, dir) {
  const c = new Fighter(f.name, 'killer', true, f.id + '~' + Math.random().toString(36).slice(2, 6));
  Object.assign(c, { isClone: true, owner: f, x: f.x, y: f.y, z: f.z, layer: f.layer, color: f.color, life: 9, cdir: dir, bot: true, remote: false });
  G.fighters.push(c);
}
function toggleLayer(f) {
  const e = world.entrances.find(e => hyp(e.x - f.x, e.y - f.y) < 46);
  if (!e || G.pit || !f.onGround || f.bike) return false;
  if (!f.layer && f.z > heightAt(e.x, e.y) + 20) return false;
  if ((f.size || 1) > 1.2) { if (f === G.human) toast('You’re too big to fit down the tunnel'); return false; }
  f.layer = 1 - f.layer; f.x = e.x; f.y = e.y; f.z = f.layer ? 0 : heightAt(e.x, e.y); f.vz = 0; f.onGround = true;
  f.kbx = f.kby = 0; f.gather = null; f.path = null;
  return true;
}
function gatherTarget(f) {
  if (f.layer === 1) return world.ores.find(o => o.amt > 0 && hyp(o.x - f.x, o.y - f.y) < o.r + f.r + 22);
  if (f.z > heightAt(f.x, f.y) + 30) return null;
  return nearObjs(f.x, f.y, 60).find(o => o.amt > 0 && hyp(o.x - f.x, o.y - f.y) < o.r + f.r + 18);
}
function gatherTime(f, o) {
  if (o.kind === 'tree') return f.kit === 'cutter' ? 0.3 : 1.2;
  if (o.kind === 'rock') return 1.5;
  if (o.kind === 'reed') return 0.5;
  return 2.6; // iron is slow on purpose
}
function addFx(kind, x, y, layer, o = {}) { G.fx.push({ kind, x, y, layer, t: o.t || (kind === 'num' ? 0.8 : 0.5), max: o.t || (kind === 'num' ? 0.8 : 0.5), ...o }); }

// Tripwire's blast trap: blows apart blocks nearby and launches everyone close
function detonate(i, j, k, owner) {
  const x = (i + .5) * B, y = (k + .5) * B, z = j * B;
  if (blockAt(i, j, k)) breakBlock(i, j, k, null);
  for (let di = -2; di <= 2; di++) for (let dj = -1; dj <= 2; dj++) for (let dk = -2; dk <= 2; dk++) {
    const b = blockAt(i + di, j + dj, k + dk);
    if (b && !BLOCKS[b.type].unbreakable && di * di + dk * dk + dj * dj <= 6) breakBlock(i + di, j + dj, k + dk, null);
  }
  for (const t of G.fighters) {
    if (!t.alive || t.layer !== 0 || t.isClone || hyp(t.x - x, t.y - y) > 75 || Math.abs(t.z - z) > 80) continue;
    if (owner && t === owner) continue;
    hurt(t, 5, owner || null, Math.atan2(t.y - y, t.x - x), 480, 330);
  }
  addFx('puff', x, y, 0, { col: '#e2733b', big: true, z: z + 20 }); addFx('bolt', x, y, 0, { t: 0.2 });
  noise(x, y, 0, 900, owner);
  NET.fx({ k: 'boom', x: Math.round(x), y: Math.round(y), z: Math.round(z) });
  Sfx.play('bolt', x, y, z);
}
// Landing: fall damage, hay bales, feather charms and the Faller kit
function land(f, fall, onType) {
  const blocks = fall / B;
  if (f === G.human && G.stats) G.stats.fall = Math.max(G.stats.fall, blocks);
  if (blocks > 1.5) addFx('ring', f.x, f.y, f.layer, { col: '#d9c7a8', z: f.z + 1 });
  // Landing in water: no damage, however far you fell
  const wet = liquidAt(f);
  if (wet && wet.type === 'water') {
    if (blocks > 3.5) {
      addFx('ring', f.x, f.y, f.layer, { col: '#9fd6ff', big: true, z: f.z + 2 });
      Sfx.play('splash', f.x, f.y, f.z);
      if (f === G.human) toast(blocks > 8 ? `Water bucket clutch! ${Math.round(blocks)} blocks, no damage` : 'The water broke your fall');
    }
    return;
  }
  if (isTitan(f)) { if (fall > 30) titanStomp(f); return; } // Titans never take fall damage
  const dmg = Math.max(0, blocks - 3.5);
  if (dmg <= 0 || wears(f, 'boots_wind')) return;
  Sfx.play('fall', f.x, f.y, f.z);
  if (onType === 'hay' || f.noFallT > 0) { if (f === G.human) toast(onType === 'hay' ? 'The hay bale broke your fall' : 'Safe landing: no damage'); return; }
  if (f.kit === 'faller') {
    const v = G.fighters.find(o => o !== f && o.alive && !o.isClone && o.layer === f.layer && hyp(o.x - f.x, o.y - f.y) < 40 && Math.abs(o.z - f.z) < 30);
    if (v) {
      if (!(v.remote ? v.net.sn : v.sneak)) {
        addFx('ring', v.x, v.y, v.layer, { col: '#e2733b', big: true, z: v.z + 2 });
        if (f === G.human) toast(`Your fall hit ${v.name} for ${dmg.toFixed(1)}`);
        if (pvpOn()) { v.fellLast = true; hurtRaw(v, dmg * 1.2, f); }
        return;
      }
      if (f === G.human) toast(`${v.name} was sneaking. You took the fall.`);
    }
  }
  if (dmg >= 3 && take(f, 'charm', 1)) { if (f === G.human) toast('Feather Charm used up: fall damage blocked'); return; }
  f.fellLast = true;
  if (f === G.human) toast(`Fell ${Math.round(blocks)} blocks: −${dmg.toFixed(1)} health`);
  hurtRaw(f, dmg, null);
  if (f.alive) f.fellLast = false;
}
// Pitfall: the trapdoor gives way. You drop chest-deep into a hole, take a hit and can't get out for 2.5 seconds.
function fallInPit(f, tr) {
  const owner = fighterById(tr.b.owner), x = (tr.i + .5) * B, y = (tr.k + .5) * B;
  breakBlock(tr.i, tr.j, tr.k, null);
  Object.assign(f, { pitT: 2.5, gather: null, kbx: 0, kby: 0, hidden: false, x, y });
  addFx('hole', x, y, 0, { t: 6, z: f.z + 0.6 });
  NET.fx({ k: 'hole', x: Math.round(x), y: Math.round(y), z: Math.round(f.z) });
  Sfx.play('fall', x, y, f.z);
  if (f === G.human) toast('You fell into a pitfall! Stuck for a moment');
  else if (owner === G.human) toast(`${f.name} fell into your pitfall`);
  if (pvpOn() || !owner) { f.diedTo = 'pitfall'; hurtRaw(f, 3, owner); if (f.alive) f.diedTo = null; }
}
// Titan landing: a shockwave that throws everyone nearby
function titanStomp(f) {
  addFx('ring', f.x, f.y, f.layer, { col: '#c9a26a', big: true, z: f.z + 1 });
  addFx('puff', f.x, f.y, f.layer, { col: '#b8a488', big: true, z: f.z + 6 });
  Sfx.play('stomp', f.x, f.y, f.z);
  NET.fx({ k: 'stomp', x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z) });
  for (const t of G.fighters) {
    if (t === f || !t.alive || t.layer !== f.layer || t.owner === f || Math.abs(t.z - f.z) > 40) continue;
    if (hyp(t.x - f.x, t.y - f.y) < 100) hurt(t, 2.5, f, Math.atan2(t.y - f.y, t.x - f.x), 480, 320);
  }
}

// ---- buckets ----
// The empty bucket in `slot` (or the first one found) becomes a full one
function fillBucket(f, type, slot) {
  const i = f.slots[slot] && f.slots[slot].id === 'bucket' ? slot : f.slots.findIndex(s => s && s.id === 'bucket');
  if (i < 0) return false;
  const s = f.slots[i], id = 'bucket_' + type;
  if (s.n === 1) f.slots[i] = { id, n: 1 };
  else { s.n--; const l = give(f, id, 1); if (l) dropStacks(f, [{ id, n: 1 }]); }
  bump(f);
  Sfx.play(type === 'lava' ? 'sizzle' : 'splash', f.x, f.y, f.z);
  return true;
}
// Pour the full bucket in `slot` into cell (i, j, k); it goes back to being an empty bucket
function pourBucket(f, slot, i, j, k) {
  const s = f.slots[slot], type = s && ITEMS[s.id].bucket;
  if (!type || !pourLiquid(f, type, i, j, k)) return false;
  f.slots[slot] = { id: 'bucket', n: 1 }; bump(f);
  if (f === G.human && G.stats) G.stats.pours = (G.stats.pours || 0) + 1;
  return true;
}

// Water puts fires out; lava sets you on fire (poured lava only burns other people once PvP is on)
function touchLiquid(f) {
  const liq = f.isClone ? null : liquidAt(f);
  f.inLiq = liq ? liq.type : null;
  if (f.inLiq === 'water') f.burnT = 0;
  else if (f.inLiq === 'lava') {
    const by = liq.owner ? fighterById(liq.owner) : null;
    if (!liq.owner || liq.owner === f.id || pvpOn()) {
      if (!(f.burnT > 0) && f === G.human) toast('You’re in lava! Get out');
      f.burnT = 3; f.burnBy = by && by !== f ? by : null;
    }
  }
}
// Burning: fast damage in lava, slower once you're out, until it wears off (water puts it out)
function burnTick(f, dt) {
  if (!(f.burnT > 0)) return;
  f.burnT -= dt; f.burnTick = (f.burnTick || 0) - dt;
  if (f.burnTick > 0) return;
  const inLava = f.inLiq === 'lava';
  f.burnTick = inLava ? 0.45 : 0.7;
  f.diedTo = 'lava';
  hurtRaw(f, inLava ? 1.5 : 0.5, f.burnBy);
  if (f.alive) { f.diedTo = null; addFx('puff', f.x, f.y, f.layer, { col: '#ff7a2a', z: f.z + 20 + Math.random() * 30 }); }
}

// ---- per-frame physics for a fighter we simulate ----
function updateFighter(f, dt) {
  for (const k of ['atkCd', 'kitCd', 'invuln', 'speedT', 'hurtT', 'swingT', 'punchT', 'drinkCd', 'slowT', 'spikeCd', 'noFallT', 'skyCd', 'titanT', 'pitT']) if (f[k] > 0) f[k] -= dt;
  // Titan: grow and shrink smoothly; the collision circle grows too
  const want = f.titanT > 0 && !f.layer ? TITAN_SIZE : 1;
  if (f.size !== want) {
    f.size += (want - f.size) * Math.min(1, dt * 6);
    if (Math.abs(f.size - want) < 0.02) { f.size = want; if (want === 1 && f === G.human) toast('You shrink back to normal size'); }
    f.r = 13 * f.size;
  }
  f.biome = f.layer ? -1 : biomeAt(f.x, f.y);
  let sp = f.layer ? 165 : [190, 185, 172, 150][f.biome];
  if (isTitan(f)) sp *= 1.25;
  if (f.inLiq === 'water') sp *= 0.7; else if (f.inLiq === 'lava') sp *= 0.5;
  if (f.kit === 'yeti' && f.biome === 2) sp = 235;
  if (f.kit === 'bogwalker' && f.biome === 3) { sp = 225; if (f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + 0.45 * dt); }
  if (f.poisonT > 0) {
    f.poisonT -= dt; f.poisonTick = (f.poisonTick || 0) - dt;
    if (f.poisonTick <= 0) { f.poisonTick = 0.8; hurtRaw(f, 0.5, f.poisonBy); }
  }
  // On a motorcycle, the bike does the moving (bikes.js)
  if (f.bike) { rideBike(f, dt); burnTick(f, dt); return; }
  if (f.speedT > 0) sp *= 1.8;
  if (f.sneak) sp *= 0.35;
  if (f.slowT > 0) sp *= 0.45;
  if (f.charge >= 0) { sp *= 0.55; f.charge = Math.min(1, f.charge + dt / 0.8); }
  if (f.refillT > 0 || f.gather || f.pitT > 0) sp = 0;
  let mx = f.mx, my = f.my;
  const ml = hyp(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  if (f.hidden && ml > 0.1) f.hidden = false;
  if (f.hook) { // being reeled in by the Skyhook
    const k = f.hook, dx = k.x - f.x, dy = k.y - f.y, dz = k.z - (f.z + 30), d = Math.hypot(dx, dy, dz);
    k.t -= dt; k.stuck = d < k.best - 2 ? 0 : k.stuck + dt; k.best = Math.min(k.best, d);
    if (d < 34 || k.t <= 0 || k.stuck > 0.25 || f.layer) f.hook = null;
    else { f.kbx = dx / d * 760; f.kby = dy / d * 760; f.vz = dz / d * 760 + 40; f.onGround = false; f.peakZ = f.z; }
  }
  const fr = Math.exp(-(f.onGround ? 7 : 1.5) * dt);
  f.kbx *= fr; f.kby *= fr;
  let nx = f.x + (mx * sp + f.kbx) * dt, ny = f.y + (my * sp + f.kby) * dt;

  if (f.layer === 1) {
    if (walkUnder(nx, ny, f.r)) { f.x = nx; f.y = ny; }
    else if (walkUnder(nx, f.y, f.r)) { f.x = nx; f.kby *= 0.3; }
    else if (walkUnder(f.x, ny, f.r)) { f.y = ny; f.kbx *= 0.3; }
    else { f.kbx = f.kby = 0; }
    f.z = 0; f.vz = 0; f.onGround = true;
  } else {
    // Sneaking keeps you from walking off an edge
    if (f.sneak && f.onGround) {
      const ok = (x, y) => supportAt(x, y, f.z, f.r, 0) >= f.z - 6;
      if (!ok(nx, ny)) { if (ok(nx, f.y)) ny = f.y; else if (ok(f.x, ny)) nx = f.x; else { nx = f.x; ny = f.y; } }
    }
    f.x = nx; f.y = ny;
    if (f.z < heightAt(f.x, f.y) + 60) for (const o of nearObjs(f.x, f.y, 50)) {
      if (o.kind === 'reed' || (o.amt <= 0 && o.kind === 'tree')) continue;
      const d = hyp(f.x - o.x, f.y - o.y), m = o.r + f.r;
      if (d < m && d > 0.01) { f.x = o.x + (f.x - o.x) / d * m; f.y = o.y + (f.y - o.y) / d * m; }
    }
    collideBlocks(f);
    if (G.pit) {
      const d = hyp(f.x - PIT.x, f.y - PIT.y), m = PIT.r - f.r - 6;
      if (d > m) { f.x = PIT.x + (f.x - PIT.x) / d * m; f.y = PIT.y + (f.y - PIT.y) / d * m; }
    }
    f.x = clamp(f.x, 20, WORLD - 20); f.y = clamp(f.y, 20, WORLD - 20);
    // Ladders: climb while pushing into one (or holding jump); no fall damage builds up while on one
    if (ladderAt(f)) {
      f.peakZ = f.z;
      if (f.climb) { f.vz = 150; f.onGround = false; }
      else if (!f.onGround) f.vz = f.sneak ? GRAV * dt : Math.max(f.vz, -80);
    }
    // Water: sink slowly (no fall damage builds up), hold Space to swim up, and it puts fires out.
    // Lava: sets you on fire (poured lava only burns other people once PvP is on).
    touchLiquid(f);
    if (f.inLiq === 'water') {
      f.peakZ = f.z;
      if (f.glide) { f.vz = 170; f.onGround = false; }
      else if (!f.onGround) f.vz = Math.max(f.vz, -110);
    } else if (f.inLiq === 'lava' && !f.onGround) f.vz = Math.max(f.vz, -160);
    // Vertical: stand, step, fall, land
    const sup = supportAt(f.x, f.y, f.z, f.r, 0), supType = SUP_TYPE;
    if (f.onGround) {
      if (f.z - sup > 6) { f.onGround = false; f.vz = 0; f.peakZ = f.z; }
      else f.z = sup;
    }
    if (!f.onGround) {
      f.vz -= GRAV * dt;
      if ((f.bot || f.glide) && f.vz < -110 && wears(f, 'boots_wind')) f.vz = -110; // glide
      f.z += f.vz * dt;
      if (f.vz > 0) { const c = headBlocked(f); if (c !== null && f.z > c) { f.z = c; f.vz = 0; } }
      f.peakZ = Math.max(f.peakZ, f.z);
      if (f.z <= sup) { f.z = sup; f.vz = 0; f.onGround = true; land(f, f.peakZ - sup, supType); }
    }
    // Traps: spikes, blast traps and launch pads; snare turf gives way under anyone but its owner
    const tr = !f.isClone ? trapAt(f) : null, trap = tr && tr.b;
    if (trap && trap.type === 'pitfall') {
      if (trap.owner !== f.id && !(f.pitT > 0)) fallInPit(f, tr);
    } else if (trap && trap.type === 'pad') {
      if (f.onGround && !(f.padCd > G.t)) {
        f.padCd = G.t + 0.6; jump(f, 900);
        if (trap.owner === f.id) f.noFallT = 6;
        addFx('ring', f.x, f.y, 0, { col: '#4fb3a9', big: true, z: f.z + 2 }); Sfx.play('shoot', f.x, f.y, f.z);
      }
    } else if (trap && trap.owner !== f.id && f.spikeCd <= 0) {
      f.spikeCd = 0.9;
      if (trap.type === 'blast') detonate(tr.i, tr.j, tr.k, fighterById(trap.owner));
      else {
        f.slowT = 1.5;
        addFx('ring', f.x, f.y, 0, { col: '#c63d3d', z: f.z + 2 });
        Sfx.play('spike', f.x, f.y, f.z);
        if (f === G.human) toast('Spike trap!');
        if (pvpOn() || !trap.owner) hurtRaw(f, 4, fighterById(trap.owner));
      }
    }
    const turf = !f.isClone && turfUnder(f);
    if (turf) { breakBlock(turf[0], turf[1], turf[2], null); addFx('puff', f.x, f.y, 0, { col: '#6b8a4a', z: f.z + 10 }); if (f === G.human) toast('The ground gave way: Snare Turf!'); }
  }
  burnTick(f, dt);
  if (!f.alive) return;
  // Gathering: stand still next to a resource
  if (f.gather) {
    const o = f.gather;
    if (o.amt <= 0 || hyp(o.x - f.x, o.y - f.y) > o.r + f.r + 26) f.gather = null;
    else {
      f.gatherT += dt;
      if (f.bot) f.face = Math.atan2(o.y - f.y, o.x - f.x);
      if (f.gatherT >= gatherTime(f, o)) {
        f.gatherT = 0; o.amt--; NET.res(o);
        const mat = { tree: 'wood', rock: 'stone', ore: 'iron', reed: 'reed' }[o.kind];
        const n = mat === 'wood' && f.kit === 'cutter' && rng() < 0.5 ? 2 : 1;
        noise(f.x, f.y, f.layer, 240, f);
        const left = give(f, mat, n);
        if (left) { dropStacks(f, [{ id: mat, n: left }]); if (f === G.human) toast('Inventory full'); }
        addFx('chip', o.x, o.y, f.layer, { col: { wood: '#a4743f', stone: '#9aa0a3', iron: '#d9905a', reed: '#b9a95a' }[mat], z: f.z + 30 });
        if (f === G.human) Sfx.play('chop');
        if (o.amt <= 0) f.gather = null;
      }
    }
  }
  // Refill: move potions from the backpack into empty hotbar slots, one at a time
  if (f.refillT > 0) {
    f.refillT -= dt;
    if (f.refillT <= 0 && refillOne(f) && canRefill(f)) f.refillT = 0.22;
  }
}

// ---- ground items: potions, drops, death bags, feast chests ----
// The host (or a solo game) owns shared items and decides who picks them up.
function addItem(it) {
  if (NET.on && !NET.isHost()) { NET.dropReq(it); return; }
  it.id = 'i' + (++G.itemSeq);
  G.items.push(it);
  NET.itemAdd(it);
}
function removeItem(it, taker) { it.gone = true; if (!it.local) NET.itemRm(it, taker); }
function pickups() {
  const host = !NET.on || NET.isHost();
  for (const it of G.items) {
    if (it.gone) continue;
    if (!it.local && !host) continue;
    for (const f of G.fighters) {
      if (!f.alive || f.isClone || f.layer !== it.layer) continue;
      if (it.local && f.remote) continue;
      if (it.noPick === f.id && G.t < it.noPickT) continue;
      if (hyp(it.x - f.x, it.y - f.y) > f.r + 16 || Math.abs(it.z - f.z) > 40) continue;
      if (f.remote) { NET.got(f, it.stacks); removeItem(it, f); if (it.kind === 'relic') relicTaken(f, it); break; }
      const left = [];
      for (const s of it.stacks) { const l = give(f, s.id, s.n); if (l) left.push({ id: s.id, n: l }); }
      if (left.length === it.stacks.length && left.every((l, i) => l.n === it.stacks[i].n)) { if (f === G.human && !it.fullWarned) { toast('Inventory full'); it.fullWarned = true; } continue; }
      if (f === G.human) { Sfx.play('pickup'); pickupToast(it.stacks, left); }
      if (it.kind === 'relic' && !left.some(l => ITEMS[l.id].legendary)) { relicTaken(f, it); it.kind = 'chest'; }
      if (left.length) { it.stacks = left; if (!it.local) NET.itemUpd(it); }
      else removeItem(it, f);
      break;
    }
  }
}
function pickupToast(stacks, left) {
  const got = stacks.map(s => { const l = left.find(x => x.id === s.id); return { id: s.id, n: s.n - (l ? l.n : 0) }; }).filter(s => s.n > 0);
  if (!got.length) return;
  toast(got.length > 3 ? `Picked up ${got.length} kinds of items` : 'Picked up ' + got.map(s => `${s.n > 1 ? s.n + ' ' : ''}${itemName(s.id, G.human)}`).join(', '));
}

// ---- rats, projectiles, effects ----
function updateRats(dt) {
  G.rats = G.rats.filter(r => !r.dead);
  const under = G.fighters.filter(f => f.alive && f.layer === 1);
  if (G.rats.length < Math.round(34 * WORLD / 3200) && Math.random() < dt * 2) {
    const n = world.nodes[Math.floor(Math.random() * world.nodes.length)];
    if (!under.some(f => hyp(f.x - n.x, f.y - n.y) < 300))
      G.rats.push({ x: n.x, y: n.y, hp: 3, kbx: 0, kby: 0, node: world.nodes.indexOf(n), a: 0 });
  }
  const nest = world.landmarks.find(m => m.id === 'nest');
  const nestLive = nest && G.items.some(i => i.kind === 'relic' && i.layer === 1 && !i.gone);
  if (nestLive && G.rats.filter(r => r.guard).length < 5 && Math.random() < dt * 0.5)
    G.rats.push({ x: nest.x + (Math.random() - .5) * 30, y: nest.y + (Math.random() - .5) * 30, hp: 4, kbx: 0, kby: 0, node: nest.node, a: 0, guard: true, biteT: 0 });
  for (const r of G.rats) {
    if (r.guard) { // guards stay near the nest and bite anyone without the crown
      r.biteT -= dt; r.kbx *= Math.exp(-8 * dt); r.kby *= Math.exp(-8 * dt);
      let tgt = null, td = 170;
      for (const f of under) if (!f.remote && !wears(f, 'crown') && hyp(f.x - nest.x, f.y - nest.y) < 220) { const d = hyp(f.x - r.x, f.y - r.y); if (d < td) { td = d; tgt = f; } }
      let a, sp;
      if (tgt) { a = Math.atan2(tgt.y - r.y, tgt.x - r.x); sp = 130; if (td < 20 && r.biteT <= 0 && !(tgt.biteCd > G.t)) { r.biteT = 1.1; tgt.biteCd = G.t + 0.3; hurt(tgt, 0.6, null, a, 80); } }
      else { a = Math.atan2(nest.y - r.y, nest.x - r.x) + Math.sin(G.t * 4 + r.x) * 1.4; sp = hyp(nest.x - r.x, nest.y - r.y) > 60 ? 90 : 40; }
      r.a = a;
      const nx = r.x + (Math.cos(a) * sp + r.kbx) * dt, ny = r.y + (Math.sin(a) * sp + r.kby) * dt;
      if (walkUnder(nx, ny, 7)) { r.x = nx; r.y = ny; }
      continue;
    }
    let tn = world.nodes[r.node];
    if (hyp(tn.x - r.x, tn.y - r.y) < 14) { r.node = pick(tn.adj); tn = world.nodes[r.node]; }
    let a = Math.atan2(tn.y - r.y, tn.x - r.x) + Math.sin(G.t * 9 + r.x) * 0.8, sp = 85;
    for (const f of under) if (!wears(f, 'crown') && hyp(f.x - r.x, f.y - r.y) < 110) { a = Math.atan2(r.y - f.y, r.x - f.x) + Math.sin(G.t * 5) * 0.5; sp = 115; }
    r.a = a;
    r.kbx *= Math.exp(-8 * dt); r.kby *= Math.exp(-8 * dt);
    const nx = r.x + (Math.cos(a) * sp + r.kbx) * dt, ny = r.y + (Math.sin(a) * sp + r.kby) * dt;
    if (walkUnder(nx, ny, 7)) { r.x = nx; r.y = ny; } else r.node = pick(world.nodes[r.node].adj);
  }
}
function updateProj(dt) {
  for (const p of G.proj) {
    p.life -= dt;
    if (p.kind === 'arrow') p.vz -= 520 * dt;
    if (p.kind === 'swap') p.vz -= 700 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.layer === 1) { if (!walkUnder(p.x, p.y, 2) || p.z < 0 || p.z > 112) p.life = 0; }
    else {
      const g = heightAt(p.x, p.y);
      if (p.z < g) p.life = 0;
      else if (solidAt(Math.floor(p.x / B), Math.floor(p.z / B), Math.floor(p.y / B))) p.life = 0;
      else if (p.z < g + 90 && nearObjs(p.x, p.y, 30).some(o => o.amt > 0 && o.kind !== 'reed' && hyp(o.x - p.x, o.y - p.y) < o.r)) p.life = 0;
    }
    // Only the shooter's machine decides hits; everyone else just draws the arrow
    if (p.ghost || p.owner.remote) { for (const t of G.fighters) if (p.life > 0 && t !== p.owner && t.alive && t.layer === p.layer && hyp(t.x - p.x, t.y - p.y) < t.r + 5 && p.z > t.z - 4 && p.z < t.z + fh(t) + 4) p.life = 0; continue; }
    for (const t of G.fighters) {
      if (p.life <= 0 || t === p.owner || !t.alive || t.layer !== p.layer || t.owner === p.owner || allied(t, p.owner)) continue;
      if (hyp(t.x - p.x, t.y - p.y) < t.r + 5 && p.z > t.z - 4 && p.z < t.z + fh(t) + 4) {
        const a = Math.atan2(p.vy, p.vx);
        if (resists(t)) { addFx('ring', t.x, t.y, t.layer, { col: '#8fa3a8', z: t.z + 30 }); }
        else if (p.kind === 'arrow') hurt(t, p.dmg, p.owner, a, p.kb);
        else if (p.kind === 'swap') { if (pvpOn() && t.invuln <= 0 && !t.isClone) swapPlaces(p.owner, t); }
        else if (pvpOn() && t.invuln <= 0) {
          const o = p.owner, b = Math.atan2(o.y - t.y, o.x - t.x);
          const m = { pull: [+b.toFixed(2), 900, o.z > t.z + 20 ? 420 : 0], by: o.id };
          if (t.remote) NET.hit(t, m); else applyHit(t, m);
        }
        p.life = 0;
      }
    }
    if (p.kind === 'arrow' && p.layer === 1) for (const r of G.rats) if (!r.dead && p.life > 0 && hyp(r.x - p.x, r.y - p.y) < 10 && p.z < 16) { hitRat(r, 2, p.owner, Math.atan2(p.vy, p.vx)); p.life = 0; }
  }
  G.proj = G.proj.filter(p => p.life > 0);
}
function updateFx(dt) {
  for (const e of G.fx) {
    e.t -= dt;
    if (e.kind === 'rope' && e.owner && !e.owner.remote && !e.owner.hook) e.t = 0;
    if (e.kind === 'strike' && e.t <= 0 && !e.done) {
      e.done = true;
      if (!e.ghost) {
        noise(e.x, e.y, e.layer, 1000, e.owner);
        for (const t of G.fighters) if (t !== e.owner && t.alive && t.layer === e.layer && hyp(t.x - e.x, t.y - e.y) < 75) hurt(t, 5, e.owner, Math.atan2(t.y - e.y, t.x - e.x), 200);
        if (e.layer === 0) strikeBlocks(e.x, e.y, 60);
      }
      addFx('bolt', e.x, e.y, e.layer, { t: 0.35 });
      Sfx.play('bolt', e.x, e.y, 0);
    }
  }
  G.fx = G.fx.filter(e => e.t > 0);
  for (const p of G.pings) p.t -= dt;
  G.pings = G.pings.filter(p => p.t > 0);
  for (const k of G.feed) k.t -= dt;
  G.feed = G.feed.filter(k => k.t > 0).slice(0, 6);
}
