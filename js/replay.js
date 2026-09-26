'use strict';
// Death replay: the last few seconds before you died, filmed over your killer's shoulder.
// While you're alive, nearby fighters and projectiles are recorded 30 times a second. Playback
// swaps the recorded values into the live objects just for the render, then puts them back,
// so an online match keeps running underneath.
const REPLAY = { buf: [], acc: 0, t: 0, t0: 0, t1: 0, hold: 0, killer: null, view: null, cam: null, saved: null, proxies: new Map(), onDone: null };
const RP_KEEP = 6, RP_HZ = 30, RP_LEN = 5;
const RP_F = ['x', 'y', 'z', 'face', 'hp', 'swingT', 'hurtT', 'mx', 'my', 'sneak', 'hidden', 'disguise', 'size', 'layer', 'invuln', 'punchT', 'charge', 'burnT', 'burnNet', 'gather', 'bike', 'pitT', 'pitNet'];
const RP_K = ['x', 'y', 'z', 'face', 'speed', 'steer', 'air', 'vz', 'wheel', 'gone']; // motorcycles

function replayReset() { REPLAY.buf = []; REPLAY.acc = 0; REPLAY.proxies.clear(); }

function replayRecord(dt) {
  const h = G.human;
  if (!h || !h.isFighter || !h.alive) return;
  REPLAY.acc += dt;
  if (REPLAY.acc < 1 / RP_HZ) return;
  REPLAY.acc = 0;
  const fs = [];
  for (const f of G.fighters) {
    if (!f.alive) continue;
    if (f !== h && f !== h.lastHitBy && (f.layer !== h.layer || hyp(f.x - h.x, f.y - h.y) > 1100)) continue;
    fs.push([f, RP_F.map(k => f[k])]);
  }
  const ks = (G.bikes || []).filter(k => hyp(k.x - h.x, k.y - h.y) < 1300).map(k => [k, RP_K.map(n => k[n])]);
  REPLAY.buf.push({ t: G.t, fs, ks, ps: G.proj.map(p => [p, p.x, p.y, p.z, p.vx, p.vy, p.vz]) });
  while (REPLAY.buf.length && REPLAY.buf[0].t < G.t - RP_KEEP) REPLAY.buf.shift();
}

// Returns false when there isn't enough footage to show
function replayStart(killer, done) {
  const b = REPLAY.buf;
  if (b.length < 20) return false;
  Object.assign(REPLAY, { t0: b[0].t, t1: b[b.length - 1].t, hold: 0, killer, onDone: done, cam: null, view: null });
  REPLAY.t = Math.max(REPLAY.t0, REPLAY.t1 - RP_LEN);
  return true;
}
function replayFinish() {
  REPLAY.view = null;
  const d = REPLAY.onDone; REPLAY.onDone = null;
  if (d) d();
}
// Real time -> replay time: normal speed, then slow motion for the last second
function replayStep(dt) {
  const R = REPLAY;
  if (R.t < R.t1) R.t = Math.min(R.t1, R.t + dt * (R.t1 - R.t < 1.1 ? 0.35 : 1));
  else if ((R.hold += dt) > 1.3) { replayFinish(); return; }
  $('#rp-prog').style.width = `${Math.min(100, (R.t - Math.max(R.t0, R.t1 - RP_LEN)) / Math.min(RP_LEN, R.t1 - R.t0) * 100)}%`;
}

function replayApply(dt) {
  const R = REPLAY, b = R.buf;
  let i = 0;
  while (i < b.length - 2 && b[i + 1].t <= R.t) i++;
  const A = b[i], Bf = b[Math.min(i + 1, b.length - 1)], k = Bf.t > A.t ? clamp((R.t - A.t) / (Bf.t - A.t), 0, 1) : 0;
  const next = new Map(Bf.fs), shown = new Set();
  R.saved = { fighters: G.fighters.map(f => [f, RP_F.map(n => f[n]), f.alive]), bikes: (G.bikes || []).map(k => [k, RP_K.map(n => k[n])]), proj: G.proj, fx: G.fx };
  const nk = new Map(Bf.ks || []);
  for (const [bk, va] of A.ks || []) {
    const vb = nk.get(bk) || va;
    RP_K.forEach((n, q) => { let v = va[q]; if (typeof v === 'number' && typeof vb[q] === 'number') v = n === 'face' ? v + angDiff(v, vb[q]) * k : v + (vb[q] - v) * k; bk[n] = v; });
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

  // Camera: over the killer's shoulder, looking at you; with no killer, a slow orbit around you
  const v = G.human, K = R.killer && shown.has(R.killer) && R.killer !== v ? R.killer : null;
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
  G.proj = s.proj; G.fx = s.fx; REPLAY.saved = null;
}
const replayReady = () => REPLAY.buf.length >= 20;
