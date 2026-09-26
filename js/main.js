'use strict';
// Match flow, input, HUD, inventory screen, screens (Play ↔ Options ↔ Game → Lose → Play), kit store.
const $ = s => document.querySelector(s);
function setHTML(sel, html) { const el = $(sel); if (el._h !== html) { el._h = html; el.innerHTML = html; } }
G.settings = { len: 8, bots: 23, snow: true, dmgNums: true, shadows: true, sens: 1, vol: 0.6, fov: 75, tips: true, mapSize: 4800 };
G.mode = 'menu';
const STORE = { coins: 150, owned: [], kit: 'killer', life: { matches: 0, wins: 0, kills: 0, best: 0, fall: 0 } };
try { const s = JSON.parse(localStorage.getItem('ff_store')); if (s) Object.assign(STORE, s); } catch (e) {}
try { const s = JSON.parse(localStorage.getItem('ff_settings')); if (s) Object.assign(G.settings, s); } catch (e) {}
function save() {
  try { localStorage.setItem('ff_store', JSON.stringify(STORE)); localStorage.setItem('ff_settings', JSON.stringify(G.settings)); localStorage.setItem('ff_nick', LOBBY.nick); } catch (e) {}
}
const KIT_PRICE = 150;
function weeklyFree() {
  const wk = Math.floor((Date.now() / 864e5 + 3) / 7), r = mulberry32(wk * 7919);
  const ids = Object.keys(KITS).filter(k => !KITS[k].locked);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, 6);
}
const FREE = weeklyFree();
const kitAvailable = k => !KITS[k].locked && (FREE.includes(k) || STORE.owned.includes(k));
if (!kitAvailable(STORE.kit)) STORE.kit = FREE[0];

// ---------- match setup ----------
function spawnPoint(taken, inSwamp) {
  for (let i = 0; i < 400; i++) {
    let x, y;
    if (inSwamp) { const s = pick(SWAMPS), a = rr(0, 6.28), d = rr(0, s.r * 0.7); x = s.x + Math.cos(a) * d; y = s.y + Math.sin(a) * d; }
    else { x = rr(150, WORLD - 150); y = rr(150, WORLD - 150); }
    if (hyp(x - PIT.x, y - PIT.y) < PIT.r + 80) continue;
    if (nearObjs(x, y, 40).some(o => hyp(o.x - x, o.y - y) < o.r + 20)) continue;
    if (!inSwamp && taken.some(p => hyp(p.x - x, p.y - y) < (taken.length > 40 ? 180 : 320))) continue;
    // Nobody starts next to a landmark or a ruin: legendaries and loot have to be reached
    if (world.landmarks.some(m => m.layer === 0 && hyp(m.x - x, m.y - y) < 450) || world.ruins.some(r => hyp(r.x - x, r.y - y) < 220)) continue;
    return { x, y };
  }
  return { x: rr(300, WORLD - 300), y: rr(300, WORLD - 300) };
}
function makeBot(name, id) {
  const kits = Object.keys(KITS).filter(k => !KITS[k].locked);
  const b = new Fighter(name, pick(kits), true, id);
  Object.assign(b, { style: pick(STYLES), react: rr(0.3, 0.5), side: 1, side2: rng() < .5 ? -1 : 1 });
  return b;
}
// Deterministic from the seed, so every player in an online match builds the same world and bots.
function newMatch(nBots, human, seed = Math.floor(Math.random() * 1e9), humans = null, size = G.settings.mapSize) {
  genWorld(seed, MAP_SIZES[size] ? size : 4800);
  resetBlocks();
  buildRuins();
  buildLandmarks();
  Object.assign(G, { fighters: [], rats: [], proj: [], fx: [], items: [], pings: [], feed: [], itemSeq: 0, t: 0, clockMin: 0, graceDone: false, feast: null, pit: false, over: false, coinsEarned: 0, killedBy: null,
    winShown: false, dmgDir: null, specTarget: null, lmSeen: {}, stats: { dmg: 0, blocks: 0, broken: 0, fall: 0, pots: 0, crafted: 0 } });
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const taken = [];
  const all = humans ? [...humans] : human ? [human] : [];
  for (let i = 0; i < nBots; i++) all.push(makeBot(names[i % names.length] + (i >= names.length ? String(Math.floor(i / names.length) + 1) : ''), 'b' + i));
  for (const f of all) { const p = spawnPoint(taken, f.kit === 'finder'); Object.assign(f, { x: p.x, y: p.y, z: heightAt(p.x, p.y), onGround: true }); taken.push(p); G.fighters.push(f); }
  if (!NET.on || NET.isHost()) {
    for (let i = 0; i < potCap(); i++) spawnPot();
    for (const r of world.ruins) addItem({ kind: 'chest', x: r.x, y: r.y, z: r.chestZ, layer: 0, stacks: ruinLoot(r) });
    for (const m of world.landmarks) addItem({ kind: 'relic', x: m.x, y: m.y, z: m.chestZ, layer: m.layer, stacks: [{ id: LANDMARKS[m.id].item, n: 1 }, { id: 'pot', n: 2 }] });
  }
}
// Watchtowers (you have to climb them) hold the best ruin loot
function ruinLoot(r) {
  const s = [], add = (id, n) => s.push({ id, n }), n = (a, b) => a + Math.floor(rng() * (b - a + 1));
  add('pot', n(1, r.kind === 'tower' ? 3 : 2));
  if (r.kind === 'tower') { add(pick(['sword3', 'sword2', 'bow']), 1); add(pick(['hide_chest', 'hide_legs', 'charm', 'charm']), 1); add('arrow', n(8, 16)); }
  else if (r.kind === 'cabin') { add(pick(['sword2', 'sword1', 'bow', 'hide_head', 'hide_feet']), 1); add(pick(['plank', 'cobble']), n(12, 24)); add('ladder', 4); }
  else { add(pick(['stone', 'wood', 'iron']), n(3, 6)); add(pick(['hay', 'spike', 'arrow']), pick([2, 3, 6])); }
  return s;
}
const potCap = () => Math.round(18 * WORLD / 3200);
function spawnPot() {
  for (let i = 0; i < 30; i++) {
    const s = pick(SWAMPS), a = rr(0, 6.28), d = rr(0, s.r);
    const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
    if (biomeAt(x, y) === 3) { addItem({ kind: 'drop', x, y, z: heightAt(x, y), layer: 0, stacks: [{ id: 'pot', n: 1 }] }); return; }
  }
}

// Attract mode: bots play a match behind the menu
let camFocus = null;
function startAttract() {
  NET.on = false;
  G.grace = 0;
  newMatch(12, null, undefined, null, 3200); // a small map behind the menu loads fast
  G.human = { x: PIT.x, y: PIT.y, z: 0, layer: 0, biome: 0, alive: false, face: 0, id: 'cam' };
  camFocus = null;
}
function startGame() {
  NET.on = false;
  G.grace = 2;
  const h = new Fighter(LOBBY.nick || 'You', STORE.kit, false, 'me');
  newMatch(G.settings.bots, h);
  G.human = h;
  VIEW.pitch = -0.05;
  Sfx.start(); Sfx.setVolume(G.settings.vol);
  setMode('play');
  lockPointer();
  banner('Grace period', `${G.settings.bots} bots. PvP turns on at 02:00. Chop wood, craft planks, find potions.`);
}

// ---------- phases ----------
function fmt(min) { const s = Math.max(0, Math.floor(min * 60)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function phases() {
  const m = G.clockMin, host = !NET.on || NET.isHost();
  if (!G.graceDone && m >= G.grace) { G.graceDone = true; banner('PvP is on', 'Kill or be killed.'); }
  if (!G.feast && m >= 20) {
    G.feast = { site: FEAST_SITES[world.seed % FEAST_SITES.length], state: 'announced' };
    banner('Feast announced', `${G.feast.site.name} · opens at 25:00 · marked on your map`);
  }
  if (G.feast && G.feast.state === 'announced' && m >= 25) {
    G.feast.state = 'spawned';
    const s = G.feast.site;
    const loot = [
      [{ id: 'sword4', n: 1 }, { id: 'pot', n: 3 }], [{ id: 'sword4', n: 1 }, { id: 'pot', n: 3 }],
      [{ id: 'iron_head', n: 1 }, { id: 'iron_chest', n: 1 }, { id: 'iron_legs', n: 1 }, { id: 'iron_feet', n: 1 }, { id: 'charm', n: 1 }],
      [{ id: 'pot', n: 6 }, { id: 'arrow', n: 16 }, { id: 'bow', n: 1 }, { id: 'cobble', n: 24 }, { id: 'hay', n: 2 }],
    ];
    if (host) loot.forEach((stacks, i) => {
      const a = i / 4 * 6.28 + .4, x = s.x + Math.cos(a) * 70, y = s.y + Math.sin(a) * 70;
      addItem({ kind: 'feast', x, y, z: heightAt(x, y), layer: 0, stacks });
    });
    banner('The feast is open', 'Feast Blades, feast armour and potions.');
  }
  if (G.feast && G.feast.state === 'spawned' && !G.items.some(i => i.kind === 'feast' && !i.gone)) G.feast.state = 'done';
  if (!G.pit && m >= 60) {
    G.pit = true;
    const alive = G.fighters.filter(f => f.alive && !f.isClone);
    G.fighters.forEach(f => { if (f.isClone) f.alive = false; });
    alive.forEach((f, i) => {
      if (f.remote) return;
      const a = i / alive.length * 6.28, x = PIT.x + Math.cos(a) * 250, y = PIT.y + Math.sin(a) * 250;
      Object.assign(f, { layer: 0, x, y, z: heightAt(x, y), vz: 0, onGround: true, gather: null, plan: null, path: null, hidden: false });
    });
    banner('The pit', 'Time is up. Everyone left is in the arena. Last one standing wins.');
  }
}

// ---------- input (first person, pointer lock) ----------
const keys = new Set();
const mouse = { down: false, rdown: false, x: 0, y: 0 };
let locked = false, wantLock = false, noLock = false;
const SENS = 0.0022;
function lockPointer() {
  wantLock = true;
  if (noLock) return;
  try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => { noLock = true; }); } catch (e) { noLock = true; }
}
function unlockPointer() { wantLock = false; if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cv;
  if (!locked && G.mode === 'play' && !G.invOpen && !G.chatOpen && !G.over && wantLock) pause();
});
document.addEventListener('pointerlockerror', () => { noLock = true; });
document.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (G.invOpen) { moveCursorStack(); return; }
  if (G.mode !== 'play' || !G.human.alive || G.chatOpen || (!locked && !noLock)) return;
  const k = SENS * G.settings.sens;
  G.human.face += e.movementX * k;
  VIEW.pitch = clamp(VIEW.pitch - e.movementY * k, -1.45, 1.3);
});
addEventListener('keydown', e => {
  if (G.chatOpen) return;
  if (G.mode === 'spectate') {
    const k = e.key.toLowerCase();
    if (['arrowright', 'd', ' '].includes(k)) { e.preventDefault(); spectate(1); }
    else if (['arrowleft', 'a'].includes(k)) spectate(-1);
    else if (k === 'escape') setMode('end');
    return;
  }
  if (G.mode !== 'play') { if (e.key === 'Escape' && G.mode === 'paused') resume(); return; }
  const k = e.key.toLowerCase(), h = G.human;
  if (['tab', ' ', 'arrowup', 'arrowdown', 'shift'].includes(k)) e.preventDefault();
  if (G.invOpen) {
    if (k === 'tab' || k === 'i' || k === 'e' || k === 'escape') toggleInv();
    else if (k >= '1' && k <= '9' && INV.hover !== null) swapWithHotbar(INV.hover, +k - 1);
    return;
  }
  if (k === 'shift') h.sneak = true;
  if (keys.has(k)) return;
  keys.add(k);
  if (k >= '1' && k <= '9') selectSlot(+k - 1);
  else if (k === ' ' && h.alive) jump(h);
  else if (k === 'escape') pause();
  else if (k === 'tab' || k === 'i') toggleInv();
  else if (k === 'q' && h.alive) { const a = aimWorld(); if (!useKit(h, a.x, a.y)) kitFail(h); }
  else if (k === 'r' && canRefill(h) && h.refillT <= 0) h.refillT = 0.22;
  else if (k === 'f') drink(h);
  else if (k === 'g' && h.alive) dropHeld(h, e.ctrlKey);
  else if (k === 't' && NET.on) openChat();
  else if (k === 'e') {
    if (!toggleLayer(h)) { const o = gatherTarget(h); if (o) { h.gather = o; h.gatherT = 0; } }
  }
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase(); keys.delete(k);
  if (k === 'e' && G.human) G.human.gather = null;
  if (k === 'shift' && G.human) G.human.sneak = false;
});
addEventListener('blur', () => { keys.clear(); mouse.down = mouse.rdown = false; if (G.human) G.human.sneak = false; if (G.mode === 'play' && !NET.on) pause(); });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  if (G.mode === 'spectate') { spectate(e.button === 2 ? -1 : 1); return; }
  if (G.mode !== 'play' || !G.human.alive) return;
  if (G.invOpen) { toggleInv(); return; }
  if (!locked && !noLock) { lockPointer(); return; }
  const h = G.human, item = heldId(h);
  if (e.button === 2) { mouse.rdown = true; if (!(item && ITEMS[item].block)) drink(h); return; }
  if (e.button !== 0) return;
  mouse.down = true;
  if (item === 'bow') { if (h.arrows > 0) h.charge = 0; else toast('No arrows. Craft them in the inventory (Tab).'); }
  else if (item === 'pot') drink(h);
  else if (item === 'kit') { const a = aimWorld(); if (!useKit(h, a.x, a.y)) kitFail(h); }
  else if (item === 'skyhook' && !fireSkyhook(h, VIEW.pitch)) toast(h.skyCd > 0 ? `Skyhook recharging: ${Math.ceil(h.skyCd)}s` : h.layer ? 'The Skyhook doesn’t work underground' : 'Nothing to hook within 22 blocks');
  else if (item === 'everflask' && !drink(h)) { const s = h.slots[h.sel]; toast(s.ready > G.t ? `Everflask refilling: ${Math.ceil(s.ready - G.t)}s` : 'You’re already at full health'); }
});
addEventListener('mouseup', e => {
  if (e.button === 2) mouse.rdown = false;
  if (e.button !== 0) return;
  mouse.down = false;
  const h = G.human;
  if (h && h.charge >= 0 && !h.remote) { if (h.charge > 0.1) shoot(h, h.charge, VIEW.pitch + 0.03); h.charge = -1; }
});
cv.addEventListener('wheel', e => { if (G.mode === 'play') selectSlot((G.human.sel + (e.deltaY > 0 ? 1 : 8)) % 9); }, { passive: true });
let heldNameT;
function selectSlot(i) {
  const h = G.human; if (h.charge >= 0) h.charge = -1; h.sel = i;
  const id = heldId(h), el = $('#held-name');
  el.textContent = id ? itemName(id, h) : '';
  el.hidden = !id; el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade');
  clearTimeout(heldNameT); heldNameT = setTimeout(() => el.hidden = true, 1600);
}
function dropHeld(h, all) {
  const s = h.slots[h.sel];
  if (!s) return;
  if (s.id === 'kit') { toast('Kit items can’t be dropped'); return; }
  const n = all ? s.n : 1;
  take(h, s.id, n, h.sel);
  dropStacks(h, [{ id: s.id, n }]);
}
function kitFail(h) {
  const K = KITS[h.kit];
  if (!K.item) toast(`${K.name} is a passive kit.`);
  else if (K.uses && h.uses <= 0) toast(`${K.item} is used up.`);
  else if (h.kitCd > 0) toast(`${K.item} recharging: ${Math.ceil(h.kitCd)}s`);
  else if (h.kit === 'mage') toast(pvpOn() ? 'Nobody within range to pull.' : 'Wait for PvP to turn on.');
}
function humanInput(dt) {
  const h = G.human;
  if (!h.alive) { h.mx = h.my = 0; return; }
  if (keys.has('arrowleft')) h.face -= dt * 2.4;
  if (keys.has('arrowright')) h.face += dt * 2.4;
  if (keys.has('arrowup')) VIEW.pitch = Math.min(1.3, VIEW.pitch + dt * 1.5);
  if (keys.has('arrowdown')) VIEW.pitch = Math.max(-1.45, VIEW.pitch - dt * 1.5);
  const busy = G.invOpen || G.chatOpen || G.mode !== 'play';
  const fw = busy ? 0 : (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0), st = busy ? 0 : (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  const c = Math.cos(h.face), sn = Math.sin(h.face);
  h.mx = c * fw - sn * st; h.my = sn * fw + c * st;
  h.climb = !busy && (keys.has('w') || keys.has(' '));
  h.glide = !busy && keys.has(' ');
  if ((fw || st) && h.gather) h.gather = null;
  h.pitch = VIEW.pitch;
  const cp = Math.cos(VIEW.pitch);
  G.aim = h.layer ? null : rayPick(h.x, h.y, h.z + EYE - (h.sneak ? 9 : 0), Math.cos(h.face) * cp, Math.sin(h.face) * cp, Math.sin(VIEW.pitch), REACH);
  if (busy) return;
  const item = heldId(h), def = item ? ITEMS[item] : null, hand = !def || def.tier || def.block || def.cat === 'mat' || def.cat === 'armor';
  // Hold left click on a block to break it (it goes back into your inventory)
  const a = G.aim;
  if (mouse.down && hand && a && a.hit === 'block') {
    const key = bkey(a.i, a.j, a.k);
    if (h.breakKey !== key) { h.breakKey = key; h.breakT = 0; }
    h.breakT += dt;
    h.breakNeed = BLOCKS[a.b.type].hard * (def && def.tier === 5 ? 0.02 : def && def.tier >= 2 ? 0.6 : 1); // the Quake Maul breaks anything in one swing
    if (h.breakT >= h.breakNeed) { breakBlock(a.i, a.j, a.k, h); h.breakKey = null; h.breakT = 0; }
  } else { h.breakKey = null; h.breakT = 0; }
  if (mouse.down && hand && swing(h, !!(def && def.tier))) hitMark();
  // Hold right click with a block to keep placing: jump and look down to tower up
  h.placeCd = (h.placeCd || 0) - dt;
  if (mouse.rdown && def && def.block && h.placeCd <= 0 && a && a.pi !== null) {
    if (placeBlock(h, item, a.pi, a.pj, a.pk)) { h.placeCd = 0.16; h.swingT = 0.1; }
  }
}
let hitT;
function hitMark() { const c = $('#cross'); c.classList.add('hit'); clearTimeout(hitT); hitT = setTimeout(() => c.classList.remove('hit'), 140); }
function updateCross(dt) {
  const h = G.human, dd = G.dmgDir, el = $('#dmgdir');
  if (dd && dd.t > 0) { dd.t -= dt * 0.9; el.style.opacity = Math.max(0, dd.t); el.style.transform = `translate(-50%, -50%) rotate(${dd.a - h.face}rad)`; }
  else el.style.opacity = 0;
  if (G.killFlash > 0) { G.killFlash -= dt; $('#cross').classList.toggle('kill', G.killFlash > 0); }
  const p = h.breakKey ? h.breakT / h.breakNeed : h.gather ? h.gatherT / gatherTime(h, h.gather) : h.charge >= 0 ? h.charge : h.refillT > 0 ? 1 - h.refillT / 0.22 : 0;
  $('#cross').style.setProperty('--p', p.toFixed(3));
  $('#hurt').style.opacity = h.hurtT > 0 ? 1 : h.hp < 6 ? 0.45 : 0;
}

// ---------- chat (online) ----------
function openChat() {
  G.chatOpen = true; mouse.down = false; keys.clear();
  const c = $('#chat'); c.hidden = false; c.value = ''; setTimeout(() => c.focus(), 0);
}
$('#chat').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const t = e.target.value.trim().slice(0, 80); if (t) { NET.send('chat', { t }); G.feed.unshift({ txt: `${G.human.name}: ${t}`, t: 10, chat: true, you: true }); } }
  if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); G.chatOpen = false; e.target.hidden = true; e.target.blur(); lockPointer(); }
});

// ---------- loop ----------
let last = performance.now(), hudT = 0, potT = 0;
function step(dt) {
  G.t += dt;
  G.clockMin = G.t / G.settings.len;
  if (G.mode !== 'menu' && G.mode !== 'options' && G.human.isFighter) { humanInput(dt); phases(); }
  for (const f of G.fighters) if (f.bot && f.alive && !f.remote) botUpdate(f, dt);
  for (const f of G.fighters) if (f.alive && !f.remote) updateFighter(f, dt);
  netInterp(dt);
  // keep bodies from stacking (only move the ones we simulate)
  const al = G.fighters.filter(f => f.alive && !f.hidden);
  for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
    const a = al[i], b = al[j];
    if (a.layer !== b.layer || Math.abs(a.z - b.z) > FH - 10) continue;
    const d = hyp(a.x - b.x, a.y - b.y), m = a.r + b.r;
    if (d < m && d > 0.01) {
      const p = (m - d) / (a.remote || b.remote ? 1 : 2), nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
      if (!a.remote) { a.x += nx * p; a.y += ny * p; }
      if (!b.remote) { b.x -= nx * p; b.y -= ny * p; }
    }
  }
  G.fighters = G.fighters.filter(f => f.alive || !f.isClone);
  pickups();
  updateRats(dt); updateProj(dt); updateFx(dt);
  potT += dt;
  if (potT > 3) {
    potT = 0; G.items = G.items.filter(i => !i.gone);
    if ((!NET.on || NET.isHost()) && G.items.filter(i => i.stacks && i.stacks.length === 1 && i.stacks[0].id === 'pot').length < potCap()) spawnPot();
  }
  netTick(dt);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (world) {
    if (G.mode === 'menu' || G.mode === 'options') {
      step(dt);
      if (!camFocus || !camFocus.alive) camFocus = G.fighters.find(f => f.alive && !f.isClone);
      if (!camFocus || G.fighters.filter(f => f.alive && !f.isClone).length <= 1 || G.t > 240) startAttract();
      else Object.assign(G.human, { x: camFocus.x, y: camFocus.y, z: camFocus.z, layer: camFocus.layer, biome: camFocus.biome });
      render(dt); Sfx.update('menu', dt, 0);
    } else if (G.mode === 'play' || G.mode === 'spectate' || (NET.on && (G.mode === 'paused' || G.mode === 'end'))) {
      // Online matches keep running while you pause or after you die; spectating always does
      if (G.mode === 'spectate' && !(G.specTarget && G.specTarget.alive)) spectate(1);
      step(dt); render(dt); renderMinimap();
      if (G.mode === 'play') { updateCross(dt); checkTips(dt); checkLandmarks(); }
      const v = VIEW.focus || G.human;
      Sfx.update(v.layer ? 'under' : v.biome === 2 && G.settings.snow && !G.pit ? 'snow' : 'surface', dt, DAY.night);
      hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHud(); }
    } else { render(0); renderMinimap(); }
  }
  requestAnimationFrame(frame);
}

// ---------- HUD ----------
function slotInner(s, h) {
  if (!s) return '';
  return `<img src="${iconURL(s.id, h.kit)}" alt="">${s.n > 1 ? `<b class="n">${s.n}</b>` : ''}`;
}
function updateHud() {
  const h = G.human;
  setHTML('#hp', Array.from({ length: 20 }, (_, i) => `<i class="${h.hp > i + 0.5 ? 'on' : h.hp > i ? 'half' : ''}"></i>`).join(''));
  setHTML('#armor', ARMOR_SLOTS.map(k => `<i class="${h.equip[k] ? (h.equip[k].id.startsWith('iron') ? 'on iron' : 'on') : ''}"></i>`).join(''));
  $('#clock').textContent = fmt(G.clockMin);
  const m = G.clockMin;
  $('#phase').textContent = m < G.grace ? `PvP in ${fmt(G.grace - m)}` : !G.feast ? `Feast announced at 20:00` :
    G.feast.state === 'announced' ? `Feast in ${fmt(25 - m)}` : G.pit ? 'The pit' : `Pit in ${fmt(60 - m)}`;
  $('#alive').textContent = G.fighters.filter(f => f.alive && !f.isClone).length;
  $('#kills').textContent = h.kills;
  $('#where').textContent = h.layer ? 'Tunnels' : G.pit ? 'The Pit' : BIOME_NAME[h.biome];
  $('#online-tag').hidden = !NET.on;
  $('#online-tag').textContent = NET.on ? `Online · ${G.fighters.filter(f => !f.bot && !f.isClone).length} players${NET.isHost() ? ' · hosting' : ''}` : '';
  setHTML('#hotbar', Array.from({ length: HOTBAR }, (_, i) => {
    const s = h.slots[i], K = KITS[h.kit];
    let sub = '';
    if (s && s.id === 'kit') sub = K.uses ? `${h.uses} left` : h.kitCd > 0 ? `${Math.ceil(h.kitCd)}s` : '';
    if (s && s.id === 'bow') sub = `${h.arrows}`;
    if (s && s.id === 'everflask' && s.ready > G.t) sub = `${Math.ceil(s.ready - G.t)}s`;
    if (s && s.id === 'skyhook' && h.skyCd > 0) sub = `${Math.ceil(h.skyCd)}s`;
    const cd = s && s.id === 'kit' && K.cd && h.kitCd > 0 ? `<span class="cd" style="height:${h.kitCd / K.cd * 100}%"></span>` : '';
    return `<div class="slot ${i === h.sel ? 'sel' : ''} ${s ? '' : 'empty'} ${s && ITEMS[s.id].legendary ? 'legend' : ''}"><span class="key">${i + 1}</span>${cd}${slotInner(s, h)}${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  }).join(''));
  const bp = bagPots(h);
  $('#bagpots').textContent = bp ? `${bp} potion${bp > 1 ? 's' : ''} in backpack${canRefill(h) ? ' · R to refill' : ''}` : 'No potions in backpack';
  $('#bagpots').classList.toggle('warn', canRefill(h));
  setHTML('#feed', G.feed.map(k => `<div class="${k.you ? 'you' : ''}${k.chat ? ' chat' : ''}${k.relic ? ' relic' : ''}">${escapeHTML(k.txt)}</div>`).join(''));
  let p = '';
  if (h.refillT > 0) p = 'Refilling hotbar…';
  else if (world.entrances.some(e => hyp(e.x - h.x, e.y - h.y) < 46) && !G.pit) p = h.layer ? '<kbd>E</kbd> Climb out' : '<kbd>E</kbd> Go down into the tunnels';
  else { const o = gatherTarget(h); if (o) p = `Hold <kbd>E</kbd> ${{ tree: 'Chop tree for wood', rock: 'Break rock for stone', reed: 'Cut reeds', ore: 'Mine iron ore (slow)' }[o.kind]}`; }
  const held = heldId(h);
  if (!p && held && ITEMS[held].block && !h.layer) p = `<kbd>Right click</kbd> Place · hold to keep placing · <kbd>Space</kbd> + look down to tower`;
  $('#prompt').innerHTML = p; $('#prompt').hidden = !p;
  const st = [];
  if (h.hidden) st.push(`Disguised as a ${h.disguise === 'snowrock' ? 'rock' : h.disguise}`);
  if (h.sneak) st.push('Sneaking');
  if (h.slowT > 0) st.push('Slowed');
  if (h.invuln > 0) st.push('Invincible');
  if (h.speedT > 0) st.push('Sprinting');
  if (h.punchT > 0) st.push('Punch charged');
  if (count(h, 'charm')) st.push(`Feather Charm ×${count(h, 'charm')}`);
  if (h.layer === 0 && h.biome === 2 && G.settings.snow && !G.pit) st.push('Snowstorm');
  $('#status').textContent = st.join(' · ');
  $('#clickto').hidden = !(G.mode === 'play' && !locked && !noLock && !G.invOpen && !G.chatOpen && h.alive);
  if (G.invOpen) renderInv();
  renderBoard();
  if (G.mode === 'spectate' && G.specTarget) {
    const t = G.specTarget;
    $('#spec').textContent = `Watching ${t.name} · ${KITS[t.kit].name} · ${Math.ceil(t.hp)} health · ${t.kills} kills   ← → or click to switch · Esc to go back`;
  }
}
// Hold P: everyone in the match, alive first, then by kills
function renderBoard() {
  const show = G.mode === 'play' && keys.has('p');
  $('#board').hidden = !show;
  if (!show) return;
  const all = G.fighters.filter(f => !f.isClone).sort((a, b) => (b.alive - a.alive) || (b.kills - a.kills) || a.name.localeCompare(b.name));
  const rows = all.slice(0, 24);
  if (!rows.includes(G.human)) rows.push(G.human);
  $('#board-count').textContent = `${all.filter(f => f.alive).length} of ${all.length} alive`;
  setHTML('#board-list', rows.map(f => `<div class="${f.alive ? '' : 'dead'} ${f === G.human ? 'me' : ''}"><span>${escapeHTML(f.name)}${f.bot ? '' : ' <i>player</i>'}</span><small>${KITS[f.kit].name}</small><b>${f.kills}</b></div>`).join(''));
}

// ---------- spectating ----------
function spectate(dir) {
  const alive = G.fighters.filter(f => f.alive && !f.isClone && f !== G.human);
  if (!alive.length) { if (G.mode === 'spectate') setMode('end'); return; }
  const i = alive.indexOf(G.specTarget);
  G.specTarget = alive[i < 0 ? 0 : (i + dir + alive.length) % alive.length];
}
function startSpectate() {
  const k = G.human.lastHitBy;
  G.specTarget = k && k.alive && !k.isClone ? k : null;
  if (!G.specTarget) spectate(1);
  if (G.specTarget) { setMode('spectate'); last = performance.now(); }
}

// ---------- landmarks: announce each one the first time you get close, while its legendary is still there ----------
function checkLandmarks() {
  const h = G.human;
  if (!h.alive) return;
  for (const m of world.landmarks) {
    if (G.lmSeen[m.id] || m.layer !== h.layer || hyp(m.x - h.x, m.y - h.y) > 260) continue;
    G.lmSeen[m.id] = true;
    if (G.items.some(i => i.kind === 'relic' && !i.gone && hyp(i.x - m.x, i.y - m.y) < 5)) banner(LANDMARKS[m.id].name, LANDMARKS[m.id].hint);
  }
}

// ---------- first-match tips (each shows once per browser) ----------
const TIPS = [
  { id: 'start', when: () => G.t > 2, text: 'Hold E next to a tree to chop wood, then press Tab to craft. A Wood Sword costs 2 wood.' },
  { id: 'sword', when: h => ['sword1', 'sword2', 'sword3', 'sword4'].some(id => count(h, id)) && !(heldId(h) && ITEMS[heldId(h)].tier), text: 'Swords only count while you hold them. Select yours with 1–9 or the mouse wheel.' },
  { id: 'swamp', when: h => h.biome === 3, text: 'Potions spawn in the swamp. They don’t stack: press R to refill empty hotbar slots from your backpack.' },
  { id: 'tunnel', when: h => world.entrances.some(e => hyp(e.x - h.x, e.y - h.y) < 120), text: 'Press E at a tunnel entrance to go underground. Rats drop hide for armour, but every kill pings your position to everyone.' },
  { id: 'planks', when: h => count(h, 'plank') > 0, text: 'Hold right-click with planks to place them. Look straight down and press Space to pillar up.' },
  { id: 'ruin', when: h => world.ruins.some(r => hyp(r.x - h.x, r.y - h.y) < 220), text: 'Ruins (gold squares on the map) hide loot chests. Watchtower chests are at the top: walk into the ladder to climb.' },
  { id: 'pvp', when: () => G.graceDone && G.clockMin > G.grace + 0.2, text: 'PvP is on. F or right-click drinks a potion mid-fight. Hold P to see who’s left.' },
  { id: 'low', when: h => h.hp < 8 && hotPots(h) > 0, text: 'Low health: drink a potion with F or right-click.' },
  { id: 'legend', when: () => G.t > 25, text: 'Gold stars on the map are landmarks, each holding one legendary item. Follow the light beams. Whoever takes one, everyone finds out.' },
  { id: 'feast', when: () => !!G.feast, text: 'The feast has the best gear in the game. Everyone else is heading there too.' },
  { id: 'night', when: () => DAY.night > 0.5, text: 'Night falls before the pit. Names are harder to read from a distance, and so is yours.' },
];
let tipsSeen = [];
try { tipsSeen = JSON.parse(localStorage.getItem('ff_tips')) || []; } catch (e) {}
let tipT = 0, tipHideT;
function checkTips(dt) {
  tipT -= dt;
  if (tipT > 0 || !G.settings.tips || !G.human.alive || !$('#tipbox').hidden) return;
  tipT = 0.5;
  const t = TIPS.find(t => !tipsSeen.includes(t.id) && t.when(G.human));
  if (!t) return;
  tipsSeen.push(t.id);
  try { localStorage.setItem('ff_tips', JSON.stringify(tipsSeen)); } catch (e) {}
  const el = $('#tipbox'); el.querySelector('p').textContent = t.text; el.hidden = false;
  clearTimeout(tipHideT); tipHideT = setTimeout(() => el.hidden = true, 9000);
}
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
let bannerT;
function banner(title, sub) {
  const b = $('#banner'); b.querySelector('h2').textContent = title; b.querySelector('p').textContent = sub;
  b.hidden = false; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerT); bannerT = setTimeout(() => b.hidden = true, 4200);
  Sfx.play('bell');
}

// ---------- inventory screen ----------
// Click to pick up a stack, click again to put it down (or swap / merge). Right click takes half or
// places one. Shift-click moves between hotbar and backpack and puts armour on. Number keys over a
// slot swap it with that hotbar slot. The drop area throws the held stack on the ground.
const INV = { cursor: null, hover: null, tab: 'Weapons' };
function toggleInv() {
  const h = G.human;
  G.invOpen = !G.invOpen;
  if (G.invOpen) { unlockPointer(); mouse.down = mouse.rdown = false; renderInv(); }
  else {
    if (INV.cursor) { const l = give(h, INV.cursor.id, INV.cursor.n); if (l) dropStacks(h, [{ id: INV.cursor.id, n: l }]); INV.cursor = null; }
    $('#tip').hidden = true; lockPointer();
  }
  $('#inv').hidden = !G.invOpen;
  moveCursorStack();
}
const refOf = el => el.dataset.eq ? { eq: el.dataset.eq } : { i: +el.dataset.slot };
const getS = r => r.eq ? G.human.equip[r.eq] : G.human.slots[r.i];
function setS(r, v) { if (r.eq) G.human.equip[r.eq] = v; else G.human.slots[r.i] = v; bump(G.human); }
function clickSlot(r, right, shift) {
  const s = getS(r), c = INV.cursor;
  if (r.eq && c && ITEMS[c.id].slot !== r.eq) { toast('Only ' + { head: 'helmets', chest: 'chest armour', legs: 'leggings', feet: 'boots' }[r.eq] + ' go there'); return; }
  if (shift && !c && s) { quickMove(r); return; }
  if (!c) {
    if (!s) return;
    if (right && s.n > 1) { const k = Math.ceil(s.n / 2); INV.cursor = { id: s.id, n: k }; s.n -= k; bump(G.human); }
    else { INV.cursor = s; setS(r, null); }
  } else if (!s) {
    if (right && c.n > 1) { setS(r, { id: c.id, n: 1 }); c.n--; }
    else { setS(r, c); INV.cursor = null; }
  } else if (s.id === c.id && ITEMS[s.id].stack > 1) {
    const k = Math.min(ITEMS[s.id].stack - s.n, right ? 1 : c.n);
    s.n += k; c.n -= k; if (!c.n) INV.cursor = null; bump(G.human);
  } else { setS(r, c); INV.cursor = s; }
  Sfx.play('pickup');
  renderInv(); moveCursorStack();
}
function moveInto(s, from, to) {
  const h = G.human, max = ITEMS[s.id].stack;
  for (let i = from; i < to && s.n; i++) { const t = h.slots[i]; if (t && t.id === s.id && t.n < max) { const k = Math.min(s.n, max - t.n); t.n += k; s.n -= k; } }
  for (let i = from; i < to && s.n; i++) if (!h.slots[i]) { h.slots[i] = { id: s.id, n: s.n }; s.n = 0; }
  return s.n;
}
function quickMove(r) {
  const h = G.human, s = getS(r), it = ITEMS[s.id];
  if (r.eq) {
    setS(r, null);
    const copy = { ...s };
    if (moveInto(copy, HOTBAR, SLOTS) && moveInto(copy, 0, HOTBAR)) setS(r, s);
  } else if (it.slot) { const cur = h.equip[it.slot]; h.equip[it.slot] = s; h.slots[r.i] = cur; }
  else {
    const copy = { ...s }; h.slots[r.i] = null;
    const left = r.i < HOTBAR ? moveInto(copy, HOTBAR, SLOTS) : moveInto(copy, 0, HOTBAR);
    if (left) h.slots[r.i] = { id: s.id, n: left };
  }
  bump(h); renderInv();
}
function swapWithHotbar(r, k) {
  if (r.eq) return;
  const h = G.human; [h.slots[r.i], h.slots[k]] = [h.slots[k], h.slots[r.i]]; bump(h); renderInv();
}
function moveCursorStack() {
  const el = $('#cursor-stack'), c = INV.cursor;
  el.hidden = !c || !G.invOpen;
  if (!c) return;
  const html = slotInner(c, G.human);
  if (el._h !== html) { el._h = html; el.innerHTML = html; }
  el.style.transform = `translate(${mouse.x - 22}px, ${mouse.y - 22}px)`;
}
function slotBtn(s, attr, label) {
  return `<button class="islot ${s ? '' : 'empty'} ${s && ITEMS[s.id].legendary ? 'legend' : ''}" ${attr}>${slotInner(s, G.human)}${!s && label ? `<small>${label}</small>` : ''}</button>`;
}
function renderInv() {
  const h = G.human;
  const eqLabels = { head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet' };
  setHTML('#equip', ARMOR_SLOTS.map(k => slotBtn(h.equip[k], `data-eq="${k}"`, eqLabels[k])).join(''));
  const def = armorDef(h);
  setHTML('#inv-stats', `<div><span>Health</span><b>${Math.ceil(h.hp)}/20</b></div><div><span>Armour</span><b>−${Math.round(def * 100)}%</b></div>
    <div><span>Held</span><b>${heldId(h) ? escapeHTML(itemName(heldId(h), h)) : 'Fists'}</b></div><div><span>Melee</span><b>${(WDMG[h.weapon] + (h.kit === 'killer' ? 1 : 0)).toFixed(1)}</b></div>`);
  setHTML('#pack', Array.from({ length: SLOTS - HOTBAR }, (_, q) => slotBtn(h.slots[q + HOTBAR], `data-slot="${q + HOTBAR}"`)).join(''));
  setHTML('#hot', Array.from({ length: HOTBAR }, (_, i) => slotBtn(h.slots[i], `data-slot="${i}"`, i + 1)).join(''));
  const cats = [...new Set(RECIPES.map(r => r.cat))];
  setHTML('#craft-tabs', cats.map(c => `<button class="ctab ${INV.tab === c ? 'on' : ''}" data-tab="${c}">${c}</button>`).join(''));
  setHTML('#recipes', RECIPES.filter(r => r.cat === INV.tab).map(r => {
    const ok = canCraft(h, r), have = count(h, r.out) + ARMOR_SLOTS.filter(k => h.equip[k] && h.equip[k].id === r.out).length;
    const cost = Object.entries(r.cost).map(([k, v]) => `<span class="cost ${count(h, k) >= v ? '' : 'short'}"><img src="${iconURL(k)}" alt="">${v}</span>`).join('');
    return `<button class="recipe ${ok ? '' : 'off'}" data-r="${r.out}"><img class="ri" src="${iconURL(r.out)}" alt=""><span class="rn">${ITEMS[r.out].name}${(r.n || 1) > 1 ? ` ×${r.n}` : ''}<small>Have ${have}</small></span><span class="rc">${cost}</span></button>`;
  }).join(''));
}
function showTip(el) {
  const tip = $('#tip');
  let id = null;
  if (el.dataset.r) id = el.dataset.r;
  else if (el.dataset.slot !== undefined || el.dataset.eq) { const s = getS(refOf(el)); id = s && s.id; }
  if (!id) { tip.hidden = true; return; }
  const it = ITEMS[id], h = G.human, lines = [];
  if (it.legendary) { const lm = Object.entries(LANDMARKS).find(([, l]) => l.item === id); lines.push(`Legendary · one per match${lm ? ` · from ${lm[1].name}` : ''}`); }
  if (it.tier) lines.push(`${WDMG[it.tier]} damage per hit`);
  if (it.def) lines.push(`Blocks ${Math.round(it.def * 100)}% of damage`);
  if (id === 'kit') lines.push(KITS[h.kit].desc);
  if (it.desc) lines.push(it.desc);
  if (el.dataset.r && !canCraft(h, recipe(id))) lines.push('Missing materials');
  if (el.dataset.r) lines.push('Click to craft · Shift-click to craft as many as you can');
  tip.innerHTML = `<b>${escapeHTML(itemName(id, h))}</b>${lines.map(l => `<p>${escapeHTML(l)}</p>`).join('')}`;
  const r = el.getBoundingClientRect();
  tip.hidden = false;
  tip.style.left = Math.min(innerWidth - 260, r.right + 8) + 'px'; tip.style.top = Math.max(8, Math.min(innerHeight - 140, r.top)) + 'px';
}
$('#inv').addEventListener('mouseover', e => {
  const el = e.target.closest('.islot, .recipe');
  INV.hover = el && (el.dataset.slot !== undefined || el.dataset.eq) ? refOf(el) : null;
  if (el) showTip(el); else $('#tip').hidden = true;
});
$('#inv').addEventListener('contextmenu', e => { e.preventDefault(); const el = e.target.closest('.islot'); if (el) clickSlot(refOf(el), true, e.shiftKey); });
$('#inv').addEventListener('click', e => {
  const h = G.human, el = e.target.closest('button, #drop-zone');
  if (!el) return;
  if (el.classList.contains('islot')) { clickSlot(refOf(el), false, e.shiftKey); showTip(el); return; }
  if (el.dataset.tab) { INV.tab = el.dataset.tab; renderInv(); return; }
  if (el.dataset.r) {
    const r = recipe(el.dataset.r);
    if (!canCraft(h, r)) { toast('Missing materials for ' + ITEMS[r.out].name); return; }
    const n = craft(h, r, e.shiftKey ? 64 : 1);
    G.stats.crafted += n;
    toast(`Crafted ${n * (r.n || 1)} × ${ITEMS[r.out].name}`); Sfx.play('craft'); renderInv(); showTip(el); return;
  }
  if (el.id === 'drop-zone') {
    if (!INV.cursor) { toast('Pick up a stack first, then click here to drop it'); return; }
    if (INV.cursor.id === 'kit') { toast('Kit items can’t be dropped'); return; }
    dropStacks(h, [INV.cursor]); INV.cursor = null; moveCursorStack(); renderInv(); return;
  }
  if (el.id === 'inv-close') toggleInv();
});

// ---------- screens ----------
function setMode(m) {
  G.mode = m;
  $('#screen-play').hidden = m !== 'menu';
  $('#screen-options').hidden = m !== 'options' && m !== 'paused';
  $('#screen-end').hidden = m !== 'end';
  $('#hud').hidden = !(m === 'play' || m === 'paused' || m === 'spectate');
  $('#hud').classList.toggle('spec', m === 'spectate');
  $('#spec').hidden = m !== 'spectate';
  if (m !== 'play') { $('#board').hidden = true; $('#tipbox').hidden = true; }
  if (m !== 'play') { $('#inv').hidden = true; G.invOpen = false; $('#chat').hidden = true; G.chatOpen = false; }
  $('#opt-resume').hidden = m !== 'paused';
  $('#opt-leave').hidden = m !== 'paused';
  $('#opt-back').hidden = m === 'paused';
  $('#pause-note').hidden = !(m === 'paused' && NET.on);
}
function pause() { unlockPointer(); mouse.down = mouse.rdown = false; if (G.human) G.human.sneak = false; setMode('paused'); fillOptions(); }
function resume() { save(); setMode('play'); last = performance.now(); lockPointer(); }
function endGame(won) {
  if (G.over) return;
  G.over = true;
  const h = G.human, place = G.fighters.filter(f => f.alive && !f.isClone).length + (won ? 0 : 1);
  if (won) G.coinsEarned += 200;
  STORE.coins += G.coinsEarned;
  const life = STORE.life = STORE.life || { matches: 0, wins: 0, kills: 0, best: 0, fall: 0 };
  life.matches++; if (won) life.wins++; life.kills += h.kills;
  if (!life.best || place < life.best) life.best = place;
  life.fall = Math.max(life.fall, G.stats.fall);
  save();
  setTimeout(() => {
    $('#end-title').textContent = won ? 'Last one standing' : 'You lost';
    $('#end-sub').textContent = won ? 'Everyone else is dead.' : G.killedBy ? `Killed by ${G.killedBy}.` : `${G.winnerName || 'Someone'} won the match.`;
    const st = G.stats;
    $('#end-stats').innerHTML = [['Place', `#${place} of ${G.fighters.filter(f => !f.isClone).length}`], ['Kills', h.kills], ['Survived', fmt(G.clockMin)], ['Coins earned', `+${G.coinsEarned}`],
      ['Damage dealt', st.dmg.toFixed(0)], ['Blocks placed', st.blocks], ['Longest fall', `${st.fall.toFixed(1)} blocks`], ['Potions drunk', st.pots]]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('#end-online').hidden = !NET.on || won;
    $('#btn-spec').hidden = won || !G.fighters.some(f => f.alive && !f.isClone && f !== G.human);
    unlockPointer();
    setMode('end');
  }, 1100);
}
function backToMenu() { if (NET.match) leaveMatch(); startAttract(); setMode('menu'); renderKits(); }
function fillOptions() {
  $('#o-len').value = G.settings.len; $('#o-bots').value = G.settings.bots;
  $('#o-bots-v').textContent = G.settings.bots;
  $('#o-snow').checked = G.settings.snow; $('#o-dmg').checked = G.settings.dmgNums;
  $('#o-shadows').checked = G.settings.shadows; $('#o-sens').value = G.settings.sens; $('#o-vol').value = G.settings.vol;
  $('#o-fov').value = G.settings.fov; $('#o-fov-v').textContent = G.settings.fov; $('#o-tips').checked = G.settings.tips; $('#o-map').value = G.settings.mapSize;
}
$('#o-len').addEventListener('change', e => { G.settings.len = +e.target.value; save(); });
$('#o-bots').addEventListener('input', e => { G.settings.bots = +e.target.value; $('#o-bots-v').textContent = e.target.value; save(); });
$('#o-snow').addEventListener('change', e => { G.settings.snow = e.target.checked; save(); });
$('#o-dmg').addEventListener('change', e => { G.settings.dmgNums = e.target.checked; save(); });
$('#o-shadows').addEventListener('change', e => { G.settings.shadows = e.target.checked; save(); });
$('#o-sens').addEventListener('input', e => { G.settings.sens = +e.target.value; save(); });
$('#o-vol').addEventListener('input', e => { G.settings.vol = +e.target.value; Sfx.setVolume(G.settings.vol); save(); });
$('#o-fov').addEventListener('input', e => { G.settings.fov = +e.target.value; $('#o-fov-v').textContent = e.target.value; save(); });
$('#o-map').addEventListener('change', e => { G.settings.mapSize = +e.target.value; save(); });
$('#o-tips').addEventListener('change', e => { G.settings.tips = e.target.checked; save(); });
$('#o-tips-reset').addEventListener('click', () => { tipsSeen = []; try { localStorage.removeItem('ff_tips'); } catch (e) {} toast('Tips will show again'); $('#o-tips-reset').textContent = 'Tips reset'; });
$('#btn-spec').addEventListener('click', startSpectate);
$('#btn-options').addEventListener('click', () => { fillOptions(); setMode('options'); });
$('#opt-back').addEventListener('click', () => { setMode('menu'); renderKits(); });
$('#opt-resume').addEventListener('click', resume);
$('#opt-leave').addEventListener('click', backToMenu);
$('#btn-play').addEventListener('click', startGame);
$('#btn-again').addEventListener('click', backToMenu);
$('#nick').addEventListener('input', e => { LOBBY.nick = e.target.value.replace(/[^\w .\-]/g, '').slice(0, 18) || 'Player'; save(); lobbyPresence(); if (NET.match) NET.match.presence({ n: LOBBY.nick }).catch(() => {}); });
$('#btn-host').addEventListener('click', hostMatch);
$('#btn-leave-match').addEventListener('click', leaveMatch);
$('#btn-start').addEventListener('click', startHostedMatch);
$('#m-bots').addEventListener('input', e => { $('#m-bots-v').textContent = e.target.value; });

let buyOpen = null;
function renderKits() {
  $('#coins').textContent = STORE.coins;
  const L = STORE.life || {};
  $('#record').textContent = L.matches ? `Your record: ${L.matches} match${L.matches > 1 ? 'es' : ''} · ${L.wins} win${L.wins === 1 ? '' : 's'} · ${L.kills} kills · best #${L.best} · longest fall ${Math.round(L.fall)} blocks` : '';
  $('#kits').innerHTML = Object.entries(KITS).map(([id, K]) => {
    const avail = kitAvailable(id), sel = STORE.kit === id;
    const tag = K.locked ? 'Not in this build' : FREE.includes(id) ? 'Free this week' : STORE.owned.includes(id) ? 'Owned' : `${KIT_PRICE} coins`;
    const buy = buyOpen === id && !avail && !K.locked ? `<div class="buy">
        <button class="b-coins" data-buy="${id}" ${STORE.coins < KIT_PRICE ? 'disabled' : ''}>Unlock · ${KIT_PRICE} coins</button>
        <button class="b-cash" data-cash="${id}">Buy with money</button></div>` : '';
    return `<div class="kit ${sel ? 'sel' : ''} ${avail ? '' : 'locked'}" data-kit="${id}" tabindex="0" role="button" aria-pressed="${sel}">
      <div class="kit-top"><h3>${K.name}</h3><span class="tag">${tag}</span></div><p>${K.desc}</p>${buy}</div>`;
  }).join('');
}
$('#kits').addEventListener('click', e => {
  const buy = e.target.closest('[data-buy]'), cash = e.target.closest('[data-cash]');
  if (buy) { STORE.coins -= KIT_PRICE; STORE.owned.push(buy.dataset.buy); STORE.kit = buy.dataset.buy; buyOpen = null; save(); renderKits(); lobbyPresence(); return; }
  if (cash) { $('#store-note').textContent = 'Real-money purchases are not part of this prototype. Earn coins with kills: 50 per kill, 200 for a win.'; return; }
  const card = e.target.closest('.kit'); if (!card) return;
  const id = card.dataset.kit;
  if (kitAvailable(id)) { STORE.kit = id; buyOpen = null; save(); lobbyPresence(); if (NET.match) NET.match.presence({ k: id }).catch(() => {}); }
  else buyOpen = buyOpen === id ? null : id;
  $('#store-note').textContent = '';
  renderKits();
});
$('#kits').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('kit')) { e.preventDefault(); e.target.click(); } });

startAttract(); renderKits(); setMode('menu');
netInit();
requestAnimationFrame(frame);
