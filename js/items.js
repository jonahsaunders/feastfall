'use strict';
// Items: registry, drawn icons, stacks, inventory (slots 0–8 hotbar, 9–35 backpack), armour, recipes.
const HOTBAR = 9, SLOTS = 36;
const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
const ITEMS = {
  wood:   { name: 'Wood', stack: 64, cat: 'mat', desc: 'Hold E next to a tree.' },
  stone:  { name: 'Stone', stack: 64, cat: 'mat', desc: 'Hold E next to a rock. Most are in the mountains.' },
  iron:   { name: 'Iron Ore', stack: 64, cat: 'mat', desc: 'Mined slowly from glowing spots in the tunnel walls.' },
  hide:   { name: 'Rat Hide', stack: 64, cat: 'mat', desc: 'Dropped by rats in the tunnels. Makes armour.' },
  reed:   { name: 'Reeds', stack: 64, cat: 'mat', desc: 'Cut in the swamp. Makes hay bales and feather charms.' },
  arrow:  { name: 'Arrow', stack: 64, cat: 'mat', desc: 'Ammunition for the bow.' },
  pot:    { name: 'Health Potion', stack: 1, cat: 'use', desc: 'Heals 3.5 hearts. Right click or F to drink. Potions don’t stack: press R to refill empty hotbar slots from your backpack.' },
  sword1: { name: 'Wood Sword', stack: 1, cat: 'weapon', tier: 1 },
  sword2: { name: 'Stone Sword', stack: 1, cat: 'weapon', tier: 2 },
  sword3: { name: 'Iron Sword', stack: 1, cat: 'weapon', tier: 3 },
  sword4: { name: 'Feast Blade', stack: 1, cat: 'weapon', tier: 4, desc: 'Only found in feast chests.' },
  bow:    { name: 'Bow', stack: 1, cat: 'weapon', desc: 'Hold left click to draw, release to shoot. Low damage, big knockback. Uses arrows.' },
  plank:  { name: 'Planks', stack: 64, cat: 'block', block: 'plank', desc: 'Quick to place and break. Good for towers.' },
  cobble: { name: 'Cobblestone', stack: 64, cat: 'block', block: 'cobble', desc: 'Slow to break. Good for walls and bunkers.' },
  hay:    { name: 'Hay Bale', stack: 64, cat: 'block', block: 'hay', desc: 'Land on it and you take no fall damage.' },
  spike:  { name: 'Spike Trap', stack: 16, cat: 'block', block: 'spike', desc: '4 damage and a slow to anyone who steps on it but you.' },
  blast:  { name: 'Blast Trap', stack: 8, cat: 'block', block: 'blast', desc: 'Tripwire’s trap. Blows apart nearby blocks and launches whoever steps on it (not you).' },
  turf:   { name: 'Snare Turf', stack: 32, cat: 'block', block: 'turf', desc: 'Snare’s fake ground. Looks like the terrain but gives way under anyone but you. Place it over a spike trap.' },
  pad:    { name: 'Launch Pad', stack: 16, cat: 'block', block: 'pad', desc: 'Updraft’s pad. Flings whoever steps on it about 14 blocks up. Off your own pads you land safely.' },
  ladder: { name: 'Ladder', stack: 64, cat: 'block', block: 'ladder', desc: 'Place against a wall or on the ground. Walk into it (or hold Space) to climb; Shift to hold still. No fall damage while on a ladder.' },
  charm:  { name: 'Feather Charm', stack: 8, cat: 'use', desc: 'Keep it anywhere in your inventory: it is used up to block one fall of 7+ blocks.' },
  hide_head:  { name: 'Hide Cap', stack: 1, cat: 'armor', slot: 'head', def: 0.08 },
  hide_chest: { name: 'Hide Tunic', stack: 1, cat: 'armor', slot: 'chest', def: 0.14 },
  hide_legs:  { name: 'Hide Leggings', stack: 1, cat: 'armor', slot: 'legs', def: 0.11 },
  hide_feet:  { name: 'Hide Boots', stack: 1, cat: 'armor', slot: 'feet', def: 0.07 },
  iron_head:  { name: 'Feast Helm', stack: 1, cat: 'armor', slot: 'head', def: 0.12, desc: 'Only found in feast chests.' },
  iron_chest: { name: 'Feast Plate', stack: 1, cat: 'armor', slot: 'chest', def: 0.2, desc: 'Only found in feast chests.' },
  iron_legs:  { name: 'Feast Greaves', stack: 1, cat: 'armor', slot: 'legs', def: 0.15, desc: 'Only found in feast chests.' },
  iron_feet:  { name: 'Feast Boots', stack: 1, cat: 'armor', slot: 'feet', def: 0.09, desc: 'Only found in feast chests.' },
  kit:    { name: 'Kit item', stack: 1, cat: 'kit' },
  // Legendaries: exactly one of each per match, each at its own landmark (see LANDMARKS in world.js)
  skyhook:    { name: 'Skyhook', stack: 1, cat: 'weapon', legendary: true, desc: 'Click to fire a grapple at any block or the ground up to 22 blocks away and get pulled to it. Recharges in 6 seconds.' },
  maul:       { name: 'Quake Maul', stack: 1, cat: 'weapon', tier: 5, legendary: true, desc: 'Slow, heavy swings that launch people into the air and knock them far. Breaks any block in one hit.' },
  everflask:  { name: 'Everflask', stack: 1, cat: 'use', legendary: true, desc: 'Heals 3.5 hearts like a potion, then refills itself 25 seconds later instead of being used up.' },
  boots_wind: { name: 'Windwalker Boots', stack: 1, cat: 'armor', slot: 'feet', def: 0.09, legendary: true, desc: 'You never take fall damage, and holding Space while falling lets you glide down slowly.' },
  crown:      { name: 'Rat King’s Crown', stack: 1, cat: 'armor', slot: 'head', def: 0.12, legendary: true, desc: 'Rats stop running from you, your rat kills no longer give away your position, and underground your map shows everyone in the tunnels.' },
};
const WNAME = ['Fists', 'Wood Sword', 'Stone Sword', 'Iron Sword', 'Feast Blade', 'Quake Maul'];
const WDMG = [1, 2.5, 3.5, 4.5, 6.5, 5];
const WCOL = ['#d9c7a8', '#a4743f', '#9aa0a3', '#dfe5e8', '#f0b43c', '#8c6ad8'];
const RECIPES = [
  { out: 'sword1', cost: { wood: 2 }, cat: 'Weapons' },
  { out: 'sword2', cost: { wood: 1, stone: 3 }, cat: 'Weapons' },
  { out: 'sword3', cost: { wood: 1, iron: 3 }, cat: 'Weapons' },
  { out: 'bow', cost: { wood: 3 }, cat: 'Weapons' },
  { out: 'arrow', n: 4, cost: { wood: 1, stone: 1 }, cat: 'Weapons' },
  { out: 'hide_head', cost: { hide: 2 }, cat: 'Armour' },
  { out: 'hide_chest', cost: { hide: 4 }, cat: 'Armour' },
  { out: 'hide_legs', cost: { hide: 3 }, cat: 'Armour' },
  { out: 'hide_feet', cost: { hide: 2 }, cat: 'Armour' },
  { out: 'plank', n: 4, cost: { wood: 1 }, cat: 'Blocks' },
  { out: 'cobble', n: 2, cost: { stone: 1 }, cat: 'Blocks' },
  { out: 'hay', cost: { reed: 3 }, cat: 'Blocks' },
  { out: 'spike', cost: { wood: 1, stone: 2 }, cat: 'Blocks' },
  { out: 'ladder', n: 4, cost: { wood: 2 }, cat: 'Blocks' },
  { out: 'blast', cost: { stone: 2, iron: 1 }, cat: 'Blocks', kit: 'tripwire' },
  { out: 'turf', n: 4, cost: { wood: 1 }, cat: 'Blocks', kit: 'snare' },
  { out: 'pad', n: 2, cost: { wood: 1, reed: 1 }, cat: 'Blocks', kit: 'updraft' },
  { out: 'charm', cost: { reed: 2, hide: 1 }, cat: 'Other' },
];
const recipe = id => RECIPES.find(r => r.out === id);
const wears = (f, id) => !!(f.equip && ARMOR_SLOTS.some(k => f.equip[k] && f.equip[k].id === id));
const itemName = (id, f) => id === 'kit' && f ? KITS[f.kit].item : ITEMS[id].name;

// ---- inventory ----
function newInv(f) { f.slots = new Array(SLOTS).fill(null); f.equip = { head: null, chest: null, legs: null, feet: null }; f.invVer = 0; }
function count(f, id) { let n = 0; if (f.slots) for (const s of f.slots) if (s && s.id === id) n += s.n; return n; }
function heldId(f) { const s = f.slots && f.slots[f.sel]; return s ? s.id : ''; }
function bump(f) { f.invVer = (f.invVer || 0) + 1; }
// Put items into the inventory; returns how many did not fit.
function give(f, id, n = 1) {
  const it = ITEMS[id], max = it.stack;
  if (it.slot) { // armour: wear it if the slot is free or this is better
    const cur = f.equip[it.slot];
    if (!cur || ITEMS[cur.id].def < it.def) {
      f.equip[it.slot] = { id, n: 1 }; n--; bump(f);
      if (cur) { const l = give(f, cur.id, 1); if (l) dropStacks(f, [{ id: cur.id, n: 1 }]); }
      if (!n) return 0;
    }
  }
  for (let i = 0; i < SLOTS && n > 0; i++) {
    const s = f.slots[i];
    if (s && s.id === id && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
  }
  const backFirst = it.cat === 'mat' || it.cat === 'armor';
  for (let q = 0; q < SLOTS && n > 0; q++) {
    const i = backFirst ? (q + HOTBAR) % SLOTS : q;
    if (!f.slots[i]) { const k = Math.min(n, max); f.slots[i] = { id, n: k }; n -= k; }
  }
  bump(f);
  return n;
}
// Remove up to n; takes from `prefer` first, then from the back of the backpack forward.
function take(f, id, n = 1, prefer = null) {
  let got = 0;
  const order = prefer !== null ? [prefer] : [];
  for (let i = SLOTS - 1; i >= 0; i--) if (i !== prefer) order.push(i);
  for (const i of order) {
    const s = f.slots[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(n - got, s.n);
    s.n -= k; got += k;
    if (!s.n) f.slots[i] = null;
    if (got >= n) break;
  }
  if (got) bump(f);
  return got;
}
function hotPots(f) { let n = 0; for (let i = 0; i < HOTBAR; i++) if (f.slots[i] && f.slots[i].id === 'pot') n++; return n; }
function bagPots(f) { let n = 0; for (let i = HOTBAR; i < SLOTS; i++) if (f.slots[i] && f.slots[i].id === 'pot') n++; return n; }
function totalPots(f) { return f.remote || f.isClone ? 0 : hotPots(f) + bagPots(f); }
function hotbarEmpty(f) { for (let i = 0; i < HOTBAR; i++) if (!f.slots[i]) return i; return -1; }
// One step of a refill: move a potion from the backpack into an empty hotbar slot.
function refillOne(f) {
  const e = hotbarEmpty(f);
  if (e < 0) return false;
  for (let i = HOTBAR; i < SLOTS; i++) if (f.slots[i] && f.slots[i].id === 'pot') { f.slots[e] = f.slots[i]; f.slots[i] = null; bump(f); return true; }
  return false;
}
function canRefill(f) { return hotbarEmpty(f) >= 0 && bagPots(f) > 0; }

function weaponTier(f) {
  if (f.remote) return f.net.w || 0;
  if (f.isClone) return f.owner ? weaponTier(f.owner) : 0;
  if (!f.bot) { const s = f.slots[f.sel]; return (s && ITEMS[s.id].tier) || 0; }
  let t = 0;
  for (const s of f.slots) if (s && ITEMS[s.id].tier > t) t = ITEMS[s.id].tier;
  return t;
}
function armorDef(f) {
  if (f.remote) return f.net.ad || 0;
  if (f.isClone) return 0;
  let d = 0; for (const k of ARMOR_SLOTS) if (f.equip[k]) d += ITEMS[f.equip[k].id].def;
  return d;
}
// Bitmask for rendering: 1 head, 2 chest, 4 legs, 8 feet, 16 = feast (iron) set
function armorMask(f) {
  if (f.remote) return f.net.am || 0;
  if (f.isClone) return f.owner ? armorMask(f.owner) : 0;
  let m = 0;
  ARMOR_SLOTS.forEach((k, i) => { if (f.equip[k]) { m |= 1 << i; if (f.equip[k].id.startsWith('iron')) m |= 16; } });
  return m;
}
const armorPieces = f => { const m = armorMask(f); return (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1); };
function allStacks(f) {
  return [...f.slots, ...ARMOR_SLOTS.map(k => f.equip[k])].filter(s => s && s.id !== 'kit').map(s => ({ id: s.id, n: s.n }));
}
const recipeFor = (f, r) => !r.kit || r.kit === f.kit; // some recipes belong to one kit
function canCraft(f, r) { return recipeFor(f, r) && Object.entries(r.cost).every(([k, v]) => count(f, k) >= v); }
function craft(f, r, times = 1) {
  let made = 0;
  for (let t = 0; t < times && canCraft(f, r); t++) {
    for (const [k, v] of Object.entries(r.cost)) take(f, k, v);
    const left = give(f, r.out, r.n || 1);
    if (left) dropStacks(f, [{ id: r.out, n: left }]);
    made++;
  }
  return made;
}
// Throw stacks on the ground in front of a fighter (or where they died)
function dropStacks(f, stacks, kind = 'drop') {
  if (!stacks.length) return;
  const a = f.face || 0, d = kind === 'drop' ? 34 : 0;
  const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
  const z = f.layer ? 0 : supportAt(x, y, f.z + 10, 4, 0);
  addItem({ kind: stacks.length > 1 && kind === 'drop' ? 'bag' : kind, x, y, z, layer: f.layer, stacks, noPick: f.id, noPickT: G.t + 1.2 });
}

// ---- icons: small flat-shaded drawings, cached as images for the HUD and as textures in 3D ----
const ICON_CACHE = {};
function shade(hex, amt) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, amt); return '#' + c.getHexString(); }
function paintIcon(id, kit) {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.scale(S / 24, S / 24); g.lineJoin = 'round'; g.lineCap = 'round';
  const P = (pts, fill, stroke, w = 1) => {
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = w; g.stroke(); }
  };
  const L = (pts, col, w) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.strokeStyle = col; g.lineWidth = w; g.stroke(); };
  const cube = col => {
    P([[12, 3], [21, 7.5], [12, 12], [3, 7.5]], shade(col, 0.1));
    P([[3, 7.5], [12, 12], [12, 21], [3, 16.5]], col);
    P([[12, 12], [21, 7.5], [21, 16.5], [12, 21]], shade(col, -0.12));
  };
  const it = ITEMS[id];
  if (it.legendary) { g.fillStyle = 'rgba(230,184,74,.22)'; g.beginPath(); g.arc(12, 12, 11.5, 0, 7); g.fill(); }
  if (id === 'skyhook') {
    g.strokeStyle = '#c9b48a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(3, 21); g.quadraticCurveTo(4, 12, 12, 12); g.stroke();
    L([[12, 12], [18, 6]], '#c9ccd0', 2.4); L([[18, 6], [21, 9.5]], '#c9ccd0', 1.8); L([[18, 6], [14.5, 3]], '#c9ccd0', 1.8); L([[18, 6], [21.5, 3.5]], '#c9ccd0', 1.8);
  } else if (id === 'maul') {
    L([[4, 21], [14, 11]], '#6b4a2e', 2.6); P([[11, 5], [19, 13], [15.5, 16.5], [7.5, 8.5]], '#8c6ad8', '#4a3580'); L([[10, 8], [16, 14]], '#b9a6ee', 1);
  } else if (id === 'everflask') {
    P([[10, 2.5], [14, 2.5], [14, 8], [10, 8]], '#e8e1cf'); g.fillStyle = '#35b8b0'; g.beginPath(); g.arc(12, 15, 6.8, 0, 7); g.fill();
    g.strokeStyle = '#d9fffb'; g.lineWidth = 1.2; g.beginPath(); g.arc(12, 15, 3.4, 0.4, 5.2); g.stroke();
  } else if (id === 'boots_wind') {
    P([[3, 10], [8, 10], [8, 17], [11, 17], [11, 20], [3, 20]], '#dfe8ee', '#8aa0ad'); P([[13, 10], [18, 10], [18, 17], [21, 17], [21, 20], [13, 20]], '#dfe8ee', '#8aa0ad');
    L([[2, 7], [7, 4]], '#9fd6ff', 1.2); L([[12, 7], [17, 4]], '#9fd6ff', 1.2); L([[5, 8], [9, 5.5]], '#9fd6ff', 1); L([[15, 8], [19, 5.5]], '#9fd6ff', 1);
  } else if (id === 'crown') {
    P([[4, 18], [4, 8], [8, 12], [12, 5], [16, 12], [20, 8], [20, 18]], '#e6b84a', '#9a7420');
    g.fillStyle = '#c63d3d'; g.beginPath(); g.arc(12, 14, 1.8, 0, 7); g.fill(); L([[4, 18], [20, 18]], '#9a7420', 1.4);
  } else if (id === 'blast') {
    P([[3, 16], [21, 16], [21, 20], [3, 20]], '#5a4a3a'); P([[8, 9], [16, 9], [16, 16], [8, 16]], '#9a3a2c', '#5a1a12');
    L([[12, 9], [14, 5]], '#e6dfcc', 1.2); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(14.5, 4.5, 1.6, 0, 7); g.fill();
  } else if (id === 'pad') {
    P([[3, 16], [21, 16], [21, 20], [3, 20]], '#2f7d75'); P([[12, 3], [18, 10], [14.5, 10], [14.5, 15], [9.5, 15], [9.5, 10], [6, 10]], '#dff7f3', '#2f7d75');
  } else if (it.block && it.block !== 'spike' && it.block !== 'ladder') cube(BLOCKS[it.block].color);
  else if (it.tier) {
    const col = WCOL[it.tier];
    P([[18.5, 3], [21, 5.5], [9, 17.5], [6.5, 15]], col, shade(col, -0.25), 0.8);
    L([[5, 13], [11, 19]], '#3a2a1c', 2.4); L([[8, 16], [4, 20]], '#6b4a2e', 2.2);
  } else if (it.slot) {
    const col = id.startsWith('iron') ? '#c9d0d4' : '#8a6446', dk = shade(col, -0.15), trim = id.startsWith('iron') ? '#e6b84a' : null;
    if (it.slot === 'head') { P([[5, 15], [5, 10], [8, 5.5], [16, 5.5], [19, 10], [19, 15], [16, 15], [15, 11], [9, 11], [8, 15]], col, dk); }
    if (it.slot === 'chest') { P([[4, 7], [8, 4], [10, 6], [14, 6], [16, 4], [20, 7], [18, 11], [17, 10], [17, 20], [7, 20], [7, 10], [6, 11]], col, dk); }
    if (it.slot === 'legs') { P([[6, 4], [18, 4], [18, 20], [13.5, 20], [12, 10], [10.5, 20], [6, 20]], col, dk); }
    if (it.slot === 'feet') { P([[3, 10], [8, 10], [8, 17], [11, 17], [11, 20], [3, 20]], col, dk); P([[13, 10], [18, 10], [18, 17], [21, 17], [21, 20], [13, 20]], col, dk); }
    if (trim) L([[7, 12.5], [17, 12.5]], trim, 1.2);
  } else switch (id) {
    case 'wood': P([[3, 9], [17, 9], [17, 17], [3, 17]], '#8a5a30'); g.fillStyle = '#c89a62'; g.beginPath(); g.ellipse(17, 13, 3, 4, 0, 0, 7); g.fill();
      g.strokeStyle = '#8a5a30'; g.lineWidth = 0.7; g.beginPath(); g.ellipse(17, 13, 1.5, 2, 0, 0, 7); g.stroke(); L([[5, 11], [14, 11]], '#6b4424', 0.8); break;
    case 'stone': P([[4, 15], [7, 7], [14, 4], [20, 9], [19, 17], [11, 20]], '#8f9296'); P([[7, 7], [14, 4], [20, 9], [12, 11]], '#aeb1b5'); break;
    case 'iron': P([[4, 15], [7, 7], [14, 4], [20, 9], [19, 17], [11, 20]], '#6f6a64'); g.fillStyle = '#e08a4a';
      for (const [x, y] of [[9, 10], [14, 8], [12, 15], [16, 13]]) g.fillRect(x, y, 2.4, 2.4); break;
    case 'hide': P([[4, 8], [8, 5], [16, 5], [20, 8], [19, 17], [15, 20], [9, 20], [5, 17]], '#8a6446'); g.fillStyle = '#6b4a32';
      for (const [x, y] of [[9, 9], [14, 12], [10, 15]]) { g.beginPath(); g.arc(x, y, 1.4, 0, 7); g.fill(); } break;
    case 'reed': for (const x of [7, 12, 17]) { L([[x, 21], [x + (x - 12) * 0.15, 6]], '#8f9a4a', 1.4); g.fillStyle = '#6b4a2e'; g.fillRect(x - 1.2 + (x - 12) * 0.15, 4, 2.4, 5); } break;
    case 'arrow': L([[5, 19], [18, 6]], '#d9c7a8', 1.4); P([[20, 4], [15.5, 5.5], [18.5, 8.5]], '#9aa0a3'); L([[5, 19], [3.5, 16]], '#c63d3d', 1.4); L([[5, 19], [8, 20.5]], '#c63d3d', 1.4); break;
    case 'pot': P([[10, 3], [14, 3], [14, 8], [10, 8]], '#e8e1cf'); g.fillStyle = '#e0506a'; g.beginPath(); g.arc(12, 15, 6.5, 0, 7); g.fill();
      g.fillStyle = '#ffc3cf'; g.beginPath(); g.arc(9.8, 13, 1.8, 0, 7); g.fill(); break;
    case 'bow': g.strokeStyle = '#8a5a2e'; g.lineWidth = 2; g.beginPath(); g.moveTo(7, 3); g.quadraticCurveTo(22, 12, 7, 21); g.stroke(); L([[7, 3], [7, 21]], '#e6dfcc', 0.7); break;
    case 'spike': P([[3, 17], [21, 17], [21, 20], [3, 20]], '#5a4a3a'); for (const x of [6, 12, 18]) P([[x - 2.2, 17], [x, x === 12 ? 5 : 8], [x + 2.2, 17]], '#b8bcbf'); break;
    case 'ladder': L([[7, 3], [7, 21]], '#8a6a44', 2); L([[17, 3], [17, 21]], '#8a6a44', 2);
      for (const y of [6, 10.5, 15, 19.5]) L([[7, y], [17, y]], '#b08a5a', 1.6); break;
    case 'charm': g.save(); g.translate(12, 12); g.rotate(-0.7); g.fillStyle = '#f2ead6'; g.beginPath(); g.ellipse(0, 0, 3.5, 9, 0, 0, 7); g.fill();
      g.strokeStyle = '#b89c6a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 10); g.stroke(); g.restore(); break;
    case 'kit': P([[12, 2], [21, 7], [21, 17], [12, 22], [3, 17], [3, 7]], '#e2733b', '#8a3a14');
      g.fillStyle = '#fff'; g.font = '700 10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((KITS[kit] || { name: '?' }).name[0], 12, 12.5); break;
  }
  return c;
}
function iconCanvas(id, kit) { const k = id + (id === 'kit' ? kit : ''); return ICON_CACHE[k] || (ICON_CACHE[k] = paintIcon(id, kit)); }
const ICON_URL = {};
function iconURL(id, kit) { const k = id + (id === 'kit' ? kit : ''); return ICON_URL[k] || (ICON_URL[k] = iconCanvas(id, kit).toDataURL()); }
