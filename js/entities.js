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
};
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
      sneak: false, slowT: 0, spikeCd: 0, noFallT: 0, lastHitT: -99, net: {},
      color: bot ? pick(COLORS) : '#f2ead6',
    });
    newInv(this);
    if (KITS[kit].item) this.slots[1] = { id: 'kit', n: 1 };
    if (kit === 'thrower') { this.slots[2] = { id: 'bow', n: 1 }; give(this, 'arrow', 12); }
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
  if (!f.onGround) return false;
  f.vz = v; f.onGround = false; f.peakZ = f.z;
  return true;
}
const srcId = s => s && s.isFighter ? (s.owner || s).id : null;
const fighterById = id => G.fighters.find(f => f.id === id && !f.isClone);

// ---- damage and death ----
function hurt(t, amt, src, ang, kb) {
  if (!t.alive || t.invuln > 0) return false;
  if (t.isFighter && src && src.isFighter && !pvpOn()) return false;
  if (t.isClone) { t.alive = false; addFx('puff', t.x, t.y, t.layer, { col: t.color, z: t.z + 30 }); return true; }
  if (t.remote) { NET.hit(t, { d: +amt.toFixed(2), a: +ang.toFixed(2), kb: Math.round(kb || 0), by: srcId(src) }); t.hurtT = 0.2; return true; }
  amt *= 1 - armorDef(t);
  t.hp -= amt; t.hurtT = 0.2; t.gather = null; t.refillT = 0; t.hidden = false;
  if (t.kit !== 'heavy' && kb) { t.kbx += Math.cos(ang) * kb; t.kby += Math.sin(ang) * kb; }
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
  if (G.settings.dmgNums) addFx('num', t.x, t.y, t.layer, { txt: amt.toFixed(1), z: t.z + 70 });
  if (t.hp <= 0) killFighter(t, src || (G.t - t.lastHitT < 8 ? t.lastHitBy : null));
}
// A hit another player's machine sent us, for a fighter we simulate.
function applyHit(t, m) {
  if (!t.alive) return;
  const src = m.by ? fighterById(m.by) : null;
  if (src) { t.lastHitBy = src; t.lastHitT = G.t; }
  if (m.tp) Object.assign(t, { x: m.tp[0], y: m.tp[1], z: m.tp[2], vz: 0, onGround: false, peakZ: m.tp[2], kbx: 0, kby: 0, gather: null });
  if (m.pull) {
    t.kbx = Math.cos(m.pull[0]) * m.pull[1]; t.kby = Math.sin(m.pull[0]) * m.pull[1]; t.gather = null; t.hidden = false;
    if (m.pull[2]) jump(t, m.pull[2]);
  }
  if (m.d) { if (m.raw) hurtRaw(t, m.d, src); else hurt(t, m.d, src, m.a || 0, m.kb || 0); }
}
function killFighter(t, src) {
  if (t.deadDone) return;
  t.alive = false; t.hp = 0; t.deadDone = true;
  let killer = src && src.isFighter && (src.owner || src) !== t ? (src.owner || src) : null;
  if (!killer && t.lastHitBy && G.t - t.lastHitT < 8) killer = t.lastHitBy;
  if (t.isClone) return;
  dropStacks(t, allStacks(t), 'bag');
  addFx('puff', t.x, t.y, t.layer, { col: t.color, big: true, z: t.z + 30 });
  announceKill(t, killer, t.fellLast);
  NET.kill(t, killer, t.fellLast);
}
// Shared by local deaths and deaths reported over the network
function announceKill(t, killer, fell) {
  t.alive = false;
  if (killer) {
    if (!killer.remote) killer.kills++;
    if (killer === G.human) G.coinsEarned += 50;
  }
  G.feed.unshift({ txt: killer ? `${killer.name} ⟶ ${t.name}` : `${t.name} ${fell ? 'fell' : 'died'}`, t: 7, you: t === G.human || killer === G.human });
  if (t === G.human) { G.killedBy = killer ? killer.name : fell ? 'a long fall' : 'the pit'; endGame(false); }
  checkWin();
}
function checkWin() {
  if (G.over && G.human && !G.human.alive) return;
  const alive = G.fighters.filter(f => f.alive && !f.isClone);
  if (alive.length !== 1) return;
  if (!NET.on) { if (G.human.alive) endGame(true); }
  else if (NET.isHost()) NET.end(alive[0]);
}
function hitRat(rat, dmg, src, ang) {
  rat.hp -= dmg; rat.kbx += Math.cos(ang) * 260; rat.kby += Math.sin(ang) * 260;
  if (rat.hp <= 0) {
    rat.dead = true;
    G.items.push({ id: 'l' + (++G.itemSeq), kind: 'drop', local: true, x: rat.x, y: rat.y, z: 0, layer: 1, stacks: [{ id: 'hide', n: 1 }] });
    // The squeal gives you away: everyone gets a ping on this spot.
    G.pings.push({ x: rat.x, y: rat.y, layer: 1, t: 12, src });
    NET.fx({ k: 'ping', x: Math.round(rat.x), y: Math.round(rat.y) });
    addFx('puff', rat.x, rat.y, 1, { col: '#8a7a6a', z: 6 });
    Sfx.play('squeak', rat.x, rat.y, 0);
  }
}

// ---- actions ----
function swing(f, armed = true) {
  if (f.atkCd > 0) return false;
  f.atkCd = 0.28; f.swingT = 0.14; f.swings++; f.hidden = false;
  const tier = armed ? f.weapon : 0;
  let dmg = WDMG[tier] + (f.kit === 'killer' ? 1 : 0);
  const punching = f.punchT > 0;
  if (punching) dmg += 8;
  const reach = f.r + 44;
  let hit = false;
  for (const t of G.fighters) {
    if (t === f || !t.alive || t.layer !== f.layer || t.owner === f) continue;
    if (Math.abs(t.z - f.z) > 50) continue;
    const a = Math.atan2(t.y - f.y, t.x - f.x);
    if (hyp(t.x - f.x, t.y - f.y) - t.r < reach && Math.abs(angDiff(f.face, a)) < 1.0) hit = hurt(t, dmg, f, a, 300) || hit;
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
function drink(f) {
  let i = heldId(f) === 'pot' ? f.sel : -1;
  if (i < 0) for (let k = 0; k < HOTBAR; k++) if (f.slots[k] && f.slots[k].id === 'pot') { i = k; break; }
  if (i < 0 || f.drinkCd > 0 || f.hp >= f.maxHp) return false;
  f.slots[i] = null; bump(f); f.drinkCd = 0.2; f.hp = Math.min(f.maxHp, f.hp + 7);
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
  spawnProj({ kind: 'arrow', x: f.x, y: f.y, z: f.z + 46, vx: Math.cos(f.face) * s * c, vy: Math.sin(f.face) * s * c, vz: Math.sin(pitch) * s, owner: f, layer: f.layer, life: 2, dmg: 0.8 + charge * 1.4, kb: 150 + 380 * charge });
  Sfx.play('shoot', f.x, f.y, f.z);
}
function useKit(f, ax, ay) {
  const K = KITS[f.kit];
  if (!K.item || f.kitCd > 0 || (K.uses && f.uses <= 0)) return false;
  const aim = Math.atan2(ay - f.y, ax - f.x);
  switch (f.kit) {
    case 'mage': {
      let e = null, ed = 600;
      for (const o of G.fighters) if (o !== f && o.alive && o.layer === f.layer && !o.isClone && hyp(o.x - f.x, o.y - f.y) < ed) { e = o; ed = hyp(o.x - f.x, o.y - f.y); }
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
  }
  if (K.cd) f.kitCd = K.cd;
  if (K.uses) f.kitCd = 0.5;
  return true;
}
function spawnClone(f, dir) {
  const c = new Fighter(f.name, 'killer', true, f.id + '~' + Math.random().toString(36).slice(2, 6));
  Object.assign(c, { isClone: true, owner: f, x: f.x, y: f.y, z: f.z, layer: f.layer, color: f.color, life: 9, cdir: dir, bot: true, remote: false });
  G.fighters.push(c);
}
function toggleLayer(f) {
  const e = world.entrances.find(e => hyp(e.x - f.x, e.y - f.y) < 46);
  if (!e || G.pit || !f.onGround) return false;
  if (!f.layer && f.z > heightAt(e.x, e.y) + 20) return false;
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

// Landing: fall damage, hay bales, feather charms and the Faller kit
function land(f, fall, onType) {
  const blocks = fall / B;
  if (blocks > 1.5) addFx('ring', f.x, f.y, f.layer, { col: '#d9c7a8', z: f.z + 1 });
  const dmg = Math.max(0, blocks - 3.5);
  if (dmg <= 0) return;
  Sfx.play('fall', f.x, f.y, f.z);
  if (onType === 'hay' || f.noFallT > 0) { if (f === G.human) toast(onType === 'hay' ? 'The hay bale broke your fall' : 'Spring landing: no damage'); return; }
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

// ---- per-frame physics for a fighter we simulate ----
function updateFighter(f, dt) {
  for (const k of ['atkCd', 'kitCd', 'invuln', 'speedT', 'hurtT', 'swingT', 'punchT', 'drinkCd', 'slowT', 'spikeCd', 'noFallT']) if (f[k] > 0) f[k] -= dt;
  f.biome = f.layer ? -1 : biomeAt(f.x, f.y);
  let sp = f.layer ? 165 : [190, 185, 172, 150][f.biome];
  if (f.speedT > 0) sp *= 1.8;
  if (f.sneak) sp *= 0.35;
  if (f.slowT > 0) sp *= 0.45;
  if (f.charge >= 0) { sp *= 0.55; f.charge = Math.min(1, f.charge + dt / 0.8); }
  if (f.refillT > 0 || f.gather) sp = 0;
  let mx = f.mx, my = f.my;
  const ml = hyp(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  if (f.hidden && ml > 0.1) f.hidden = false;
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
    // Vertical: stand, step, fall, land
    const sup = supportAt(f.x, f.y, f.z, f.r, 0), supType = SUP_TYPE;
    if (f.onGround) {
      if (f.z - sup > 6) { f.onGround = false; f.vz = 0; f.peakZ = f.z; }
      else f.z = sup;
    }
    if (!f.onGround) {
      f.vz -= GRAV * dt; f.z += f.vz * dt;
      if (f.vz > 0) { const c = headBlocked(f); if (c !== null && f.z > c) { f.z = c; f.vz = 0; } }
      f.peakZ = Math.max(f.peakZ, f.z);
      if (f.z <= sup) { f.z = sup; f.vz = 0; f.onGround = true; land(f, f.peakZ - sup, supType); }
    }
    // Spike traps
    const trap = f.spikeCd <= 0 && !f.isClone ? trapAt(f) : null;
    if (trap && trap.owner !== f.id) {
      f.spikeCd = 0.9; f.slowT = 1.5;
      addFx('ring', f.x, f.y, 0, { col: '#c63d3d', z: f.z + 2 });
      Sfx.play('spike', f.x, f.y, f.z);
      if (f === G.human) toast('Spike trap!');
      if (pvpOn() || !trap.owner) hurtRaw(f, 4, fighterById(trap.owner));
    }
  }
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
      if (f.remote) { NET.got(f, it.stacks); removeItem(it, f); break; }
      const left = [];
      for (const s of it.stacks) { const l = give(f, s.id, s.n); if (l) left.push({ id: s.id, n: l }); }
      if (left.length === it.stacks.length && left.every((l, i) => l.n === it.stacks[i].n)) { if (f === G.human && !it.fullWarned) { toast('Inventory full'); it.fullWarned = true; } continue; }
      if (f === G.human) { Sfx.play('pickup'); pickupToast(it.stacks, left); }
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
  if (G.rats.length < 34 && Math.random() < dt * 2) {
    const n = world.nodes[Math.floor(Math.random() * world.nodes.length)];
    if (!under.some(f => hyp(f.x - n.x, f.y - n.y) < 300))
      G.rats.push({ x: n.x, y: n.y, hp: 3, kbx: 0, kby: 0, node: world.nodes.indexOf(n), a: 0 });
  }
  for (const r of G.rats) {
    let tn = world.nodes[r.node];
    if (hyp(tn.x - r.x, tn.y - r.y) < 14) { r.node = pick(tn.adj); tn = world.nodes[r.node]; }
    let a = Math.atan2(tn.y - r.y, tn.x - r.x) + Math.sin(G.t * 9 + r.x) * 0.8, sp = 85;
    for (const f of under) if (hyp(f.x - r.x, f.y - r.y) < 110) { a = Math.atan2(r.y - f.y, r.x - f.x) + Math.sin(G.t * 5) * 0.5; sp = 115; }
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
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.layer === 1) { if (!walkUnder(p.x, p.y, 2) || p.z < 0 || p.z > 112) p.life = 0; }
    else {
      const g = heightAt(p.x, p.y);
      if (p.z < g) p.life = 0;
      else if (solidAt(Math.floor(p.x / B), Math.floor(p.z / B), Math.floor(p.y / B))) p.life = 0;
      else if (p.z < g + 90 && nearObjs(p.x, p.y, 30).some(o => o.amt > 0 && o.kind !== 'reed' && hyp(o.x - p.x, o.y - p.y) < o.r)) p.life = 0;
    }
    // Only the shooter's machine decides hits; everyone else just draws the arrow
    if (p.ghost || p.owner.remote) { for (const t of G.fighters) if (p.life > 0 && t !== p.owner && t.alive && t.layer === p.layer && hyp(t.x - p.x, t.y - p.y) < t.r + 5 && p.z > t.z - 4 && p.z < t.z + FH + 4) p.life = 0; continue; }
    for (const t of G.fighters) {
      if (p.life <= 0 || t === p.owner || !t.alive || t.layer !== p.layer || t.owner === p.owner) continue;
      if (hyp(t.x - p.x, t.y - p.y) < t.r + 5 && p.z > t.z - 4 && p.z < t.z + FH + 4) {
        const a = Math.atan2(p.vy, p.vx);
        if (p.kind === 'arrow') hurt(t, p.dmg, p.owner, a, p.kb);
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
    if (e.kind === 'strike' && e.t <= 0 && !e.done) {
      e.done = true;
      if (!e.ghost) {
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
