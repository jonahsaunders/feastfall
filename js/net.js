'use strict';
// Online play over the artifact's `room` capability.
// Everyone simulates their own player and shares it through presence (~10 Hz). The host also runs
// the bots, the clock, potions, feast chests and item pickups. Hits, block edits, deaths and item
// changes travel as room messages; the machine that simulates a fighter applies damage to it.
const NET_TOPICS = ['start', 'hit', 'kill', 'blk', 'res', 'fx', 'item', 'drop', 'got', 'clock', 'end', 'chat'];
const MAX_ONLINE_BOTS = 45;
const NET = {
  on: false, lobby: null, match: null, me: 'me', hostPeer: null, code: null, roster: [], denied: false,
  outBlk: [], outRes: [], sendT: 0, clockT: 0,
  isHost() { return !this.on || this.hostPeer === this.me; },
  send(topic, data) {
    if (!this.match) return;
    this.match.emit(topic, data).catch(e => {
      if (e && e.code === 'not_permitted' && !this.denied) { this.denied = true; toast('Your access to this page can’t send game moves. Ask the owner to share it with edit access.'); }
    });
  },
  // ---- called by the game ----
  hit(t, m) { if (this.on) this.send('hit', { to: t.id, ...m }); },
  kill(t, killer, fell) { if (this.on) this.send('kill', { v: t.id, k: killer ? killer.id : null, f: fell ? 1 : 0 }); },
  blk(op) { if (this.on) this.outBlk.push(op); },
  res(o) { if (this.on) this.outRes.push([o.kind === 'ore' ? 1 : 0, (o.kind === 'ore' ? world.ores : world.objs).indexOf(o), o.amt]); },
  fx(d) { if (this.on) this.send('fx', d); },
  itemAdd(it) { if (this.on) this.send('item', { add: [packItem(it)] }); },
  itemRm(it) { if (this.on) this.send('item', { rm: [it.id] }); },
  itemUpd(it) { if (this.on) this.send('item', { upd: packItem(it) }); },
  dropReq(it) { if (this.on) this.send('drop', packItem(it)); },
  got(f, stacks) { if (this.on) this.send('got', { to: f.id, s: stacks }); },
  end(w) { if (this.on && !G.endSent) { G.endSent = true; this.send('end', { w: w.id }); onEnd({ w: w.id }); } },
};
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
  const h = G.human, s = packFighter(h);
  const patch = { s };
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
    | (f.titanT > 0 ? 128 : 0) | (f.burnT > 0 ? 256 : 0);
  return [Math.round(f.x), Math.round(f.y), Math.round(f.z), Math.round(f.face * 100), Math.round(f.hp * 10), flags, f.weapon, armorMask(f), f.swings % 100, f.kills];
}
function applyPacked(f, a, o) {
  if (!f || f.deadDone) return;
  f.net.tx = a[o]; f.net.ty = a[o + 1]; f.net.tz = a[o + 2]; f.net.tf = a[o + 3] / 100;
  f.hp = a[o + 4] / 10; const fl = a[o + 5];
  if (!(fl & 1) && f.alive) { f.alive = false; }
  f.layer = fl & 2 ? 1 : 0; f.hidden = !!(fl & 4); f.sneak = f.net.sn = !!(fl & 8); f.charge = fl & 16 ? 0.5 : -1;
  f.disguise = ['bush', 'rock', 'snowrock', 'cactus'][(fl >> 5) & 3];
  f.net.titan = !!(fl & 128); f.burnNet = !!(fl & 256);
  f.net.w = a[o + 6]; f.net.am = a[o + 7];
  f.net.ad = [1, 2, 4, 8].reduce((d, bit, i) => d + (f.net.am & bit ? [0.08, 0.14, 0.11, 0.07][i] * (f.net.am & 16 ? 1.45 : 1) : 0), 0);
  if (f.net.sw !== undefined && f.net.sw !== a[o + 8]) f.swingT = 0.14;
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
  NET.hostPeer = ids[0] || NET.me;
  if (NET.isHost() && NET.on) {
    for (const f of G.fighters) if (f.bot && f.id[0] === 'b') { f.remote = false; f.plan = null; f.vz = 0; f.onGround = false; }
    toast('The host left. You are now running the bots.');
  }
  if (NET.on) checkWin();
}
function wireMatch(m) {
  const H = {
    start: d => startOnline(d),
    hit: d => { const t = fighterById(d.to); if (t && !t.remote) applyHit(t, d); },
    kill: (d, msg) => {
      const v = fighterById(d.v); if (!v || !v.remote) return;
      v.deadDone = true; announceKill(v, d.k ? fighterById(d.k) : null, d.f);
      addFx('puff', v.x, v.y, v.layer, { col: v.color, big: true, z: v.z + 30 });
    },
    blk: d => applyBlockOps(d.ops || []),
    res: d => { for (const [t, i, a] of d.r || []) { const o = (t ? world.ores : world.objs)[i]; if (o && a < o.amt) o.amt = a; } },
    fx: (d, msg) => {
      const o = fighterById(d.o);
      if (d.k === 'p' && o) { const v = d.v; G.proj.push({ kind: d.t, x: v[0], y: v[1], z: v[2], vx: v[3], vy: v[4], vz: v[5], owner: o, layer: d.l, life: d.t === 'hook' ? 0.6 : 2, ghost: true }); }
      if (d.k === 's') addFx('strike', d.x, d.y, d.l, { t: 0.6, ghost: true });
      if (d.k === 'c' && o) for (const dd of [-0.7, 0.7]) spawnClone(o, d.f + dd);
      if (d.k === 'ping') G.pings.push({ x: d.x, y: d.y, layer: 1, t: 12, src: fighterById(msg.peer) });
      if (d.k === 'relic' && typeof d.i === 'string') announceRelic(o, d.i);
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
  for (const t of NET_TOPICS) m.on(t, msg => { if (msg.sameTab) return; try { H[t](msg.data || {}, msg); } catch (e) { console.warn('net', t, e); } });
  m.onPeers(onPeersMatch);
}
function onEnd(d) {
  if (G.over && !G.human.alive) { const w = fighterById(d.w); banner(`${w ? w.name : 'Someone'} wins`, 'Last one standing.'); return; }
  const w = fighterById(d.w);
  if (d.w === NET.me) endGame(true);
  else { G.killedBy = null; G.winnerName = w ? w.name : 'Someone'; endGame(false, true); }
}

// ---- starting a match ----
function startOnline(d) {
  if (G.mode === 'play') return;
  NET.on = true; NET.hostPeer = d.host; NET.roster = d.roster; G.endSent = false;
  G.settings.len = d.len;
  G.grace = 2;
  const humans = d.roster.map(r => {
    const f = new Fighter(String(r.n || 'Player').slice(0, 18), KITS[r.k] ? r.k : 'killer', false, r.p);
    f.color = /^#[0-9a-f]{6}$/i.test(r.c) ? r.c : '#f2ead6';
    if (r.p !== NET.me) { f.remote = true; if (f.slots) newInv(f); }
    return f;
  });
  const me = humans.find(f => f.id === NET.me);
  newMatch(d.bots, me, d.seed, humans, MAP_SIZES[d.sz] ? d.sz : 4800);
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
  NET.lobby.presence({ n: LOBBY.nick, k: STORE.kit, c: LOBBY.color, st: NET.match ? (NET.hostPeer === NET.me ? 'host' : 'match') : 'lobby', code: NET.code, ...extra }).catch(() => {});
}
function renderLobby() {
  if (!NET.lobby) return;
  const peers = NET.lobby.peers();
  const others = peers.filter(p => !p.sameTab);
  $('#net-count').textContent = peers.length ? `${peers.length} ${peers.length === 1 ? 'person' : 'people'} on this page` : 'Connecting…';
  const hosts = others.filter(p => p.presence && p.presence.st === 'host' && typeof p.presence.code === 'string');
  const list = $('#matches');
  list.textContent = '';
  if (!hosts.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = NET.match ? '' : 'No open matches. Host one and share the page with friends.'; list.append(p); }
  for (const p of hosts) {
    const row = document.createElement('div'); row.className = 'match-row';
    const name = document.createElement('span'); name.textContent = `${String(p.presence.n || 'Someone').slice(0, 18)}’s match`;
    const meta = document.createElement('small'); meta.textContent = p.presence.started ? 'in progress' : `${p.presence.np || 1} joined`;
    const b = document.createElement('button'); b.className = 'btn ghost small'; b.textContent = NET.code === p.presence.code ? 'Joined' : 'Join';
    b.disabled = !!p.presence.started || !!NET.match;
    b.onclick = () => joinMatch(p.presence.code, p.peer);
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
  $('#match-title').textContent = host ? 'Your match' : 'Waiting for the host to start';
  const ul = $('#match-players'); ul.textContent = '';
  for (const p of peers) {
    const li = document.createElement('li');
    const dot = document.createElement('i'); dot.style.background = /^#[0-9a-f]{6}$/i.test(p.presence.c) ? p.presence.c : '#888';
    const t = document.createElement('span');
    t.textContent = `${String(p.presence.n || 'Joining…').slice(0, 18)}${p.sameTab ? ' (you)' : ''}${p.peer === NET.hostPeer ? ' · host' : ''}`;
    const k = document.createElement('small'); k.textContent = KITS[p.presence.k] ? KITS[p.presence.k].name : '';
    li.append(dot, t, k); ul.append(li);
  }
  $('#host-controls').hidden = !host;
  $('#m-bots-v').textContent = $('#m-bots').value;
  if (host) lobbyPresence({ np: peers.length });
}
async function hostMatch() {
  const code = Math.random().toString(36).slice(2, 7);
  await enterMatch(code, null);
}
async function joinMatch(code, hostPeer) { await enterMatch(code, hostPeer); }
async function enterMatch(code, hostPeer) {
  if (!NET.lobby || NET.match) return;
  try { NET.match = await NET.lobby.join('ff-' + code); }
  catch (e) { toast(e && e.code === 'not_permitted' ? 'Your access to this page can’t join matches.' : 'Couldn’t join that match. Try again.'); return; }
  NET.code = code; NET.hostPeer = hostPeer || NET.me; NET.denied = false;
  wireMatch(NET.match);
  NET.match.presence({ n: LOBBY.nick, k: STORE.kit, c: LOBBY.color }).catch(() => {});
  lobbyPresence();
  renderLobby(); renderMatchPanel();
}
async function leaveMatch() {
  if (NET.match) { try { await NET.match.leave(); } catch (e) {} }
  Object.assign(NET, { match: null, code: null, on: false, hostPeer: null, roster: [] });
  lobbyPresence(); renderLobby(); renderMatchPanel();
}
function startHostedMatch() {
  if (!NET.match || NET.hostPeer !== NET.me) return;
  const roster = NET.match.peers().filter(p => p.presence && p.presence.n).slice(0, 16)
    .map(p => ({ p: p.peer, n: String(p.presence.n).slice(0, 18), k: p.presence.k, c: p.presence.c }));
  if (!roster.some(r => r.p === NET.me)) roster.unshift({ p: NET.me, n: LOBBY.nick, k: STORE.kit, c: LOBBY.color });
  roster.sort((a, b) => a.p < b.p ? -1 : 1);
  const d = { seed: Math.floor(Math.random() * 1e9), bots: Math.min(MAX_ONLINE_BOTS, +$('#m-bots').value), len: +$('#m-len').value, sz: +$('#m-size').value, host: NET.me, roster };
  NET.send('start', d);
  lobbyPresence({ started: true });
  startOnline(d);
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
