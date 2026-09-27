'use strict';
// Replays: the death replay (the last few seconds before you died, filmed over your killer's shoulder) and the
// play of the match (the best kill anyone made, filmed over the shoulder of whoever made it).
// Every fighter, motorcycle, helicopter and projectile is recorded 20 times a second, and the last 8 seconds are kept.
// When you die, or a kill scores higher than the current play of the match, that stretch is kept as a clip.
// Playback swaps the recorded values into the live objects just for the render, then puts them back,
// so an online match keeps running underneath.
const REPLAY = { buf: [], acc: 0, t: 0, t0: 0, t1: 0, hold: 0, clip: null, view: null, cam: null, saved: null, proxies: new Map(), onDone: null, death: null, best: null, pending: null };
const RP_KEEP = 8, RP_HZ = 20, RP_LEN = 5;
const RP_F = ['x', 'y', 'z', 'face', 'hp', 'swingT', 'hurtT', 'mx', 'my', 'sneak', 'hidden', 'disguise', 'size', 'layer', 'invuln', 'punchT', 'charge', 'burnT', 'burnNet', 'gather', 'bike', 'pitT', 'pitNet', 'heli', 'seat'];
const RP_K = ['x', 'y', 'z', 'face', 'speed', 'steer', 'air', 'vz', 'wheel', 'gone']; // motorcycles
const RP_H = ['x', 'y', 'z', 'face', 'tilt', 'roll', 'rotor', 'blade', 'tail', 'gone', 'pilot', 'gunner']; // helicopters

function replayReset() { Object.assign(REPLAY, { buf: [], acc: 0, death: null, best: null, pending: null, clip: null }); REPLAY.proxies.clear(); }

function replayRecord(dt) {
  if (!G.human || !G.human.isFighter) return;
  REPLAY.acc += dt;
  if (REPLAY.acc < 1 / RP_HZ) return;
  REPLAY.acc = 0;
  const fs = [];
  for (const f of G.fighters) if (f.alive) fs.push([f, RP_F.map(k => f[k])]);
  const ks = (G.bikes || []).filter(k => !k.gone).map(k => [k, RP_K.map(n => k[n])]);
  const hs = (G.helis || []).filter(h => !h.gone).map(h => [h, RP_H.map(n => h[n])]);
  REPLAY.buf.push({ t: G.t, fs, ks, hs, ps: G.proj.map(p => [p, p.x, p.y, p.z, p.vx, p.vy, p.vz]) });
  while (REPLAY.buf.length && REPLAY.buf[0].t < G.t - RP_KEEP) REPLAY.buf.shift();
  // A highlight is kept a moment after the kill, so the clip shows what happened next
  const P = REPLAY.pending;
  if (P && G.t >= P.at + 1.5) {
    REPLAY.pending = null;
    if (!REPLAY.best || P.score >= REPLAY.best.score) REPLAY.best = { ...P, frames: REPLAY.buf.filter(b => b.t >= P.at - 5.5) };
  }
}
// Keep the footage of the human's death (the recorder carries on for the play of the match)
function replaySnapDeath() {
  const b = REPLAY.buf;
  REPLAY.death = b.length >= 20 ? { frames: b.slice(), focus: G.human, anchor: G.killer, at: b[b.length - 1].t } : null;
}
// Score a kill for the play of the match
function noteHighlight(t, k, fell, kind) {
  if (!k || !k.isFighter || t.isClone || !G.human.isFighter) return;
  let score = 10;
  const why = [];
  if (k.multi >= 2) { score += 15 * (k.multi - 1); why.push(MULTI[Math.min(5, k.multi)]); }
  if (k.streak >= 3) { score += 4 * Math.min(k.streak, 10); why.push(`${k.streak} in a row`); }
  const special = { pitfall: 'Pitfall', ram: 'Road kill', bike: 'Wrecked', stomp: 'Titan stomp', bolt: 'Lightning', lava: 'Burned', blast: 'Blast trap', heli: 'Shot down', rocket: 'Rocket' }[kind];
  if (special) { score += 12; why.push(special); } else if (fell) { score += 12; why.push('Knocked off'); }
  const d = hyp(k.x - t.x, k.y - t.y);
  if (d > 750) { score += 15; why.push('Long shot'); }
  if (G.bounty === t) { score += 20; why.push('Bounty claimed'); }
  if (k.alive && k.hp < 4) { score += 12; why.push(`${Math.max(0.5, Math.round(k.hp * 2) / 2)} health left`); }
  if (t.rival || k.rival) score += 5;
  if (k === G.human) score += 8;
  const left = new Set(G.fighters.filter(f => f.alive && !f.isClone).map(f => f.squad || f.id)).size;
  if (left <= 1) { score += 18; why.push('Winning kill'); }
  const P = REPLAY.pending;
  if (P && P.anchor === k && G.t - P.at < 10) { score = Math.max(score, P.score) + 6; } // a follow-up kill in the same clip
  if (P && P.score > score) return;
  if (REPLAY.best && REPLAY.best.score > score) return;
  REPLAY.pending = { score, anchor: k, focus: t, at: G.t, title: k.name, sub: why.length ? why.join(' · ') : `${k.name} eliminated ${t.name}`, victim: t.name };
}
// The match is over: take a highlight that's still waiting for its last second and a half
function replayFlush() {
  const P = REPLAY.pending;
  if (!P) return;
  REPLAY.pending = null;
  if (!REPLAY.best || P.score >= REPLAY.best.score) REPLAY.best = { ...P, frames: REPLAY.buf.filter(b => b.t >= P.at - 5.5) };
}
const pomReady = () => !!(REPLAY.best && REPLAY.best.frames.length >= 20);

// Returns false when there isn't enough footage to show. `clip` is REPLAY.death or REPLAY.best.
function replayStart(clip, done) {
  const b = clip && clip.frames;
  if (!b || b.length < 20) return false;
  const t1 = b[b.length - 1].t;
  Object.assign(REPLAY, { clip, t0: b[0].t, t1, hold: 0, onDone: done, cam: null, view: null });
  REPLAY.t = Math.max(REPLAY.t0, clip === REPLAY.death ? t1 - RP_LEN : clip.at - 3.2); // a highlight starts a few seconds before the kill
  REPLAY.start = REPLAY.t;
  return true;
}
function replayFinish() {
  REPLAY.view = null; REPLAY.clip = null;
  const d = REPLAY.onDone; REPLAY.onDone = null;
  if (d) d();
}
// Real time -> replay time: normal speed, and slow motion around the moment that matters
function replayStep(dt) {
  const R = REPLAY, death = R.clip === R.death, at = R.clip ? R.clip.at : R.t1;
  const slow = death ? R.t1 - R.t < 1.1 : Math.abs(at - R.t) < 0.45;
  if (R.t < R.t1) R.t = Math.min(R.t1, R.t + dt * (slow ? (death ? 0.35 : 0.4) : 1));
  else if ((R.hold += dt) > (death ? 1.3 : 0.9)) { replayFinish(); return; }
  $('#rp-prog').style.width = `${Math.min(100, (R.t - R.start) / Math.max(0.1, R.t1 - R.start) * 100)}%`;
}

function replayApply(dt) {
  const R = REPLAY, b = R.clip.frames;
  let i = 0;
  while (i < b.length - 2 && b[i + 1].t <= R.t) i++;
  const A = b[i], Bf = b[Math.min(i + 1, b.length - 1)], k = Bf.t > A.t ? clamp((R.t - A.t) / (Bf.t - A.t), 0, 1) : 0;
  const next = new Map(Bf.fs), shown = new Set();
  R.saved = { fighters: G.fighters.map(f => [f, RP_F.map(n => f[n]), f.alive]), bikes: (G.bikes || []).map(k => [k, RP_K.map(n => k[n])]), helis: (G.helis || []).map(h => [h, RP_H.map(n => h[n])]), proj: G.proj, fx: G.fx };
  const nk = new Map(Bf.ks || []);
  for (const [bk, va] of A.ks || []) {
    const vb = nk.get(bk) || va;
    RP_K.forEach((n, q) => { let v = va[q]; if (typeof v === 'number' && typeof vb[q] === 'number') v = n === 'face' ? v + angDiff(v, vb[q]) * k : v + (vb[q] - v) * k; bk[n] = v; });
  }
  const nh = new Map(Bf.hs || []);
  for (const [hh, va] of A.hs || []) {
    const vb = nh.get(hh) || va;
    RP_H.forEach((n, q) => { let v = va[q]; if (typeof v === 'number' && typeof vb[q] === 'number') v = n === 'face' ? v + angDiff(v, vb[q]) * k : v + (vb[q] - v) * k; hh[n] = v; });
  }
  for (const [f, va] of A.fs) {
    const vb = next.get(f) || va;
    RP_F.forEach((n, q) => {
      let v = va[q];
      if (typeof v === 'number' && typeof vb[q] === 'number') v = n === 'face' ? v + angDiff(v, vb[q]) * k : v + (vb[q] - v) * k;
      f[n] = v;
    });
    f.alive = true; shown.add(f);
  }
  for (const f of G.fighters) if (!shown.has(f)) f.alive = false; // only people who were there
  G.proj = A.ps.map(([p, x, y, z, vx, vy, vz]) => {
    let q = R.proxies.get(p);
    if (!q) { q = { kind: p.kind, owner: p.owner, layer: p.layer }; R.proxies.set(p, q); }
    const s = R.t - A.t;
    return Object.assign(q, { x: x + vx * s, y: y + vy * s, z: z + vz * s, vx, vy, vz });
  });
  G.fx = [];

  // Camera: over the shoulder of the anchor (your killer, or whoever made the play) looking at the focus
  // (you, or who they got); once the focus is gone, or with no anchor, a slow orbit
  const C = R.clip, K0 = C.anchor && shown.has(C.anchor) ? C.anchor : null;
  const v = C.focus && shown.has(C.focus) ? C.focus : K0 || C.focus, K = K0 && K0 !== v ? K0 : null;
  const tx = v.x, ty = v.y, tz = v.z + 34 * (v.size || 1);
  let cx, cy, cz, fov = 62;
  if (K) {
    let dx = v.x - K.x, dy = v.y - K.y, d = hyp(dx, dy);
    if (d < 1) { dx = Math.cos(K.face); dy = Math.sin(K.face); d = 1; } else { dx /= d; dy /= d; }
    const s = K.size || 1;
    cx = K.x - dx * 70 * s - dy * 44 * s; cy = K.y - dy * 70 * s + dx * 44 * s; cz = K.z + 90 * s;
    fov = clamp(64 - (d - 200) / 22, 30, 64); // zoom in on long shots
  } else {
    const a = R.t * 0.5;
    cx = v.x + Math.cos(a) * 170; cy = v.y + Math.sin(a) * 170; cz = v.z + 95;
  }
  cz = v.layer ? Math.min(cz, 100) : Math.max(cz, heightAt(cx, cy) + 20);
  if (!R.cam) R.cam = { x: cx, y: cy, z: cz, fov };
  const m = 1 - Math.exp(-7 * dt);
  R.cam.x += (cx - R.cam.x) * m; R.cam.y += (cy - R.cam.y) * m; R.cam.z += (cz - R.cam.z) * m; R.cam.fov += (fov - R.cam.fov) * m;
  R.view = { focus: v, x: R.cam.x, y: R.cam.y, z: R.cam.z, tx, ty, tz, fov: R.cam.fov };
}
function replayRestore() {
  const s = REPLAY.saved;
  if (!s) return;
  for (const [f, vals, alive] of s.fighters) { RP_F.forEach((n, q) => { f[n] = vals[q]; }); f.alive = alive; }
  for (const [k, vals] of s.bikes) RP_K.forEach((n, q) => { k[n] = vals[q]; });
  for (const [h, vals] of s.helis) RP_H.forEach((n, q) => { h[n] = vals[q]; });
  G.proj = s.proj; G.fx = s.fx; REPLAY.saved = null;
}
const replayReady = () => !!(REPLAY.death && REPLAY.death.frames.length >= 20);
