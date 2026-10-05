/**
 * Phase 3 — zero-asset procedural audio synthesis (Web Audio API).
 *
 * - Pitch-swept oscillator kick (sine 160→42 Hz + click transient).
 * - Filtered white-noise snare (body triangle + highpassed noise burst).
 * - Ascending pentatonic combo chime C4→C6: consecutive hits climb the scale,
 *   MISS resets the ladder; a MISS also slams an aggressive low-pass dip on
 *   the music bus.
 *
 * Testability: all musical math is pure (combo frequencies, sweep params).
 * Node-graph construction goes through the narrow `SynthContext` interface so
 * Vitest can inject a recording fake — no real AudioContext needed in tests.
 * The live game passes a real `AudioContext` (or lets the engine create one).
 */

// ---- pure musical data -------------------------------------------------

/** Pentatonic ladder C4 D4 E4 G4 A4 C5 D5 E5 G5 A5 C6 (Hz). */
export const COMBO_SCALE: readonly number[] = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5,
] as const;

export const COMBO_TOP = COMBO_SCALE.length - 1;

/** Combo step → chime frequency. Negative clamps to C4, overflow clamps to C6. */
export function comboFrequency(combo: number): number {
  const i = Math.floor(combo);
  if (!Number.isFinite(i) || i <= 0) return COMBO_SCALE[0] as number;
  if (i >= COMBO_TOP) return COMBO_SCALE[COMBO_TOP] as number;
  return COMBO_SCALE[i] as number;
}

export interface KickParams {
  oscType: 'sine';
  f0: number;
  f1: number;
  dur: number;
  peak: number;
  clickPeak: number;
}
/** Pure kick recipe so tests can assert the sweep without audio hardware. */
export function kickParams(vel: number): KickParams {
  const v = clamp01(vel);
  return { oscType: 'sine', f0: 160, f1: 42, dur: 0.26, peak: 0.9 * v + 0.1, clickPeak: 0.22 * v };
}

export interface SnareParams {
  bodyType: 'triangle';
  bodyFreq: number;
  noiseFilter: 'highpass';
  noiseFreq: number;
  noiseDur: number;
  bodyPeak: number;
  noisePeak: number;
}
export function snareParams(vel: number): SnareParams {
  const v = clamp01(vel);
  return {
    bodyType: 'triangle',
    bodyFreq: 190,
    noiseFilter: 'highpass',
    noiseFreq: 1800,
    noiseDur: 0.18,
    bodyPeak: 0.55 * v + 0.05,
    noisePeak: 0.5 * v + 0.05,
  };
}

export interface MissDipParams {
  fromFreq: number;
  dipFreq: number;
  attack: number;
  release: number;
}
export function missDipParams(): MissDipParams {
  return { fromFreq: 18000, dipFreq: 320, attack: 0.02, release: 0.38 };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


// ---- narrow context interface (real AudioContext satisfies it) ----------

export interface OscNodeLike {
  type: string;
  frequency: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
  connect(dest: unknown): void;
  start(t: number): void;
  stop(t: number): void;
}
export interface GainNodeLike {
  gain: {
    value: number;
    setValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
    linearRampToValueAtTime(v: number, t: number): void;
    cancelScheduledValues(t: number): void;
    setTargetAtTime(v: number, t: number, tc: number): void;
  };
  connect(dest: unknown): void;
}
export interface FilterNodeLike {
  type: string;
  frequency: GainNodeLike['gain'];
  Q: { value: number };
  connect(dest: unknown): void;
}
export interface BufferSourceLike {
  buffer: unknown;
  loop: boolean;
  connect(dest: unknown): void;
  start(t: number): void;
  stop(t: number): void;
}
export interface SynthContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  createOscillator(): OscNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): FilterNodeLike;
  createBufferSource(): BufferSourceLike;
  createDynamicsCompressor(): GainNodeLike & { threshold: { value: number }; ratio: { value: number } };
  createDelay(max: number): GainNodeLike & { delayTime: { value: number } };
  createBuffer(channels: number, length: number, rate: number): { getChannelData(c: number): Float32Array };
}

export interface SynthEngineOptions {
  /** Inject a fake context in tests; otherwise lazily created. */
  context?: SynthContext | undefined;
  /** Factory used when no context is injected (live game). */
  createLiveContext?: (() => SynthContext) | undefined;
  master?: number | undefined;
}

export interface SynthGraphStats {
  oscillators: number;
  gains: number;
  filters: number;
  noiseSources: number;
  chimeStep: number;
  dipCount: number;
  kicks: number;
  snares: number;
}

/**
 * Procedural drum + chime synth. All buffers are generated (white noise),
 * no audio assets. After construction everything is preallocated except the
 * per-hit voice nodes (oscillators/gains), which is inherent to Web Audio.
 */
export class ProceduralSynth {
  private ctx: SynthContext | null = null;
  private readonly injected: SynthContext | null;
  private readonly liveFactory: (() => SynthContext) | null;
  private master: GainNodeLike | null = null;
  private musicFilter: FilterNodeLike | null = null;
  private musicBus: GainNodeLike | null = null;
  private noiseBuf: unknown = null;
  private chimeStep = 0;
  private stats: SynthGraphStats = {
    oscillators: 0,
    gains: 0,
    filters: 0,
    noiseSources: 0,
    chimeStep: 0,
    dipCount: 0,
    kicks: 0,
    snares: 0,
  };

  constructor(opts: SynthEngineOptions = {}) {
    this.injected = opts.context ?? null;
    this.liveFactory = opts.createLiveContext ?? null;
    if (opts.master !== undefined && !(opts.master >= 0)) {
      throw new RangeError(`ProceduralSynth: master must be >= 0, got ${opts.master}`);
    }
    this.initialMaster = opts.master ?? 0.9;
  }
  private readonly initialMaster: number;

  get ready(): boolean {
    return this.ctx !== null;
  }
  get combo(): number {
    return this.chimeStep;
  }
  graphStats(): SynthGraphStats {
    return { ...this.stats };
  }

  /** Build (or return) the shared graph. Idempotent. */
  ensure(): SynthContext {
    if (this.ctx) return this.ctx;
    const ctx = this.injected ?? this.createLive();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    this.stats.gains++;
    master.gain.value = this.initialMaster;
    master.connect(comp);
    this.master = master;
    // Music bus with the MISS dip filter in front of it.
    const filt = ctx.createBiquadFilter();
    this.stats.filters++;
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(18000, ctx.currentTime);
    filt.Q.value = 0.4;
    filt.connect(master);
    this.musicFilter = filt;
    const bus = ctx.createGain();
    this.stats.gains++;
    bus.gain.value = 1;
    bus.connect(filt);
    this.musicBus = bus;
    // Pre-generate 1s of white noise (zero assets).
    const len = Math.floor(ctx.sampleRate * 1);
    const buf = ctx.createBuffer(1, Math.max(1, len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return ctx;
  }

  private createLive(): SynthContext {
    if (this.liveFactory) return this.liveFactory();
    const AC =
      (globalThis as unknown as { AudioContext?: new () => SynthContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: new () => SynthContext }).webkitAudioContext;
    if (!AC) throw new Error('ProceduralSynth: no AudioContext available (pass a context in tests)');
    return new AC();
  }

  /** Pitch-swept oscillator kick + click transient. Returns voice count (2). */
  kick(vel = 1, when?: number): number {
    const ctx = this.ensure();
    const p = kickParams(vel);
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    this.stats.oscillators++;
    o.type = p.oscType;
    o.frequency.setValueAtTime(p.f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f1), t + p.dur * 0.9);
    const g = ctx.createGain();
    this.stats.gains++;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p.peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + p.dur + 0.05);
    // Click transient: short noise tick through highpass.
    this.noiseHit(t, 0.03, p.clickPeak, 'highpass', 1200);
    this.stats.kicks++;
    return 2;
  }

  /** Filtered white-noise snare + triangle body. Returns voice count (2). */
  snare(vel = 1, when?: number): number {
    const ctx = this.ensure();
    const p = snareParams(vel);
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    this.stats.oscillators++;
    o.type = p.bodyType;
    o.frequency.setValueAtTime(p.bodyFreq, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const g = ctx.createGain();
    this.stats.gains++;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p.bodyPeak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.17);
    this.noiseHit(t, p.noiseDur, p.noisePeak, p.noiseFilter, p.noiseFreq);
    this.stats.snares++;
    return 2;
  }

  /**
   * Combo chime: triangle at the pentatonic ladder step + octave shimmer.
   * Each call climbs one step (C4→C6); returns the frequency used.
   */
  chime(combo: number, vel = 1, when?: number): number {
    const ctx = this.ensure();
    const freq = comboFrequency(combo);
    this.chimeStep = Math.max(0, Math.floor(combo));
    this.stats.chimeStep = this.chimeStep;
    const t = when ?? ctx.currentTime;
    const v = clamp01(vel);
    this.pluck(freq, t, 0.5, 0.28 * v + 0.04);
    this.pluck(freq * 2, t + 0.015, 0.3, 0.1 * v + 0.01);
    return freq;
  }

  /** Reset the chime ladder (call on MISS, after the dip). */
  resetCombo(): void {
    this.chimeStep = 0;
    this.stats.chimeStep = 0;
  }

  /**
   * Aggressive low-pass dip on the music bus (MISS feedback): slam to
   * ~320 Hz then release back to 18 kHz. Counts dips for tests/telemetry.
   */
  missDip(when?: number): void {
    const ctx = this.ensure();
    if (!this.musicFilter) return;
    const p = missDipParams();
    const t = when ?? ctx.currentTime;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(p.fromFreq, t);
    f.exponentialRampToValueAtTime(p.dipFreq, t + p.attack);
    f.exponentialRampToValueAtTime(p.fromFreq, t + p.attack + p.release);
    this.stats.dipCount++;
    this.resetCombo();
  }

  setMaster(v: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02);
    }
  }

  /** Resume a suspended context (call from a user gesture). */
  resume(): void {
    try {
      const live = this.ctx as unknown as { resume?: () => void; state?: string };
      if (live && live.state === 'suspended') live.resume?.();
    } catch {
      /* ignore */
    }
  }

  private pluck(freq: number, t: number, dur: number, peak: number): void {
    const ctx = this.ctx as SynthContext;
    const o = ctx.createOscillator();
    this.stats.oscillators++;
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    this.stats.gains++;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.musicBus ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, peak: number, type: string, freq: number): void {
    const ctx = this.ctx as SynthContext;
    const src = ctx.createBufferSource();
    this.stats.noiseSources++;
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    this.stats.filters++;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    this.stats.gains++;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}

/** Live arcade synth singleton shared by gameplay, tools, and tests. */
export const juiceSynth = new ProceduralSynth();
