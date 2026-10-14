import { DRUMS, type DrumId } from '../lib/drums';

/**
 * Zero-latency WebAudio drum synthesizer.
 * No external samples required — all voices synthesized for offline + instant play.
 * A Tone.js-backed metronome click is layered in MetronomePlayground via this clock.
 */
class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  verb: ConvolverNode | null = null;
  ready = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    // tiny generated impulse reverb
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this.impulse(1.1, 2.2);
    const wet = this.ctx.createGain(); wet.gain.value = 0.18;
    this.verb.connect(wet); wet.connect(this.master);
    this.ready = true;
    return this.ctx;
  }

  impulse(dur = 1.2, decay = 2.0) {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate, len = rate * dur;
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  now() { this.ensure(); return this.ctx!.currentTime; }

  env(g: GainNode, t: number, peak: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  play(id: DrumId, velocity = 0.9, when?: number) {
    const ctx = this.ensure();
    const t = when ?? ctx.currentTime;
    const v = Math.min(1, Math.max(0.05, velocity));
    switch (id) {
      case 'kick': this.kick(t, v); break;
      case 'snare': this.snare(t, v); break;
      case 'rim': this.rim(t, v); break;
      case 'hihatClosed': this.hat(t, v, 0.09); break;
      case 'hihatOpen': this.hat(t, v, 0.5); break;
      case 'tomLow': this.tom(t, v, 110); break;
      case 'tomMid': this.tom(t, v, 165); break;
      case 'crash': this.cymbal(t, v, 1.6, 5200); break;
      case 'ride': this.cymbal(t, v, 1.1, 6800); break;
    }
  }

  private out(t: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.master!);
    g.connect(this.verb!);
    void t;
    return g;
  }

  private kick(t: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = this.out(t);
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    this.env(g, t, 1.0 * v, 0.42);
    o.connect(g); o.start(t); o.stop(t + 0.5);
    const n = this.noiseBurst(t, 0.03, 900, v * 0.4);
    void n;
  }
  private snare(t: number, v: number) {
    this.noiseBurst(t, 0.2, 1800, v * 0.9, 'highpass');
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = this.out(t);
    o.type = 'triangle'; o.frequency.value = 190;
    this.env(g, t, 0.7 * v, 0.12);
    o.connect(g); o.start(t); o.stop(t + 0.15);
  }
  private rim(t: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = this.out(t);
    o.type = 'square'; o.frequency.value = 1720;
    this.env(g, t, 0.35 * v, 0.05);
    o.connect(g); o.start(t); o.stop(t + 0.08);
    this.noiseBurst(t, 0.05, 3200, v * 0.5, 'bandpass');
  }
  private hat(t: number, v: number, decay: number) {
    this.noiseBurst(t, decay, 8000, v * 0.6, 'highpass');
  }
  private tom(t: number, v: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = this.out(t);
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.85, t + 0.18);
    this.env(g, t, 0.9 * v, 0.35);
    o.connect(g); o.start(t); o.stop(t + 0.4);
  }
  private cymbal(t: number, v: number, decay: number, cutoff: number) {
    this.noiseBurst(t, decay, cutoff, v * 0.7, 'highpass');
  }

  private noiseBurst(t: number, decay: number, filterFreq: number, peak: number, type: BiquadFilterType = 'highpass') {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * decay));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.out(t);
    this.env(g, t, peak, decay);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + decay + 0.05);
    return src;
  }

  click(when: number, accent: boolean, freq = accent ? 1600 : 1000) {
    const ctx = this.ensure();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + (accent ? 0.09 : 0.06));
    o.connect(g); g.connect(this.master!);
    o.start(when); o.stop(when + 0.12);
  }
}

export const audio = new AudioEngine();
export const drumList = DRUMS;
