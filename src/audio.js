// Synthesized drum engine — zero samples, works offline. Acoustic + electric voices.
let ctx = null, master = null, verbSend = null, muted = false;
let kit = 'acoustic';

export function audioKit() { return kit; }
export function setAudioKit(k) { kit = k; }
export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.9; return muted; }

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 5;
  master.connect(comp); comp.connect(ctx.destination);
  // tiny space: feedback delay
  const delay = ctx.createDelay(0.5); delay.delayTime.value = 0.23;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  verbSend = ctx.createGain(); verbSend.gain.value = 1;
  verbSend.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(comp);
  return ctx;
}
export function now() { ensureAudio(); return ctx.currentTime; }
function env(g, t, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}
function noiseBuffer(len = 1) {
  ensureAudio();
  const b = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let _noise = null;
function getNoise() { if (!_noise) _noise = noiseBuffer(2); return _noise; }

function osc(type, f0, f1, t, dur, peak = 0.8, dest = null) {
  ensureAudio();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur * 0.9);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || master);
  if (dest === undefined) { const s = ctx.createGain(); s.gain.value = 0.12; g.connect(s); s.connect(verbSend); }
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, peak, filterType, freq, q = 1, open = false) {
  ensureAudio();
  const s = ctx.createBufferSource(); s.buffer = getNoise(); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  const wet = ctx.createGain(); wet.gain.value = open ? 0.25 : 0.08;
  g.connect(wet); wet.connect(verbSend);
  s.start(t); s.stop(t + dur + 0.05);
}

export const DRUMS = ['kick', 'snare', 'hihat', 'hihatOpen', 'tom1', 'tom2', 'floor', 'crash', 'ride'];

export function playDrum(name, t = null, vel = 1) {
  ensureAudio();
  t = t ?? ctx.currentTime;
  vel = Math.max(0.2, Math.min(1.2, vel));
  const el = kit === 'electric';
  switch (name) {
    case 'kick':
      if (el) { osc('square', 160, 42, t, 0.22, 0.5 * vel); osc('sine', 150, 38, t, 0.28, 0.95 * vel); noise(t, 0.03, 0.25 * vel, 'highpass', 1200); }
      else { osc('sine', 155, 40, t, 0.32, 1.0 * vel); noise(t, 0.025, 0.3 * vel, 'lowpass', 900); }
      break;
    case 'snare':
      if (el) { osc('triangle', 240, 150, t, 0.14, 0.6 * vel); noise(t, 0.16, 0.55 * vel, 'highpass', 1800); osc('square', 190, 190, t, 0.05, 0.25 * vel); }
      else { osc('triangle', 190, 120, t, 0.12, 0.7 * vel); noise(t, 0.2, 0.6 * vel, 'highpass', 1400); }
      break;
    case 'hihat':
      noise(t, el ? 0.05 : 0.06, 0.32 * vel, 'highpass', 7800); break;
    case 'hihatOpen':
      noise(t, el ? 0.32 : 0.45, 0.34 * vel, 'highpass', 6800); break;
    case 'tom1': osc('sine', el ? 220 : 200, el ? 110 : 95, t, 0.3, 0.85 * vel); break;
    case 'tom2': osc('sine', el ? 180 : 165, el ? 90 : 80, t, 0.32, 0.85 * vel); break;
    case 'floor': osc('sine', el ? 140 : 130, el ? 60 : 52, t, 0.4, 0.95 * vel); break;
    case 'crash':
      noise(t, el ? 0.9 : 1.4, 0.5 * vel, 'highpass', 5200);
      osc('sine', 620, 590, t, 0.8, 0.08 * vel);
      break;
    case 'ride':
      noise(t, el ? 0.7 : 1.0, 0.34 * vel, 'highpass', 6000);
      osc('square', 820, 815, t, 0.5, 0.05 * vel);
      break;
    case 'clickHi': osc('square', 2000, 2000, t, 0.05, 0.3 * vel); break;
    case 'clickLo': osc('square', 1200, 1200, t, 0.06, 0.3 * vel); break;
    case 'shaker': noise(t, 0.09, 0.2 * vel, 'highpass', 6000); break;
    case 'win': {
      [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, t + i * 0.09, 0.25, 0.3));
      break;
    }
    case 'bad': osc('sawtooth', 160, 90, t, 0.25, 0.3); break;
  }
}
export function click(accent, t) { playDrum(accent ? 'clickHi' : 'clickLo', t, 1); }
