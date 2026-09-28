'use strict';
// Match flow, input, HUD, inventory screen, screens (Play ↔ Options ↔ Game → Lose → Play), kit store.
const $ = s => document.querySelector(s);
function setHTML(sel, html) { const el = $(sel); if (el._h !== html) { el._h = html; el.innerHTML = html; } }
G.settings = { len: 8, bots: 23, snow: true, dmgNums: true, shadows: true, sens: 1, vol: 0.6, fov: 75, tips: true, mapSize: 4800, mapType: 'mixed', botLevel: 1, mode: 'solo', voice: true };
G.mode = 'menu';
const STORE = { coins: 150, owned: [], kit: 'killer', life: { matches: 0, wins: 0, kills: 0, best: 0, fall: 0 } };
try { const s = JSON.parse(localStorage.getItem('ff_store')); if (s) Object.assign(STORE, s); } catch (e) {}
try { const s = JSON.parse(localStorage.getItem('ff_settings')); if (s) Object.assign(G.settings, s); } catch (e) {}
Sfx.setVoice(G.settings.voice);
function save() {
  try { localStorage.setItem('ff_store', JSON.stringify(STORE)); localStorage.setItem('ff_settings', JSON.stringify(G.settings)); localStorage.setItem('ff_nick', LOBBY.nick); } catch (e) {}
}
const KIT_PRICE = 150;
function weeklyFree() {
  const wk = Math.floor((Date.now() / 864e5 + 3) / 7), r = mulberry32(wk * 7919);
  const ids = Object.keys(KITS).filter(k => !KITS[k].locked);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, 8);
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
    if (hyp(x - PIT.x, y - PIT.y) < PIT.r + 80 || (!inSwamp && seaAt(x, y))) continue;
    if (nearObjs(x, y, 40).some(o => hyp(o.x - x, o.y - y) < o.r + 20)) continue;
    if (!inSwamp && taken.some(p => hyp(p.x - x, p.y - y) < (taken.length > 40 ? 180 : 320))) continue;
    // Nobody starts next to a landmark or a ruin: legendaries and loot have to be reached
    if (world.landmarks.some(m => m.layer === 0 && hyp(m.x - x, m.y - y) < 450) || world.ruins.some(r => hyp(r.x - x, r.y - y) < 220)) continue;
    if (lavaPoolAt(x, y, 120)) continue;
    return { x, y };
  }
  return { x: rr(300, WORLD - 300), y: rr(300, WORLD - 300) };
}
// Recluse: of many valid spawn points, the one furthest from everyone already placed
function loneliestPoint(taken) {
  let best = null, bd = -1;
  for (let i = 0; i < 60; i++) {
    const p = spawnPoint([], false), d = Math.min(1e9, ...taken.map(q => hyp(q.x - p.x, q.y - p.y)));
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}
// A clear spot next to someone (a duos partner)
function besidePoint(o) {
  for (let i = 0; i < 24; i++) {
    const a = rr(0, 6.28), d = rr(40, 80), x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
    if (!seaAt(x, y) && !lavaPoolAt(x, y, 40) && !nearObjs(x, y, 40).some(q => hyp(q.x - x, q.y - y) < q.r + 16)) return { x, y };
  }
  return { x: o.x + 30, y: o.y };
}
function makeBot(name, id, kit) {
  const kits = Object.keys(KITS).filter(k => !KITS[k].locked), rk = pick(kits);
  const b = new Fighter(name, kit || rk, true, id), L = botLvl();
  Object.assign(b, { style: pick(STYLES), react: rr(L.react[0], L.react[1]), side: 1, side2: rng() < .5 ? -1 : 1, bountyKeen: rng() < 0.3, pers: pick(PERS_LIST) });
  if (['tripwire', 'snare', 'updraft'].includes(b.kit)) b.style = 'trapper';
  return b;
}
// Deterministic from the seed, so every player in an online match builds the same world and bots.
function newMatch(nBots, human, seed = Math.floor(Math.random() * 1e9), humans = null, size = G.settings.mapSize, type = G.settings.mapType, duo = false) {
  genWorld(seed, MAP_SIZES[size] ? size : 4800, type);
  resetBlocks();
  buildRuins();
  buildLandmarks();
  Object.assign(G, { fighters: [], rats: [], proj: [], fx: [], items: [], pings: [], feed: [], itemSeq: 0, t: 0, clockMin: 0, graceDone: false, feast: null, pit: false, over: false, coinsEarned: 0, killedBy: null,
    winShown: false, dmgDir: null, specTarget: null, lmSeen: {}, duels: [], killer: null, teams: [], teamSeq: 0, allyT: 0,
    bounty: null, bountySeen: null, bountyPingT: 0, bountyCheck: 0, qpings: [], noises: [], pathBudget: 0, graves: [], duo: !!duo, ann: {}, stats: { dmg: 0, blocks: 0, broken: 0, fall: 0, pots: 0, crafted: 0, assists: 0 } });
  replayReset(); resetPaths();
  // Rivals (solo only): bots that killed you before come back as themselves
  const rivals = human && !humans && !NET.on ? rivalBots() : [];
  const names = BOT_NAMES.filter(n => !rivals.some(r => r.name === n));
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const taken = [];
  const all = humans ? [...humans] : human ? [human] : [];
  for (let i = 0; i < nBots; i++) all.push(i < rivals.length ? makeRival(rivals[i], 'b' + i) : makeBot(names[i % names.length] + (i >= names.length ? String(Math.floor(i / names.length) + 1) : ''), 'b' + i));
  formSquads(all); // duos: pairs, humans first
  if (!G.duo) all.sort((a, b) => (a.kit === 'recluse') - (b.kit === 'recluse')); // Recluses pick their spot after everyone else
  for (const f of all) {
    const mate = G.duo && G.fighters.find(o => o.squad === f.squad); // partners start side by side
    const p = mate ? besidePoint(mate) : f.kit === 'recluse' ? loneliestPoint(taken) : spawnPoint(taken, f.kit === 'finder');
    Object.assign(f, { x: p.x, y: p.y, z: heightAt(p.x, p.y), onGround: true }); taken.push(p); G.fighters.push(f);
  }
  if (!NET.on || NET.isHost()) {
    for (let i = 0; i < potCap(); i++) spawnPot();
    for (const r of world.ruins) addItem({ kind: 'chest', x: r.x, y: r.y, z: r.chestZ, layer: 0, stacks: ruinLoot(r) });
    for (const c of world.caves) addItem({ kind: 'chest', x: c.x, y: c.y, z: 0, layer: 1, stacks: caveLoot() });
    for (const m of world.landmarks) addItem({ kind: 'relic', x: m.x, y: m.y, z: m.chestZ, layer: m.layer, stacks: [{ id: LANDMARKS[m.id].item, n: 1 }, { id: 'pot', n: 2 }] });
  }
  spawnBikes(); spawnHelis(); resetDigs(); resetRifts();
  for (const o of world.objs) o.a0 = o.amt; // so a spectator joining late can be told what's been used up
  for (const o of world.ores) o.a0 = o.amt;
  NET.blkLog = new Map();
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
// Supply drops: announced three in-game minutes ahead, then a crate parachutes down for the last few seconds
const DROP_FALL = 6; // real seconds the crate is visible falling
const SUPPLY_LOOT = [
  [['sword3', 1], ['pot', 2], ['bucket_water', 1]],
  [['bow', 1], ['arrow', 20], ['bucket_lava', 1], ['pot', 1]],
  [['iron_chest', 1], ['pot', 2], ['charm', 1], ['bucket', 1]],
  [['bucket_lava', 1], ['bucket_water', 1], ['cobble', 32], ['pot', 1]],
  [['sword3', 1], ['hay', 4], ['pot', 2], ['bucket', 1]],
  [['iron_head', 1], ['iron_feet', 1], ['bucket_water', 1], ['pot', 2]],
];
const supplyLoot = () => pick(SUPPLY_LOOT).map(([id, n]) => ({ id, n }));
const dropCrate = d => G.items.find(i => i.kind === 'supply' && !i.gone && hyp(i.x - d.x, i.y - d.y) < 60);
const dropLive = d => d.st === 'announced' || d.st === 'falling' || (d.st === 'landed' && !!dropCrate(d));
function updateDrops() {
  const m = G.clockMin, host = !NET.on || NET.isHost();
  for (const d of world.drops || []) {
    const land = d.min * G.settings.len; // G.t when it touches down
    if (!d.st && m >= d.min - 3 && !G.pit) {
      d.st = 'announced';
      const a = Math.atan2(d.y - PIT.y, d.x - PIT.x), dir = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
      banner('Supply drop incoming', `Lands in 3:00 in the ${dir} · marked in blue on your map`);
      Sfx.say(`Supply drop incoming, ${dir}`);
    }
    if (d.st === 'announced' && G.t >= land - DROP_FALL) d.st = 'falling';
    if (d.st === 'falling' && G.t >= land) {
      d.st = 'landed';
      if (host) addItem({ kind: 'supply', x: d.x, y: d.y, z: heightAt(d.x, d.y), layer: 0, stacks: supplyLoot() });
      Sfx.play('thud', d.x, d.y, heightAt(d.x, d.y));
      addFx('puff', d.x, d.y, 0, { col: '#cfc3a8', big: true });
      G.feed.unshift({ txt: 'The supply drop has landed', t: 8, relic: true });
    }
  }
}
// Top-left line while a drop is on: time or status, distance and which way to turn
function dropLine() {
  const d = (world.drops || []).find(dropLive);
  if (!d) return '';
  const h = G.human, dist = Math.round(hyp(d.x - h.x, d.y - h.y) / B), a = angDiff(h.face, Math.atan2(d.y - h.y, d.x - h.x));
  const arrow = '↑↗→↘↓↙←↖'[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  const when = d.st === 'landed' ? 'Supply drop landed' : `Supply drop in ${fmt((d.min * G.settings.len - G.t) / G.settings.len)}`;
  return `${when} · ${dist} blocks ${arrow}`;
}
// A cave's chest: iron gear and the ore to make more
function caveLoot() {
  const s = [{ id: pick(['sword3', 'sword3', 'hide_chest', 'bucket']), n: 1 }, { id: 'iron', n: 2 + Math.floor(rng() * 3) }, { id: 'pot', n: 1 }];
  if (rng() < 0.4) s.push({ id: 'charm', n: 1 });
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
  NET.on = false; G.watching = false; G.botLevel = 1;
  G.grace = 0;
  newMatch(12, null, undefined, null, 3200); // a small map behind the menu loads fast
  G.human = { x: PIT.x, y: PIT.y, z: 0, layer: 0, biome: 0, alive: false, face: 0, id: 'cam' };
  camFocus = null;
}
function startGame() {
  NET.on = false; G.watching = false; G.freeCam = null;
  G.grace = 2; G.botLevel = G.settings.botLevel ?? 1;
  const h = new Fighter(LOBBY.nick || 'You', STORE.kit, false, 'me');
  newMatch(G.settings.bots, h, undefined, null, G.settings.mapSize, G.settings.mapType, G.settings.mode === 'duos');
  for (const b of G.fighters.filter(f => f.rival)) { // rivals announce themselves
    setTimeout(() => { if (b.alive && G.human === h) { G.feed.unshift({ txt: `Your rival ${b.name} is in this match`, t: 9, streak: true }); botSay(b, 'rival', h); } }, 3500);
  }
  G.human = h;
  VIEW.pitch = -0.05;
  Sfx.start(); Sfx.setVolume(G.settings.vol);
  setMode('play');
  lockPointer();
  const mate = partnerOf(h);
  banner(mate ? 'Duos' : 'Grace period', mate ? `Your partner is ${mate.name} (green marker). Stick together: you can revive each other. PvP at 02:00.` : `${G.settings.bots} bots. PvP turns on at 02:00. Chop wood, craft planks, find potions.`);
  Sfx.setVoice(G.settings.voice);
}

// ---------- phases ----------
function fmt(min) { const s = Math.max(0, Math.floor(min * 60)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function phases() {
  const m = G.clockMin, host = !NET.on || NET.isHost();
  if (!G.graceDone && m >= G.grace) { G.graceDone = true; banner('PvP is on', 'Kill or be killed.'); Sfx.say('Fight!', true); }
  if (!G.feast && m >= 20) {
    G.feast = { site: FEAST_SITES[world.seed % FEAST_SITES.length], state: 'announced' };
    banner('Feast announced', `${G.feast.site.name} · opens at 25:00 · marked on your map`);
    Sfx.say(`The feast has been announced at ${G.feast.site.name}`);
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
    Sfx.say('The feast is open');
  }
  if (G.feast && G.feast.state === 'spawned' && !G.items.some(i => i.kind === 'feast' && !i.gone)) G.feast.state = 'done';
  if (!G.pit && m >= 60) {
    G.pit = true;
    const alive = G.fighters.filter(f => f.alive && !f.isClone);
    G.fighters.forEach(f => { if (f.isClone) f.alive = false; });
    alive.forEach((f, i) => {
      if (f.remote) return;
      if (f.bike) dismountBike(f, true);
      if (f.heli) leaveHeli(f, true);
      const a = i / alive.length * 6.28, x = PIT.x + Math.cos(a) * 250, y = PIT.y + Math.sin(a) * 250;
      Object.assign(f, { layer: 0, x, y, z: heightAt(x, y), vz: 0, onGround: true, gather: null, plan: null, path: null, hidden: false });
    });
    banner('The pit', 'Time is up. Everyone left is in the arena. Last one standing wins.');
    Sfx.say('Final showdown. Everyone to the pit.', true);
  }
  if (DAY.night > 0.5 && !G.ann.night && !G.pit) { G.ann.night = true; Sfx.say('Night is falling'); }
  updateDrops();
}

// ---------- key bindings (Options → Controls) ----------
// Every action key can be changed. Number keys (hotbar), Esc and the arrow keys stay fixed.
const BIND_DEFAULTS = { fwd: 'w', back: 's', left: 'a', right: 'd', jump: ' ', sneak: 'shift', use: 'e', kit: 'q', drink: 'f', refill: 'r', drop: 'g', inv: 'tab', map: 'm', board: 'p', wheel: 'c', chat: 't', seat: 'x' };
const BIND_LABELS = { fwd: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump · swim up · fly up', sneak: 'Sneak · fly down', use: 'Interact (doors, vehicles, tunnels, gather, revive)',
  kit: 'Kit ability', drink: 'Drink a potion', refill: 'Refill the hotbar', drop: 'Drop the held item', inv: 'Inventory and crafting', map: 'Full-screen map', board: 'Scoreboard (hold)', wheel: 'Emotes and quick chat (hold)', chat: 'Chat (online)', seat: 'Swap helicopter seat' };
const BINDS = { ...BIND_DEFAULTS };
try { const b = JSON.parse(localStorage.getItem('ff_keys')); if (b) for (const a in BIND_DEFAULTS) if (typeof b[a] === 'string' && b[a]) BINDS[a] = b[a]; } catch (e) {}
const keyHeld = a => keys.has(BINDS[a]);
const keyName = k => ({ ' ': 'Space', shift: 'Shift', tab: 'Tab', control: 'Ctrl', alt: 'Alt', enter: 'Enter', backspace: 'Backspace', capslock: 'Caps Lock', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[k] || (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1)));
const kbd = a => `<kbd>${escapeHTML(keyName(BINDS[a]))}</kbd>`;
const isKey = (k, a) => k === BINDS[a];

// ---------- input (first person, pointer lock) ----------
const keys = new Set();
const mouse = { down: false, rdown: false, x: 0, y: 0 };
// The camera only turns while the mouse is captured. If the browser refuses a capture (Chrome does for about a
// second after Esc), the game shows "Click to play" and waits for a click instead of steering with the cursor.
const noLock = !('requestPointerLock' in HTMLElement.prototype); // only when the browser has no pointer lock at all
let locked = false, wantLock = false;
const SENS = 0.0022;
// Some windows (embedded browsers, some app views) never allow capture. After a real click fails twice, the game
// switches to free-look: the cursor is hidden, moving the mouse turns the view, and the window edges keep turning.
let lockRetry = null, lastExit = -1e9, freeLook = false;
function enableFreeLook() {
  if (freeLook) return;
  freeLook = true;
  toast('This window can’t capture the mouse, so moving it turns the view directly. Push against the edge to keep turning. For full mouse control, play in Chrome, Edge or the desktop app.');
  setTimeout(() => { const t = $('#toast'); if (t.textContent.startsWith('This window')) t.hidden = true; }, 7000);
}
function lockPointer(retry = true, gesture = true) {
  wantLock = true;
  clearTimeout(lockRetry);
  if (noLock || freeLook || document.pointerLockElement === cv) return;
  // Chrome refuses a capture for about a second after Esc; try once more while the click still counts.
  // If that fails too, and it wasn't just the Esc cooldown, this window can't capture at all.
  const again = () => {
    if (retry) lockRetry = setTimeout(() => { if (wantLock && G.mode === 'play' && !G.invOpen && !G.chatOpen) lockPointer(false, gesture); }, 1100);
    else if (gesture && performance.now() - lastExit > 2500 && G.mode === 'play') enableFreeLook();
  };
  const plain = () => { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(again); } catch (e) { again(); } };
  // Raw mouse input (no Windows acceleration) where supported, otherwise a normal capture
  try { const p = cv.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(e => { if (e && e.name === 'NotSupportedError') plain(); else again(); }); else if (!p) plain(); }
  catch (e) { plain(); }
}
function unlockPointer() { wantLock = false; clearTimeout(lockRetry); if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('mouseout', e => { if (!e.relatedTarget) { mouse.x = innerWidth / 2; mouse.y = innerHeight / 2; } }); // left the window: stop edge turning
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cv;
  if (!locked) lastExit = performance.now();
  if (!locked && G.mode === 'play' && !G.invOpen && !G.chatOpen && !G.over && wantLock) pause();
});
document.addEventListener('pointerlockerror', () => {}); // a refused capture: "Click to play" shows, and a click retries
document.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (G.invOpen) { moveCursorStack(); return; }
  if (wheelMove(e.movementX, e.movementY)) return; // choosing on the emote / quick-chat wheel
  if (G.mode === 'spectate' && G.freeCam && locked) { // free camera: look around
    const k = SENS * G.settings.sens;
    G.freeCam.yaw += e.movementX * k; G.freeCam.pitch = clamp(G.freeCam.pitch - e.movementY * k, -1.5, 1.5);
    return;
  }
  if (G.mode !== 'play' || !G.human.alive || G.chatOpen || (!locked && !noLock && !freeLook)) return;
  // Chrome sometimes reports one huge jump right after capture: ignore it
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  const k = SENS * G.settings.sens;
  if (G.human.bike) { VIEW.lookYaw = clamp((VIEW.lookYaw || 0) + e.movementX * k, -2.6, 2.6); VIEW.lookT = performance.now(); } // riding: the mouse swings the camera
  else if (G.human.heli && G.human.seat === 'gunner') { // the gunner turns the chin gun, which only swings so far either side of the nose
    G.human.aimYaw = clamp((G.human.aimYaw || 0) + e.movementX * k, -TURRET, TURRET);
    VIEW.pitch = clamp(VIEW.pitch - e.movementY * k, -1.35, 0.3);
    return;
  }
  else G.human.face += e.movementX * k;
  VIEW.pitch = clamp(VIEW.pitch - e.movementY * k, -1.45, 1.3);
});
addEventListener('keydown', e => {
  if (G.chatOpen) return;
  if (G.mode === 'replay') {
    if ([' ', 'escape', 'enter'].includes(e.key.toLowerCase())) { e.preventDefault(); replayFinish(); }
    return;
  }
  if (G.mode === 'spectate') {
    const k = e.key.toLowerCase();
    if (isKey(k, 'map')) { toggleBigMap(); return; }
    if (k === 'escape') { if (bigMapOpen()) { toggleBigMap(false); return; } if (G.freeCam) unlockPointer(); if (G.watching) backToMenu(); else if (!G.over) endGame(false); else setMode('end'); return; }
    if (k === 'f') { if (G.freeCam) { G.freeCam = null; unlockPointer(); spectate(1); } else startFreeCam(); return; }
    if (G.freeCam) { // WASD fly, Space up, Shift down, arrows go back to following someone
      if ([' ', 'shift', 'tab'].includes(k)) e.preventDefault();
      if (k === 'arrowright' || k === 'arrowleft') { G.freeCam = null; unlockPointer(); spectate(k === 'arrowright' ? 1 : -1); return; }
      keys.add(k); return;
    }
    if (k === 'arrowright' || isKey(k, 'right') || isKey(k, 'jump')) { e.preventDefault(); spectate(1); }
    else if (k === 'arrowleft' || isKey(k, 'left')) spectate(-1);
    return;
  }
  if (G.mode !== 'play') { if (e.key === 'Escape' && G.mode === 'paused') resume(); return; }
  const k = e.key.toLowerCase(), h = G.human;
  if (['tab', ' ', 'arrowup', 'arrowdown', 'shift'].includes(k) || Object.values(BINDS).includes(k)) e.preventDefault();
  if (isKey(k, 'wheel') && !G.invOpen && h.alive) { if (!e.repeat) openWheel(); return; } // hold: emotes and quick chat
  if (isKey(k, 'map') && !G.invOpen) { if (!e.repeat) toggleBigMap(); return; } // the full map
  if (k === 'escape' && bigMapOpen()) { toggleBigMap(false); return; }
  if (G.invOpen) {
    if (isKey(k, 'inv') || isKey(k, 'use') || k === 'escape') toggleInv();
    else if (k >= '1' && k <= '9' && INV.hover !== null) swapWithHotbar(INV.hover, +k - 1);
    else if ((isKey(k, 'drop') || isKey(k, 'kit')) && INV.hover !== null) dropFromSlot(INV.hover, e.ctrlKey);
    return;
  }
  if (isKey(k, 'sneak')) h.sneak = true;
  if (keys.has(k)) return;
  keys.add(k);
  if (k >= '1' && k <= '9') selectSlot(+k - 1);
  else if (k === 'escape') pause();
  else if (isKey(k, 'jump') && h.alive && !h.bike && !h.heli) jump(h);
  else if (isKey(k, 'inv')) toggleInv();
  else if (isKey(k, 'kit') && h.alive) { const a = aimWorld(); if (!useKit(h, a.x, a.y)) kitFail(h); }
  else if (isKey(k, 'refill') && canRefill(h) && h.refillT <= 0) h.refillT = 0.22;
  else if (isKey(k, 'drink')) drink(h);
  else if (isKey(k, 'drop') && h.alive && !h.heli) dropHeld(h, e.ctrlKey);
  else if (isKey(k, 'seat') && h.alive && h.heli) switchSeat(h);
  else if (isKey(k, 'chat') && NET.on) openChat();
  else if (isKey(k, 'use') && h.alive) {
    const d = aimDoor();
    if (h.bike) dismountBike(h);
    else if (h.heli) leaveHeli(h);
    else if (d) toggleDoor(d.i, d.j, d.k, h);
    else if (reviveTarget(h)) h.reviving = 0; // hold E by your partner's grave
    else if (!mountBike(h, nearBike(h)) && !boardHeli(h, nearHeli(h)) && !toggleLayer(h)) { const o = gatherTarget(h); if (o) { h.gather = o; h.gatherT = 0; } }
  }
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase(); keys.delete(k);
  if (isKey(k, 'wheel')) closeWheel();
  if (isKey(k, 'use') && G.human) G.human.gather = null;
  if (isKey(k, 'sneak') && G.human) G.human.sneak = false;
});
addEventListener('blur', () => { keys.clear(); mouse.down = mouse.rdown = false; if (G.human) G.human.sneak = false; if (G.mode === 'play' && !NET.on) pause(); });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  if (G.mode === 'replay') { replayFinish(); return; }
  if (G.mode === 'spectate') { if (G.freeCam) { if (!locked) cv.requestPointerLock(); } else spectate(e.button === 2 ? -1 : 1); return; }
  if (WHEEL_UI.open) { closeWheel(); return; }
  if (G.mode !== 'play' || !G.human.alive) return;
  if (G.invOpen) { toggleInv(); return; }
  if (!locked && !noLock && !freeLook) { lockPointer(); return; }
  if (G.human.bike) return; // hands on the handlebars
  if (G.human.heli) { // the gunner: hold left click for the chain gun, right click for a rocket. The pilot's hands are full.
    if (G.human.seat !== 'gunner') return;
    if (e.button === 0) mouse.down = true;
    else if (e.button === 2) fireRocket(G.human);
    return;
  }
  const h = G.human, item = heldId(h), bucket = item === 'bucket' || !!(item && ITEMS[item].bucket);
  const door = aimDoor();
  if (e.button === 2 && door && !h.sneak) { toggleDoor(door.i, door.j, door.k, h); return; } // right click opens doors (sneak to place against one)
  if (e.button === 2) { mouse.rdown = true; if (bucket) useBucket(h); else if (item === 'riftlantern') openRift(h, 1, VIEW.pitch); else if (!(item && ITEMS[item].block)) drink(h); return; }
  if (e.button !== 0) return;
  mouse.down = true;
  if (bucket) useBucket(h);
  else if (item === 'bow') { if (h.arrows > 0) h.charge = 0; else toast('No arrows. Craft them in the inventory (Tab).'); }
  else if (item === 'pot') drink(h);
  else if (item === 'kit') { const a = aimWorld(); if (!useKit(h, a.x, a.y)) kitFail(h); }
  else if (item === 'riftlantern') openRift(h, 0, VIEW.pitch);
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
// Buckets: an empty one scoops up what you aim at; a full one pours where a block would go
function useBucket(h) {
  if (!h.alive || h.bucketCd > G.t) return;
  if (h.layer) { toast('Buckets don’t work in the tunnels'); return; }
  h.bucketCd = G.t + 0.25;
  const id = heldId(h);
  if (id === 'bucket') {
    const cp = Math.cos(VIEW.pitch), s = h.size || 1;
    const t = scoopTarget(h.x, h.y, h.z + EYE * s, Math.cos(h.face) * cp, Math.sin(h.face) * cp, Math.sin(VIEW.pitch), REACH * (s > 1.5 ? 1.6 : 1));
    if (!t) { toast('Aim at swamp water, a lava pool, or poured water or lava to fill the bucket'); return; }
    if (t.src) removeLiquid(t.src);
    fillBucket(h, t.type, h.sel);
    toast(t.type === 'lava' ? 'Lava Bucket: right click to pour it on someone' : 'Water Bucket: pour it under you before you land');
    return;
  }
  const a = G.aim;
  if (!a || a.pi === null || !pourBucket(h, h.sel, a.pi, a.pj, a.pk)) toast('You can’t pour there');
}
function kitFail(h) {
  const K = KITS[h.kit];
  if (h.bike) toast('Get off the motorcycle to use your kit');
  else if (h.heli) toast('Get out of the helicopter to use your kit');
  else if (!K.item) toast(`${K.name} is a passive kit.`);
  else if (K.uses && h.uses <= 0) toast(`${K.item} is used up.`);
  else if (h.kitCd > 0) toast(`${K.item} recharging: ${Math.ceil(h.kitCd)}s`);
  else if (h.kit === 'mage') toast(pvpOn() ? 'Nobody within range to pull.' : 'Wait for PvP to turn on.');
}
function humanInput(dt) {
  const h = G.human;
  if (!h.alive) { h.mx = h.my = 0; return; }
  if (h.bike) { // W/S throttle, A/D steer, Space brake; the camera drifts back behind you
    const k = h.bike, busy = G.invOpen || G.chatOpen || G.mode !== 'play';
    k.throttle = busy ? 0 : (keyHeld('fwd') || keys.has('arrowup') ? 1 : 0) - (keyHeld('back') || keys.has('arrowdown') ? 1 : 0);
    k.steer = busy ? 0 : (keyHeld('right') || keys.has('arrowright') ? 1 : 0) - (keyHeld('left') || keys.has('arrowleft') ? 1 : 0);
    k.brake = !busy && keyHeld('jump');
    if (performance.now() - (VIEW.lookT || 0) > 700) VIEW.lookYaw = (VIEW.lookYaw || 0) * Math.exp(-3 * dt);
    h.mx = h.my = 0; h.pitch = VIEW.pitch; G.aim = null;
    return;
  }
  if (h.heli) { // pilot: W/S forward and back, A/D strafe, Space up, Shift down, the mouse turns the nose. Gunner: hold to fire.
    const hl = h.heli, busy = G.invOpen || G.chatOpen || G.mode !== 'play', key = (...ks) => !busy && ks.some(q => keys.has(BINDS[q] || q));
    if (h.seat === 'pilot') {
      if (freeLook && !busy) { if (mouse.x < innerWidth * 0.06) h.face -= dt * 2.2; else if (mouse.x > innerWidth * 0.94) h.face += dt * 2.2; }
      if (key('arrowleft')) h.face -= dt * 2;
      if (key('arrowright')) h.face += dt * 2;
      hl.ctl.fw = (key('fwd', 'arrowup') ? 1 : 0) - (key('back', 'arrowdown') ? 1 : 0);
      hl.ctl.st = (key('right') ? 1 : 0) - (key('left') ? 1 : 0);
      hl.ctl.up = (key('jump') ? 1 : 0) - (key('sneak') ? 1 : 0);
    } else if (mouse.down && !busy) fireGun(h);
    h.mx = h.my = 0; h.pitch = VIEW.pitch; G.aim = null; h.sneak = false;
    return;
  }
  if (freeLook && !G.invOpen && !G.chatOpen && G.mode === 'play') {
    const ex = innerWidth * 0.06, ey = innerHeight * 0.07;
    if (mouse.x < ex) h.face -= dt * 2.2; else if (mouse.x > innerWidth - ex) h.face += dt * 2.2;
    if (mouse.y < ey) VIEW.pitch = Math.min(1.3, VIEW.pitch + dt * 1.2); else if (mouse.y > innerHeight - ey) VIEW.pitch = Math.max(-1.45, VIEW.pitch - dt * 1.2);
  }
  if (keys.has('arrowleft')) h.face -= dt * 2.4;
  if (keys.has('arrowright')) h.face += dt * 2.4;
  if (keys.has('arrowup')) VIEW.pitch = Math.min(1.3, VIEW.pitch + dt * 1.5);
  if (keys.has('arrowdown')) VIEW.pitch = Math.max(-1.45, VIEW.pitch - dt * 1.5);
  const busy = G.invOpen || G.chatOpen || G.mode !== 'play';
  const fw = busy ? 0 : (keyHeld('fwd') ? 1 : 0) - (keyHeld('back') ? 1 : 0), st = busy ? 0 : (keyHeld('right') ? 1 : 0) - (keyHeld('left') ? 1 : 0);
  const c = Math.cos(h.face), sn = Math.sin(h.face);
  h.mx = c * fw - sn * st; h.my = sn * fw + c * st;
  const moved = hyp(h.x - (h.distX ?? h.x), h.y - (h.distY ?? h.y));
  if (moved < 60 && G.stats) G.stats.dist = (G.stats.dist || 0) + moved; // (not teleports)
  h.distX = h.x; h.distY = h.y;
  h.climb = !busy && (keyHeld('fwd') || keyHeld('jump'));
  h.glide = !busy && keyHeld('jump');
  if ((fw || st) && h.gather) h.gather = null;
  h.pitch = VIEW.pitch;
  const cp = Math.cos(VIEW.pitch);
  const big = h.size || 1;
  G.aim = rayPick(h.x, h.y, h.z + EYE * big - (h.sneak ? 9 : 0), Math.cos(h.face) * cp, Math.sin(h.face) * cp, Math.sin(VIEW.pitch), REACH * (big > 1.5 ? 1.6 : 1), false, h.layer);
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
  } else if (mouse.down && hand && canDig(h, a)) { // in the tunnels: hold on the rock to dig a stride forward
    if (h.breakKey !== 'dig') { h.breakKey = 'dig'; h.breakT = 0; }
    h.breakT += dt; h.breakNeed = digTime(def);
    if (h.breakT >= h.breakNeed) { digWall(h); h.breakKey = null; h.breakT = 0; }
  } else { h.breakKey = null; h.breakT = 0; }
  if (mouse.down && hand && swing(h, !!(def && def.tier))) hitMark();
  // Hold right click with a block to keep placing: jump and look down to tower up
  h.placeCd = (h.placeCd || 0) - dt;
  if (mouse.rdown && def && def.block && h.placeCd <= 0 && a && a.pi !== null) {
    if (placeBlock(h, item, a.pi, a.pj, a.pk, { up: hatchUp(a) })) { h.placeCd = 0.16; h.swingT = 0.1; }
  }
}
// Close enough to the tunnel wall to dig it (the wall is within the next stride)
const canDig = (h, a) => !!a && h.layer === 1 && a.hit === 'wall' && a.t * Math.cos(VIEW.pitch) < DIG_R + 12;
const aimDoor = () => { const a = G.aim; return a && a.hit === 'block' && BLOCKS[a.b.type].door ? a : null; };
// ---------- hit and damage feedback ----------
// Your hits: four ticks round the crosshair and a click (red, bigger and a heavier click on a kill).
// Hits on you: a red wedge pointing at where each one came from (up to four at once) and a flash at the screen edge.
let hitT, hitSndT = 0;
function hitMark(kill = false) {
  const c = $('#cross'), m = $('#hitmark');
  c.classList.add('hit'); m.classList.remove('on'); void m.offsetWidth; m.classList.add('on'); m.classList.toggle('kill', kill);
  clearTimeout(hitT); hitT = setTimeout(() => { c.classList.remove('hit'); m.classList.remove('on', 'kill'); }, kill ? 420 : 170);
  if (performance.now() - hitSndT > 45) { hitSndT = performance.now(); Sfx.play(kill ? 'killmark' : 'hitmark'); }
}
// Someone hurt you from angle a (world space)
function addDmgDir(a, amt = 1) {
  G.dmgDirs = (G.dmgDirs || []).filter(d => d.t > 0 && Math.abs(angDiff(d.a, a)) > 0.35);
  G.dmgDirs.unshift({ a, t: 1.2 });
  G.dmgDirs.length = Math.min(G.dmgDirs.length, 4);
  G.hurtFlash = Math.min(1, (G.hurtFlash || 0) + 0.35 + amt * 0.08);
}
const DMG_ELS = [...document.querySelectorAll('#dmgdirs i')];
function updateCross(dt) {
  const h = G.human, dirs = G.dmgDirs || [];
  DMG_ELS.forEach((el, i) => {
    const d = dirs[i];
    if (d) d.t -= dt;
    el.style.opacity = d && d.t > 0 ? Math.min(1, d.t).toFixed(2) : 0;
    if (d && d.t > 0) el.style.transform = `rotate(${(angDiff(h.face, d.a)).toFixed(3)}rad)`;
  });
  G.hurtFlash = Math.max(0, (G.hurtFlash || 0) - dt * 1.6);
  if (G.killFlash > 0) { G.killFlash -= dt; $('#cross').classList.toggle('kill', G.killFlash > 0); }
  const rv = h.reviving && reviveTarget(h);
  const p = rv ? rv.p.reviveP || 0 : h.breakKey ? h.breakT / h.breakNeed : h.gather ? h.gatherT / gatherTime(h, h.gather) : h.charge >= 0 ? h.charge : h.refillT > 0 ? 1 - h.refillT / 0.22 : 0;
  $('#cross').style.setProperty('--p', p.toFixed(3));
  $('#hurt').style.opacity = Math.max(G.hurtFlash || 0, h.hurtT > 0 ? 0.6 : 0, h.hp < 6 ? 0.35 + Math.sin(G.t * 5) * 0.1 : 0).toFixed(2);
}

// Arrows around the crosshair for anyone close by but out of view (you'd hear them), nearest first.
// Disguised Hidden players don't show; snowstorms shorten the range.
const NEAR_ELS = [...document.querySelectorAll('#near i')];
function updateNear() {
  const h = G.human, hf = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 0.92;
  const R = h.layer ? 260 : h.biome === 2 && G.settings.snow && h.kit !== 'yeti' && !G.pit ? 170 : 320;
  const near = [];
  if (h.alive) for (const f of G.fighters) {
    if (f === h || !f.alive || f.hidden || f.layer !== h.layer) continue;
    const d = hyp(f.x - h.x, f.y - h.y);
    if (d > R) continue;
    const a = angDiff(h.face, Math.atan2(f.y - h.y, f.x - h.x));
    if (Math.abs(a) > hf) near.push([d, a]);
  }
  near.sort((p, q) => p[0] - q[0]);
  NEAR_ELS.forEach((el, i) => {
    const n = near[i];
    el.style.opacity = n ? (0.35 + 0.65 * (1 - n[0] / R)).toFixed(2) : 0;
    if (n) el.style.transform = `translate(-50%, -50%) rotate(${n[1].toFixed(3)}rad) translateY(-118px)`;
  });
}

// ---------- footsteps: anyone walking makes noise. Hard floors carry further, snowstorms muffle, sneaking is silent ----------
const STEP_RANGE = { grass: 300, sand: 260, snow: 170, stone: 520, wood: 480, water: 360, big: 850 };
let stepBudget = 0;
function surfaceUnder(f) {
  if (f.layer) return 'stone';
  if (f.inLiq === 'water') return 'water';
  const b = blockAt(Math.floor(f.x / B), Math.floor((f.z - 1) / B), Math.floor(f.y / B));
  if (b) return b.type === 'cobble' || b.type === 'arena' ? 'stone' : b.type === 'water' ? 'water' : 'wood';
  if (hyp(f.x - PIT.x, f.y - PIT.y) < PIT.r) return 'stone';
  const bi = biomeAt(f.x, f.y);
  return bi === 0 && world.winter ? 'snow' : ['grass', 'sand', 'snow', 'water'][bi];
}
function footsteps(dt) {
  const L = VIEW.focus || G.human;
  if (!L) return;
  stepBudget = Math.min(6, stepBudget + dt * 30); // at most ~30 steps a second, however crowded
  for (const f of G.fighters) {
    const moved = hyp(f.x - (f.stepX ?? f.x), f.y - (f.stepY ?? f.y));
    f.stepX = f.x; f.stepY = f.y;
    if (!f.alive || f.layer !== L.layer || f.hidden || moved > 60 || moved < 0.2 || f.pitT > 0 || f.bike || f.heli) continue;
    const grounded = f.remote ? f.z - (f.layer ? 0 : heightAt(f.x, f.y)) < 4 || !!blockAt(Math.floor(f.x / B), lj(f.z - 1, f.layer), Math.floor(f.y / B)) : f.onGround;
    if (!grounded || (f.remote ? f.net.sn : f.sneak)) continue;
    const size = f.size || 1;
    if ((f.stepAcc = (f.stepAcc || 0) + moved) < 56 * size) continue;
    f.stepAcc = 0;
    const surf = size > 1.5 ? 'big' : surfaceUnder(f), range = STEP_RANGE[surf];
    if (hyp(f.x - L.x, f.y - L.y) > range || stepBudget < 1) continue;
    stepBudget--;
    Sfx.step(surf, f.x, f.y, f.z, range, f === L ? 0.35 : 1);
  }
}

// Engine noise for the (up to three) nearest running motorcycles
function engineSounds() {
  const L = VIEW.focus || G.human, on = G.mode === 'play' || G.mode === 'spectate' || (NET.on && G.mode === 'end');
  const list = !on || !L ? [] : (G.bikes || []).filter(k => !k.gone && (k.rider || !bikeStill(k)) && hyp(k.x - L.x, k.y - L.y) < 800)
    .sort((a, b) => hyp(a.x - L.x, a.y - L.y) - hyp(b.x - L.x, b.y - L.y)).slice(0, 3)
    .map(k => ({ id: k.id, x: k.x, y: k.y, z: k.z, speed: k.speed, mine: k.rider === G.human.id }));
  Sfx.engines(list);
  // Helicopter rotors carry much further (the two nearest that are turning)
  Sfx.rotors(!on || !L ? [] : (G.helis || []).filter(h => !h.gone && h.rotor > 0.02 && hyp(h.x - L.x, h.y - L.y) < 1800)
    .sort((a, b) => hyp(a.x - L.x, a.y - L.y) - hyp(b.x - L.x, b.y - L.y)).slice(0, 2)
    .map(h => ({ id: h.id, x: h.x, y: h.y, z: h.z, rotor: h.rotor, mine: G.human.heli === h })));
}

// ---------- bounty: the top killer (3+ kills) shows on everyone's map every 30 seconds ----------
const BOUNTY_MIN = 3, BOUNTY_PING = 30;
const bountyReward = f => 50 + 25 * f.kills;
function updateBounty(dt) {
  if (G.bounty && !G.bounty.alive) setBounty(null);
  if ((!NET.on || NET.isHost()) && (G.bountyCheck -= dt) <= 0) { // the host (or a solo game) picks the target
    G.bountyCheck = 3;
    let top = null;
    for (const f of G.fighters) if (f.alive && !f.isClone && f.kills >= BOUNTY_MIN && (!top || f.kills > top.kills)) top = f;
    if (top && top !== G.bounty && (!G.bounty || top.kills > G.bounty.kills)) { setBounty(top); NET.fx({ k: 'bounty', o: top.id }); }
  }
  const b = G.bounty;
  if (b && G.t >= G.bountyPingT) {
    G.bountyPingT = G.t + BOUNTY_PING;
    G.bountySeen = { x: b.x, y: b.y, layer: b.layer, t: G.t };
    if (b === G.human) toast('Your position was just shown to everyone');
  }
}
function setBounty(f) {
  G.bounty = f; G.bountySeen = null;
  if (!f) return;
  G.bountyPingT = G.t;
  G.feed.unshift({ txt: `Bounty on ${f.name} · ${f.kills} kills`, t: 8, relic: true });
  if (f === G.human) { banner('There’s a bounty on you', `Everyone sees where you are every ${BOUNTY_PING} seconds. Stay alive.`); Sfx.say('There is a bounty on you'); }
  else if (G.human.isFighter && G.human.alive && G.mode === 'play') Sfx.say(`Bounty on ${f.name}`);
  else if (G.human.alive) toast(`Bounty on ${f.name}: kill them for ${bountyReward(f)} coins`);
}
function claimBounty(t, killer) {
  const r = bountyReward(t);
  G.feed.unshift({ txt: killer ? `${killer.name} claimed the bounty on ${t.name}` : `The bounty on ${t.name} is gone`, t: 8, relic: true });
  if (killer === G.human) { G.coinsEarned += r; banner('Bounty claimed', `${t.name} is down · +${r} coins`); Sfx.say('Bounty claimed'); }
  G.bounty = null; G.bountySeen = null;
}
function bountyLine() {
  const b = G.bounty, h = G.human;
  if (!b) return '';
  if (b === h) return `Bounty on you · shown to everyone in ${Math.max(0, Math.ceil(G.bountyPingT - G.t))}s`;
  const s = G.bountySeen;
  let line = `★ Bounty: ${b.name} · ${b.kills} kills`;
  if (s) {
    const a = angDiff(h.face, Math.atan2(s.y - h.y, s.x - h.x));
    line += ` · seen ${Math.round((G.t - s.t))}s ago, ${Math.round(hyp(s.x - h.x, s.y - h.y) / B)} blocks ${'↑↗→↘↓↙←↖'[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]}`;
  }
  return line;
}

// ---------- music and the announcer ----------
// How intense the music gets: enemies close by, a fight you're in, the pit, the last few players
function combatLevel(v) {
  if (!v || !v.isFighter || !v.alive || G.mode === 'menu' || G.mode === 'options') return 0;
  let near = 1e9;
  if (pvpOn()) for (const f of G.fighters) if (f !== v && f.alive && !f.isClone && !f.hidden && f.layer === v.layer && !allied(f, v)) near = Math.min(near, hyp(f.x - v.x, f.y - v.y));
  let lvl = pvpOn() ? clamp(1 - (near - 120) / 420, 0, 1) * 0.55 : 0;
  if (G.t - (v.lastHitT ?? -99) < 5 || G.t - (v.dealtT ?? -99) < 5) lvl += 0.4;
  if (G.pit) lvl += 0.35;
  if (pvpOn() && G.fighters.filter(f => f.alive && !f.isClone).length <= 5) lvl += 0.15;
  return clamp(lvl, 0, 1);
}
// Spoken lines after a death: players (or squads) left, revenge, rivals
const LEFT_WORDS = { 10: 'Ten', 5: 'Five', 3: 'Three', 2: 'Two' };
function announcerKill(t, killer) {
  const h = G.human;
  if (!h || !h.isFighter || G.over || t.isClone || G.mode === 'menu' || G.mode === 'options') return;
  if (killer === h && t.rival) Sfx.say('Rival defeated');
  else if (killer === h && h.revengeOn === t) { Sfx.say('Revenge!'); h.revengeOn = null; }
  if (G.duo && killer && killer !== h && t === partnerOf(h)) h.revengeOn = killer; // whoever got your partner
  const alive = G.fighters.filter(f => f.alive && !f.isClone), left = G.duo ? new Set(alive.map(f => f.squad || f.id)).size : alive.length;
  if (LEFT_WORDS[left] && !G.ann['left' + left]) {
    G.ann['left' + left] = true;
    if (left > 1 || !G.duo) Sfx.say(`${LEFT_WORDS[left]} ${G.duo ? 'squads' : 'players'} remain`);
  }
}
// One kill-feed line: killer (and helpers), how, victim
function feedKill(k) {
  const help = k.help && k.help.length ? `<small>+ ${k.help.map(escapeHTML).join(', ')}</small>` : '';
  const how = FEED_NAME[k.icon] || '';
  return `${k.a ? `<span>${escapeHTML(k.a)}</span>${help}` : ''}<img class="fi${k.icon === 'skull' ? ' sk' : ''}" src="${feedIconURL(k.icon)}" alt="${escapeHTML(how || 'killed')}" title="${escapeHTML(how)}"><span>${escapeHTML(k.v)}</span>${!k.a && help ? ` ${help}` : ''}`;
}

// ---------- kill-streak callout ----------
let streakT;
function showStreak(title, sub) {
  const el = $('#streak');
  el.querySelector('b').textContent = title; el.querySelector('span').textContent = sub || '';
  el.hidden = false; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  clearTimeout(streakT); streakT = setTimeout(() => el.hidden = true, 2200);
  Sfx.play('streak');
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
  G.pathBudget = 3; // bot path searches allowed this frame
  pruneNoises(); trackVelocities(dt);
  if (G.mode !== 'menu' && G.mode !== 'options' && G.human.isFighter) { humanInput(dt); phases(); updateRevives(dt); replayRecord(dt); }
  for (const f of G.fighters) if (f.bot && f.alive && !f.remote) {
    try { botUpdate(f, dt); } catch (e) { f.plan = null; f.spath = null; reportOnce(e); } // one confused bot shouldn't stop the game
  }
  for (const f of G.fighters) if (f.alive && !f.remote) updateFighter(f, dt);
  updateRifts(dt);
  netInterp(dt);
  // keep bodies from stacking (only move the ones we simulate)
  const al = G.fighters.filter(f => f.alive && !f.hidden && !f.heli);
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
  updateDuels(dt); clearStaleArenas();
  pickups();
  updateRats(dt); updateProj(dt); updateFx(dt); coolLava(); updateBikes(dt); updateHelis(dt); updateSocial(dt);
  if (G.mode !== 'menu' && G.mode !== 'options') { updateAlliances(dt); updateBounty(dt); }
  potT += dt;
  if (potT > 3) {
    potT = 0; G.items = G.items.filter(i => !i.gone);
    if ((!NET.on || NET.isHost()) && G.items.filter(i => i.stacks && i.stacks.length === 1 && i.stacks[0].id === 'pot').length < potCap()) spawnPot();
  }
  netTick(dt);
}
// Errors in the loop are logged once each and the game carries on, rather than freezing
const reported = new Set();
function reportOnce(e) { const k = String(e && e.message); if (!reported.has(k)) { reported.add(k); console.error(e); } }
function frame(now) {
  try { tick(now); } catch (e) { reportOnce(e); }
  requestAnimationFrame(frame);
}
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (world) {
    if (G.mode === 'menu' || G.mode === 'options') {
      step(dt);
      if (!camFocus || !camFocus.alive) camFocus = G.fighters.find(f => f.alive && !f.isClone);
      if (!camFocus || G.fighters.filter(f => f.alive && !f.isClone).length <= 1 || G.t > 240) startAttract();
      else Object.assign(G.human, { x: camFocus.x, y: camFocus.y, z: camFocus.z, layer: camFocus.layer, biome: camFocus.biome });
      render(dt); Sfx.update('menu', dt, 0); Sfx.music(0, dt);
    } else if (G.mode === 'replay') {
      if (NET.on) step(dt); // online, the match carries on while you watch
      replayStep(dt);
      if (G.mode === 'replay') { replayApply(dt); render(dt); replayRestore(); } else render(0);
      Sfx.music(0, dt);
    } else if (G.mode === 'play' || G.mode === 'spectate' || (NET.on && (G.mode === 'paused' || G.mode === 'end'))) {
      // Online matches keep running while you pause or after you die; spectating always does
      if (G.mode === 'spectate' && !G.freeCam && !(G.specTarget && G.specTarget.alive)) spectate(1);
      if (G.mode === 'spectate' && G.freeCam) moveFreeCam(dt);
      step(dt); render(dt); renderMinimap(); footsteps(dt);
      if (G.mode === 'play') { updateCross(dt); updateNear(); checkTips(dt); checkLandmarks(); }
      const v = VIEW.focus || G.human;
      Sfx.update(v.layer ? 'under' : v.biome === 2 && G.settings.snow && !G.pit ? 'snow' : 'surface', dt, DAY.night, !!(v.hidden || (v.sneak && v === G.human)));
      Sfx.music(combatLevel(v), dt);
      if (bigMapOpen()) renderBigMap();
      hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHud(); }
    } else { render(0); renderMinimap(); Sfx.music(0, 0.016); }
    engineSounds();
  }
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
  $('#where').textContent = placeName(h);
  const dl = dropLine(), bl = bountyLine();
  $('#droptag').hidden = !dl; if (dl) $('#droptag').textContent = dl;
  $('#bountytag').hidden = !bl; if (bl) $('#bountytag').textContent = bl;
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
  $('#bagpots').textContent = bp ? `${bp} potion${bp > 1 ? 's' : ''} in backpack${canRefill(h) ? ` · ${keyName(BINDS.refill)} to refill` : ''}` : 'No potions in backpack';
  $('#bagpots').classList.toggle('warn', canRefill(h));
  setHTML('#feed', G.feed.map(k => `<div class="${k.you ? 'you' : ''}${k.chat ? ' chat' : ''}${k.relic ? ' relic' : ''}${k.streak ? ' streak' : ''}${k.kill ? ' kf' : ''}">${k.team && k.team !== true ? `<i style="background:${k.team}"></i>` : ''}${k.kill ? feedKill(k.kill) : escapeHTML(k.txt)}</div>`).join(''));
  // Duos: your partner's name, health and whether they're down
  const mate = G.duo ? partnerOf(h) : null;
  $('#squadtag').hidden = !mate;
  if (mate) setHTML('#squadtag', `<i style="background:${mate.teamCol}"></i><b>${escapeHTML(mate.name)}</b> ${mate.alive ? `<span class="sq-hp"><span style="width:${Math.max(0, mate.hp / mate.maxHp * 100).toFixed(0)}%"></span></span> ${Math.round(hyp(mate.x - h.x, mate.y - h.y) / B)} blocks`
    : revivable(mate) ? `<em>down · revive in ${Math.ceil(mate.reviveUntil - G.t)}s</em>` : '<em>out</em>'}`);
  // Vehicles: gauges hug the crosshair (fuel or speed on the left, hull on the right, numbers underneath)
  const bk = h.alive && h.bike, hl = h.alive && h.heli, gunner = hl && h.seat === 'gunner';
  $('#cross').hidden = !!bk || !!(hl && !gunner);
  vehicleHud(bk, hl, gunner);
  const lantern = h.alive && heldId(h) === 'riftlantern';
  $('#riftind').hidden = !lantern;
  if (lantern) { const r = G.rifts && G.rifts.get(h.id); $('#riftind .a').classList.toggle('on', !!(r && r[0])); $('#riftind .b').classList.toggle('on', !!(r && r[1])); }
  const U = kbd('use');
  let p = '';
  if (bk) p = `${kbd('fwd')}${kbd('back')} Throttle · ${kbd('left')}${kbd('right')} Steer · ${kbd('jump')} Brake · ${U} Get off (hurts at speed)`;
  else if (hl && gunner) p = `<kbd>Left click</kbd> Chain gun · <kbd>Right click</kbd> Rocket · ${kbd('seat')} ${hl.pilot ? 'Pilot seat (taken)' : 'Take the controls'} · ${U} Get out`;
  else if (hl) p = `${kbd('fwd')}${kbd('back')} Forward · back · ${kbd('left')}${kbd('right')} Strafe · Mouse to turn · ${kbd('jump')} Up · ${kbd('sneak')} Down · ${kbd('seat')} ${hl.gunner ? 'Gunner seat (taken)' : 'Gunner seat'} · ${U} Get out`;
  else if (h.alive && nearHeli(h)) { const n = nearHeli(h); p = isTitan(h) ? 'Too big for the cockpit while you’re a Titan' : `${U} ${n.pilot ? 'Get in as the gunner' : 'Fly the helicopter'}${n.fuel < 15 && !onPad(n) ? ' · almost out of fuel' : ''}`; }
  else if (h.alive && nearBike(h)) p = isTitan(h) ? 'Too big to ride while you’re a Titan' : `${U} Ride the motorcycle`;
  else if (h.refillT > 0) p = 'Refilling hotbar…';
  else if (h.alive && reviveTarget(h)) p = `Hold ${U} Revive ${escapeHTML(reviveTarget(h).p.name)}`;
  else if (h.alive && aimDoor()) p = `${U} or <kbd>Right click</kbd> ${aimDoor().b.open ? 'Shut' : 'Open'} the ${aimDoor().b.type === 'trapdoor' ? 'trapdoor' : 'door'}`;
  else if (world.entrances.some(e => hyp(e.x - h.x, e.y - h.y) < 46) && !G.pit) p = h.layer ? `${U} Climb out` : `${U} Go down into the tunnels`;
  else { const o = gatherTarget(h); if (o) p = `Hold ${U} ${{ tree: 'Chop tree for wood', rock: 'Break rock for stone', reed: 'Cut reeds', ore: 'Mine iron ore (slow)' }[o.kind]}`; }
  if (!p && h.alive && canDig(h, G.aim)) p = `Hold <kbd>Left click</kbd> Dig through the rock`;
  if (!p && h.alive && G.aim && G.aim.hit === 'block' && G.aim.b.type === 'rubble') p = `Hold <kbd>Left click</kbd> Dig out the rubble`;
  const held = heldId(h);
  if (!p && lantern) p = `<kbd>Left click</kbd> <span style="color:#c99bff">Violet rift</span> · <kbd>Right click</kbd> <span style="color:#7ff0a8">Green rift</span> · walk into one to come out of the other`;
  if (!p && held && ITEMS[held].block) p = `<kbd>Right click</kbd> Place · hold to keep placing · ${kbd('jump')} + look down to tower`;
  if (!p && held === 'bucket' && !h.layer) p = `<kbd>Right click</kbd> Fill from swamp water, a lava pool, or poured water or lava`;
  if (!p && held === 'bucket_water' && !h.layer) p = `<kbd>Right click</kbd> Pour · pour it under you just before you land: no fall damage`;
  if (!p && held === 'bucket_lava' && !h.layer) p = `<kbd>Right click</kbd> Pour lava · it burns whoever’s in it`;
  if (!p && h.inLiq === 'water' && !h.onGround) p = `Hold ${kbd('jump')} to swim up`;
  $('#prompt').innerHTML = p; $('#prompt').hidden = !p;
  const st = [];
  if (h.hidden) st.push(`Disguised as a ${h.disguise === 'snowrock' ? 'rock' : h.disguise}`);
  if (h.sneak) st.push('Sneaking');
  if (h.slowT > 0) st.push('Slowed');
  if (h.poisonT > 0) st.push('Poisoned');
  if (h.invuln > 0) st.push('Invincible');
  if (h.speedT > 0) st.push('Sprinting');
  if (h.titanT > 0) st.push(`Titan · ${Math.ceil(h.titanT)}s`);
  if (bk && bk.hp < 35) st.push('Your bike is smoking: it’s about to blow');
  if (hl) {
    const other = hl[gunner ? 'pilot' : 'gunner'], mate = other && fighterById(other);
    if (hl.dead) st.push('Engine out: bail out!');
    else if (hl.fuel < 12 && hl.air) st.push('FUEL CRITICAL: land now');
    else if (hl.fuel < 30 && hl.air) st.push('Low fuel');
    if (!gunner && !hl.air && hl.rotor < 1 && !hl.dead) st.push(`Rotors spinning up · ${Math.round(hl.rotor * 100)}%`);
    if (onPad(hl) && hl.fuel < HELI.fuel) st.push('Refuelling');
    if (onPad(hl) && (hl.ammo < HELI.ammo || hl.rockets < HELI.rockets)) st.push(hl.gunner ? 'Rearms once the gunner seat is empty' : 'Rearming');
    if (hl.hp < HELI.hp * 0.3) st.push('Hull failing');
    st.push(mate ? `${gunner ? 'Pilot' : 'Gunner'}: ${mate.name}` : gunner ? (hl.air ? 'Nobody flying: sinking' : 'Pilot seat empty') : 'Gunner seat empty');
  }
  if (h.burnT > 0) st.push('On fire');
  else if (h.inLiq === 'water') st.push('In water');
  if (h.punchT > 0) st.push('Punch charged');
  if (count(h, 'charm')) st.push(`Feather Charm ×${count(h, 'charm')}`);
  if (h.layer === 0 && h.biome === 2 && G.settings.snow && !G.pit) st.push('Snowstorm');
  $('#status').textContent = st.join(' · ');
  $('#clickto').hidden = !(G.mode === 'play' && !locked && !noLock && !freeLook && !G.invOpen && !G.chatOpen && h.alive);
  cv.style.cursor = freeLook && G.mode === 'play' && !G.invOpen && !G.chatOpen ? 'none' : '';
  if (G.invOpen) renderInv();
  renderBoard();
  const back = G.watching ? 'Esc to leave' : 'Esc to go back';
  if (G.mode === 'spectate' && G.freeCam) $('#spec').textContent = `Free camera · WASD fly · Space up · Q down · Shift slow · click to look around   ← → follow a player · F follow · ${back}`;
  else if (G.mode === 'spectate' && G.specTarget) {
    const t = G.specTarget;
    const down = G.duo && !G.human.alive && G.human.isFighter && !G.over, mate = down && partnerOf(G.human);
    $('#spec').textContent = down ? (revivable(G.human) ? `You’re down · ${mate.name} can revive you for ${Math.ceil(G.human.reviveUntil - G.t)}s more · Esc to give up` : `It’s up to ${mate.name} now · ← → switch · Esc to leave`)
      : `Watching ${t.name} · ${KITS[t.kit].name} · ${Math.ceil(t.hp)} health · ${t.kills} kills   ← → or click to switch · F free camera · ${back}`;
  }
}
// The gauges by the crosshair. Motorcycle: speed and damage. Helicopter: fuel and hull, speed and height, and the
// gunner's rounds and rockets.
function vehicleHud(bk, hl, gunner) {
  const el = $('#vhud');
  el.hidden = !bk && !hl;
  if (!bk && !hl) return;
  const arc = (id, f) => $(id).setAttribute('stroke-dasharray', `${(clamp(f, 0, 1) * 100).toFixed(1)} 100`);
  const show = (id, on) => { $(id).hidden = !on; };
  if (bk) {
    arc('#vh-l', Math.abs(bk.speed) / BIKE.top); arc('#vh-r', bk.hp / BIKE.hp);
    $('#vh-lv').textContent = kmh(bk.speed); $('#vh-lk').textContent = 'km/h'; $('#vh-rv').textContent = `${Math.max(0, Math.round(bk.hp / BIKE.hp * 100))}%`;
    show('#vh-a', false); show('#vh-b', false); show('#vh-c', false); show('#vh-d', false);
    el.classList.remove('low', 'crit'); el.classList.toggle('wreck', bk.hp < 35);
    return;
  }
  const fuel = Math.max(0, hl.fuel / HELI.fuel), hull = Math.max(0, hl.hp / HELI.hp);
  arc('#vh-l', fuel); arc('#vh-r', hull);
  $('#vh-lv').textContent = `${Math.ceil(fuel * 100)}%`; $('#vh-lk').textContent = 'Fuel'; $('#vh-rv').textContent = `${Math.round(hull * 100)}%`;
  $('#vh-av').textContent = kmhOf(hl); $('#vh-ak').textContent = 'km/h';
  $('#vh-bv').textContent = Math.max(0, Math.round((hl.z - heliGround(hl)) / B));
  $('#vh-cv').textContent = hl.ammo; $('#vh-dv').textContent = hl.rockets;
  show('#vh-a', true); show('#vh-b', true); show('#vh-c', gunner); show('#vh-d', gunner);
  $('#vh-c').classList.toggle('dry', hl.ammo <= 0); $('#vh-d').classList.toggle('dry', hl.rockets <= 0);
  el.classList.toggle('low', hl.fuel < 30); el.classList.toggle('crit', hl.fuel < 12 || hl.dead); el.classList.toggle('wreck', hl.hp < HELI.hp * 0.3);
}
// Hold P: everyone in the match, alive first, then by kills
function renderBoard() {
  const show = G.mode === 'play' && keyHeld('board');
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
  if (!alive.length) { if (G.watching) startFreeCam(); else if (G.mode === 'spectate') setMode('end'); return; }
  const i = alive.indexOf(G.specTarget);
  G.specTarget = alive[i < 0 ? 0 : (i + dir + alive.length) % alive.length];
}
// Free camera for spectators: fly anywhere above ground (F toggles, WASD to move, click to look around)
function startFreeCam() {
  const c = camera.position;
  G.freeCam = { x: c.x, y: c.z, z: Math.max(c.y, 60), yaw: G.specTarget ? G.specTarget.face : 0, pitch: -0.3, layer: 0, biome: 0, face: 0 };
  if (!isFinite(G.freeCam.x)) Object.assign(G.freeCam, { x: PIT.x - 400, y: PIT.y, z: 300 });
  G.specTarget = null;
  if (G.mode !== 'spectate') setMode('spectate');
}
function moveFreeCam(dt) {
  const c = G.freeCam, sp = (keyHeld('sneak') ? 260 : 620) * dt;
  const fw = (keyHeld('fwd') ? 1 : 0) - (keyHeld('back') ? 1 : 0), st = (keyHeld('right') ? 1 : 0) - (keyHeld('left') ? 1 : 0);
  c.x = clamp(c.x + (Math.cos(c.yaw) * fw - Math.sin(c.yaw) * st) * sp, -200, WORLD + 200);
  c.y = clamp(c.y + (Math.sin(c.yaw) * fw + Math.cos(c.yaw) * st) * sp, -200, WORLD + 200);
  c.z += ((keyHeld('jump') ? 1 : 0) - (keys.has('q') ? 1 : 0)) * sp;
  c.z = clamp(c.z, heightAt(c.x, c.y) + 12, 2200);
  c.face = c.yaw; c.biome = biomeAt(c.x, c.y);
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
  { id: 'drop', when: () => (world.drops || []).some(d => d.st === 'announced'), text: 'Supply drops land at the blue square on your map. They hold iron swords, feast armour and buckets, and everyone can see the beam.' },
  { id: 'bucket', when: h => ['bucket', 'bucket_water', 'bucket_lava'].some(id => count(h, id)), text: 'Fill a bucket from swamp water or a lava pool (orange on the map). Pour water under you just before you land and you take no fall damage.' },
  { id: 'bounty', when: () => !!G.bounty && G.bounty !== G.human, text: 'The top killer has a bounty: the gold star on your map is where they were last seen. Take them down for bonus coins.' },
  { id: 'team', when: () => G.teams && G.teams.length > 0, text: 'Bots sometimes team up (matching colour squares by their names). Sooner or later one turns on the other.' },
  { id: 'bike', when: h => !!nearBike(h, 200) || !!h.bike, text: 'Motorcycles are fast and fragile. Hit a tree at full speed and it can kill you, getting off at speed hurts, and a smoking bike is about to explode. Space brakes.' },
  { id: 'heli', when: h => !!nearHeli(h, 400) || !!h.heli, text: 'Helicopters seat two: a pilot, and a gunner with a chain gun and rockets. Fuel only burns in the air, and if it runs dry up there the helicopter explodes, so land in time. Helipads (the H on your map) refuel it, and rearm it while the gunner seat is empty.' },
  { id: 'dig', when: h => h.layer === 1 && G.t > 5, text: 'In the tunnels you can build, set traps and dig: hold left click against the rock to cut a new passage. Blast traps and the Sapper bring the roof down in a cave-in.' },
  { id: 'pitfall', when: h => count(h, 'pitfall') > 0, text: 'Pitfalls look like the ground. Place them where people walk: whoever steps on one is stuck in a hole for a couple of seconds.' },
  { id: 'near', when: () => NEAR_ELS.some(el => +el.style.opacity > 0), text: 'The red arrows around your crosshair point at people close by but out of view. Turn to face them.' },
  { id: 'map', when: () => G.t > 40, text: 'Press M for the full map, with a grid and the names of landmarks. Esc or M closes it.' },
  { id: 'duo', when: () => G.duo, text: 'Duos: your partner has a green marker you can see through walls. If one of you goes down, the other has 15 seconds to hold E by the gravestone and revive them.' },
  { id: 'door', when: h => ['door', 'trapdoor', 'slab', 'stairs'].some(id => count(h, id)), text: 'Doors and trapdoors open and shut with E or right click (sneak to place blocks against them). Slabs and stairs can be walked up without jumping.' },
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
// Drop straight from a slot (G or Q over it; Ctrl drops the whole stack)
function dropFromSlot(r, all) {
  const h = G.human, s = getS(r);
  if (!s) return;
  if (s.id === 'kit') { toast('Kit items can’t be dropped'); return; }
  const n = all ? s.n : 1;
  if (r.eq) setS(r, null); else take(h, s.id, n, r.i);
  dropStacks(h, [{ id: s.id, n }]);
  Sfx.play('pickup'); renderInv();
}
function dropCursor() {
  const h = G.human;
  if (!INV.cursor) return;
  if (INV.cursor.id === 'kit') { toast('Kit items can’t be dropped'); return; }
  dropStacks(h, [INV.cursor]); INV.cursor = null;
  Sfx.play('pickup'); moveCursorStack(); renderInv();
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
  setHTML('#recipes', RECIPES.filter(r => r.cat === INV.tab && recipeFor(h, r)).map(r => {
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
let drag = null;
$('#inv').addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const el = e.target.closest('.islot');
  if (!el) return;
  e.preventDefault();
  const had = !!INV.cursor;
  clickSlot(refOf(el), false, e.shiftKey);
  drag = !had && INV.cursor ? { x: e.clientX, y: e.clientY, from: refOf(el) } : null;
  showTip(el);
});
addEventListener('mouseup', e => {
  if (!drag || e.button !== 0 || !G.invOpen) { drag = null; return; }
  const { x, y, from } = drag;
  drag = null;
  if (hyp(e.clientX - x, e.clientY - y) < 8 || !INV.cursor) return; // a plain click keeps the stack on the cursor
  const el = document.elementFromPoint(e.clientX, e.clientY), slot = el && el.closest('.islot');
  if (slot) clickSlot(refOf(slot), false, false);                                  // dragged onto a slot
  else if (!el || !el.closest('.inv-card') || el.closest('#drop-zone')) dropCursor(); // dragged out of the panel
  else clickSlot(from, false, false);                                               // let go on the panel: put it back
});
$('#inv').addEventListener('contextmenu', e => { e.preventDefault(); const el = e.target.closest('.islot'); if (el) clickSlot(refOf(el), true, e.shiftKey); });
$('#inv').addEventListener('click', e => {
  const h = G.human, el = e.target.closest('button, #drop-zone');
  if (!e.target.closest('.inv-card')) { dropCursor(); return; } // clicked outside the panel while holding a stack
  if (!el) return;
  if (el.classList.contains('islot')) return; // handled on mousedown / mouseup below
  if (el.dataset.tab) { INV.tab = el.dataset.tab; renderInv(); return; }
  if (el.dataset.r) {
    const r = recipe(el.dataset.r);
    if (!canCraft(h, r)) { toast('Missing materials for ' + ITEMS[r.out].name); return; }
    const n = craft(h, r, e.shiftKey ? 64 : 1);
    G.stats.crafted += n;
    toast(`Crafted ${n * (r.n || 1)} × ${ITEMS[r.out].name}`); Sfx.play('craft'); renderInv(); showTip(el); return;
  }
  if (el.id === 'drop-zone') {
    if (!INV.cursor) { toast('Drag a stack here (or anywhere outside this panel) to drop it'); return; }
    dropCursor(); return;
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
  $('#replay').hidden = m !== 'replay';
  if (m === 'replay') { $('#banner').hidden = true; $('#streak').hidden = true; }
  if (m !== 'play' && m !== 'spectate') $('#bigmap').hidden = true;
  if (m !== 'play') $('#clickto').hidden = true; // never leave "Click to play" over a menu
  if (m !== 'play') { $('#board').hidden = true; $('#tipbox').hidden = true; }
  if (m !== 'options' && m !== 'paused' && rebinding) { rebinding = null; renderBinds(); } // don't swallow a key once Options is closed
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
  const h = G.human, left = G.fighters.filter(f => f.alive && !f.isClone), sq = f => f.squad || f.id;
  const place = G.duo ? (won ? 1 : new Set(left.map(sq)).size + 1) : left.length + (won ? 0 : 1);
  const entrants = G.duo ? new Set(G.fighters.filter(f => !f.isClone).map(sq)).size : G.fighters.filter(f => !f.isClone).length;
  replayFlush();
  toggleBigMap(false);
  Sfx.say(won ? 'Victory' : 'Eliminated', true);
  if (won) G.coinsEarned += 200;
  STORE.coins += G.coinsEarned;
  const life = STORE.life = STORE.life || { matches: 0, wins: 0, kills: 0, best: 0, fall: 0 };
  life.matches++; if (won) life.wins++; life.kills += h.kills;
  if (!life.best || place < life.best) life.best = place;
  life.fall = Math.max(life.fall, G.stats.fall);
  save();
  // Dying plays the last few seconds back first (skip with Space, Esc or a click)
  // Winning plays the play of the match
  setTimeout(() => {
    if (!won && !h.alive && G.mode === 'play' && playReplay(showEnd)) return;
    if (won && playPom(showEnd)) return;
    showEnd();
  }, 900);
  function showEnd() {
    const mate = G.duo ? partnerOf(h) : null;
    $('#end-title').textContent = won ? (mate ? 'Last squad standing' : 'Last one standing') : 'You lost';
    $('#end-sub').textContent = won ? (mate ? `You and ${mate.name} outlasted everyone.` : 'Everyone else is dead.') : G.killedBy ? `Killed by ${G.killedBy}.` : `${G.winnerName || 'Someone'} won the match.`;
    const st = G.stats, cell = ([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`;
    $('#end-stats').innerHTML = [['Place', `#${place} of ${entrants}${G.duo ? ' squads' : ''}`], ['Kills', h.kills], ['Damage dealt', st.dmg.toFixed(0)], ['Survived', fmt(G.clockMin)]].map(cell).join('');
    const acc = st.shots ? `${Math.round((st.hits || 0) / st.shots * 100)}%` : '–';
    $('#end-more').innerHTML = [['Assists', st.assists || 0], ['Damage taken', (st.taken || 0).toFixed(0)], ['Accuracy', acc],
      ['Longest kill', st.longKill ? `${Math.round(st.longKill / B)} blocks` : '–'], ['Distance', `${Math.round((st.dist || 0) / B)} blocks`], ['Longest fall', `${st.fall.toFixed(1)} blocks`],
      ['Blocks placed', st.blocks], ['Blocks broken', st.broken || 0], ['Potions drunk', st.pots || 0],
      ['Items crafted', st.crafted || 0], ['Rock dug', `${st.dug || 0} strides`], ['Coins earned', `+${G.coinsEarned}`]].map(cell).join('');
    const vs = st.victims || [];
    $('#end-kills-h').hidden = !vs.length;
    setHTML('#end-kills', vs.map(v => `<span class="chip"><img src="${feedIconURL(v.icon)}" alt="">${escapeHTML(v.name)}</span>`).join(''));
    $('#end-online').hidden = !NET.on || won;
    $('#btn-spec').hidden = won || !G.fighters.some(f => f.alive && !f.isClone && f !== G.human);
    $('#btn-replay').hidden = won || !replayReady();
    replayFlush();
    $('#btn-pom').hidden = !pomReady();
    $('#pom-cap').hidden = !pomReady();
    if (pomReady()) $('#pom-cap').textContent = `Play of the match: ${REPLAY.best.title} · ${REPLAY.best.sub}`;
    renderRematch();
    unlockPointer();
    setMode('end');
  }
}
function playReplay(done) {
  const k = G.killer;
  if (!replayStart(REPLAY.death, done)) return false;
  $('#rp-tag').textContent = 'Replay';
  $('#rp-sub').textContent = k ? `Killed by ${k.name} · ${KITS[k.kit].name}` : G.killedBy === 'a long fall' ? 'You fell' : `Killed by ${G.killedBy}`;
  unlockPointer();
  setMode('replay');
  return true;
}
// The play of the match: the best kill anyone made, over their shoulder
function playPom(done) {
  replayFlush();
  if (!pomReady() || !replayStart(REPLAY.best, done)) return false;
  const P = REPLAY.best;
  $('#rp-tag').textContent = 'Play of the match';
  $('#rp-sub').textContent = `${P.title} · ${P.sub}`;
  unlockPointer();
  setMode('replay');
  Sfx.say(`Play of the match: ${P.title}`, true);
  return true;
}
function backToMenu() { if (NET.match) leaveMatch(); startAttract(); setMode('menu'); renderKits(); }
function fillOptions() {
  $('#o-len').value = G.settings.len; $('#o-bots').value = G.settings.bots;
  $('#o-bots-v').textContent = G.settings.bots; optValues(); renderBinds();
  $('#o-snow').checked = G.settings.snow; $('#o-dmg').checked = G.settings.dmgNums;
  $('#o-shadows').checked = G.settings.shadows; $('#o-sens').value = G.settings.sens; $('#o-vol').value = G.settings.vol;
  $('#o-fov').value = G.settings.fov; $('#o-tips').checked = G.settings.tips; $('#o-map').value = G.settings.mapSize;
  $('#o-type').value = G.settings.mapType; $('#o-lvl').value = G.settings.botLevel;
  $('#o-mode').value = G.settings.mode; $('#o-voice').checked = G.settings.voice;
}
$('#o-mode').addEventListener('change', e => { G.settings.mode = e.target.value; save(); });
$('#o-voice').addEventListener('change', e => { G.settings.voice = e.target.checked; Sfx.setVoice(e.target.checked); save(); });
$('#o-type').addEventListener('change', e => { G.settings.mapType = e.target.value; save(); });
$('#o-lvl').addEventListener('change', e => { G.settings.botLevel = +e.target.value; save(); });
$('#btn-rematch').addEventListener('click', rematch);
$('#btn-host-priv').addEventListener('click', () => hostMatch(true));
$('#code-form').addEventListener('submit', e => { e.preventDefault(); joinByCode($('#code').value); });
$('#o-len').addEventListener('change', e => { G.settings.len = +e.target.value; save(); });
$('#o-bots').addEventListener('input', e => { G.settings.bots = +e.target.value; $('#o-bots-v').textContent = e.target.value; save(); });
$('#o-snow').addEventListener('change', e => { G.settings.snow = e.target.checked; save(); });
$('#o-dmg').addEventListener('change', e => { G.settings.dmgNums = e.target.checked; save(); });
$('#o-shadows').addEventListener('change', e => { G.settings.shadows = e.target.checked; save(); });
$('#o-sens').addEventListener('input', e => { G.settings.sens = +e.target.value; optValues(); save(); });
$('#o-vol').addEventListener('input', e => { G.settings.vol = +e.target.value; Sfx.setVolume(G.settings.vol); optValues(); save(); });
$('#o-fov').addEventListener('input', e => { G.settings.fov = +e.target.value; optValues(); save(); });
// The number beside each slider
function optValues() {
  $('#o-sens-v').textContent = `${(+G.settings.sens).toFixed(1)}×`; $('#o-vol-v').textContent = `${Math.round(G.settings.vol * 100)}%`;
  $('#o-fov-v').textContent = `${G.settings.fov}°`; $('#o-bots-v').textContent = G.settings.bots;
}
// Options tabs: Match, Video, Audio, Controls
let optTab = 'match';
function showOptTab(t) {
  optTab = t;
  for (const b of document.querySelectorAll('#opt-tabs button')) { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); }
  for (const sec of document.querySelectorAll('.opt-sec')) sec.hidden = sec.dataset.sec !== t;
}
for (const b of document.querySelectorAll('#opt-tabs button')) b.addEventListener('click', () => showOptTab(b.dataset.tab));
// Key bindings: click an action, then press the key you want. A key that's taken swaps with it.
let rebinding = null;
function renderBinds() {
  const el = $('#binds');
  el.textContent = '';
  for (const a of Object.keys(BIND_DEFAULTS)) {
    const label = document.createElement('span'); label.textContent = BIND_LABELS[a];
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = rebinding === a ? 'Press a key…' : keyName(BINDS[a]);
    b.classList.toggle('wait', rebinding === a);
    b.addEventListener('click', () => { rebinding = rebinding === a ? null : a; renderBinds(); });
    el.append(label, b);
  }
}
function saveBinds() { try { localStorage.setItem('ff_keys', JSON.stringify(BINDS)); } catch (e) {} }
addEventListener('keydown', e => {
  if (!rebinding) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const k = e.key.toLowerCase();
  if (k === 'escape') { rebinding = null; renderBinds(); return; }
  if ((k >= '0' && k <= '9') || k.startsWith('arrow') || k === 'meta') { toast('Number keys, arrows and Esc can’t be bound'); return; }
  const other = Object.keys(BINDS).find(a => a !== rebinding && BINDS[a] === k);
  if (other) { BINDS[other] = BINDS[rebinding]; toast(`${BIND_LABELS[other]} moved to ${keyName(BINDS[other])}`); }
  BINDS[rebinding] = k; rebinding = null;
  saveBinds(); renderBinds();
}, true);
$('#binds-reset').addEventListener('click', () => { Object.assign(BINDS, BIND_DEFAULTS); rebinding = null; saveBinds(); renderBinds(); toast('Keys reset to the defaults'); });
$('#o-map').addEventListener('change', e => { G.settings.mapSize = +e.target.value; save(); });
$('#o-tips').addEventListener('change', e => { G.settings.tips = e.target.checked; save(); });
$('#o-tips-reset').addEventListener('click', () => { tipsSeen = []; try { localStorage.removeItem('ff_tips'); } catch (e) {} toast('Tips will show again'); $('#o-tips-reset').textContent = 'Tips reset'; });
$('#btn-spec').addEventListener('click', startSpectate);
$('#btn-replay').addEventListener('click', () => playReplay(() => setMode('end')));
$('#btn-pom').addEventListener('click', () => playPom(() => setMode('end')));
$('#btn-options').addEventListener('click', () => { fillOptions(); setMode('options'); });
$('#opt-back').addEventListener('click', () => { setMode('menu'); renderKits(); });
$('#opt-resume').addEventListener('click', resume);
$('#opt-leave').addEventListener('click', backToMenu);
$('#btn-play').addEventListener('click', startGame);
$('#btn-again').addEventListener('click', backToMenu);
$('#nick').addEventListener('input', e => { LOBBY.nick = e.target.value.replace(/[^\w .\-]/g, '').slice(0, 18) || 'Player'; save(); lobbyPresence(); if (NET.match) NET.match.presence({ n: LOBBY.nick }).catch(() => {}); });
$('#btn-host').addEventListener('click', () => hostMatch(false));
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
