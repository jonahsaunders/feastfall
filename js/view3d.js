'use strict';
// Per-frame 3D view: first-person camera, players, rats, pickups, effects, held item, minimap.
const EYE = 46;
const FG = {
  leg: new T.BoxGeometry(6, 22, 6).translate(0, -11, 0),
  torso: new T.CylinderGeometry(9, 11, 26, 6),
  head: new T.IcosahedronGeometry(8, 0),
  arm: new T.BoxGeometry(4.5, 20, 4.5).translate(0, -10, 0),
  blade: new T.BoxGeometry(2.4, 32, 5).translate(0, -16, 0),
  fist: new T.BoxGeometry(6.5, 6.5, 6.5),
  plate: new T.CylinderGeometry(11.5, 12.5, 18, 6),
  helm: new T.SphereGeometry(9.8, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2),
  pad: new T.BoxGeometry(9, 5, 9),
  bush: new T.IcosahedronGeometry(21, 0),
  ring: new T.TorusGeometry(22, 1.5, 4, 24).rotateX(Math.PI / 2),
  ratBody: new T.SphereGeometry(5, 6, 4).scale(1.7, 0.85, 1),
  ratTail: new T.BoxGeometry(12, 1, 1).translate(-6, 0, 0),
  pot: new T.IcosahedronGeometry(5.5, 0),
  neck: new T.CylinderGeometry(1.8, 2.2, 5, 5),
  hide: new T.DodecahedronGeometry(6, 0).scale(1.3, 0.35, 1),
  bag: new T.DodecahedronGeometry(9, 0),
  chest: new T.BoxGeometry(28, 18, 20),
  band: new T.BoxGeometry(29, 3, 21),
  arrow: new T.CylinderGeometry(0.7, 0.7, 22, 4).rotateZ(Math.PI / 2),
  hook: new T.TorusGeometry(4, 1, 4, 8, Math.PI * 1.4),
  puff: new T.IcosahedronGeometry(1, 0),
  flatRing: new T.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2),
};
const FMAT = {
  skin: lam('#e0c9a6'), steel: lam('#a9bcc2'), dark: lam('#2a2622'), rat: lam('#6f6258'), tail: lam('#b89c8c'),
  pot: lam('#e0506a', { emissive: 0x401018 }), glass: lam('#e8e1cf'), hide: lam('#8a6446'), bag: lam('#7b5a3a'),
  chest: lam('#7a4d23'), gold: lam('#e6b84a', { emissive: 0x3a2a00 }), arrow: lam('#e6dfcc'), bush: lam('#4a7a3a'),
};
const dyn = new Map();
let frameNo = 0;

function tagSprite() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new T.CanvasTexture(c);
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: true, fog: true, transparent: true }));
  s.scale.set(52, 13, 1); s.userData = { c, tex, key: '' };
  return s;
}
function drawTag(s, name, hp, max, clone) {
  const key = name + '|' + Math.ceil(hp);
  if (s.userData.key === key) return;
  s.userData.key = key;
  const g = s.userData.c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.font = '600 26px "Saira Condensed", system-ui, sans-serif'; g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(name, 129, 30);
  g.fillStyle = '#f2ead6'; g.fillText(name, 128, 28);
  if (!clone && hp < max) {
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(68, 40, 120, 10);
    g.fillStyle = '#c63d3d'; g.fillRect(68, 40, 120 * hp / max, 10);
  }
  s.userData.tex.needsUpdate = true;
}

function makeFighter(f) {
  const g = new T.Group(), body = new T.Group(); g.add(body);
  const col = new T.Color(f.color);
  const mT = lam(col), mL = lam(col.clone().multiplyScalar(0.45)), mB = lam(WCOL[f.weapon]);
  const mesh = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
  const legL = mesh(FG.leg, mL, 0, 22, -5), legR = mesh(FG.leg, mL, 0, 22, 5);
  const torso = mesh(FG.torso, mT, 0, 35, 0), head = mesh(FG.head, FMAT.skin, 0, 56, 0);
  const mA = lam('#8a6446');
  const plate = mesh(FG.plate, mA, 0, 37, 0), helm = mesh(FG.helm, mA, 0, 57, 0);
  const padL = mesh(FG.pad, mA, 0, 48, -10), padR = mesh(FG.pad, mA, 0, 48, 10);
  const arm = new T.Group(); arm.position.set(0, 46, 12);
  arm.add(mesh(FG.arm, mT, 0, 0, 0));
  const blade = mesh(FG.blade, mB, 0, -20, 0), fist = mesh(FG.fist, FMAT.skin, 0, -21, 0);
  arm.add(blade, fist);
  body.add(legL, legR, torso, head, plate, helm, padL, padR, arm);
  const bush = new T.Group();
  const dis = {
    bush: mesh(FG.bush, FMAT.bush, 0, 16, 0),
    rock: mesh(GEO.rock, lam('#77726a'), 0, 10, 0),
    snowrock: mesh(GEO.rock, lam('#b9c2c8'), 0, 10, 0),
    cactus: mesh(GEO.cactus, lam('#4d7a34'), 0, 0, 0),
  };
  dis.bush.scale.set(1, 0.8, 1); dis.rock.scale.set(22, 16, 20); dis.snowrock.scale.set(22, 16, 20); dis.cactus.scale.set(1.1, 0.9, 1.1);
  Object.values(dis).forEach(d => bush.add(d));
  const ring = new T.Mesh(FG.ring, new T.MeshBasicMaterial({ color: 0x9d7cf0 })); ring.position.y = 2;
  const tag = tagSprite(); tag.position.y = 80;
  g.add(bush, ring, tag);
  g.userData = { body, legL, legR, arm, blade, fist, plate, helm, padL, padR, bush, dis, ring, tag, mT, mL, mB, mA, walk: 0, w: -1, a: -1 };
  return g;
}
function updFighter(m, f, dt) {
  const u = m.userData;
  m.position.set(f.x, f.z, f.y);
  u.body.scale.y = f.sneak ? 0.86 : 1;
  m.rotation.y = -f.face;
  const moving = hyp(f.mx, f.my) > 0.1 && !f.gather && f.refillT <= 0;
  u.walk = moving ? u.walk + dt * 11 : u.walk * 0.8;
  u.legL.rotation.z = Math.sin(u.walk) * 0.6; u.legR.rotation.z = -Math.sin(u.walk) * 0.6;
  u.arm.rotation.z = f.swingT > 0 ? 2.4 - (1 - f.swingT / 0.14) * 2.3 : f.gather ? 1.4 + Math.sin(G.t * 11) * 0.7 : 1.0 + Math.sin(u.walk) * 0.15;
  if (u.w !== f.weapon) { u.w = f.weapon; u.mB.color.set(WCOL[f.weapon]); u.blade.visible = f.weapon > 0; u.fist.visible = f.weapon === 0; const m5 = f.weapon === 5; u.blade.scale.set(m5 ? 2.6 : 1, m5 ? 0.75 : 1, m5 ? 2 : 1); }
  const am = armorMask(f);
  if (u.a !== am) {
    u.a = am; const iron = am & 16, ac = iron ? '#c9d0d4' : '#8a6446';
    u.mA.color.set(ac); u.helm.visible = !!(am & 1); u.plate.visible = !!(am & 2);
    u.mL.color.set(am & 4 ? ac : new T.Color(f.color).multiplyScalar(0.45)); u.padL.visible = u.padR.visible = !!(am & 8);
  }
  u.body.visible = !f.hidden; u.bush.visible = !!f.hidden;
  if (f.hidden) for (const [k, d] of Object.entries(u.dis)) d.visible = k === f.disguise;
  u.mT.emissive.setHex(f.hurtT > 0 ? 0x992222 : 0x000000);
  u.ring.visible = f.invuln > 0 || f.punchT > 0;
  if (u.ring.visible) u.ring.material.color.setHex(f.invuln > 0 ? 0x9d7cf0 : 0xf0b43c);
  const d = hyp(f.x - camera.position.x, f.y - camera.position.z);
  const v = VIEW.focus || G.human, snowy = v.biome === 2 && G.settings.snow && !G.pit && !v.layer;
  u.tag.visible = !f.hidden && d < (snowy ? 220 : v.layer ? 330 : 650 * (1 - 0.45 * DAY.night));
  if (u.tag.visible) drawTag(u.tag, f.name, f.hp, f.maxHp, f.isClone);
}

function makeRat() {
  const g = new T.Group();
  const b = new T.Mesh(FG.ratBody, FMAT.rat); b.position.y = 4.5;
  const t = new T.Mesh(FG.ratTail, FMAT.tail); t.position.set(-7, 3, 0);
  const n = new T.Mesh(FG.puff, FMAT.tail); n.scale.set(2.5, 2, 2); n.position.set(8.5, 4.5, 0);
  g.add(b, t, n); g.userData.tail = t;
  return g;
}
const ICON_MATS = {};
function iconMaterial(id) {
  return ICON_MATS[id] || (ICON_MATS[id] = new T.SpriteMaterial({ map: new T.CanvasTexture(iconCanvas(id, G.human && G.human.kit)), fog: true, transparent: true }));
}
FG.miniBlock = new T.BoxGeometry(11, 11, 11);
FG.beam = new T.CylinderGeometry(5, 10, 1240, 8, 1, true);
const BEAM_MAT = new T.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.32, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide });
const RELIC_MAT = lam('#d9a93a', { emissive: 0x5a3c00 });
FG.spikeItem = new T.BoxGeometry(12, 3, 12);
function makeItem(it) {
  const g = new T.Group();
  const one = it.kind === 'drop' && it.stacks.length === 1 ? it.stacks[0].id : null;
  if (one === 'pot') {
    const p = new T.Mesh(FG.pot, FMAT.pot); p.position.y = 7;
    const n = new T.Mesh(FG.neck, FMAT.glass); n.position.y = 13.5;
    const halo = new T.Mesh(FG.flatRing, new T.MeshBasicMaterial({ color: 0xe0506a, transparent: true, opacity: 0.5 })); halo.scale.setScalar(13); halo.position.y = 0.8;
    g.add(p, n, halo); g.userData.bob = true;
  } else if (one && ITEMS[one].block) {
    const c = new T.Mesh(ITEMS[one].block === 'spike' ? FG.spikeItem : FG.miniBlock, lam(BLOCKS[ITEMS[one].block].color));
    c.position.y = 7; c.castShadow = true; g.add(c); g.userData.bob = true;
  } else if (one === 'hide') {
    const h = new T.Mesh(FG.hide, FMAT.hide); h.position.y = 2; g.add(h);
  } else if (one) {
    const s = new T.Sprite(iconMaterial(one)); s.scale.set(18, 18, 1); s.position.y = 12; g.add(s); g.userData.bob = true;
  } else if (it.kind === 'relic') { // a legendary's chest: gold, glowing, with a beam of light you can see across the map
    const c = new T.Mesh(FG.chest, RELIC_MAT); c.position.y = 9; c.castShadow = true;
    const b = new T.Mesh(FG.band, FMAT.dark); b.position.y = 12;
    const halo = new T.Mesh(FG.flatRing, new T.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6 })); halo.scale.setScalar(26); halo.position.y = 1;
    g.add(c, b, halo);
    if (!it.layer) { const beam = new T.Mesh(FG.beam, BEAM_MAT); beam.position.y = 620; g.add(beam); g.userData.beam = beam; }
    g.userData.halo = halo;
  } else if (it.kind === 'bag' || it.kind === 'drop') {
    const b = new T.Mesh(FG.bag, FMAT.bag); b.scale.set(1, 0.85, 1); b.position.y = 7; b.castShadow = true;
    const t = new T.Mesh(FG.neck, FMAT.glass); t.position.y = 15; g.add(b, t);
  } else {
    const c = new T.Mesh(FG.chest, FMAT.chest); c.position.y = 9; c.castShadow = true;
    const b = new T.Mesh(FG.band, FMAT.gold); b.position.y = 12;
    g.add(c, b);
  }
  g.rotation.y = rr(0, 6);
  return g;
}
function makeProj(p) {
  if (p.kind === 'arrow') return new T.Mesh(FG.arrow, FMAT.arrow);
  const g = new T.Group();
  g.add(new T.Mesh(FG.hook, FMAT.steel));
  const lg = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const line = new T.Line(lg, new T.LineBasicMaterial({ color: 0xe6dfcc }));
  line.frustumCulled = false;
  g.userData.line = line; scene.add(line);
  return g;
}
const tmpV = new T.Vector3();
function makeFx(e) {
  if (e.kind === 'puff' || e.kind === 'chip') return new T.Mesh(FG.puff, new T.MeshBasicMaterial({ color: e.col, transparent: true }));
  if (e.kind === 'ring' || e.kind === 'strike') return new T.Mesh(FG.flatRing, new T.MeshBasicMaterial({ color: e.kind === 'strike' ? 0xbfe3ff : e.col, transparent: true, side: T.DoubleSide }));
  if (e.kind === 'rope') {
    const l = new T.Line(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)), new T.LineBasicMaterial({ color: 0xe8d9b0 }));
    l.frustumCulled = false; return l;
  }
  if (e.kind === 'num') { const s = tagSprite(); drawTag(s, e.txt, 1, 1, true); s.scale.set(40, 10, 1); return s; }
  // lightning bolt
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push((i % 2 ? 1 : -1) * rr(6, 18) * (1 - i / 8), 420 - i * 52.5, rr(-10, 10));
  const g = new T.Group();
  g.add(new T.Line(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(pts, 3)), new T.LineBasicMaterial({ color: 0xffffff })));
  const flash = new T.Mesh(FG.puff, new T.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.6 })); flash.scale.setScalar(70); g.add(flash);
  G.flashT = 0.25;
  return g;
}
function updFx(m, e) {
  const k = 1 - e.t / e.max, hz = e.z !== undefined, base = hz ? e.z : e.layer ? 0 : heightAt(e.x, e.y);
  if (e.kind === 'puff' || e.kind === 'chip') { m.position.set(e.x, base + (hz ? 0 : 20) + k * 20, e.y); m.scale.setScalar((e.big ? 30 : e.kind === 'chip' ? 6 : 14) * (0.4 + k)); m.material.opacity = 1 - k; }
  else if (e.kind === 'ring') { m.position.set(e.x, base + (hz ? 0 : 2), e.y); m.scale.setScalar((e.big ? 50 : 26) * (0.3 + k)); m.material.opacity = 1 - k; }
  else if (e.kind === 'strike') { m.position.set(e.x, base + 2, e.y); m.scale.setScalar(75); m.material.opacity = 0.4 + 0.6 * Math.abs(Math.sin(G.t * 20)); }
  else if (e.kind === 'num') { m.position.set(e.x, base + (hz ? 0 : 70) + k * 25, e.y); m.material.opacity = 1 - k; }
  else if (e.kind === 'rope') {
    const o = e.owner, a = m.geometry.attributes.position, fp = o === G.human && VIEW.focus === G.human;
    a.setXYZ(0, o.x, o.z + (fp ? 30 : 42), o.y); a.setXYZ(1, e.x, e.az, e.y); a.needsUpdate = true;
  }
  else { m.position.set(e.x, base, e.y); m.children[1].material.opacity = 0.6 * (1 - k); }
}

function sync(key, make, upd, visible) {
  let m = dyn.get(key);
  if (!m) { m = make(key); scene.add(m); dyn.set(key, m); }
  m.userData.seen = frameNo;
  m.visible = visible;
  if (visible) upd(m, key);
}
function sweep() {
  for (const [k, m] of dyn) if (m.userData.seen !== frameNo) {
    scene.remove(m);
    if (m.userData.line) scene.remove(m.userData.line);
    if (m.userData.tag) m.userData.tag.userData.tex.dispose();
    dyn.delete(k);
  }
}

// ---- feast marker: table plus a tall banner you can see from far away ----
let feastMarker = null;
function syncFeast() {
  if (!G.feast) { if (feastMarker) { scene.remove(feastMarker); feastMarker = null; } return; }
  if (!feastMarker || feastMarker.userData.site !== G.feast.site) {
    if (feastMarker) scene.remove(feastMarker);
    const s = G.feast.site, g = new T.Group(), y = heightAt(s.x, s.y);
    g.position.set(s.x, y, s.y);
    const table = new T.Mesh(new T.BoxGeometry(90, 6, 30), FMAT.chest); table.position.y = 22; table.castShadow = true;
    const pole = new T.Mesh(new T.CylinderGeometry(2, 2, 240, 5), FMAT.dark); pole.position.set(0, 120, -40);
    const flag = new T.Mesh(new T.PlaneGeometry(60, 34), new T.MeshBasicMaterial({ color: 0xe6b84a, side: T.DoubleSide, fog: false }));
    flag.position.set(30, 220, -40);
    g.add(table, pole, flag); g.userData = { site: s, flag };
    scene.add(g); feastMarker = g;
  }
  feastMarker.visible = G.human.layer === 0;
  feastMarker.userData.flag.rotation.y = Math.sin(G.t * 2) * 0.3;
}

// ---- snow ----
const SNOW_N = 1400, snowGeo = new T.BufferGeometry(), snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) { snowPos[i * 3] = rr(-350, 350); snowPos[i * 3 + 1] = rr(-60, 260); snowPos[i * 3 + 2] = rr(-350, 350); }
snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
const snow = new T.Points(snowGeo, new T.PointsMaterial({ color: 0xffffff, size: 2.6, transparent: true, opacity: 0.9 }));
snow.frustumCulled = false; scene.add(snow);

// ---- held item (first-person viewmodel) ----
const VM = new T.Group(); VM.scale.setScalar(0.78); vmScene.add(VM);
const vmParts = {};
(() => {
  const sword = new T.Group();
  const blade = new T.Mesh(new T.BoxGeometry(2.2, 30, 5).translate(0, 17, 0), lam('#a4743f'));
  const guard = new T.Mesh(new T.BoxGeometry(3, 2.5, 12), lam('#3a2a1c'));
  const grip = new T.Mesh(new T.BoxGeometry(2.6, 9, 2.6).translate(0, -4.5, 0), lam('#5b3f25'));
  sword.add(blade, guard, grip); sword.userData.blade = blade;
  const fist = new T.Mesh(new T.BoxGeometry(8, 8, 9), FMAT.skin);
  const bow = new T.Group();
  const limb = new T.Mesh(new T.TorusGeometry(15, 1.1, 4, 16, Math.PI), lam('#8a5a2e')); limb.rotation.z = Math.PI / 2;
  const sg = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([0, 15, 0, 0, 0, 0, 0, -15, 0], 3));
  const string = new T.Line(sg, new T.LineBasicMaterial({ color: 0xe6dfcc }));
  const arrowVm = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 26, 4).rotateX(Math.PI / 2), FMAT.arrow);
  bow.add(limb, string, arrowVm); bow.userData = { string, arrowVm };
  const pot = new T.Group();
  pot.add(new T.Mesh(new T.IcosahedronGeometry(6, 0), FMAT.pot));
  const pn = new T.Mesh(new T.CylinderGeometry(2, 2.4, 6, 5), FMAT.glass); pn.position.y = 7; pot.add(pn);
  const kit = new T.Mesh(new T.CylinderGeometry(7, 7, 4, 6).rotateX(Math.PI / 2), lam('#e2733b', { emissive: 0x3a1500 }));
  const block = new T.Mesh(new T.BoxGeometry(8, 8, 8), lam('#a2774a'));
  const icon = new T.Mesh(new T.PlaneGeometry(13, 13), new T.MeshBasicMaterial({ transparent: true, side: T.DoubleSide }));
  Object.assign(vmParts, { sword, fist, bow, pot, kit, block, icon });
  VM.add(sword, fist, bow, pot, kit, block, icon);
})();
let vmBob = 0;
function updateViewmodel(dt) {
  const h = G.human, item = heldId(h), def = item ? ITEMS[item] : null;
  const show = !item ? 'fist' : def.tier ? 'sword' : item === 'bow' ? 'bow' : item === 'pot' ? 'pot' : item === 'kit' ? 'kit' : def.block ? 'block' : 'icon';
  if (show === 'icon' && vmParts.icon.userData.id !== item) { vmParts.icon.material.map = iconMaterial(item).map; vmParts.icon.material.needsUpdate = true; vmParts.icon.userData.id = item; }
  for (const [k, p] of Object.entries(vmParts)) p.visible = k === show && !h.hidden;
  const moving = hyp(h.mx, h.my) > 0.1 && h.refillT <= 0 && !h.gather;
  vmBob += moving ? dt * 9 : 0;
  VM.position.set(17 + Math.cos(vmBob) * 1.2, -17 + Math.abs(Math.sin(vmBob)) * 1.6, -46);
  VM.rotation.set(0, 0, 0);
  if (show === 'sword' || show === 'fist') {
    const p = vmParts[show];
    if (show === 'sword') { const m5 = h.weapon === 5; p.userData.blade.material.color.set(WCOL[h.weapon]); p.userData.blade.scale.set(m5 ? 2.6 : 1, m5 ? 0.7 : 1, m5 ? 2 : 1); }
    p.position.set(0, 0, 0); p.rotation.set(-0.25, 0.3, -0.35);
    if (h.swingT > 0) {
      const t = 1 - h.swingT / 0.14;
      p.rotation.set(-0.25 - Math.sin(t * Math.PI) * 1.3, 0.3 + t * 0.9, -0.35 + Math.sin(t * Math.PI) * 0.8);
      p.position.set(-t * 10, Math.sin(t * Math.PI) * 4, -Math.sin(t * Math.PI) * 6);
    } else if (h.gather) {
      p.rotation.x = -0.25 - Math.max(0, Math.sin(G.t * 11)) * 1.1;
    }
  } else if (show === 'bow') {
    const c = Math.max(0, h.charge), b = vmParts.bow;
    b.position.set(-8, 2, -4); b.rotation.set(0, -0.15, 0.25);
    const sp = b.userData.string.geometry.attributes.position; sp.setZ(1, 4 + c * 14); sp.needsUpdate = true;
    b.userData.arrowVm.visible = h.arrows > 0; b.userData.arrowVm.position.z = -9 + c * 14;
  } else if (show === 'pot') {
    const p = vmParts.pot, d = h.drinkCd > 0 ? h.drinkCd / 0.2 : 0;
    p.position.set(-d * 10, d * 10, 0); p.rotation.set(d * 0.8, 0, d * 0.6);
  } else if (show === 'block') {
    const p = vmParts.block, sw = h.swingT > 0 ? Math.sin((1 - h.swingT / 0.14) * Math.PI) : 0;
    p.material.color.set(BLOCKS[def.block].color);
    p.position.set(-2 - sw * 4, -1 + sw * 3, -sw * 6); p.rotation.set(0.35 - sw * 0.6, 0.7, 0.1);
    p.scale.set(1, def.block === 'spike' ? 0.35 : 1, 1);
  } else if (show === 'icon') {
    const p = vmParts.icon, sw = h.swingT > 0 ? Math.sin((1 - h.swingT / 0.14) * Math.PI) : 0;
    p.position.set(-3 - sw * 4, 1 + sw * 3, -sw * 6); p.rotation.set(-0.2, 0.35, 0.1);
  } else if (show === 'kit') {
    const p = vmParts.kit; p.position.set(0, 0, 0); p.rotation.set(0.3, G.t * 0.8, 0);
    p.material.emissive.setHex(h.kitCd > 0 ? 0x000000 : 0x3a1500);
  }
}

// ---- aim point on the ground (for Lightning and Jumper) ----
function aimWorld() {
  const h = G.human;
  let d = 520;
  if (VIEW.pitch < -0.03) d = clamp(EYE / Math.tan(-VIEW.pitch), 40, 520);
  return { x: h.x + Math.cos(h.face) * d, y: h.y + Math.sin(h.face) * d };
}

// ---- time of day: dawn at the start, midday, dusk around 45:00, night by the pit ----
const TOD = [[0, '#d9c2a4', '#ffcf9a', 0.6, 0.62, 1700], [8, '#aebfc0', '#fff0d8', 0.8, 0.8, 1900], [36, '#aebfc0', '#fff0d8', 0.8, 0.8, 1900],
  [46, '#cf946c', '#ff9a5c', 0.5, 0.52, 1500], [53, '#131b28', '#a9bcff', 0.22, 0.26, 950], [99, '#0e1520', '#a9bcff', 0.2, 0.24, 900]]
  .map(([m, sky, sun, si, hi, far]) => ({ m, sky: new T.Color(sky), sun: new T.Color(sun), si, hi, far }));
const DAY = { sky: new T.Color('#aebfc0'), sun: new T.Color('#fff0d8'), si: 0.8, hi: 0.8, far: 1900, night: 0, arc: 0.5 };
function timeOfDay(min) {
  let i = 0;
  while (i < TOD.length - 2 && min > TOD[i + 1].m) i++;
  const a = TOD[i], b = TOD[i + 1], k = clamp((min - a.m) / (b.m - a.m), 0, 1);
  DAY.sky.copy(a.sky).lerp(b.sky, k); DAY.sun.copy(a.sun).lerp(b.sun, k);
  DAY.si = a.si + (b.si - a.si) * k; DAY.hi = a.hi + (b.hi - a.hi) * k; DAY.far = a.far + (b.far - a.far) * k;
  DAY.night = clamp((min - 45) / 8, 0, 1); DAY.arc = clamp(min / 52, 0, 1);
}
const STAR_N = 900, starGeo = new T.BufferGeometry(), starPos = new Float32Array(STAR_N * 3);
for (let i = 0; i < STAR_N; i++) {
  const a = Math.random() * Math.PI * 2, e = Math.asin(0.08 + Math.random() * 0.92);
  starPos.set([Math.cos(a) * Math.cos(e) * 1500, Math.sin(e) * 1500, Math.sin(a) * Math.cos(e) * 1500], i * 3);
}
starGeo.setAttribute('position', new T.BufferAttribute(starPos, 3));
const stars = new T.Points(starGeo, new T.PointsMaterial({ color: 0xdfe8ff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 }));
stars.frustumCulled = false; scene.add(stars);
const SNOW_DAY = new T.Color('#e1e8ec'), SNOW_NIGHT = new T.Color('#3a4452');
const FOG = { surf: { c: DAY.sky, n: 450, f: 1900 }, snow: { c: new T.Color('#e1e8ec'), n: 10, f: 300 }, under: { c: new T.Color('#050403'), n: 40, f: 400 } };
let camYaw = 0, deathLift = 0;
function render(dt) {
  if (world !== builtWorld) { build3D(); for (const [, m] of dyn) { scene.remove(m); if (m.userData.line) scene.remove(m.userData.line); } dyn.clear(); }
  frameNo++;
  const h = G.human, playing = G.mode !== 'menu' && G.mode !== 'options';
  const spec = G.mode === 'spectate' && G.specTarget && G.specTarget.alive ? G.specTarget : null;
  const focus = spec || h, L = focus.layer, fp = playing && !spec; // fp: first person
  VIEW.focus = focus;
  timeOfDay(playing ? G.clockMin : 14);
  surfaceGroup.visible = L === 0; underGroup.visible = L === 1;
  if (frameNo % 6 === 0) {
    for (const o of world.objs) if (o.amt !== o._amt) syncObjParts(o);
    for (const o of world.ores) if (o.amt !== o._amt) syncObjParts(o);
  }

  // camera
  if (fp) {
    deathLift = h.alive ? 0 : Math.min(140, deathLift + dt * 60);
    const bob = hyp(h.mx, h.my) > 0.1 && h.alive && h.onGround ? Math.sin(G.t * 11) * 1.4 : 0;
    camera.position.set(h.x, h.z + EYE - (h.sneak ? 9 : 0) + bob + deathLift, h.y);
    camera.rotation.y = -h.face - Math.PI / 2;
    camera.rotation.x = h.alive ? VIEW.pitch : Math.max(-1.2, VIEW.pitch - deathLift / 200);
    camera.fov = (G.settings.fov || 75) + (h.speedT > 0 ? 13 : 0);
    if (h.hurtT > 0 && h.alive) { const s = h.hurtT * 14; camera.position.x += (Math.random() - .5) * s; camera.position.y += (Math.random() - .5) * s; camera.position.z += (Math.random() - .5) * s; }
  } else {
    // Menu: slow orbit. Spectating: follow behind the player you're watching.
    if (spec) camYaw += angDiff(camYaw, focus.face) * Math.min(1, dt * 3); else camYaw += dt * 0.12;
    const fx = focus.x, fz = focus.y, fy = focus.z ?? groundY(focus);
    const d = L ? 110 : spec ? 150 : 230, up = L ? 50 : spec ? 80 : 130;
    camera.position.set(fx - Math.cos(camYaw) * d, fy + up, fz - Math.sin(camYaw) * d);
    if (L === 0) camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 30);
    camera.lookAt(fx, fy + 30, fz);
    camera.fov = 70;
  }
  camera.updateProjectionMatrix();

  syncBlocks();
  syncAim();
  // players, rats, items, projectiles, effects
  for (const f of G.fighters) if (f.alive && !(fp && f === h)) sync(f, makeFighter, (m, f) => updFighter(m, f, dt), f.layer === L && hyp(f.x - camera.position.x, f.y - camera.position.z) < (L ? 500 : 1300));
  if (L === 1) for (const r of G.rats) if (!r.dead) sync(r, makeRat, (m, r) => { m.position.set(r.x, 0, r.y); m.rotation.y = -r.a; m.userData.tail.rotation.y = Math.sin(G.t * 14 + r.x) * 0.5; }, true);
  for (const it of G.items) if (!it.gone) sync(it, makeItem, (m, it) => {
    m.position.set(it.x, (it.z ?? (it.layer ? 0 : heightAt(it.x, it.y))) + (m.userData.bob ? Math.sin(G.t * 3 + it.x) * 2 : 0), it.y);
    if (m.userData.bob) m.rotation.y += dt;
    if (m.userData.halo) { const on = it.kind === 'relic'; m.userData.halo.visible = on; if (m.userData.beam) m.userData.beam.visible = on; m.userData.halo.material.opacity = 0.4 + Math.sin(G.t * 3) * 0.2; }
  }, it.layer === L);
  for (const p of G.proj) sync(p, makeProj, (m, p) => {
    const y = p.z;
    m.position.set(p.x, y, p.y); m.rotation.set(0, -Math.atan2(p.vy, p.vx), Math.atan2(p.vz, hyp(p.vx, p.vy)));
    if (m.userData.line) {
      const a = m.userData.line.geometry.attributes.position;
      a.setXYZ(0, p.owner.x, p.owner.z + 40, p.owner.y); a.setXYZ(1, p.x, y, p.y); a.needsUpdate = true;
      m.userData.line.visible = true;
    }
  }, p.layer === L);
  for (const e of G.fx) sync(e, makeFx, updFx, e.layer === L);
  sweep();
  syncFeast();

  // atmosphere: sky haze, snowstorm, or the dark of the tunnels
  const inSnow = L === 0 && focus.biome === 2 && G.settings.snow && !G.pit;
  FOG.surf.f = DAY.far; FOG.snow.c.copy(SNOW_DAY).lerp(SNOW_NIGHT, DAY.night);
  const tgt = L ? FOG.under : inSnow ? FOG.snow : FOG.surf, k = 1 - Math.exp(-3 * dt);
  scene.fog.color.lerp(tgt.c, k); scene.fog.near += (tgt.n - scene.fog.near) * k; scene.fog.far += (tgt.f - scene.fog.far) * k;
  scene.background.copy(scene.fog.color);
  G.flashT = Math.max(0, (G.flashT || 0) - dt);
  hemi.intensity = (L ? 0.1 : DAY.hi) + G.flashT * 3;
  sun.intensity = L ? 0 : DAY.si; sun.color.copy(DAY.sun);
  stars.visible = !L && DAY.night > 0.02; stars.material.opacity = DAY.night * (inSnow ? 0.2 : 1); stars.position.copy(camera.position);
  sun.castShadow = !!G.settings.shadows;
  torch.intensity = L ? 1.5 : 0;
  torch.position.copy(camera.position);
  sun.position.set(camera.position.x + 700 - 1400 * DAY.arc, camera.position.y + 250 + 650 * Math.sin(Math.max(0.15, DAY.arc) * Math.PI), camera.position.z + 250);
  sun.target.position.set(camera.position.x, camera.position.y - 40, camera.position.z);
  snow.visible = inSnow;
  if (inSnow) {
    snow.position.copy(camera.position);
    for (let i = 0; i < SNOW_N; i++) {
      let y = snowPos[i * 3 + 1] - dt * 60; if (y < -60) y += 320;
      snowPos[i * 3 + 1] = y; snowPos[i * 3] += dt * 25; if (snowPos[i * 3] > 350) snowPos[i * 3] -= 700;
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (fp && h.alive) {
    updateViewmodel(dt);
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
}

// ---- minimap (top-down, 2D) ----
const mm = document.getElementById('minimap'), mctx = mm.getContext('2d');
let mmTick = 0;
function renderMinimap() {
  if (mmTick++ % 3) return;
  const S = mm.width / WORLD, h = VIEW.focus || G.human;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.globalAlpha = h.layer ? 0.35 : 1;
  mctx.drawImage(world.ground, 0, 0, mm.width, mm.height);
  mctx.globalAlpha = 1;
  if (h.layer) {
    mctx.strokeStyle = '#8b6b48'; mctx.lineWidth = 3; mctx.lineCap = 'round';
    for (const line of world.tunnels) { mctx.beginPath(); line.forEach((p, i) => i ? mctx.lineTo(p.x * S, p.y * S) : mctx.moveTo(p.x * S, p.y * S)); mctx.stroke(); }
  }
  mctx.fillStyle = '#e8c27a'; mctx.strokeStyle = '#3a2a14'; mctx.lineWidth = 1.5;
  for (const r of world.ruins) { mctx.beginPath(); mctx.rect(r.x * S - 4, r.y * S - 4, 8, 8); mctx.fill(); mctx.stroke(); }
  mctx.fillStyle = '#e6dfcc';
  for (const e of world.entrances) mctx.fillRect(e.x * S - 2, e.y * S - 2, 4, 4);
  if (G.feast) {
    mctx.strokeStyle = '#e6b84a'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(G.feast.site.x * S, G.feast.site.y * S, 7 + Math.sin(G.t * 5) * 2, 0, 7); mctx.stroke();
  }
  const star = (x, y, r) => { mctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rad = i % 2 ? r * 0.45 : r; mctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } mctx.closePath(); mctx.fill(); mctx.stroke(); };
  mctx.fillStyle = '#ffd24a'; mctx.strokeStyle = '#3a2a08'; mctx.lineWidth = 1.5;
  for (const it of G.items) if (it.kind === 'relic' && !it.gone) star(it.x * S, it.y * S, 8 + Math.sin(G.t * 4) * 1.2);
  if (h.layer === 1 && G.human.equip && wears(G.human, 'crown')) {
    mctx.fillStyle = '#e0506a';
    for (const f of G.fighters) if (f.alive && f.layer === 1 && f !== G.human && !f.isClone) { mctx.beginPath(); mctx.arc(f.x * S, f.y * S, 3.5, 0, 7); mctx.fill(); }
  }
  for (const p of G.pings) {
    if (p.src === h) continue;
    mctx.strokeStyle = `rgba(214,90,90,${p.t / 12})`; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(p.x * S, p.y * S, 4 + (12 - p.t) % 2 * 5, 0, 7); mctx.stroke();
  }
  mctx.save(); mctx.translate(h.x * S, h.y * S); mctx.rotate(h.face);
  mctx.fillStyle = '#e2733b'; mctx.beginPath(); mctx.moveTo(8, 0); mctx.lineTo(-5, -5); mctx.lineTo(-3, 0); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// ---- placed blocks ----
const BLOCK_GEO = new T.BoxGeometry(B, B, B).translate(0, B / 2, 0);
const SPIKE_BASE = new T.BoxGeometry(B - 2, 4, B - 2).translate(0, 2, 0), SPIKE = new T.ConeGeometry(2.2, 12, 4).translate(0, 10, 0);
function mergeGeos(geos) {
  const pos = [], nor = [];
  for (const g of geos) { const n = g.toNonIndexed(); pos.push(...n.attributes.position.array); nor.push(...n.attributes.normal.array); }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return out;
}
const LADDER_GEO = mergeGeos([new T.BoxGeometry(2.5, B, 2.5).translate(-8, B / 2, 0), new T.BoxGeometry(2.5, B, 2.5).translate(8, B / 2, 0),
  ...[4, 10.5, 17, 23.5].map(y => new T.BoxGeometry(16, 2, 2).translate(0, y, 0))]);
const blockMeshes = {};
let blockVer = -1;
function syncBlocks() {
  if (!Object.keys(blockMeshes).length) {
    for (const [type, def] of Object.entries(BLOCKS)) {
      if (def.trap) {
        blockMeshes[type] = new T.InstancedMesh(SPIKE_BASE, lam('#5a4a3a'), 600);
        blockMeshes.spikeTips = new T.InstancedMesh(SPIKE, lam('#b8bcbf'), 600 * 5);
      } else if (def.ladder) blockMeshes[type] = new T.InstancedMesh(LADDER_GEO, lam(def.color), 2000);
      else { blockMeshes[type] = new T.InstancedMesh(BLOCK_GEO, lam('#ffffff'), MAX_BLOCKS); blockMeshes[type].setColorAt(0, new T.Color(1, 1, 1)); }
    }
    for (const m of Object.values(blockMeshes)) { m.castShadow = true; m.receiveShadow = true; m.count = 0; m.frustumCulled = false; scene.add(m); }
  }
  for (const m of Object.values(blockMeshes)) m.visible = (VIEW.focus || G.human).layer === 0;
  if (BL.ver === blockVer) return;
  blockVer = BL.ver;
  const n = {}, col = new T.Color();
  for (const k of Object.keys(blockMeshes)) n[k] = 0;
  for (const [key, b] of BL.map) {
    const [i, j, k] = key.split(',').map(Number), cx = (i + .5) * B, cz = (k + .5) * B;
    if (b.type === 'spike') {
      if (n.spike >= 600) continue;
      const y = Math.max(j * B, heightAt(cx, cz) - 1);
      dummy.position.set(cx, y, cz); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      blockMeshes.spike.setMatrixAt(n.spike++, dummy.matrix);
      for (const [ox, oz] of [[0, 0], [-7, -7], [7, -7], [-7, 7], [7, 7]]) {
        dummy.position.set(cx + ox, y, cz + oz); dummy.updateMatrix();
        blockMeshes.spikeTips.setMatrixAt(n.spikeTips++, dummy.matrix);
      }
      continue;
    }
    if (b.type === 'ladder') {
      if (n.ladder >= 2000) continue;
      const w = ladderWall(i, j, k), off = B / 2 - 2.5;
      dummy.position.set(cx + (w === 0 ? off : w === 1 ? -off : 0), j * B, cz + (w === 2 ? off : w === 3 ? -off : 0));
      dummy.rotation.set(0, w === 0 || w === 1 ? Math.PI / 2 : 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      blockMeshes.ladder.setMatrixAt(n.ladder++, dummy.matrix);
      continue;
    }
    const m = blockMeshes[b.type];
    dummy.position.set(cx, j * B, cz); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    m.setMatrixAt(n[b.type], dummy.matrix);
    // small per-block shade shift so individual blocks read in a wall
    const h = ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) >>> 0;
    col.set(BLOCKS[b.type].color).offsetHSL(0, 0, ((h % 100) / 100 - 0.5) * 0.08);
    m.setColorAt(n[b.type]++, col);
  }
  for (const [k, m] of Object.entries(blockMeshes)) {
    m.count = n[k]; m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

// ---- what the crosshair is pointing at: outline the block, ghost the placement ----
const aimBox = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(B + 0.6, B + 0.6, B + 0.6)), new T.LineBasicMaterial({ color: 0x111111 }));
const ghost = new T.Mesh(new T.BoxGeometry(B, B, B), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
scene.add(aimBox, ghost);
function syncAim() {
  const a = G.aim, h = G.human;
  aimBox.visible = ghost.visible = false;
  if (!a || G.mode !== 'play' || !h.alive || h.layer) return;
  if (a.hit === 'block') {
    aimBox.visible = true;
    const spike = a.b.type === 'spike';
    aimBox.scale.set(1, spike ? 0.2 : 1, 1);
    aimBox.position.set((a.i + .5) * B, spike ? a.j * B + 2.5 : a.j * B + B / 2, (a.k + .5) * B);
  }
  const held = heldId(h), type = held && ITEMS[held].block ? held : null;
  if (type && a.pi !== null && count(h, type) > 0 && canPlace(type, a.pi, a.pj, a.pk)) {
    ghost.visible = true;
    ghost.position.set((a.pi + .5) * B, a.pj * B + B / 2, (a.pk + .5) * B);
    ghost.scale.set(1, type === 'spike' ? 0.2 : 1, 1);
    ghost.material.color.set(BLOCKS[type].color);
  }
}
