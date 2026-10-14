// WebAudio drum synth — zero assets, works on phone/tablet. Acoustic + Electric banks.
export const PADS = [
  { id: 'crash', label: 'Crash', key: 'Q', color: '#fbbf24' },
  { id: 'tom1', label: 'Tom 1', key: 'W', color: '#fb7185' },
  { id: 'ride', label: 'Ride', key: 'E', color: '#f59e0b' },
  { id: 'hihat', label: 'Hat', key: 'A', color: '#22d3ee' },
  { id: 'snare', label: 'Snare', key: 'S', color: '#a855f7' },
  { id: 'tom2', label: 'Tom 2', key: 'D', color: '#f472b6' },
  { id: 'tom3', label: 'Floor', key: 'F', color: '#c084fc' },
  { id: 'kick', label: 'Kick', key: ' ', color: '#34d399' },
  { id: 'openhat', label: 'Open Hat', key: 'K', color: '#67e8f9' },
];

class DrumSynth {
  constructor() {
    this.ctx = null; this.master = null; this.bank = 'acoustic';
    this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }
  get electric() { return this.bank === 'electric'; }
  now() { this.ensure(); return this.ctx.currentTime; }
  env(g, t, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }
  osc(type, f0, f1, t, dur, peak = 0.9) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, peak, dur); o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(t, dur, filterType, freq, q = 1, peak = 0.7) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); this.env(g, t, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  play(id, when = 0, vel = 1) {
    this.ensure();
    const t = when || this.ctx.currentTime;
    const E = this.electric, v = Math.min(1.2, vel);
    switch (id) {
      case 'kick':
        this.osc('sine', E ? 220 : 160, 42, t, E ? 0.28 : 0.42, 1.0 * v);
        if (E) this.osc('square', 90, 40, t, 0.12, 0.25 * v);
        else this.noise(t, 0.03, 'lowpass', 900, 1, 0.35 * v);
        break;
      case 'snare':
        this.noise(t, E ? 0.16 : 0.2, 'highpass', 1500, 1, 0.7 * v);
        this.osc('triangle', E ? 240 : 190, 120, t, 0.12, 0.6 * v);
        if (E) this.osc('square', 180, 90, t, 0.08, 0.3 * v);
        break;
      case 'hihat':
        this.noise(t, 0.06, 'highpass', 7500, 1, 0.4 * v);
        break;
      case 'openhat':
        this.noise(t, 0.4, 'highpass', 7000, 1, 0.42 * v);
        break;
      case 'tom1': this.osc('sine', E ? 300 : 240, 110, t, 0.3, 0.8 * v); break;
      case 'tom2': this.osc('sine', E ? 240 : 190, 90, t, 0.32, 0.85 * v); break;
      case 'tom3': this.osc('sine', E ? 190 : 140, 60, t, 0.42, 0.95 * v); break;
      case 'crash':
        this.noise(t, E ? 0.9 : 1.4, 'highpass', 4500, 0.7, 0.5 * v);
        this.noise(t, 0.3, 'bandpass', 8000, 1.5, 0.3 * v);
        break;
      case 'ride':
        this.noise(t, 0.9, 'highpass', 6000, 1, 0.35 * v);
        this.osc('square', E ? 620 : 520, 510, t, 0.25, 0.06 * v);
        break;
      case 'click': this.osc('sine', 2000, 1800, t, 0.05, 0.5 * v); break;
      case 'clickAcc': this.osc('sine', 2800, 2400, t, 0.07, 0.65 * v); break;
      case 'sub': this.osc('sine', 1400, 1300, t, 0.04, 0.25 * v); break;
      case 'shaker': this.noise(t, 0.09, 'bandpass', 6000, 2, 0.3 * v); break;
    }
  }
}
export const synth = new DrumSynth();

// Precise lookahead metronome scheduler
export class Metronome {
  constructor(onTick) {
    this.onTick = onTick; this.bpm = 100; this.beats = 4; this.sub = 1;
    this.running = false; this.step = 0; this.nextT = 0; this.timer = null;
    this.tapTimes = [];
  }
  get stepDur() { return 60 / this.bpm / this.sub; }
  start(bpm = this.bpm) {
    synth.ensure(); this.bpm = bpm; this.running = true; this.step = 0;
    this.nextT = synth.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stop() { this.running = false; clearInterval(this.timer); }
  schedule() {
    while (this.nextT < synth.ctx.currentTime + 0.15) {
      const stepsPerBar = this.beats * this.sub;
      const s = this.step % stepsPerBar;
      const isBar = s === 0, isBeat = s % this.sub === 0;
      const id = isBar ? 'clickAcc' : isBeat ? 'click' : 'sub';
      synth.play(id, this.nextT, isBar ? 1 : isBeat ? 0.9 : 0.6);
      const delay = Math.max(0, (this.nextT - synth.ctx.currentTime) * 1000);
      setTimeout(() => this.onTick?.({ step: this.step, bar: Math.floor(this.step / stepsPerBar) + 1, beat: (s / this.sub | 0) + 1, isBar, isBeat, sub: s % this.sub }), delay);
      this.nextT += this.stepDur; this.step++;
    }
  }
  tap() {
    const n = performance.now(); this.tapTimes.push(n); this.tapTimes = this.tapTimes.slice(-6);
    if (this.tapTimes.length >= 3) {
      const diffs = this.tapTimes.slice(1).map((t, i) => t - this.tapTimes[i]);
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      return Math.round(60000 / avg);
    }
    return null;
  }
}
