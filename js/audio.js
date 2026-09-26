'use strict';
// Sound: a quiet generative ambient bed that changes with where you are, plus small positional effects.
// Everything is synthesised with Web Audio, so there are no files to load.
const Sfx = (() => {
  let ac = null, master, noiseBuf, pad, padGain, wind, windGain, windFilter, cave, caveGain, dripT = 0, chordT = 0, chordI = 0;
  let vol = 0.6;
  const CHORDS = [[110, 130.81, 164.81], [87.31, 110, 130.81], [130.81, 164.81, 196], [98, 123.47, 146.83]];

  function start() {
    if (ac) { ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; return; }
    master = ac.createGain(); master.gain.value = vol; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Pad: three soft triangle voices through a slowly breathing low-pass
    padGain = ac.createGain(); padGain.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.7;
    const lfo = ac.createOscillator(), lfoG = ac.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 260;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    pad = CHORDS[0].map(f => { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = Math.random() * 10 - 5; o.connect(lp); o.start(); return o; });
    lp.connect(padGain); padGain.connect(master);
    // Wind: looping noise through a wandering band-pass
    wind = ac.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
    windFilter = ac.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 450; windFilter.Q.value = 0.8;
    const wl = ac.createOscillator(), wlG = ac.createGain(); wl.frequency.value = 0.13; wlG.gain.value = 220; wl.connect(wlG); wlG.connect(windFilter.frequency); wl.start();
    windGain = ac.createGain(); windGain.gain.value = 0;
    wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); wind.start();
    // Cave: a low hum
    cave = ac.createOscillator(); cave.type = 'sine'; cave.frequency.value = 55;
    caveGain = ac.createGain(); caveGain.gain.value = 0; cave.connect(caveGain); caveGain.connect(master); cave.start();
  }

  // A gain (and stereo pan, -1 left … 1 right) into the master bus
  function out(g, pan = 0) {
    const n = ac.createGain(); n.gain.value = g;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; n.connect(p); p.connect(master); }
    else n.connect(master);
    return n;
  }
  function tone(freq, dur, type, gain, to, when = 0, dest) {
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, q, gain, type, to, dest, when = 0) {
    const t = ac.currentTime + when, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type || 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    swing: d => noise(0.11, 2200, 1.2, 0.18, 'bandpass', 700, d),
    hit: d => { tone(150, 0.12, 'sine', 0.45, 60, 0, d); noise(0.06, 900, 1, 0.25, 'lowpass', 0, d); },
    hurt: d => { tone(210, 0.16, 'sawtooth', 0.16, 90, 0, d); noise(0.08, 700, 1, 0.3, 'lowpass', 0, d); },
    place: d => { tone(180, 0.07, 'square', 0.08, 120, 0, d); noise(0.05, 1400, 2, 0.22, 'bandpass', 0, d); },
    break: d => { noise(0.16, 900, 0.8, 0.35, 'lowpass', 300, d); noise(0.05, 2500, 3, 0.12, 'bandpass', 0, d, 0.05); },
    chop: d => { noise(0.07, 600, 1.5, 0.25, 'bandpass', 0, d); tone(120, 0.06, 'triangle', 0.15, 80, 0, d); },
    drink: d => { for (let i = 0; i < 3; i++) tone(480 + i * 140, 0.07, 'sine', 0.12, 720 + i * 140, i * 0.08, d); },
    shoot: d => { tone(420, 0.16, 'triangle', 0.22, 150, 0, d); noise(0.1, 3000, 2, 0.1, 'bandpass', 800, d); },
    bolt: d => { noise(0.9, 3000, 0.5, 0.7, 'lowpass', 150, d); tone(52, 1.0, 'sine', 0.55, 30, 0, d); },
    fall: d => { tone(95, 0.22, 'sine', 0.55, 40, 0, d); noise(0.1, 500, 1, 0.3, 'lowpass', 0, d); },
    pickup: d => { tone(880, 0.07, 'sine', 0.12, 1320, 0, d); tone(1320, 0.08, 'sine', 0.08, 0, 0.06, d); },
    squeak: d => tone(2300, 0.12, 'sine', 0.08, 3100, 0, d),
    spike: d => { noise(0.1, 3200, 3, 0.3, 'bandpass', 0, d); tone(300, 0.12, 'sawtooth', 0.14, 110, 0, d); },
    craft: d => { tone(660, 0.05, 'square', 0.06, 0, 0, d); tone(990, 0.07, 'square', 0.06, 0, 0.06, d); },
    kill: d => { tone(660, 0.09, 'square', 0.09, 0, 0, d); tone(990, 0.14, 'square', 0.09, 0, 0.08, d); tone(1320, 0.2, 'triangle', 0.07, 0, 0.16, d); },
    bell: d => { tone(523, 1.2, 'sine', 0.2, 0, 0, d); tone(784, 1.2, 'sine', 0.12, 0, 0.02, d); },
    splash: d => { noise(0.35, 1800, 0.7, 0.35, 'lowpass', 400, d); noise(0.12, 3500, 2, 0.12, 'bandpass', 0, d, 0.04); },
    sizzle: d => { noise(0.6, 5200, 1.5, 0.22, 'highpass', 2600, d); tone(90, 0.25, 'sine', 0.2, 50, 0, d); },
    grow: d => { tone(70, 0.7, 'sawtooth', 0.16, 180, 0, d); tone(140, 0.7, 'triangle', 0.14, 360, 0.05, d); },
    stomp: d => { tone(55, 0.5, 'sine', 0.7, 28, 0, d); noise(0.35, 400, 0.8, 0.5, 'lowpass', 90, d); },
    thud: d => { tone(70, 0.35, 'sine', 0.55, 35, 0, d); noise(0.2, 700, 1, 0.35, 'lowpass', 150, d); },
    // Footsteps, by what's underfoot
    step_grass: d => noise(0.07, 380, 0.9, 0.3, 'lowpass', 180, d),
    step_sand: d => noise(0.09, 2600, 0.7, 0.16, 'bandpass', 1500, d),
    step_snow: d => noise(0.11, 1100, 1.8, 0.28, 'bandpass', 600, d),
    step_stone: d => { noise(0.035, 2100, 3, 0.3, 'bandpass', 0, d); tone(240, 0.03, 'triangle', 0.08, 160, 0, d); },
    step_wood: d => { tone(150, 0.07, 'triangle', 0.22, 110, 0, d); noise(0.04, 900, 2, 0.12, 'bandpass', 0, d); },
    step_water: d => noise(0.14, 1300, 0.8, 0.22, 'lowpass', 500, d),
    step_big: d => { tone(60, 0.2, 'sine', 0.6, 32, 0, d); noise(0.14, 300, 1, 0.35, 'lowpass', 110, d); },
    rev: d => { tone(45, 0.5, 'sawtooth', 0.14, 120, 0, d); tone(90, 0.45, 'square', 0.05, 200, 0.05, d); },
    crash: d => { noise(0.4, 1200, 0.6, 0.6, 'lowpass', 200, d); tone(90, 0.3, 'sine', 0.5, 40, 0, d); noise(0.25, 3800, 4, 0.18, 'bandpass', 1500, d, 0.03); },
    streak: d => { tone(523, 0.1, 'square', 0.07, 0, 0, d); tone(784, 0.12, 'square', 0.07, 0, 0.09, d); tone(1047, 0.3, 'triangle', 0.08, 0, 0.18, d); },
  };
  // Positional: sounds fade with distance from whoever you're watching, and pan left or right
  function place(x, y, z, range) {
    const L = (typeof VIEW !== 'undefined' && VIEW.focus) || G.human;
    if (x === undefined || !L) return [1, 0];
    const d = hyp(x - L.x, y - L.y, (z || 0) - (L.z || 0));
    const g = Math.pow(clamp(1 - d / range, 0, 1), 2);
    return [g, d > 20 ? Math.sin(angDiff(L.face || 0, Math.atan2(y - L.y, x - L.x))) * 0.85 : 0];
  }
  function play(name, x, y, z) {
    if (!ac || vol <= 0 || !SOUNDS[name]) return;
    const [g, pan] = place(x, y, z, 900);
    if (g < 0.02) return;
    SOUNDS[name](out(g, pan));
  }
  function step(surface, x, y, z, range, loud = 1) {
    if (!ac || vol <= 0) return;
    const [g, pan] = place(x, y, z, range);
    if (g * loud < 0.02) return;
    SOUNDS['step_' + surface](out(g * loud, pan));
  }
  let cricketT = 0;
  function update(env, dt, night = 0) {
    if (!ac) return;
    // Crickets at night, above ground
    if (night > 0.4 && (env === 'surface' || env === 'menu')) {
      cricketT -= dt;
      if (cricketT <= 0) { cricketT = 0.15 + Math.random() * 1.2; const f = 4200 + Math.random() * 900, o = out(0.5 * night); for (let i = 0; i < 3; i++) tone(f, 0.035, 'sine', 0.035, 0, i * 0.06, o); }
    }
    const t = ac.currentTime;
    const [p, w, c] = env === 'under' ? [0.0, 0.0, 0.07] : env === 'snow' ? [0.018, 0.16, 0] : env === 'menu' ? [0.03, 0.03, 0] : [0.035, 0.025, 0];
    padGain.gain.setTargetAtTime(p, t, 1.2); windGain.gain.setTargetAtTime(w, t, 0.8); caveGain.gain.setTargetAtTime(c, t, 1.0);
    chordT -= dt;
    if (chordT <= 0) {
      chordT = 11; chordI = (chordI + 1) % CHORDS.length;
      pad.forEach((o, i) => o.frequency.setTargetAtTime(CHORDS[chordI][i], t, 1.5));
    }
    if (env === 'under') {
      dripT -= dt;
      if (dripT <= 0) { dripT = 0.8 + Math.random() * 2.4; tone(1200 + Math.random() * 900, 0.09, 'sine', 0.05, 700, 0, out(1)); }
    }
  }
  // Motorcycle engines: one voice per running bike nearby (a sawtooth and a sub an octave down), pitch by speed
  const eng = new Map();
  function engines(list) {
    if (!ac) return;
    const t = ac.currentTime, seen = new Set();
    for (const e of list) {
      let v = eng.get(e.id);
      if (!v) {
        const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.Q.value = 2; g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(g);
        const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (p) { g.connect(p); p.connect(master); } else g.connect(master);
        o1.start(); o2.start();
        eng.set(e.id, v = { o1, o2, f, g, p });
      }
      seen.add(e.id);
      const [gain, pan] = place(e.x, e.y, e.z, 800), s = Math.min(1, Math.abs(e.speed) / 540);
      v.o1.frequency.setTargetAtTime(36 + s * 115 + Math.random() * 3, t, 0.06); v.o2.frequency.setTargetAtTime(18 + s * 57, t, 0.06);
      v.f.frequency.setTargetAtTime(420 + s * 1500, t, 0.08);
      v.g.gain.setTargetAtTime(gain * (0.05 + s * 0.08) * (e.mine ? 0.7 : 1), t, 0.06);
      if (v.p) v.p.pan.setTargetAtTime(pan, t, 0.06);
    }
    for (const [id, v] of eng) if (!seen.has(id)) { v.g.gain.setTargetAtTime(0, t, 0.08); v.o1.stop(t + 0.5); v.o2.stop(t + 0.5); eng.delete(id); }
  }
  function setVolume(v) { vol = v; if (master) master.gain.setTargetAtTime(v, ac.currentTime, 0.05); }
  return { start, play, step, engines, update, setVolume };
})();
