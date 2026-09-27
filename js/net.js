'use strict';
// Online play over the artifact's `room` capability.
// Everyone simulates their own player and shares it through presence (~10 Hz). The host also runs
// the bots, the clock, potions, feast chests and item pickups. Hits, block edits, deaths and item
// changes travel as room messages; the machine that simulates a fighter applies damage to it.
const NET_TOPICS = ['start', 'hit', 'kill', 'blk', 'res', 'fx', 'item', 'drop', 'got', 'clock', 'end', 'chat', 'snapreq', 'snap'];
const MAX_ONLINE_BOTS = 45;
const NET = {
  on: false, lobby: null, match: null, me: 'me', hostPeer: null, code: null, roster: [], denied: false,
  outBlk: [], outRes: [], sendT: 0, clockT: 0, priv: false, watch: false, pending: false, queue: [], cfg: null, blkLog: new Map(), snapParts: null,
  isHost() { return !this.on || this.hostPeer === this.me; },
  send(topic, data) {
    if (!this.match) return;
    this.match.emit(topic, data).catch(e => {
      if (e && e.code === 'not_permitted' && !this.denied) { this.denied = true; toast('Your access to this page can’t send game moves. Ask the owner to share it with edit access.'); }
    });
  },
  // ---- called by the game ----
  hit(t, m) { if (this.on) this.send('hit', { to: t.id, ...m }); },
  kill(t, killer, fell, assists = []) { if (this.on) this.send('kill', { v: t.id, k: killer ? killer.id : null, f: fell ? 1 : 0, a: assists.map(a => a.id) }); },
  blk(op) { if (this.on) { this.outBlk.push(op); logBlk([op]); } },
  res(o) { if (this.on) this.outRes.push([o.kind === 'ore' ? 1 : 0, (o.kind === 'ore' ? world.ores : world.objs).indexOf(o), o.amt]); },
  fx(d) { if (this.on) this.send('fx', d); },
  itemAdd(it) { if (this.on) this.send('item', { add: [packItem(it)] }); },
  itemRm(it) { if (this.on) this.send('item', { rm: [it.id] }); },
  itemUpd(it) { if (this.on) this.send('item', { upd: packItem(it) }); },
  dropReq(it) { if (this.on) this.send('drop', packItem(it)); },
  got(f, stacks) { if (this.on) this.send('got', { to: f.id, s: stacks }); },
  end(w) { if (this.on && !G.endSent) { G.endSent = true; this.send('end', { w: w.id }); onEnd({ w: w.id }); } },
};
// Every block change this match, latest per cell, so someone who starts watching late can be caught up
function logBlk(ops) { for (const op of ops) if (Array.isArray(op)) NET.blkLog.set(op[0] + ',' + op[1] + ',' + op[2], op); }
const packItem = it => ({ id: it.id, k: it.kind, x: Math.round(it.x), y: Math.round(it.y), z: Math.round(it.z), l: it.layer, s: it.stacks, np: it.noPick || null });
const unpackItem = d => ({ id: d.id, kind: d.k, x: d.x, y: d.y, z: d.z, layer: d.l, stacks: d.s, noPick: d.np, noPickT: G.t + 1.2 });

// ---- per-frame: publish my state (and the bots, if hosting); flush batched edits ----
function netTick(dt) {
  if (!NET.on || !NET.match) return;
  NET.sendT -= dt; NET.clockT -= dt;
  if (NET.outBlk.length) { for (let i = 0; i < NET.outBlk.length; i += 150) NET.send('blk', { ops: NET.outBlk.slice(i, i + 150) }); NET.outBlk = []; }
  if (NET.outRes.length && NET.sendT <= 0) { NET.send('res', { r: NET.outRes.slice(0, 200) }); NET.outRes = []; }
  if (NET.sendT > 0) return;
  NET.sendT = 0.1;
  const h = G.human, patch = {};
  if (!G.watching) patch.s = packFighter(h); // spectators aren't in the match
  if (NET.isHost()) {
    patch.b = [];
    for (const b of G.fighters) if (b.bot && !b.isClone && b.id[0] === 'b') patch.b.push(...packFighter(b));
    patch.t = Math.round(G.t * 10);
    if (NET.clockT <= 0) { NET.clockT = 2; NET.send('clock', { t: G.t }); }
  }
  NET.match.presence(patch).catch(() => {});
}
// x, y, z, face, hp, flags, weapon tier, armour mask, swing count, kills
function packFighter(f) {
  const flags = (f.alive ? 1 : 0) | (f.layer ? 2 : 0) | (f.hidden ? 4 : 0) | (f.sneak ? 8 : 0) | (f.charge >= 0 ? 16 : 0) | (['bush', 'rock', 'snowrock', 'cactus'].indexOf(f.disguise) << 5)
    | (f.titanT > 0 ? 128 : 0) | (f.burnT > 0 ? 256 : 0) | (f.pitT > 0 ? 512 : 0) | ((f.emoteT > 0 ? f.emote + 1 : 0) << 10);
  return [Math.round(f.x), Math.round(f.y), Math.round(f.z), Math.round(f.face * 100), Math.round(f.hp * 10), flags, f.weapon, armorMask(f), f.swings % 100, f.kills];
}
function applyPacked(f, a, o) {
  if (!f || f.deadDone) return;
  f.net.tx = a[o]; f.net.ty = a[o + 1]; f.net.tz = a[o + 2]; f.net.tf = a[o + 3] / 100;
  f.hp = a[o + 4] / 10; const fl = a[o + 5];
  if (!(fl & 1) && f.alive) { f.alive = false; }
  f.layer = fl & 2 ? 1 : 0; f.hidden = !!(fl & 4); f.sneak = f.net.sn = !!(fl & 8); f.charge = fl & 16 ? 0.5 : -1;
  f.disguise = ['bush', 'rock', 'snowrock', 'cactus'][(fl >> 5) & 3];
  f.net.titan = !!(fl & 128); f.burnNet = !!(fl & 256); f.pitNet = !!(fl & 512);
  const em = (fl >> 10) & 7; // an emote in progress: keep it going, and show its bubble when it starts
  if (em && EMOTES[em - 1]) { if (f.emote !== em - 1 || !(f.emoteT > 0)) { f.sayText = EMOTES[em - 1].say; f.sayT = 2; } f.emote = em - 1; f.emoteT = 0.5; }
  else f.emoteT = 0;
  f.net.w = a[o + 6]; f.net.am = a[o + 7];
  f.net.ad = [1, 2, 4, 8].reduce((d, bit, i) => d + (f.net.am & bit ? [0.08, 0.14, 0.11, 0.07][i] * (f.net.am & 16 ? 1.45 : 1) : 0), 0);
  if (f.net.sw !== undefined && f.net.sw !== a[o + 8]) { f.swingT = 0.14; noise(f.x, f.y, f.layer, 320, f); }
  f.net.sw = a[o + 8]; f.kills = a[o + 9];
  if (f.net.first === undefined) { f.net.first = 1; f.x = f.net.tx; f.y = f.net.ty; f.z = f.net.tz; f.face = f.net.tf; }
}
// Smoothly move mirrored fighters toward their last reported state
function netInterp(dt) {
  const k = Math.min(1, dt * 12);
  for (const f of G.fighters) {
    if (!f.remote || f.net.tx === undefined) continue;
    if (hyp(f.net.tx - f.x, f.net.ty - f.y) > 300) { f.x = f.net.tx; f.y = f.net.ty; f.z = f.net.tz; }
    f.x += (f.net.tx - f.x) * k; f.y += (f.net.ty - f.y) * k; f.z += (f.net.tz - f.z) * k;
    f.face += angDiff(f.face, f.net.tf) * k;
    f.mx = (f.net.tx - f.x) * 0.05; f.my = (f.net.ty - f.y) * 0.05;
    const size = f.net.titan ? TITAN_SIZE : 1;
    if (f.size !== size) { f.size += (size - f.size) * k * 0.5; if (Math.abs(f.size - size) < 0.02) f.size = size; f.r = 13 * f.size; }
    if (f.swingT > 0) f.swingT -= dt;
    if (f.hurtT > 0) f.hurtT -= dt;
  }
}

// ---- incoming ----
function onPeersMatch(ch) {
  // Joined by code: the host marks itself in the match room
  if (!NET.hostPeer) { const h = ch.peers.find(p => !p.sameTab && p.presence && p.presence.h); if (h) NET.hostPeer = h.peer; }
  // Joined with a code but the match is already going: watch it instead
  if (NET.match && !NET.on && !NET.watch && NET.hostPeer && NET.hostPeer !== NET.me) {
    const hp = ch.peers.find(p => p.peer === NET.hostPeer);
    if (hp && hp.presence && hp.presence.live) { NET.watch = true; NET.match.presence({ w: 1 }).catch(() => {}); requestSnap(); }
  }
  for (const p of ch.peers) {
    if (p.sameTab || !p.presence) continue;
    if (p.presence.s) applyPacked(fighterById(p.peer), p.presence.s, 0);
    if (p.peer === NET.hostPeer && p.presence.b && !NET.isHost()) {
      const b = p.presence.b;
      for (let i = 0, n = 0; i + 10 <= b.length; i += 10, n++) applyPacked(fighterById('b' + n), b, i);
    }
  }
  for (const p of ch.left) {
    if (p.sameTab) continue;
    const f = fighterById(p.peer);
    if (NET.on && f && f.alive) { f.alive = false; f.deadDone = true; G.feed.unshift({ txt: `${f.name} left the match`, t: 7 }); }
    if (p.peer === NET.hostPeer) migrateHost();
    else if (NET.on) checkWin();
  }
  renderMatchPanel();
}
function migrateHost() {
  const ids = NET.match.peers().map(p => p.peer).filter(id => NET.roster.some(r => r.p === id)).sort();
  NET.hostPeer = ids[0] || (G.watching ? null : NET.me); // a spectator never takes over the match
  if (NET.isHost() && NET.match) NET.match.presence({ h: 1 }).catch(() => {}); // so code-joiners can still find the match
  if (NET.isHost() && NET.on) {
    for (const f of G.fighters) if (f.bot && f.id[0] === 'b') { f.remote = false; f.plan = null; f.vz = 0; f.onGround = false; }
    toast('The host left. You are now running the bots.');
  }
  if (NET.on) checkWin();
}
function wireMatch(m) {
  const H = {
    start: d => startOnline(d),
    snapreq: (d, msg) => { if (NET.isHost() && NET.on && !G.watching) sendSnap(msg.peer); },
    snap: d => receiveSnap(d),
    hit: d => { const t = fighterById(d.to); if (t && !t.remote) applyHit(t, d); },
    kill: (d, msg) => {
      const v = fighterById(d.v); if (!v || !v.remote) return;
      v.deadDone = true; announceKill(v, d.k ? fighterById(d.k) : null, d.f, (Array.isArray(d.a) ? d.a : []).map(fighterById).filter(Boolean));
      addFx('puff', v.x, v.y, v.layer, { col: v.color, big: true, z: v.z + 30 });
    },
    blk: d => { applyBlockOps(d.ops || []); logBlk(d.ops || []); },
    res: d => { for (const [t, i, a] of d.r || []) { const o = (t ? world.ores : world.objs)[i]; if (o && a < o.amt) o.amt = a; } },
    fx: (d, msg) => {
      const o = fighterById(d.o);
      if (d.k === 'p' && o) { const v = d.v; noise(v[0], v[1], d.l, 480, o); G.proj.push({ kind: d.t, x: v[0], y: v[1], z: v[2], vx: v[3], vy: v[4], vz: v[5], owner: o, layer: d.l, life: d.t === 'hook' ? 0.6 : 2, ghost: true }); }
      if (d.k === 's') addFx('strike', d.x, d.y, d.l, { t: 0.6, ghost: true });
      if (d.k === 'c' && o) for (const dd of [-0.7, 0.7]) spawnClone(o, d.f + dd);
      if (d.k === 'ping') G.pings.push({ x: d.x, y: d.y, layer: 1, t: 12, src: fighterById(msg.peer) });
      if (d.k === 'relic' && typeof d.i === 'string') announceRelic(o, d.i);
      if (d.k === 'bk' && typeof d.i === 'string') applyBikeMsg(d);
      if (d.k === 'bkx') { const k = bikeById(d.i); if (k && !k.gone) { k.gone = true; const r = riderOf(k); if (r && r.bike === k) { if (r.remote) r.bike = null; else dismountBike(r, true); } } bikeBoomFx(d.x, d.y, d.z); }
      if (d.k === 'bsay' && o && typeof d.t === 'string') showSay(o, d.t);
      if (d.k === 'qc' && o && QUICK[d.q]) hearQuick(o, d.q, Array.isArray(d.p) ? { x: d.p[0], y: d.p[1], layer: d.p[2] ? 1 : 0 } : null);
      if (d.k === 'hole') addFx('hole', d.x, d.y, 0, { t: 6, z: d.z + 0.6 });
      if (d.k === 'team' && Array.isArray(d.ids)) announceTeam(d.ids, typeof d.c === 'string' ? d.c : null);
      if (d.k === 'betray' && Array.isArray(d.ids)) announceBetrayal(d.ids, fighterById(d.a), fighterById(d.v));
      if (d.k === 'bounty' && !NET.isHost()) { const f = fighterById(d.o); if (f && f.alive) setBounty(f); }
      if (d.k === 'stomp') { addFx('ring', d.x, d.y, 0, { col: '#c9a26a', big: true, z: d.z + 1 }); addFx('puff', d.x, d.y, 0, { col: '#b8a488', big: true, z: d.z + 6 }); Sfx.play('stomp', d.x, d.y, d.z); }
      if (d.k === 'boom') { addFx('puff', d.x, d.y, 0, { col: '#e2733b', big: true, z: d.z + 20 }); addFx('bolt', d.x, d.y, 0, { t: 0.2 }); Sfx.play('bolt', d.x, d.y, d.z); }
      if (d.k === 'rope' && o && Array.isArray(d.a)) addFx('rope', d.a[0], d.a[1], 0, { owner: o, t: 1.4, az: d.a[2] });
    },
    item: d => {
      if (NET.isHost()) return;
      for (const a of d.add || []) if (!G.items.some(i => i.id === a.id)) G.items.push(unpackItem(a));
      for (const id of d.rm || []) { const it = G.items.find(i => i.id === id); if (it) it.gone = true; }
      if (d.upd) { const it = G.items.find(i => i.id === d.upd.id); if (it) { it.stacks = d.upd.s; if (d.upd.k) it.kind = d.upd.k; } }
    },
    drop: d => { if (NET.isHost()) addItem(unpackItem(d)); },
    got: d => {
      if (d.to !== NET.me || !G.human.alive) return;
      const left = [];
      for (const s of d.s) { const l = give(G.human, s.id, s.n); if (l) left.push({ id: s.id, n: l }); }
      Sfx.play('pickup'); pickupToast(d.s, left);
      if (left.length) dropStacks(G.human, left);
    },
    clock: d => { if (!NET.isHost() && Math.abs(G.t - d.t) > 0.6) G.t = d.t; },
    end: d => onEnd(d),
    chat: (d, msg) => { const f = fighterById(msg.peer); if (typeof d.t === 'string') G.feed.unshift({ txt: `${f ? f.name : 'Someone'}: ${d.t.slice(0, 80)}`, t: 10, chat: true }); },
  };
  for (const t of NET_TOPICS) m.on(t, msg => {
    if (msg.sameTab) return;
    // A spectator still catching up keeps game messages until its copy of the match is built
    if (NET.pending && t !== 'snap' && t !== 'start') { if (t !== 'snapreq') NET.queue.push([t, msg]); return; }
    try { H[t](msg.data || {}, msg); } catch (e) { console.warn('net', t, e); }
  });
  NET.handlers = H;
  m.onPeers(onPeersMatch);
}

// ---- spectators: the host sends a snapshot of the match so far, in pieces under the relay's size limit ----
function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
function sendSnap(to) {
  const res = [];
  world.objs.forEach((o, i) => { if (o.amt !== o.a0) res.push([0, i, o.amt]); });
  world.ores.forEach((o, i) => { if (o.amt !== o.a0) res.push([1, i, o.amt]); });
  const head = {
    cfg: NET.cfg, t: G.t, res, dead: G.fighters.filter(f => !f.alive && !f.isClone).map(f => f.id),
    kills: G.fighters.filter(f => !f.isClone && f.kills).map(f => [f.id, f.kills]),
    bikes: (G.bikes || []).map(k => [k.id, ...[k.x, k.y, k.z, k.face * 100, k.hp].map(Math.round), k.rider, k.gone ? 1 : 0]),
    drops: (world.drops || []).map(d => d.st), feast: G.feast ? [FEAST_SITES.indexOf(G.feast.site), G.feast.state] : null,
    pit: G.pit, bounty: G.bounty ? G.bounty.id : null,
  };
  const parts = [head, ...chunk([...NET.blkLog.values()], 500).map(b => ({ blk: b })), ...chunk(G.items.filter(i => !i.gone && !i.local).map(packItem), 120).map(i => ({ items: i }))];
  parts.forEach((p, n) => NET.send('snap', { to, n, of: parts.length, p }));
}
function receiveSnap(d) {
  if (d.to !== NET.me || !NET.pending || !d.p) return;
  const s = NET.snapParts = NET.snapParts || [];
  s[d.n] = d.p;
  if (s.filter(Boolean).length < d.of || !s[0] || !s[0].cfg) return;
  NET.snapParts = null;
  startWatch(s[0].cfg, s);
}
// Build the match from its settings, catch up from the snapshot, then play back anything that arrived meanwhile
function startWatch(cfg, parts = []) {
  NET.on = true; NET.pending = false; NET.cfg = cfg; G.watching = true; NET.roster = cfg.roster || [];
  if (cfg.host && !NET.hostPeer) NET.hostPeer = cfg.host;
  G.settings.len = cfg.len; G.grace = 2; G.botLevel = cfg.lvl ?? 1;
  const humans = (cfg.roster || []).map(r => {
    const f = new Fighter(String(r.n || 'Player').slice(0, 18), KITS[r.k] ? r.k : 'killer', false, r.p);
    f.color = /^#[0-9a-f]{6}$/i.test(r.c) ? r.c : '#f2ead6'; f.remote = true; newInv(f);
    return f;
  });
  newMatch(cfg.bots, null, cfg.seed, humans, MAP_SIZES[cfg.sz] ? cfg.sz : 4800, cfg.mt || 'mixed');
  for (const f of G.fighters) f.remote = true;
  const me = new Fighter(LOBBY.nick || 'Watcher', 'killer', false, NET.me);
  Object.assign(me, { alive: false, deadDone: true, x: PIT.x, y: PIT.y, z: 300 });
  G.human = me;
  const head = parts[0];
  if (head) {
    G.t = head.t || 0;
    for (const [k, i, a] of head.res || []) { const o = (k ? world.ores : world.objs)[i]; if (o) o.amt = a; }
    for (const id of head.dead || []) { const f = fighterById(id); if (f) { f.alive = false; f.deadDone = true; } }
    for (const [id, n] of head.kills || []) { const f = fighterById(id); if (f) f.kills = n; }
    for (const [id, x, y, z, fc, hp, r, gone] of head.bikes || []) { const k = bikeById(id); if (k) Object.assign(k, { x, y, z, face: fc / 100, hp, rider: r || null, gone: !!gone }); }
    (head.drops || []).forEach((st, i) => { if (world.drops[i]) world.drops[i].st = st; });
    if (head.feast && FEAST_SITES[head.feast[0]]) G.feast = { site: FEAST_SITES[head.feast[0]], state: head.feast[1] };
    G.pit = !!head.pit; G.graceDone = G.clockMin >= G.grace;
    if (head.bounty) G.bounty = fighterById(head.bounty) || null;
    for (const p of parts.slice(1)) {
      if (p.blk) { applyBlockOps(p.blk); logBlk(p.blk); }
      if (p.items) for (const a of p.items) if (!G.items.some(i => i.id === a.id)) G.items.push(unpackItem(a));
    }
  }
  G.clockMin = G.t / G.settings.len;
  Sfx.start(); Sfx.setVolume(G.settings.vol);
  G.specTarget = null; G.freeCam = null; spectate(1);
  setMode('spectate');
  if (!G.specTarget) startFreeCam();
  const q = NET.queue; NET.queue = [];
  for (const [t, msg] of q) try { NET.handlers[t](msg.data || {}, msg); } catch (e) {}
  banner('Spectating', 'You’re watching this match. ← → follow a player · F free camera · Esc to leave');
}
function onEnd(d) {
  if (G.watching) { const w = fighterById(d.w); banner(`${w ? w.name : 'Someone'} wins`, 'Last one standing.'); return; }
  if (G.over && !G.human.alive) { const w = fighterById(d.w); banner(`${w ? w.name : 'Someone'} wins`, 'Last one standing.'); return; }
  const w = fighterById(d.w);
  if (d.w === NET.me) endGame(true);
  else { G.killedBy = null; G.winnerName = w ? w.name : 'Someone'; endGame(false, true); }
}

// ---- starting a match ----
function startOnline(d) {
  if (G.mode === 'play' && !G.watching) return;
  NET.on = true; NET.hostPeer = d.host; NET.roster = d.roster; G.endSent = false; NET.cfg = d; NET.pending = false; NET.queue = [];
  if (!d.roster.some(r => r.p === NET.me)) { startWatch(d); return; } // not playing in it: watch from the start
  G.watching = false; G.freeCam = null;
  G.settings.len = d.len;
  G.grace = 2; G.botLevel = d.lvl ?? 1;
  const humans = d.roster.map(r => {
    const f = new Fighter(String(r.n || 'Player').slice(0, 18), KITS[r.k] ? r.k : 'killer', false, r.p);
    f.color = /^#[0-9a-f]{6}$/i.test(r.c) ? r.c : '#f2ead6';
    if (r.p !== NET.me) { f.remote = true; if (f.slots) newInv(f); }
    return f;
  });
  const me = humans.find(f => f.id === NET.me);
  newMatch(d.bots, me, d.seed, humans, MAP_SIZES[d.sz] ? d.sz : 4800, d.mt || 'mixed');
  for (const f of G.fighters) if (f.bot && !NET.isHost()) f.remote = true;
  G.human = me;
  VIEW.pitch = -0.05;
  Sfx.start(); Sfx.setVolume(G.settings.vol);
  setMode('play');
  lockPointer(true, false); // started by the host's message, not your click
  banner('Grace period', `Online · ${humans.length} players + ${d.bots} bots. PvP turns on at 02:00.`);
  NET.lobby && NET.lobby.presence({ st: 'play' }).catch(() => {});
}

// ---- lobby ----
const LOBBY = { nick: '', color: pick(COLORS) };
try { LOBBY.nick = localStorage.getItem('ff_nick') || ''; } catch (e) {}
if (!LOBBY.nick) LOBBY.nick = 'Player' + Math.floor(Math.random() * 900 + 100);
// Where online play comes from, in order: claude.ai's room capability (when the page is an
// Artifact), the Feastfall relay server (npm start, or ?server=wss://…), or two local tabs.
const DESKTOP = /Electron/i.test(navigator.userAgent), DESKTOP_PORT = 47800;
// "192.168.1.5", "192.168.1.5:47800", "http://host:8080" or "wss://host/ws" -> a WebSocket address
function serverUrlFrom(text) {
  let t = String(text).trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) t = t.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(t)) {
    if (!/:\d+$/.test(t.split('/')[0])) t = t.split('/')[0] + ':' + DESKTOP_PORT;
    t = (location.protocol === 'https:' ? 'wss://' : 'ws://') + t;
  }
  return /\/ws$/.test(t) ? t : t.replace(/\/?$/, '/ws');
}
function wireServerForm(joinedOther) {
  const form = $('#srv-form');
  form.hidden = false;
  $('#srv-home').hidden = !joinedOther;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const url = serverUrlFrom($('#srv').value);
    if (!url) { toast('Type the address your friend sees in their game, like 192.168.1.5:47800'); return; }
    location.search = '?server=' + encodeURIComponent(url);
  });
  $('#srv-home').addEventListener('click', () => { location.search = ''; });
}
async function netInit() {
  const status = $('#net-status'), hint = $('#net-hint');
  const params = new URLSearchParams(location.search), joinedOther = !!params.get('server');
  if (!window.claude) wireServerForm(joinedOther);
  let room = null, kind = '';
  try { room = window.claude && window.claude.use ? await window.claude.use('room') : null; } catch (e) { room = null; }
  if (room) kind = 'claude';
  if (!room) {
    const srv = params.get('server') || window.FEASTFALL_SERVER;
    if (srv) { room = wsRoom(srv === 'auto' ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws' : srv); kind = 'server'; }
  }
  if (!room && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { room = fakeRoom(); kind = 'local'; }
  if (!room) {
    status.textContent = window.claude ? 'Online play isn’t available in this view. Open the page on claude.ai while signed in.'
      : 'Online play needs a Feastfall server. Run it with npm start (see the README), or open this page with ?server=wss://your-server.';
    $('#online-ui').hidden = true; return;
  }
  hint.textContent = {
    claude: 'Everyone plays on this page. To play together, share it with edit access (view-only access can’t send moves). Up to 16 players, plus bots.',
    server: joinedOther ? `Connected to ${params.get('server').replace(/^wss?:\/\//, '').replace(/\/ws$/, '')}. Up to 16 players, plus bots.` : 'Everyone on the same server shares a lobby. Up to 16 players, plus bots.',
    local: 'Local test mode: open this page in a second tab to play against yourself.',
  }[kind];
  NET.lobby = room;
  $('#online-ui').hidden = false;
  // Running our own server (npm start or the desktop app): tell friends on the network how to reach it
  if (kind === 'server' && !joinedOther && window.FEASTFALL_SERVER === 'auto') {
    fetch('info.json').then(r => r.json()).then(i => {
      if (!i.lan || !i.lan.length) return;
      const el = $('#lan-info'), addr = `${i.lan[0]}:${i.port}`, others = i.lan.slice(1, 3).map(a => `${a}:${i.port}`);
      el.textContent = (DESKTOP ? `Friends on your network: type ${addr} under “Join a server”.` : `Friends on your network can open http://${addr} or type ${addr} under “Join a server”.`)
        + (others.length ? ` If that doesn’t connect, try ${others.join(' or ')}.` : '');
      el.hidden = false;
    }).catch(() => {});
  }
  $('#nick').value = LOBBY.nick;
  room.onPeers(ch => {
    const mine = ch.peers.find(p => p.sameTab);
    if (mine) NET.me = mine.peer;
    renderLobby();
  }, () => { status.textContent = 'Online play is unavailable right now.'; });
  let downT;
  room.onConnection(c => {
    clearTimeout(downT);
    if (c) status.textContent = '';
    else downT = setTimeout(() => { status.textContent = kind === 'server' ? 'Can’t reach the game server. Retrying…' : 'Connecting…'; }, 2000);
    renderLobby();
  });
  lobbyPresence();
}
function lobbyPresence(extra = {}) {
  if (!NET.lobby) return;
  const st = NET.match ? (NET.hostPeer === NET.me ? (NET.priv ? 'phost' : 'host') : 'match') : 'lobby';
  NET.lobby.presence({ n: LOBBY.nick, k: STORE.kit, c: LOBBY.color, st, code: NET.priv ? null : NET.code, ...extra }).catch(() => {});
}
function renderLobby() {
  if (!NET.lobby) return;
  const peers = NET.lobby.peers();
  const others = peers.filter(p => !p.sameTab);
  $('#net-count').textContent = peers.length ? `${peers.length} ${peers.length === 1 ? 'person' : 'people'} on this page` : 'Connecting…';
  // Private matches don't publish their code, so they never show up here
  const hosts = others.filter(p => p.presence && p.presence.st === 'host' && typeof p.presence.code === 'string');
  const list = $('#matches');
  list.textContent = '';
  if (!hosts.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = NET.match ? '' : 'No open matches. Host one and share the page with friends.'; list.append(p); }
  for (const p of hosts) {
    const row = document.createElement('div'); row.className = 'match-row';
    const name = document.createElement('span'); name.textContent = `${String(p.presence.n || 'Someone').slice(0, 18)}’s match`;
    const meta = document.createElement('small'); meta.textContent = p.presence.started ? 'in progress' : `${p.presence.np || 1} joined`;
    const b = document.createElement('button'); b.className = 'btn ghost small';
    const live = !!p.presence.started;
    b.textContent = NET.code === p.presence.code ? 'Joined' : live ? 'Watch' : 'Join';
    b.disabled = !!NET.match;
    b.onclick = () => live ? watchMatch(p.presence.code, p.peer) : joinMatch(p.presence.code, p.peer);
    row.append(name, meta, b); list.append(row);
  }
  $('#btn-host').disabled = !!NET.match;
}
function renderMatchPanel() {
  const panel = $('#match-panel');
  if (!NET.match) { panel.hidden = true; return; }
  panel.hidden = false;
  const peers = NET.match.peers();
  const host = NET.hostPeer === NET.me;
  $('#match-title').textContent = NET.watch ? 'Spectating' : host ? (NET.priv ? 'Your private match' : 'Your match') : NET.hostPeer ? 'Waiting for the host to start' : 'Looking for the match…';
  $('#match-code').hidden = !(host && NET.priv);
  $('#match-code').textContent = `Code: ${String(NET.code || '').toUpperCase()} · friends type it under “Join with a code”`;
  const ul = $('#match-players'); ul.textContent = '';
  for (const p of peers) {
    const li = document.createElement('li');
    const dot = document.createElement('i'); dot.style.background = /^#[0-9a-f]{6}$/i.test(p.presence.c) ? p.presence.c : '#888';
    const t = document.createElement('span');
    t.textContent = `${String(p.presence.n || 'Joining…').slice(0, 18)}${p.sameTab ? ' (you)' : ''}${p.peer === NET.hostPeer ? ' · host' : ''}${p.presence.w ? ' · watching' : ''}${p.presence.rm ? ' · ready' : ''}`;
    const k = document.createElement('small'); k.textContent = KITS[p.presence.k] ? KITS[p.presence.k].name : '';
    li.append(dot, t, k); ul.append(li);
  }
  $('#host-controls').hidden = !host;
  $('#m-bots-v').textContent = $('#m-bots').value;
  if (host) lobbyPresence({ np: peers.filter(p => !p.presence.w).length });
  renderRematch();
}
// A private match isn't listed: friends join with its code
async function hostMatch(priv = false) {
  const code = Math.random().toString(36).slice(2, 7);
  NET.priv = priv;
  await enterMatch(code, null, { host: true });
}
async function joinMatch(code, hostPeer) { await enterMatch(code, hostPeer); }
async function joinByCode(text) {
  const code = String(text || '').trim().toLowerCase();
  if (!/^[a-z0-9]{5}$/.test(code)) { toast('Codes are five letters and numbers, like K3X9P'); return; }
  await enterMatch(code, null, { byCode: true });
  if (!NET.match) return;
  // No host answering after a few seconds: there's no such match
  setTimeout(() => { if (NET.match && NET.code === code && !NET.hostPeer) { toast('No match with that code'); leaveMatch(); } }, 3500);
}
async function watchMatch(code, hostPeer) { await enterMatch(code, hostPeer, { watch: true }); }
async function enterMatch(code, hostPeer, o = {}) {
  if (!NET.lobby || NET.match) return;
  try { NET.match = await NET.lobby.join('ff-' + code); }
  catch (e) { toast(e && e.code === 'not_permitted' ? 'Your access to this page can’t join matches.' : 'Couldn’t join that match. Try again.'); return; }
  NET.code = code; NET.hostPeer = o.host ? NET.me : hostPeer || null; NET.denied = false; NET.watch = !!o.watch;
  if (!o.host) NET.priv = false;
  wireMatch(NET.match);
  NET.match.presence({ n: LOBBY.nick, k: STORE.kit, c: LOBBY.color, h: o.host ? 1 : undefined, w: o.watch ? 1 : undefined }).catch(() => {});
  lobbyPresence();
  renderLobby(); renderMatchPanel();
  if (o.watch) requestSnap();
}
// Spectating a match in progress: ask the host for a snapshot (again, in case the first ask is missed)
function requestSnap(tries = 0) {
  if (!NET.match || !NET.watch || (G.watching && !NET.pending) || tries > 5) { if (tries > 5 && NET.pending) { toast('The match didn’t answer. Try again.'); leaveMatch(); } return; }
  NET.pending = true; NET.queue = []; NET.snapParts = null;
  if (NET.hostPeer) NET.send('snapreq', {});
  setTimeout(() => { if (NET.pending) requestSnap(tries + 1); }, 2500);
}
async function leaveMatch() {
  if (NET.match) { try { await NET.match.leave(); } catch (e) {} }
  Object.assign(NET, { match: null, code: null, on: false, hostPeer: null, roster: [], watch: false, pending: false, queue: [], priv: false });
  G.watching = false;
  lobbyPresence(); renderLobby(); renderMatchPanel();
}
function startHostedMatch() {
  if (!NET.match || NET.hostPeer !== NET.me) return;
  // Spectators stay spectators; everyone else plays
  const roster = NET.match.peers().filter(p => p.presence && p.presence.n && !p.presence.w).slice(0, 16)
    .map(p => ({ p: p.peer, n: String(p.presence.n).slice(0, 18), k: p.presence.k, c: p.presence.c }));
  if (!roster.some(r => r.p === NET.me)) roster.unshift({ p: NET.me, n: LOBBY.nick, k: STORE.kit, c: LOBBY.color });
  roster.sort((a, b) => a.p < b.p ? -1 : 1);
  const d = { seed: Math.floor(Math.random() * 1e9), bots: Math.min(MAX_ONLINE_BOTS, +$('#m-bots').value), len: +$('#m-len').value, sz: +$('#m-size').value,
    mt: $('#m-type').value, lvl: +$('#m-lvl').value, host: NET.me, roster };
  NET.send('start', d);
  lobbyPresence({ started: true });
  NET.match.presence({ rm: null, live: 1 }).catch(() => {});
  startOnline(d);
}
// Rematch: the host starts a new match in the same room; everyone else says they're ready
function renderRematch() {
  const b = $('#btn-rematch');
  if (!b) return;
  if (!NET.match) { b.textContent = 'Rematch'; b.disabled = false; return; }
  const peers = NET.match.peers(), ready = peers.filter(p => p.presence && p.presence.rm && !p.sameTab).length, host = NET.hostPeer === NET.me;
  b.textContent = host ? `Rematch${ready ? ` · ${ready} ready` : ''}` : peers.find(p => p.sameTab && p.presence.rm) ? 'Waiting for the host…' : 'Ready for a rematch';
}
function rematch() {
  if (!NET.match) { startGame(); return; }
  if (NET.hostPeer === NET.me) { NET.watch = false; startHostedMatch(); }
  else { NET.watch = false; NET.match.presence({ rm: 1, w: null }).catch(() => {}); renderRematch(); } // spectators can join the next one
}

// ---- local testing: two tabs on localhost talk through a BroadcastChannel ----
function fakeRoom() {
  const me = 'p' + Math.random().toString(36).slice(2, 10);
  function mk(name) {
    const bc = new BroadcastChannel('ffroom-' + name), handlers = {}, peers = new Map(), cbs = [];
    let pres = {}, snap = [], closed = false;
    const post = m => { if (!closed) bc.postMessage(m); };
    const fire = (joined = [], left = []) => { snap = Object.freeze([{ peer: me, presence: pres, isMe: true, sameTab: true }, ...peers.values()]); for (const cb of cbs) cb({ peers: snap, joined, left, updated: [] }); };
    bc.onmessage = e => {
      const m = e.data;
      if (m.type === 'emit') (handlers[m.topic] || []).forEach(h => h({ topic: m.topic, data: m.data, peer: m.peer, isMe: false, sameTab: false }));
      if (m.type === 'pres') { const had = peers.has(m.peer); peers.set(m.peer, { peer: m.peer, presence: m.presence, isMe: false, sameTab: false, seen: Date.now() }); fire(had ? [] : [peers.get(m.peer)]); }
      if (m.type === 'hello') post({ type: 'pres', peer: me, presence: pres });
      if (m.type === 'bye') { const p = peers.get(m.peer); peers.delete(m.peer); if (p) fire([], [p]); }
    };
    addEventListener('beforeunload', () => post({ type: 'bye', peer: me }));
    setInterval(() => { for (const [id, p] of peers) if (Date.now() - p.seen > 5000) { peers.delete(id); fire([], [p]); } }, 1000);
    setInterval(() => post({ type: 'pres', peer: me, presence: pres }), 1500);
    post({ type: 'hello', peer: me });
    const api = {
      name, emit: async (topic, data) => post({ type: 'emit', topic, data, peer: me }),
      on: (topic, h) => { (handlers[topic] = handlers[topic] || []).push(h); return () => {}; },
      presence: async patch => { pres = Object.freeze({ ...pres, ...patch }); post({ type: 'pres', peer: me, presence: pres }); fire(); },
      peers: () => snap,
      onPeers: cb => { cbs.push(cb); setTimeout(() => fire(), 0); return () => {}; },
      connected: () => true, onConnection: cb => { setTimeout(() => cb(true), 0); return () => {}; },
      leave: async () => { post({ type: 'bye', peer: me }); closed = true; bc.close(); },
      join: async n => mk(name + '.' + n),
    };
    return api;
  }
  return mk('lobby');
}

// ---- the Feastfall relay server (server.js): same calls as the claude.ai room, over a WebSocket ----
function wsRoom(url) {
  let ws = null, me = 'me', open = false, retry = 500;
  const rooms = {}, connCbs = [];
  const send = m => { if (open) ws.send(JSON.stringify(m)); };
  const peerObj = (id, p) => ({ peer: id, presence: Object.freeze(p || {}), isMe: false, sameTab: false, by: null, kind: 'viewer', guest: false, updatedAt: Date.now() });
  function mk(name) {
    const st = { handlers: {}, peers: new Map(), cbs: [], pres: Object.freeze({}), snap: Object.freeze([]) };
    st.fire = (joined = [], left = [], updated = []) => {
      st.snap = Object.freeze([{ ...peerObj(me, st.pres), isMe: true, sameTab: true }, ...st.peers.values()]);
      for (const cb of st.cbs) cb({ peers: st.snap, joined, left, updated });
    };
    rooms[name] = st;
    send({ t: 'join', r: name });
    return st.api = {
      name,
      emit: async (topic, data) => send({ t: 'emit', r: name, topic, data }),
      on: (topic, h) => { (st.handlers[topic] = st.handlers[topic] || []).push(h); return () => { st.handlers[topic] = st.handlers[topic].filter(x => x !== h); }; },
      presence: async patch => {
        const next = { ...st.pres };
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
        st.pres = Object.freeze(next); send({ t: 'pres', r: name, p: st.pres }); st.fire();
      },
      peers: () => st.snap,
      onPeers: cb => { st.cbs.push(cb); setTimeout(() => st.fire(), 0); return () => { st.cbs = st.cbs.filter(x => x !== cb); }; },
      connected: () => open,
      onConnection: cb => { connCbs.push(cb); setTimeout(() => cb(open), 0); return () => {}; },
      leave: async () => { send({ t: 'leave', r: name }); delete rooms[name]; },
      join: async n => { if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(n)) throw { code: 'invalid_argument' }; return rooms[n] ? rooms[n].api : mk(n); },
    };
  }
  function connect() {
    try { ws = new WebSocket(url); } catch (e) { setTimeout(connect, retry = Math.min(retry * 2, 10000)); return; }
    ws.onopen = () => { open = true; retry = 500; };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello') {
        me = m.id;
        for (const [name, st] of Object.entries(rooms)) { st.peers.clear(); send({ t: 'join', r: name }); if (Object.keys(st.pres).length) send({ t: 'pres', r: name, p: st.pres }); st.fire(); }
        connCbs.forEach(cb => cb(true));
        return;
      }
      const st = rooms[m.r];
      if (!st) return;
      if (m.t === 'peers') { st.peers.clear(); for (const p of m.peers || []) st.peers.set(p.id, peerObj(p.id, p.p)); st.fire([...st.peers.values()]); }
      else if (m.t === 'pres') { const had = st.peers.has(m.id), po = peerObj(m.id, m.p); st.peers.set(m.id, po); st.fire(had ? [] : [po], [], had ? [po] : []); }
      else if (m.t === 'left') { const p = st.peers.get(m.id); st.peers.delete(m.id); if (p) st.fire([], [p]); }
      else if (m.t === 'emit') for (const h of st.handlers[m.topic] || []) h({ topic: m.topic, data: m.data, peer: m.id, isMe: false, sameTab: false, by: null, kind: 'viewer', guest: false });
    };
    ws.onclose = () => {
      const was = open; open = false;
      for (const st of Object.values(rooms)) { const left = [...st.peers.values()]; st.peers.clear(); st.fire([], left); }
      if (was) connCbs.forEach(cb => cb(false));
      setTimeout(connect, retry = Math.min(retry * 2, 10000));
    };
  }
  connect();
  return mk('lobby');
}
