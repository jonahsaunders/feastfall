'use strict';
// Throwable, non-damaging knockback. Only the thrower's machine decides who the burst reaches.
const SHOCK = { radius: 110, speed: 480, gravity: 650, horizontal: 620, up: 520, life: 2, cooldown: 0.65 };

function throwShockbomb(f, pitch = 0) {
  if (!f.alive || f.remote || f.bike || f.heli || f.shockCd > G.t || !take(f, 'shockbomb', 1)) return false;
  const c = Math.cos(pitch);
  f.shockCd = G.t + SHOCK.cooldown; f.swingT = 0.14; f.hidden = false; f.charge = -1;
  spawnProj({ kind: 'shockbomb', x: f.x, y: f.y, z: f.z + 46 * (f.size || 1),
    vx: Math.cos(f.face) * SHOCK.speed * c, vy: Math.sin(f.face) * SHOCK.speed * c,
    vz: Math.sin(pitch) * SHOCK.speed + 110, owner: f, layer: f.layer, life: SHOCK.life });
  noise(f.x, f.y, f.layer, 300, f); Sfx.play('shoot', f.x, f.y, f.z);
  return true;
}

function botShockbomb(b, target) {
  const d = hyp(target.x - b.x, target.y - b.y);
  if (!pvpOn() || b.shockThinkT > G.t || d < 90 || d > 280 || Math.abs(target.z - b.z) > 100
    || target.kit === 'heavy' || isTitan(target) || !count(b, 'shockbomb') || !canSee(b, target)) return;
  const t = d / SHOCK.speed;
  const pitch = Math.atan2(target.z + 10 - b.z - 46 + SHOCK.gravity * t * t / 2 - 110 * t, d);
  if (throwShockbomb(b, pitch)) b.shockThinkT = G.t + 8;
}

function shockBlocked(x, y, z, layer) {
  return x < 0 || y < 0 || x > WORLD || y > WORLD || z <= floorAt(x, y, layer)
    || (layer && (!walkUnder(x, y, 2) || z >= TUN_H))
    || solidAt(Math.floor(x / B), lj(z, layer), Math.floor(y / B));
}
function shockVisible(p, f) {
  const dx = f.x - p.x, dy = f.y - p.y, dz = f.z + fh(f) / 2 - p.z, d = Math.hypot(dx, dy, dz);
  for (let t = 4; t < d; t += 4) if (shockBlocked(p.x + dx * t / d, p.y + dy * t / d, p.z + dz * t / d, p.layer)) return false;
  return true;
}
function applyShockHit(f, impulse, owner) {
  const self = f === owner;
  if (!owner || owner.layer !== f.layer || !f.alive || f.isClone || f.bike || f.heli || f.kit === 'heavy' || isTitan(f)
    || (!self && (!pvpOn() || f.invuln > 0 || allied(f, owner)))) return false;
  if (!Array.isArray(impulse) || impulse.length !== 3 || !impulse.every(Number.isFinite)) return false;
  const [a, kb, up] = impulse;
  f.kbx += Math.cos(a) * clamp(kb, 0, SHOCK.horizontal);
  f.kby += Math.sin(a) * clamp(kb, 0, SHOCK.horizontal);
  f.vz = Math.max(f.vz, clamp(up, 0, SHOCK.up));
  f.onGround = false; f.peakZ = Math.max(f.peakZ, f.z);
  f.gather = null; f.refillT = 0; f.hidden = false; f.hook = null;
  if (self) f.noFallT = Math.max(f.noFallT, 5);
  else if (owner) { f.lastHitBy = owner; f.lastHitT = G.t; }
  return true;
}
function shockFx(x, y, z, layer) {
  addFx('shockwave', x, y, layer, { z, col: '#78e5ff', t: 0.45 });
  addFx('ring', x, y, layer, { z, col: '#bdf4ff', big: true, t: 0.4 });
  Sfx.play('shockwave', x, y, z);
}
function burstShockbomb(p) {
  if (p.boomed) return;
  p.boomed = true;
  if (p.ghost || p.owner.remote) return;
  let hit = false;
  for (const f of G.fighters) {
    if (!f.alive || f.layer !== p.layer || f.isClone || f.bike || f.heli || f.kit === 'heavy' || isTitan(f)) continue;
    if (f !== p.owner && (!pvpOn() || f.invuln > 0 || allied(f, p.owner))) continue;
    const d = Math.hypot(f.x - p.x, f.y - p.y, f.z + fh(f) / 2 - p.z);
    if (d >= SHOCK.radius || !shockVisible(p, f)) continue;
    const force = 1 - d / SHOCK.radius * 0.55;
    const a = hyp(f.x - p.x, f.y - p.y) < 1 ? p.owner.face : Math.atan2(f.y - p.y, f.x - p.x);
    const impulse = [+a.toFixed(3), Math.round(SHOCK.horizontal * force), Math.round(SHOCK.up * force)];
    if (f.remote) { NET.hit(f, { shock: impulse, by: p.owner.id }); hit = hit || f !== p.owner; }
    else if (applyShockHit(f, impulse, p.owner) && f !== p.owner) hit = true;
  }
  if (hit && p.owner === G.human) hitMark();
  shockFx(p.x, p.y, p.z, p.layer);
  noise(p.x, p.y, p.layer, 900, p.owner);
  NET.fx({ k: 'shock', o: p.owner.id, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), l: p.layer });
}
function updateShockbomb(p, dt) {
  p.life -= dt; p.vz -= SHOCK.gravity * dt;
  // Short steps stop a fast throw from skipping thin walls or a fighter at low frame rates.
  const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) * dt / 6)), s = dt / steps;
  for (let i = 0; i < steps && p.life > 0; i++) {
    const x = p.x + p.vx * s, y = p.y + p.vy * s, z = p.z + p.vz * s;
    const tree = !p.layer && z < heightAt(x, y) + 90 && nearObjs(x, y, 30).some(o => o.amt > 0 && o.kind !== 'reed' && hyp(o.x - x, o.y - y) < o.r);
    if (shockBlocked(x, y, z, p.layer) || tree) { p.life = 0; break; } // burst on the free side of the wall
    p.x = x; p.y = y; p.z = z;
    if (G.fighters.some(f => f !== p.owner && f.alive && f.layer === p.layer && !allied(f, p.owner)
      && hyp(f.x - x, f.y - y) < f.r + 5 && z > f.z - 4 && z < f.z + fh(f) + 4)) p.life = 0;
  }
  if (p.life <= 0) burstShockbomb(p);
}
