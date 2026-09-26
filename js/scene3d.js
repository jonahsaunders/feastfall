'use strict';
// Static 3D world: renderer, lights, low-poly terrain, instanced trees/rocks, tunnels.
// The simulation runs on a flat (x, y) plane; here sim y maps to three.js z and height comes from heightAt().
const T = THREE;
const cv = document.getElementById('game');
const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new T.Scene();
const camera = new T.PerspectiveCamera(75, 1, 1.5, 4000);
camera.rotation.order = 'YXZ';
const vmScene = new T.Scene(), vmCam = new T.PerspectiveCamera(60, 1, 0.5, 300);
const VIEW = { pitch: -0.05, fov: 75 };
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = vmCam.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const SKY = new T.Color('#aebfc0');
scene.background = SKY.clone();
scene.fog = new T.Fog(SKY.clone(), 500, 2000);
const hemi = new T.HemisphereLight(0xeef2ff, 0x4a4630, 0.8); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff0d8, 0.8);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008;
Object.assign(sun.shadow.camera, { left: -550, right: 550, top: 550, bottom: -550, near: 10, far: 2200 });
scene.add(sun, sun.target);
const torch = new T.PointLight(0xffc27a, 0, 560, 1.2); scene.add(torch);
vmScene.add(new T.HemisphereLight(0xffffff, 0x555544, 0.9));
const vmSun = new T.DirectionalLight(0xffffff, 0.55); vmSun.position.set(1, 2, 1.5); vmScene.add(vmSun);

const lam = (c, o = {}) => new T.MeshLambertMaterial({ color: c, ...o });
const hsl = (h, s, l) => new T.Color().setHSL(h / 360, s / 100, l / 100);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function heightAt(x, y) {
  const u = clamp(x / WORLD, 0, 1), v = clamp(y / WORLD, 0, 1);
  const a = world.n1(u, v), b = world.n2(u, v);
  let h = (a - .5) * 46 + (b - .5) * 18;
  const w = (a - .5) * 0.16 + (b - .5) * 0.06;
  h += smooth(0.34, 0.16, v + w) * (30 + b * 230);              // mountains to the north
  h += smooth(0.62, 0.74, u + w) * Math.sin(x / 150 + a * 7) * 13; // dunes to the east
  for (const s of SWAMPS) {
    const d = hyp(x - s.x, y - s.y) / s.r;
    if (d < 1.25) h += (-7 + (b - .5) * 14 - h) * smooth(1.25, 0.8, d);
  }
  const dp = hyp(x - PIT.x, y - PIT.y) / PIT.r;
  if (dp < 1.3) h += (-34 - h) * smooth(1.3, 1.0, dp);
  return h;
}
const groundY = f => f.layer ? 0 : heightAt(f.x, f.y);

// Shared geometry, pivot at the base where it matters
const GEO = {
  trunk: new T.CylinderGeometry(3.5, 5.5, 60, 5).translate(0, 30, 0),
  crown: new T.IcosahedronGeometry(34, 0),
  cone: new T.ConeGeometry(30, 90, 7).translate(0, 45, 0),
  cactus: new T.CylinderGeometry(7, 8, 60, 7).translate(0, 30, 0),
  rock: new T.DodecahedronGeometry(1, 0),
  boulder: new T.IcosahedronGeometry(1, 0),
  crystal: new T.OctahedronGeometry(4, 0),
  reed: new T.ConeGeometry(2.2, 44, 4).translate(0, 22, 0),
};
const SHARED = new Set(Object.values(GEO));
const WHITE = lam(0xffffff);
const dummy = new T.Object3D();
function setInst(mesh, i, s, k = 1, ky = k) {
  dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(s.rx || 0, s.ry || 0, 0);
  dummy.scale.set(Math.max(1e-4, s.sx * k), Math.max(1e-4, s.sy * ky), Math.max(1e-4, s.sz * k));
  dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
}

let surfaceGroup = null, underGroup = null, builtWorld = null;
function makeInstanced(group, specs, cast = true) {
  for (const [key, list] of Object.entries(specs)) {
    const geo = GEO[key.split(':')[0]];
    const mat = key.endsWith(':glow') ? lam(0xffffff, { emissive: 0x7a3000 }) : WHITE;
    const mesh = new T.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      setInst(mesh, i, p.s);
      mesh.setColorAt(i, p.c);
      if (p.o) (p.o.parts = p.o.parts || []).push({ mesh, i, s: p.s, role: p.role });
    });
    mesh.castShadow = cast; mesh.receiveShadow = true;
    group.add(mesh);
  }
}
function syncObjParts(o) {
  for (const p of o.parts || []) {
    let k = 1, ky;
    if (o.kind === 'rock') k = o.amt > 0 ? 0.5 + 0.5 * o.amt / 5 : 0;
    else if (o.kind === 'ore') k = p.role >= 0 ? (o.amt > p.role ? 1 : 0) : 0.6 + 0.4 * o.amt / 3;
    else if (o.amt <= 0) { if (p.role === 'trunk') { k = 1; ky = 0.16; } else k = 0; }
    setInst(p.mesh, p.i, p.s, k, ky ?? k);
    p.mesh.instanceMatrix.needsUpdate = true;
  }
  o._amt = o.amt;
}

function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
    if (o.material && o.material !== WHITE) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

function build3D() {
  if (surfaceGroup) { scene.remove(surfaceGroup, underGroup); disposeGroup(surfaceGroup); disposeGroup(underGroup); }
  surfaceGroup = new T.Group(); underGroup = new T.Group();
  scene.add(surfaceGroup, underGroup);
  builtWorld = world;

  // --- terrain: jittered triangle mesh, flat-shaded, coloured per face ---
  const step = 40, n = WORLD / step, V = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const edge = i === 0 || j === 0 || i === n || j === n;
    const x = i * step + (edge ? 0 : rr(-13, 13)), y = j * step + (edge ? 0 : rr(-13, 13));
    V.push([x, heightAt(x, y), y]);
  }
  const pos = [], col = [];
  const va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3();
  function tri(a, b, c) {
    va.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); vb.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    vc.crossVectors(va, vb);
    if (vc.y < 0) { [b, c] = [c, b]; vc.negate(); }
    vc.normalize();
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
    const bi = biomeAt(cx, cz), steep = vc.y < 0.82, jit = rr(-2.5, 2.5);
    let color;
    if (hyp(cx - PIT.x, cz - PIT.y) < PIT.r * 1.02) color = hsl(30, 8, 36 + jit);
    else if (bi === 2) color = steep || cy < 40 ? hsl(215, 7, 44 + jit) : hsl(205, 18, 88 + jit);
    else if (bi === 1) color = hsl(38, 40, 50 + jit);
    else if (bi === 3) color = cy < -6 ? hsl(170, 25, 18) : hsl(95, 22, 26 + jit);
    else color = steep ? hsl(90, 18, 30 + jit) : hsl(100 + world.n2(cx / WORLD, cz / WORLD) * 20, 34, 29 + jit);
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = V[j * (n + 1) + i], b = V[j * (n + 1) + i + 1], d = V[(j + 1) * (n + 1) + i], e = V[(j + 1) * (n + 1) + i + 1];
    if ((i + j) % 2) { tri(a, b, e); tri(a, e, d); } else { tri(a, b, d); tri(b, e, d); }
  }
  const tg = new T.BufferGeometry();
  tg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  tg.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  tg.computeVertexNormals();
  const terrain = new T.Mesh(tg, lam(0xffffff, { vertexColors: true }));
  terrain.receiveShadow = true;
  surfaceGroup.add(terrain);
  // outer ground so the map edge is not a cliff into the sky
  const outer = new T.Mesh(new T.PlaneGeometry(WORLD * 3, WORLD * 3).rotateX(-Math.PI / 2), lam('#27351f'));
  outer.position.set(WORLD / 2, -40, WORLD / 2); surfaceGroup.add(outer);
  // swamp water
  for (const s of SWAMPS) {
    const w = new T.Mesh(new T.CircleGeometry(s.r * 1.15, 28).rotateX(-Math.PI / 2), lam('#2c4a45', { transparent: true, opacity: 0.78 }));
    w.position.set(s.x, -3, s.y); surfaceGroup.add(w);
  }

  // --- trees, cacti, rocks ---
  const specs = {};
  const add = (key, o, s, c, role) => (specs[key] = specs[key] || []).push({ o, s, c, role });
  for (const o of world.objs) {
    const g = heightAt(o.x, o.y), sd = o.seed, ry = sd * 6.28;
    if (o.kind === 'reed') {
      for (let q = 0; q < 4; q++) {
        const a = ry + q * 1.7, rd = 3 + q * 2.2;
        add('reed', o, { x: o.x + Math.cos(a) * rd, y: g - 4, z: o.y + Math.sin(a) * rd, sx: 1, sy: 0.7 + ((sd * 7 + q) % 1) * 0.6, sz: 1, ry: a, rx: (q - 1.5) * 0.12 }, hsl(52 + q * 8, 38, 40 + q * 4));
      }
      continue;
    }
    if (o.kind === 'rock') {
      const c = o.style === 2 ? hsl(210, 6, 62) : o.style === 1 ? hsl(32, 24, 56) : hsl(100, 4, 46);
      add('rock', o, { x: o.x, y: g + o.r * 0.25, z: o.y, sx: o.r * 1.3, sy: o.r * 0.95, sz: o.r * 1.15, ry }, c.offsetHSL(0, 0, rr(-.04, .04)));
      if (o.style === 2) add('rock', o, { x: o.x - 3, y: g + o.r * 0.95, z: o.y + 2, sx: o.r * 0.8, sy: o.r * 0.35, sz: o.r * 0.7, ry }, hsl(205, 20, 93));
      continue;
    }
    if (o.style === 1) {
      const c = hsl(95, 35, 33 + sd * 6), sy = 0.8 + sd * 0.5;
      add('cactus', o, { x: o.x, y: g, z: o.y, sx: 1, sy, sz: 1, ry }, c, 'trunk');
      add('cactus', o, { x: o.x + 9 * Math.cos(ry), y: g + 22 * sy, z: o.y + 9 * Math.sin(ry), sx: 0.6, sy: 0.38, sz: 0.6, ry }, c);
    } else if (o.style === 2) {
      const s = 0.9 + sd * 0.45;
      add('trunk', o, { x: o.x, y: g, z: o.y, sx: 1, sy: 0.6, sz: 1, ry }, hsl(25, 30, 24), 'trunk');
      add('cone', o, { x: o.x, y: g + 22, z: o.y, sx: s, sy: s, sz: s, ry }, hsl(155, 26, 22 + sd * 5));
      add('cone', o, { x: o.x, y: g + 22 + 55 * s, z: o.y, sx: s * 0.68, sy: s * 0.7, sz: s * 0.68, ry }, hsl(155, 24, 25 + sd * 5));
      add('cone', o, { x: o.x, y: g + 22 + 92 * s, z: o.y, sx: s * 0.33, sy: s * 0.35, sz: s * 0.33, ry }, hsl(205, 25, 94));
    } else {
      const swamp = o.style === 3, tall = 1 + sd * 0.4;
      add('trunk', o, { x: o.x, y: g, z: o.y, sx: 1, sy: swamp ? 1.5 : tall, sz: 1, ry }, swamp ? hsl(30, 14, 18) : hsl(25, 35, 27), 'trunk');
      const s = swamp ? 0.6 : 0.85 + sd * 0.5, top = g + (swamp ? 90 : 60 * tall) + 14;
      const c = swamp ? hsl(70, 22, 24) : hsl(98 + sd * 28, 40, 28 + sd * 7);
      add('crown', o, { x: o.x, y: top, z: o.y, sx: s, sy: s * 0.85, sz: s, ry }, c);
      if (!swamp) add('crown', o, { x: o.x + 14 * Math.cos(ry), y: top + 20, z: o.y + 14 * Math.sin(ry), sx: s * 0.6, sy: s * 0.55, sz: s * 0.6, ry: ry + 1 }, c.clone().offsetHSL(0, 0, .05));
    }
  }
  // Pit rim boulders
  for (let k = 0; k < 44; k++) {
    const a = k / 44 * 6.28, R = PIT.r + 14;
    add('rock', null, { x: PIT.x + Math.cos(a) * R, y: heightAt(PIT.x + Math.cos(a) * R, PIT.y + Math.sin(a) * R) + 4, z: PIT.y + Math.sin(a) * R, sx: 22, sy: 18 + (k % 3) * 6, sz: 20, ry: a }, hsl(30, 6, 34 + (k % 4) * 3));
  }
  makeInstanced(surfaceGroup, specs);
  world.objs.forEach(o => { o._amt = o.amt; });

  // Tunnel entrances on the surface: a hole under a wooden A-frame
  const wood = lam('#6b4a2e'), black = new T.MeshBasicMaterial({ color: 0x050403 });
  for (const e of world.entrances) {
    const g = heightAt(e.x, e.y), grp = new T.Group();
    grp.position.set(e.x, g, e.y); grp.rotation.y = rr(0, 6.28);
    const hole = new T.Mesh(new T.CircleGeometry(21, 9).rotateX(-Math.PI / 2), black); hole.position.y = 1.2; grp.add(hole);
    for (const s of [-1, 1]) { const p = new T.Mesh(new T.BoxGeometry(4, 62, 4), wood); p.position.set(0, 31, s * 24); p.castShadow = true; grp.add(p); }
    const bar = new T.Mesh(new T.BoxGeometry(4, 4, 56), wood); bar.position.y = 62; grp.add(bar);
    const rope = new T.Mesh(new T.BoxGeometry(1, 50, 1), lam('#c9b48a')); rope.position.y = 37; grp.add(rope);
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * 6.28, r = new T.Mesh(GEO.rock, lam('#6c665c'));
      r.scale.set(9, 6, 8); r.position.set(Math.cos(a) * 25, 2, Math.sin(a) * 25); grp.add(r);
    }
    surfaceGroup.add(grp);
  }

  // --- underground: floor strips, boulder walls, ore, light shafts ---
  const floorMat = lam('#4b3a2d');
  for (const s of world.segs) {
    const L = hyp(s.bx - s.ax, s.by - s.ay);
    const m = new T.Mesh(new T.PlaneGeometry(L, TUN_R * 2).rotateX(-Math.PI / 2), floorMat);
    m.position.set((s.ax + s.bx) / 2, 0, (s.ay + s.by) / 2); m.rotation.y = -Math.atan2(s.by - s.ay, s.bx - s.ax);
    m.receiveShadow = true; underGroup.add(m);
  }
  for (const nd of world.nodes) {
    const m = new T.Mesh(new T.CircleGeometry(TUN_R, 12).rotateX(-Math.PI / 2), floorMat);
    m.position.set(nd.x, 0.05, nd.y); underGroup.add(m);
  }
  const uspec = {};
  const uadd = (key, o, s, c, role) => (uspec[key] = uspec[key] || []).push({ o, s, c, role });
  for (const s of world.segs) {
    const L = hyp(s.bx - s.ax, s.by - s.ay), nx = -(s.by - s.ay) / L, ny = (s.bx - s.ax) / L;
    for (let d = 0; d < L; d += 30) for (const side of [-1, 1]) {
      const t = d / L, off = TUN_R + 16 + rr(0, 10);
      const x = s.ax + (s.bx - s.ax) * t + nx * off * side, y = s.ay + (s.by - s.ay) * t + ny * off * side;
      if (walkUnder(x, y, -6)) continue;
      const r = rr(18, 28);
      uadd('boulder', null, { x, y: rr(10, 40), z: y, sx: r, sy: r * rr(2.2, 3.2), sz: r, ry: rr(0, 6) }, hsl(24, rr(8, 16), rr(16, 24)));
    }
  }
  for (const o of world.ores) {
    const ry = rr(0, 6);
    uadd('rock', o, { x: o.x, y: 10, z: o.y, sx: 16, sy: 14, sz: 16, ry }, hsl(25, 8, 30), -1);
    for (let k = 0; k < 3; k++)
      uadd('crystal:glow', o, { x: o.x + Math.cos(ry + k * 2.1) * 9, y: 16 + k * 5, z: o.y + Math.sin(ry + k * 2.1) * 9, sx: 1, sy: 1.8, sz: 1, ry: k }, hsl(24, 80, 55), k);
  }
  makeInstanced(underGroup, uspec, false);
  world.ores.forEach(o => { o._amt = o.amt; });
  const ceil = new T.Mesh(new T.PlaneGeometry(WORLD, WORLD).rotateX(Math.PI / 2), lam('#120e0b'));
  ceil.position.set(WORLD / 2, 115, WORLD / 2); underGroup.add(ceil);
  const shaftMat = new T.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false });
  for (const e of world.entrances) {
    const sh = new T.Mesh(new T.CylinderGeometry(24, 30, 115, 9, 1, true), shaftMat); sh.position.set(e.x, 57, e.y); underGroup.add(sh);
    const pool = new T.Mesh(new T.CircleGeometry(40, 12).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x8a6a40, transparent: true, opacity: 0.5 }));
    pool.position.set(e.x, 0.2, e.y); underGroup.add(pool);
    for (const s of [-1, 1]) { const r = new T.Mesh(new T.BoxGeometry(2.5, 115, 2.5), wood); r.position.set(e.x + s * 8, 57, e.y); underGroup.add(r); }
    for (let k = 0; k < 9; k++) { const r = new T.Mesh(new T.BoxGeometry(18, 2, 2), wood); r.position.set(e.x, 8 + k * 12, e.y); underGroup.add(r); }
  }
}
