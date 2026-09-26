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

  function out(g) { const n = ac.createGain(); n.gain.value = g; n.connect(master); return n; }
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
  };
  // Positional: sounds fade with distance from the listener and are skipped when far away
  function play(name, x, y, z) {
    if (!ac || vol <= 0 || !SOUNDS[name]) return;
    let g = 1;
    if (x !== undefined && G.human) {
      const d = hyp(x - G.human.x, y - G.human.y, (z || 0) - (G.human.z || 0));
      g = Math.pow(clamp(1 - d / 900, 0, 1), 2);
      if (g < 0.02) return;
    }
    SOUNDS[name](out(g));
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
  function setVolume(v) { vol = v; if (master) master.gain.setTargetAtTime(v, ac.currentTime, 0.05); }
  return { start, play, update, setVolume };
})();
