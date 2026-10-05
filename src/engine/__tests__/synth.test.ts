import { describe, expect, it } from 'vitest';
import {
  ProceduralSynth,
  comboFrequency,
  kickParams,
  snareParams,
  missDipParams,
  COMBO_SCALE,
  type SynthContext,
  type OscNodeLike,
  type GainNodeLike,
  type FilterNodeLike,
  type BufferSourceLike,
} from '../synth.js';

interface Rec {
  oscs: Array<{ type: string; f0: number; f1: number[] }>;
  gains: number;
  filters: Array<{ type: string; freq: number }>;
  noise: number;
  dips: Array<{ from: number; dip: number }>;
}

function fakeContext(rec: Rec): SynthContext {
  const mkGain = (): GainNodeLike => {
    rec.gains++;
    const calls: Array<[string, number]> = [];
    return {
      gain: {
        value: 1,
        setValueAtTime: (v) => void calls.push(['set', v]),
        exponentialRampToValueAtTime: (v) => void calls.push(['exp', v]),
        linearRampToValueAtTime: (v) => void calls.push(['lin', v]),
        cancelScheduledValues: () => void calls.push(['cancel', 0]),
        setTargetAtTime: (v) => void calls.push(['target', v]),
      },
      connect: () => undefined,
    };
  };
  return {
    currentTime: 100,
    sampleRate: 44100,
    destination: {},
    createOscillator: (): OscNodeLike => {
      const o: { type: string; f0: number; f1: number[] } = { type: 'sine', f0: 0, f1: [] };
      rec.oscs.push(o);
      return {
        get type() {
          return o.type;
        },
        set type(v: string) {
          o.type = v;
        },
        frequency: {
          setValueAtTime: (v) => {
            o.f0 = v;
          },
          exponentialRampToValueAtTime: (v) => {
            o.f1.push(v);
          },
        },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      };
    },
    createGain: mkGain,
    createBiquadFilter: (): FilterNodeLike => {
      const f: { type: string; freq: number } = { type: 'lowpass', freq: 0 };
      rec.filters.push(f);
      return {
        get type() {
          return f.type;
        },
        set type(v: string) {
          f.type = v;
        },
        frequency: {
          value: 0,
          setValueAtTime: (v) => {
            f.freq = v;
          },
          exponentialRampToValueAtTime: (v) => void rec.dips.push({ from: f.freq, dip: v }),
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
          setTargetAtTime: () => undefined,
        },
        Q: { value: 0 },
        connect: () => undefined,
      };
    },
    createBufferSource: (): BufferSourceLike => {
      rec.noise++;
      return { buffer: null, loop: false, connect: () => undefined, start: () => undefined, stop: () => undefined };
    },
    createDynamicsCompressor: () => ({ ...mkGain(), threshold: { value: 0 }, ratio: { value: 0 } }),
    createDelay: () => ({ ...mkGain(), delayTime: { value: 0 } }),
    createBuffer: () => ({ getChannelData: () => new Float32Array(44100) }),
  };
}

function engine() {
  const rec: Rec = { oscs: [], gains: 0, filters: [], noise: 0, dips: [] };
  const synth = new ProceduralSynth({ context: fakeContext(rec) });
  return { synth, rec };
}

describe('combo ladder + recipes (pure)', () => {
  it('climbs C4→C6 and clamps both ends', () => {
    expect(comboFrequency(0)).toBeCloseTo(261.63, 2);
    expect(comboFrequency(5)).toBeCloseTo(523.25, 2);
    expect(comboFrequency(10)).toBeCloseTo(1046.5, 2);
    expect(comboFrequency(999)).toBeCloseTo(1046.5, 2);
    expect(comboFrequency(-3)).toBeCloseTo(261.63, 2);
    expect(COMBO_SCALE.length).toBe(11);
  });

  it('specifies a pitch-swept kick and a highpassed snare', () => {
    const k = kickParams(1);
    expect(k.oscType).toBe('sine');
    expect(k.f0).toBe(160);
    expect(k.f1).toBe(42);
    expect(k.f0).toBeGreaterThan(k.f1);
    expect(kickParams(0.5).peak).toBeLessThan(k.peak);
    const s = snareParams(1);
    expect(s.noiseFilter).toBe('highpass');
    expect(s.noiseFreq).toBe(1800);
    expect(snareParams(0.2).noisePeak).toBeLessThan(s.noisePeak);
    const dip = missDipParams();
    expect(dip.dipFreq).toBeLessThan(500);
    expect(dip.fromFreq).toBeGreaterThan(10000);
  });
});

describe('node-graph construction (fake context)', () => {
  it('builds the shared graph once and reuses it', () => {
    const { synth, rec } = engine();
    expect(synth.ready).toBe(false);
    synth.ensure();
    synth.ensure();
    expect(synth.ready).toBe(true);
    expect(rec.gains).toBe(3); // compressor + master + music bus
    expect(rec.filters.length).toBe(1); // music lowpass
    expect(rec.filters[0]?.type).toBe('lowpass');
  });

  it('builds a swept kick: sine 160→42 plus a noise click', () => {
    const { synth, rec } = engine();
    expect(synth.kick(1, 100)).toBe(2);
    expect(rec.oscs[0]?.type).toBe('sine');
    expect(rec.oscs[0]?.f0).toBe(160);
    expect(rec.oscs[0]?.f1[0]).toBe(42);
    expect(rec.noise).toBe(1);
    expect(synth.graphStats().kicks).toBe(1);
  });

  it('builds a snare: triangle body plus highpassed noise', () => {
    const { synth, rec } = engine();
    synth.snare(0.8, 100);
    expect(rec.oscs[0]?.type).toBe('triangle');
    expect(rec.oscs[0]?.f0).toBe(190);
    const hp = rec.filters.find((f) => f.type === 'highpass');
    expect(hp?.freq).toBe(1800);
    expect(synth.graphStats().snares).toBe(1);
  });

  it('climbs the pentatonic ladder per combo and shimmers the octave', () => {
    const { synth, rec } = engine();
    const f0 = synth.chime(0, 1, 100);
    const f3 = synth.chime(3, 1, 101);
    const fTop = synth.chime(99, 1, 102);
    expect(f0).toBeCloseTo(261.63, 2);
    expect(f3).toBeCloseTo(392.0, 2);
    expect(fTop).toBeCloseTo(1046.5, 2);
    expect(synth.combo).toBe(99);
    // 2 oscs per chime (fundamental + octave shimmer)
    expect(rec.oscs.length).toBe(6);
    expect(rec.oscs[1]?.f0).toBeCloseTo(f0 * 2, 1);
  });

  it('missDip slams the music filter and resets the combo', () => {
    const { synth, rec } = engine();
    synth.chime(6, 1, 100);
    expect(synth.combo).toBe(6);
    synth.missDip(101);
    const stats = synth.graphStats();
    expect(stats.dipCount).toBe(1);
    expect(synth.combo).toBe(0);
    expect(rec.dips.length).toBeGreaterThanOrEqual(2);
    expect(rec.dips[0]?.dip).toBeLessThan(500);
    synth.resetCombo();
    expect(synth.combo).toBe(0);
  });

  it('setMaster and bad options behave', () => {
    const { synth } = engine();
    synth.ensure();
    expect(() => synth.setMaster(0.4)).not.toThrow();
    expect(() => new ProceduralSynth({ master: -1 })).toThrow(RangeError);
    expect(() => new ProceduralSynth().ensure()).toThrow(/no AudioContext/);
  });
});
