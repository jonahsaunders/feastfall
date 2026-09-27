'use strict';
// Duos: everyone is in a squad of two. Partners can't hurt each other, share a colour, see each other through
// walls and on the map, and can bring each other back: when one goes down, the other has 15 seconds to reach the
// gravestone and hold E there for 3 seconds. The revived partner comes back on 8 health with just their kit (their
// gear is in the death bag). The last squad with anyone standing wins.
const REVIVE_TIME = 15, REVIVE_HOLD = 3, REVIVE_R = 45, REVIVE_HP = 8;
const SQUAD_COL = ['#6fe08a', '#5fc8f0', '#f0c75f', '#e07ae0', '#f08a5f', '#9fa8ff', '#c8f05f', '#5ff0c8', '#ff8fa8', '#d8d8d8'];

// Pair up consecutive fighters (humans come first, so online friends play together)
function formSquads(all) {
  if (!G.duo) return;
  for (let i = 0; i < all.length; i++) {
    const n = Math.floor(i / 2);
    all[i].squad = 's' + n; all[i].teamCol = SQUAD_COL[n % SQUAD_COL.length];
  }
}
const partnerOf = f => f && f.squad ? G.fighters.find(o => o !== f && o.squad === f.squad && !o.isClone) || null : null;
const squadAlive = f => G.fighters.some(o => o.alive && !o.isClone && o.squad && o.squad === f.squad);
const graveOf = f => { const gs = G.graves || []; for (let i = gs.length - 1; i >= 0; i--) if (gs[i].id === f.id) return gs[i]; return null; };
const revivable = f => !!f && !f.alive && f.reviveUntil > G.t && !!graveOf(f);
// A downed partner close enough to revive
function reviveTarget(f) {
  const p = G.duo && f.alive ? partnerOf(f) : null;
  if (!revivable(p)) return null;
  const g = graveOf(p);
  return g.layer === f.layer && hyp(g.x - f.x, g.y - f.y) < REVIVE_R && Math.abs(g.z - f.z) < 60 ? { p, g } : null;
}
// One frame of holding E (or a bot kneeling) by the grave
function channelRevive(by, t, dt) {
  t.reviveP = (t.reviveP || 0) + dt / REVIVE_HOLD; t.reviveTouch = G.t; by.gather = null;
  if (t.reviveP >= 1) { NET.fx({ k: 'revive', o: t.id, by: by.id }); applyRevive(t, by); }
}
// Everyone runs this when someone is revived; the machine that simulates them puts them back in the game
function applyRevive(t, by) {
  if (!t || t.alive) return;
  const g = graveOf(t);
  if (g) G.graves.splice(G.graves.indexOf(g), 1);
  Object.assign(t, { alive: true, deadDone: false, hp: REVIVE_HP, reviveUntil: 0, reviveP: 0, revivedT: G.t });
  G.feed.unshift({ txt: `${by ? by.name : 'Someone'} revived ${t.name}`, t: 7, team: t.teamCol || true, you: t === G.human || by === G.human });
  Sfx.play('revive', t.x, t.y, t.z);
  if (by === G.human) Sfx.say(`${t.name} is back`);
  if (t.remote) return;
  const x = g ? g.x : t.x, y = g ? g.y : t.y, z = g ? g.z + 2 : t.z;
  Object.assign(t, { x, y, z, layer: g ? g.layer : t.layer, vz: 0, onGround: false, peakZ: z, kbx: 0, kby: 0, invuln: 2, burnT: 0, poisonT: 0, pitT: 0, slowT: 0,
    bike: null, dmgBy: null, lastHitBy: null, lastHitT: -99, fellLast: false, diedTo: null, lastKind: null, streak: 0, titanT: 0, size: 1, r: 13,
    hidden: false, gather: null, charge: -1, plan: null, path: null, spath: null, emoteT: 0, uses: KITS[t.kit].uses || 0 });
  newInv(t);
  if (KITS[t.kit].item) t.slots[1] = { id: 'kit', n: 1 };
  give(t, 'pot', 1);
  t.sel = 0;
  if (t === G.human) {
    G.specTarget = null; G.freeCam = null; G.killer = null; G.killedBy = null;
    setMode('play'); lockPointer(true, false);
    banner('Revived', `${by ? by.name : 'Your partner'} brought you back. Your gear is in your death bag.`);
    Sfx.say('Revived', true);
  }
}
// Called every frame: the human holding E by their partner's grave, and progress that stops when nobody's holding
function updateRevives(dt) {
  if (!G.duo) return;
  const h = G.human;
  h.reviving = false;
  if (G.mode === 'play' && h.alive && keys.has('e') && !G.invOpen && !G.chatOpen) {
    const r = reviveTarget(h);
    if (r) { h.reviving = true; channelRevive(h, r.p, dt); }
  }
  for (const f of G.fighters) if (!f.alive && f.reviveP > 0 && G.t - (f.reviveTouch || 0) > 0.15) f.reviveP = 0;
  // Down and waiting: the revive window closing is when your partner is on their own
  if (!h.alive && h.isFighter && G.mode === 'spectate' && h.reviveUntil && G.t > h.reviveUntil && !h.bledOut) {
    h.bledOut = true;
    toast(`Too late to revive you. Keep watching: if ${partnerOf(h) ? partnerOf(h).name : 'your partner'} wins, you win.`);
  }
}
// The human went down with a partner still standing: watch them until revived, or until the squad is out
function humanDown() {
  const p = partnerOf(G.human);
  G.specTarget = p; G.freeCam = null; G.human.bledOut = false;
  unlockPointer();
  setMode('spectate');
  banner('You’re down', `${p.name} has ${REVIVE_TIME} seconds to reach your grave and revive you.`);
}
// Bots: go to a downed partner's grave and revive them; otherwise back the partner up and stay close
function squadPlan(b) {
  const p = partnerOf(b);
  if (!p) return false;
  if (revivable(p)) {
    const g = graveOf(p);
    if (g.layer === b.layer && hyp(g.x - b.x, g.y - b.y) < 1400) { b.plan = { type: 'revive', t: p, g }; return true; }
    return false;
  }
  if (!p.alive || p.layer !== b.layer) return false;
  const foe = p.plan && p.plan.type === 'fight' && p.plan.target ? p.plan.target : G.t - p.lastHitT < 5 ? p.lastHitBy : null;
  if (foe && foe.alive && !allied(foe, b) && pvpOn() && hyp(p.x - b.x, p.y - b.y) < 600) { b.plan = { type: 'fight', target: foe }; return true; }
  if (hyp(p.x - b.x, p.y - b.y) > 300 && !G.pit) { b.plan = { type: 'go', x: p.x + rr(-70, 70), y: p.y + rr(-70, 70), layer: p.layer }; return true; }
  return false;
}
function botRevive(b, dt) {
  const { t, g } = b.plan;
  if (!revivable(t)) { b.plan = null; return; }
  if (hyp(g.x - b.x, g.y - b.y) > REVIVE_R - 12) { steer(b, g.x, g.y, g.layer, dt); return; }
  b.face = Math.atan2(g.y - b.y, g.x - b.x);
  channelRevive(b, t, dt);
}
