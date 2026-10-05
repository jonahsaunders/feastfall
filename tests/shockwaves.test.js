'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Use the real inventory, collision grid, combat and projectile code on a flat test arena.
function arena() {
  const events = { hits: [], fx: [], sounds: [], marks: 0 };
  const context = vm.createContext({ console, events, Sfx: { play: (...a) => events.sounds.push(a) },
    NET: { on: false, isHost: () => true, hit: (f, m) => events.hits.push({ f, m }), fx: m => events.fx.push(m) },
    noise() {}, toast() {}, hitMark() { events.marks++; } });
  for (const file of ['world', 'blocks', 'items', 'entities', 'shockwaves', 'rifts', 'botmind']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file + '.js'), 'utf8'), context, { filename: file });
  }
  vm.runInContext(`
    heightAt = () => 0; nearObjs = () => []; walkUnder = () => true;
    biomeAt = () => 0; pushFromHelis = () => {}; liquidAt = () => null;
    G.t = 10; G.clockMin = 5; G.grace = 2; G.settings = { dmgNums: false };
    G.duels = []; G.graves = []; G.rifts = new Map(); G.noises = [];
    function fighter(id, x = 250, y = 250, kit = 'killer') {
      const f = new Fighter(id, kit, false, id); f.x = x; f.y = y; G.fighters.push(f); return f;
    }
    function bomb(owner, x = owner.x, y = owner.y, z = 3, layer = owner.layer) {
      return { kind: 'shockbomb', owner, x, y, z, layer, life: 2, vx: 0, vy: 0, vz: 0 };
    }
  `, context);
  return { events, run: code => vm.runInContext(code, context) };
}

test('crafting makes two bombs; throwing consumes one and prevents rapid reuse', () => {
  const { run, events } = arena();
  run(`const f = fighter('me'); give(f, 'stone', 3); give(f, 'reed', 2); craft(f, recipe('shockbomb'));`);
  assert.equal(run(`count(f, 'shockbomb')`), 2);
  assert.equal(run(`throwShockbomb(f, -1)`), true);
  assert.equal(run(`throwShockbomb(f, -1)`), false);
  assert.equal(run(`count(f, 'shockbomb')`), 1);
  assert.equal(run(`G.proj.length`), 1);
  assert.equal(events.fx[0].t, 'shockbomb');
  run(`G.t += 1; f.bike = {};`);
  assert.equal(run(`throwShockbomb(f)`), false);
  assert.equal(run(`count(f, 'shockbomb')`), 1);
});

test('a burst launches nearby fighters without losing health; self-launch protects the fall', () => {
  const { run } = arena();
  run(`const owner = fighter('me'); const enemy = fighter('enemy', 300); const far = fighter('far', 500);
    G.human = owner; burstShockbomb(bomb(owner));`);
  assert.equal(run(`owner.hp`), 20);
  assert.equal(run(`enemy.hp`), 20);
  assert.ok(run(`owner.vz > 0 && enemy.vz > 0 && !enemy.onGround`));
  assert.ok(run(`enemy.kbx > 0 && enemy.lastHitBy === owner`));
  assert.equal(run(`far.onGround`), true);
  assert.equal(run(`owner.noFallT`), 5);
  assert.equal(run(`enemy.noFallT`), 0);
  run(`land(owner, 200, 'plank')`);
  assert.equal(run(`owner.hp`), 20);
});

test('grace period, allies, invulnerability, Heavy, Titan, vehicles and other layers are respected', () => {
  const { run } = arena();
  run(`const owner = fighter('me'); const enemy = fighter('enemy', 290);
    const mate = fighter('mate', 280); owner.squad = mate.squad = 's1'; G.duo = true;
    const heavy = fighter('heavy', 280, 260, 'heavy'); const titan = fighter('titan', 280, 240); titan.size = 2.2;
    const inv = fighter('inv', 270, 280); inv.invuln = 1;
    const rider = fighter('rider', 260, 280); rider.bike = {};
    const under = fighter('under', 270, 270); under.layer = 1;
    G.clockMin = 0; burstShockbomb(bomb(owner));`);
  assert.equal(run(`[enemy, mate, heavy, titan, inv, rider, under].every(f => f.onGround)`), true);
  assert.equal(run(`owner.onGround`), false);
  run(`G.clockMin = 5; burstShockbomb(bomb(owner));`);
  assert.equal(run(`enemy.onGround`), false);
  assert.equal(run(`[mate, heavy, titan, inv, rider, under].every(f => f.onGround)`), true);
});

test('a solid wall blocks a wave without being destroyed', () => {
  const { run } = arena();
  run(`const owner = fighter('me', 225); const enemy = fighter('enemy', 290);
    setB(10, 0, 10, 'cobble'); setB(10, 1, 10, 'cobble'); setB(10, 2, 10, 'cobble');
    burstShockbomb(bomb(owner, 240, 260, 12));`);
  assert.equal(run(`enemy.onGround`), true);
  assert.equal(run(`BL.map.size`), 3);
});

test('one remote impulse is delivered and ghost projectiles never apply a second blast', () => {
  const { run, events } = arena();
  run(`const owner = fighter('me', 100); const remote = fighter('remote', 300); remote.remote = true;
    const p = bomb(owner, 280, 250, 20); burstShockbomb(p); burstShockbomb(p);
    const ghost = bomb(owner, 280, 250, 20); ghost.ghost = true; burstShockbomb(ghost);`);
  assert.equal(events.hits.length, 1);
  assert.equal(events.fx.filter(e => e.k === 'shock').length, 1);
  assert.equal(run(`remote.onGround`), true);
  run(`remote.remote = false; applyHit(remote, events.hits[0].m)`);
  assert.ok(run(`remote.vz > 0 && remote.lastHitBy === owner`));
  assert.equal(run(`remote.hp`), 20);
  assert.equal(run(`remote.noFallT`), 0);
});

test('fast projectiles hit thin walls and burst exactly once on the free side', () => {
  const { run, events } = arena();
  run(`const owner = fighter('me', 100); setB(10, 1, 10, 'plank');
    const p = bomb(owner, 220, 260, 40); p.vx = 480; p.vz = 65; G.proj.push(p); updateProj(0.1);`);
  assert.equal(run(`G.proj.length`), 0);
  assert.ok(run(`p.x < 250`));
  assert.equal(events.fx.filter(e => e.k === 'shock').length, 1);
  assert.equal(run(`BL.map.size`), 1);
});

test('ground impacts and an expired fuse both remove projectiles', () => {
  const { run, events } = arena();
  run(`const owner = fighter('me', 100); const ground = bomb(owner, 300, 250, 3); ground.vz = -300;
    const fuse = bomb(owner, 600, 250, 300); fuse.life = 0.01; G.proj.push(ground, fuse); updateProj(0.02);`);
  assert.equal(run(`G.proj.length`), 0);
  assert.equal(events.fx.filter(e => e.k === 'shock').length, 2);
});

test('self-launch follows the real fighter physics and lands safely; protection expires', () => {
  const { run } = arena();
  run(`const owner = fighter('me'); G.human = owner; burstShockbomb(bomb(owner));
    for (let i = 0; i < 180; i++) { G.t += 1/60; updateFighter(owner, 1/60); }`);
  assert.equal(run(`owner.onGround`), true);
  assert.equal(run(`owner.hp`), 20);
  assert.ok(run(`owner.x > 250`));
  run(`for (let i = 0; i < 180; i++) updateFighter(owner, 1/60); land(owner, 200, 'plank');`);
  assert.ok(run(`owner.hp < 20`));
});

test('bots throw at a visible fighter and wait before using another bomb', () => {
  const { run } = arena();
  run(`const bot = fighter('bot', 100); const target = fighter('enemy', 280);
    give(bot, 'shockbomb', 2); botShockbomb(bot, target); botShockbomb(bot, target);`);
  assert.equal(run(`count(bot, 'shockbomb')`), 1);
  run(`for (let i = 0; i < 120; i++) updateProj(1/60);`);
  assert.ok(run(`target.vz > 0 && !target.onGround`));
  assert.equal(run(`target.hp`), 20);
});

test('a tunnel ceiling stops a throw and remote impulses reject invalid values', () => {
  const { run } = arena();
  run(`const owner = fighter('me'); owner.layer = 1; const p = bomb(owner, 250, 250, 100, 1);
    p.vz = 400; G.proj.push(p); updateProj(0.05);`);
  assert.equal(run(`G.proj.length`), 0);
  assert.ok(run(`p.z < TUN_H`));
  run(`const target = fighter('enemy', 300); target.layer = 1;`);
  assert.equal(run(`applyShockHit(target, [0, NaN, 400], owner)`), false);
  assert.equal(run(`target.onGround`), true);
});
