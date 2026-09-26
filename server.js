'use strict';
// Feastfall server: serves the game and relays multiplayer messages.
// It is a dumb relay with rooms, presence and broadcast: every game rule runs in the players' browsers,
// with one player per match acting as host (see js/net.js).
//
//   npm install
//   npm start            -> http://localhost:8080
//   PORT=3000 npm start  -> any other port
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const ROOM_NAME = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const TOPIC = /^[a-z][a-z0-9_.-]{0,47}$/;
const MAX_ROOMS_PER_PLAYER = 16;
const MAX_PRESENCE_BYTES = 4096;
const MSGS_PER_SECOND = 80;

// ---- static files: only the game itself ----
const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (url === '/config.js') {
    // Tells the page to connect back to this server for online play
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    res.end("window.FEASTFALL_SERVER = 'auto';\n");
    return;
  }
  if (url === '/') url = '/index.html';
  if (!/^\/(index\.html|js\/[a-z0-9]+\.js)$/.test(url)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, url), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(url)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- rooms ----
const rooms = new Map(); // room name -> Map(player id -> { ws, presence })
let nextId = 0;
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
function broadcast(room, msg, exceptId) {
  const members = rooms.get(room);
  if (!members) return;
  const text = JSON.stringify(msg);
  for (const [id, m] of members) if (id !== exceptId && m.ws.readyState === 1) m.ws.send(text);
}
function leave(ws, room) {
  const members = rooms.get(room);
  ws.rooms.delete(room);
  if (!members || !members.delete(ws.id)) return;
  if (members.size) broadcast(room, { t: 'left', r: room, id: ws.id });
  else rooms.delete(room);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  ws.id = 'p' + (++nextId).toString(36) + Math.random().toString(36).slice(2, 8);
  ws.rooms = new Set();
  ws.tokens = MSGS_PER_SECOND;
  ws.lastRefill = Date.now();
  send(ws, { t: 'hello', id: ws.id });

  ws.on('message', raw => {
    const now = Date.now();
    ws.tokens = Math.min(MSGS_PER_SECOND * 2, ws.tokens + (now - ws.lastRefill) / 1000 * MSGS_PER_SECOND);
    ws.lastRefill = now;
    if (ws.tokens < 1) return; // over budget: drop, like the claude.ai room does
    ws.tokens--;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.r !== 'string' || !ROOM_NAME.test(m.r)) return;
    const members = rooms.get(m.r);
    switch (m.t) {
      case 'join': {
        if (ws.rooms.has(m.r) || ws.rooms.size >= MAX_ROOMS_PER_PLAYER) return;
        const room = members || new Map();
        rooms.set(m.r, room);
        send(ws, { t: 'peers', r: m.r, peers: [...room].map(([id, p]) => ({ id, p: p.presence })) });
        room.set(ws.id, { ws, presence: {} });
        ws.rooms.add(m.r);
        broadcast(m.r, { t: 'pres', r: m.r, id: ws.id, p: {} }, ws.id);
        break;
      }
      case 'leave': leave(ws, m.r); break;
      case 'pres': {
        const me = members && members.get(ws.id);
        if (!me || !m.p || typeof m.p !== 'object' || JSON.stringify(m.p).length > MAX_PRESENCE_BYTES) return;
        me.presence = m.p;
        broadcast(m.r, { t: 'pres', r: m.r, id: ws.id, p: m.p }, ws.id);
        break;
      }
      case 'emit':
        if (!ws.rooms.has(m.r) || typeof m.topic !== 'string' || !TOPIC.test(m.topic)) return;
        broadcast(m.r, { t: 'emit', r: m.r, id: ws.id, topic: m.topic, data: m.data }, ws.id);
        break;
    }
  });
  ws.on('close', () => { for (const r of [...ws.rooms]) leave(ws, r); });
});

server.listen(PORT, () => console.log(`Feastfall running at http://localhost:${PORT}`));
