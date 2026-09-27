'use strict';
// The social side: bots that talk, rivals who remember you, emotes, and proximity quick chat with map pings.

// ---------- bot chat: short lines by personality, shown over their heads and in the feed if you're close ----------
const BOT_LINES = {
  kill: {
    steady: ['gg {v}', 'one less', 'sorry {v}', 'nice try'], coward: ['I... got one?', 'oh no, sorry!', 'please don’t tell anyone'],
    camper: ['patience pays', 'walked right into it', 'should’ve checked the bushes'], rusher: ['NEXT', 'too slow {v}', 'ez', 'who’s next?'],
    looter: ['mine now', 'thanks for the loot {v}', 'nice bag'],
  },
  engage: {
    steady: ['here we go', '{v}, let’s do this'], coward: ['please go away', 'I don’t want trouble'], camper: ['gotcha', 'right where I want you'],
    rusher: ['FIGHT ME {v}', 'found you!', 'you’re mine'], looter: ['what’s in your pockets?', 'hand it over'],
  },
  flee: { steady: ['nope', 'not today'], coward: ['AAAH', 'run run run', 'bye!'], camper: ['regroup', 'later'], rusher: ['I’ll be back'], looter: ['gotta go', 'not worth it'] },
  die: { steady: ['gg', 'well played'], coward: ['I knew it', 'worth a try'], camper: ['how did you find me', 'my spot...'], rusher: ['lag', 'rematch me'], looter: ['my loot!', 'nooo my stuff'] },
  team: { steady: ['truce?', 'teaming for now'], coward: ['safety in numbers'], camper: ['watch my back'], rusher: ['let’s hunt'], looter: ['split it 50/50'] },
  betray: { steady: ['sorry, it’s a battle royale', 'nothing personal'], coward: ['I had to!', 'sorry sorry sorry'], camper: ['saw that coming?'], rusher: ['truce over'], looter: ['your stuff looks better on me'] },
  rival: { steady: ['{v}. Again.', 'hello again {v}'], coward: ['oh no it’s {v}'], camper: ['I remember you {v}'], rusher: ['{v}! round two!'], looter: ['{v}, I still have your sword'] },
};
let botSayT = 0;
function botSay(b, ev, other) {
  if (!b || !b.bot || b.isClone || (b.sayCd || 0) > G.t) return;
  const involved = other === G.human || b.rival, near = G.human && hyp(b.x - G.human.x, b.y - G.human.y) < 900;
  const chance = { kill: 0.6, die: 0.35, engage: 0.18, flee: 0.3, team: 0.5, betray: 0.8, rival: 1 }[ev] ?? 0.3;
  if (!(involved || near) || rng() > (involved ? Math.min(1, chance * 2) : chance) || G.t < botSayT) return;
  const pool = (BOT_LINES[ev] || {})[b.pers] || (BOT_LINES[ev] || {}).steady;
  if (!pool) return;
  const txt = pick(pool).replace('{v}', other ? other.name : 'you');
  b.sayCd = G.t + 6; botSayT = G.t + 1.2;
  showSay(b, txt);
  NET.fx({ k: 'bsay', o: b.id, t: txt });
}
// A line over someone's head for a few seconds, and in the feed if you're close enough to hear it
function showSay(f, txt, quick) {
  if (!f || typeof txt !== 'string') return;
  f.sayText = txt.slice(0, 40); f.sayT = 3.2;
  if (!G.human || f === G.human || hyp(f.x - G.human.x, f.y - G.human.y) < 1100 || f.rival)
    G.feed.unshift({ txt: `${f.name}: ${txt}`, t: 7, chat: true, you: f === G.human, quick });
}

// ---------- rivals: a bot that kills you remembers you, and comes back for you in later solo matches ----------
let RIVALS = [];
try { RIVALS = JSON.parse(localStorage.getItem('ff_rivals')) || []; } catch (e) {}
const saveRivals = () => { try { localStorage.setItem('ff_rivals', JSON.stringify(RIVALS.slice(0, 6))); } catch (e) {} };
function noteRival(killer) { // a bot just killed you (solo only)
  if (!killer || !killer.bot || killer.isClone || NET.on) return;
  let r = RIVALS.find(q => q.name === killer.name);
  if (!r) RIVALS.unshift(r = { name: killer.name, color: killer.color, kit: killer.kit, style: killer.style, pers: killer.pers, won: 0, lost: 0 });
  r.won++;
  RIVALS.sort((a, b) => (b.won - b.lost) - (a.won - a.lost));
  saveRivals();
}
function beatRival(b) { // you killed a rival
  const r = RIVALS.find(q => q.name === b.name);
  if (!r) return;
  r.lost++;
  G.coinsEarned += 75;
  if (r.lost >= 2 && r.lost >= r.won) { RIVALS = RIVALS.filter(q => q !== r); banner('Score settled', `${b.name} won’t be back · +75 coins`); }
  else banner('Revenge', `You got ${b.name} · +75 coins`);
  saveRivals();
}
// Up to two rivals join a solo match, as themselves
function rivalBots() { return NET.on ? [] : [...RIVALS].sort(() => Math.random() - 0.5).slice(0, 2); }
function makeRival(r, id) {
  const b = makeBot(r.name, id, KITS[r.kit] && !KITS[r.kit].locked ? r.kit : undefined);
  return Object.assign(b, { color: r.color || b.color, style: r.style || b.style, pers: r.pers || b.pers, rival: true, bountyKeen: true });
}

// ---------- emotes and quick chat: hold C for the wheel ----------
const EMOTES = [
  { id: 'wave', name: 'Wave', say: 'Hi!', t: 2.6 }, { id: 'taunt', name: 'Taunt', say: 'Ha ha!', t: 2.4 },
  { id: 'dance', name: 'Dance', say: '♪ ♫', t: 4 }, { id: 'cheer', name: 'Cheer', say: 'Woo!', t: 2.4 },
];
const QUICK = [
  { id: 'help', text: 'Help!', ping: 'me' }, { id: 'enemy', text: 'Enemy here!', ping: 'aim' }, { id: 'omw', text: 'On my way', ping: 'me' },
  { id: 'loot', text: 'Loot here', ping: 'aim' }, { id: 'thanks', text: 'Thanks!' }, { id: 'gg', text: 'Good game' },
];
const WHEEL = [...EMOTES.map((e, i) => ({ kind: 'emote', i, label: e.name })), ...QUICK.map((q, i) => ({ kind: 'quick', i, label: q.text }))];
const HEAR = 1100; // quick chat carries about 44 blocks
function startEmote(f, i) {
  const e = EMOTES[i];
  if (!e || !f.alive || f.bike) return false;
  f.emote = i; f.emoteT = e.t; f.gather = null;
  f.sayText = e.say; f.sayT = e.t;
  return true;
}
function stopEmote(f) { if (f.emoteT > 0) { f.emoteT = 0; f.emote = -1; if (f.sayT > 0 && EMOTES.some(e => e.say === f.sayText)) f.sayT = 0; } }
// Say something to everyone close by; some lines drop a ping on their maps
function quickChat(f, i, at) {
  const q = QUICK[i];
  if (!q || (f.quickCd || 0) > G.t) return;
  f.quickCd = G.t + 1.5;
  const p = q.ping === 'me' ? { x: f.x, y: f.y, layer: f.layer } : q.ping === 'aim' && at ? { x: at.x, y: at.y, layer: f.layer } : null;
  hearQuick(f, i, p);
  NET.fx({ k: 'qc', o: f.id, q: i, p: p ? [Math.round(p.x), Math.round(p.y), p.layer] : null });
}
function hearQuick(f, i, p) {
  const q = QUICK[i];
  if (!f || !q) return;
  const L = G.human;
  if (L && f !== L && hyp(f.x - L.x, f.y - L.y) > HEAR && !(G.duo && allied(f, L))) return; // out of earshot
  showSay(f, q.text, true);
  Sfx.play('voice', f.x, f.y, f.z);
  if (p) G.qpings.push({ x: p.x, y: p.y, layer: p.layer, t: 10, who: f.name, text: q.text, mine: f === L });
  // Hunters and rushers who hear "Enemy here" or "Help" sometimes come to see
  if (!NET.on || NET.isHost()) for (const b of G.fighters) {
    if (!b.bot || !b.alive || b.remote || b === f || (hyp(b.x - f.x, b.y - f.y) > HEAR && !(G.duo && allied(b, f))) || !p) continue;
    if (((G.duo && allied(b, f)) || ((b.style === 'hunter' || b.pers === 'rusher') && rng() < 0.5)) && !(b.plan && (b.plan.type === 'fight' || b.plan.type === 'bike'))) b.plan = { type: 'go', x: p.x, y: p.y, layer: p.layer };
  }
}
// Where the crosshair points, out to about 60 blocks (for "Enemy here" and "Loot here")
function aimPoint(h) {
  const cp = Math.cos(VIEW.pitch), dx = Math.cos(h.face) * cp, dy = Math.sin(h.face) * cp, dz = Math.sin(VIEW.pitch), ez = h.z + EYE * (h.size || 1);
  for (let t = 20; t < 1500; t += 8) {
    const x = h.x + dx * t, y = h.y + dy * t, z = ez + dz * t;
    if (h.layer ? !walkUnder(x, y, 4) || z < 0 : z <= heightAt(x, y) || solidAt(Math.floor(x / B), Math.floor(z / B), Math.floor(y / B))) return { x, y };
    for (const o of G.fighters) if (o !== h && o.alive && o.layer === h.layer && hyp(o.x - x, o.y - y) < o.r + 8 && z > o.z && z < o.z + fh(o)) return { x: o.x, y: o.y };
  }
  return { x: h.x + dx * 1500, y: h.y + dy * 1500 };
}
// The wheel: hold C, move the mouse toward an option, let go
const WHEEL_UI = { open: false, vx: 0, vy: 0, sel: -1 };
function openWheel() {
  if (WHEEL_UI.open || !G.human.alive) return;
  Object.assign(WHEEL_UI, { open: true, vx: 0, vy: 0, sel: -1 });
  const el = $('#wheel');
  if (!el.children.length) el.innerHTML = WHEEL.map((w, i) => {
    const a = i / WHEEL.length * Math.PI * 2 - Math.PI / 2;
    return `<div class="wopt ${w.kind}" style="left:calc(50% + ${(Math.cos(a) * 150).toFixed(0)}px);top:calc(50% + ${(Math.sin(a) * 150).toFixed(0)}px)">${w.label}</div>`;
  }).join('') + '<div class="wmid">Emotes · quick chat</div>';
  el.hidden = false; markWheel();
}
function wheelMove(dx, dy) {
  if (!WHEEL_UI.open) return false;
  WHEEL_UI.vx = clamp(WHEEL_UI.vx + dx, -200, 200); WHEEL_UI.vy = clamp(WHEEL_UI.vy + dy, -200, 200);
  if (hyp(WHEEL_UI.vx, WHEEL_UI.vy) > 40) {
    const a = (Math.atan2(WHEEL_UI.vy, WHEEL_UI.vx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    WHEEL_UI.sel = Math.round(a / (Math.PI * 2) * WHEEL.length) % WHEEL.length;
  } else WHEEL_UI.sel = -1;
  markWheel();
  return true;
}
function markWheel() { [...$('#wheel').querySelectorAll('.wopt')].forEach((el, i) => el.classList.toggle('on', i === WHEEL_UI.sel)); }
function closeWheel(use = true) {
  if (!WHEEL_UI.open) return;
  WHEEL_UI.open = false; $('#wheel').hidden = true;
  const w = WHEEL[WHEEL_UI.sel], h = G.human;
  if (!use || !w || !h.alive) return;
  if (w.kind === 'emote') { if (!startEmote(h, w.i)) toast('You can’t emote while riding'); }
  else quickChat(h, w.i, QUICK[w.i].ping === 'aim' ? aimPoint(h) : null);
}
function updateSocial(dt) {
  for (const f of G.fighters) {
    if (f.sayT > 0) f.sayT -= dt;
    if (f.emoteT > 0 && !f.remote) {
      f.emoteT -= dt;
      if (hyp(f.mx, f.my) > 0.1 || f.swingT > 0 || f.hurtT > 0.15 || f.bike || !f.alive) stopEmote(f); // moving or fighting cancels it
    }
  }
  for (const p of G.qpings) p.t -= dt;
  G.qpings = G.qpings.filter(p => p.t > 0);
}
