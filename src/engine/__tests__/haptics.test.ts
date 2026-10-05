import { describe, expect, it } from 'vitest';
import {
  vibrationPatternFor,
  scalePattern,
  triggerHaptic,
  SensorySettings,
  sensorySettings,
} from '../haptics.js';
import { TraumaShake, traumaFor } from '../shake.js';

describe('vibration patterns', () => {
  it('matches the spec patterns', () => {
    expect(vibrationPatternFor('PERFECT')).toEqual([10]);
    expect(vibrationPatternFor('GREAT')).toEqual([25]);
    expect(vibrationPatternFor('MISS')).toEqual([40, 40, 40]);
    expect(vibrationPatternFor('GOOD')).toEqual([15]);
  });

  it('scales by intensity, drops sub-motor pulses, keeps the MISS shape', () => {
    expect(scalePattern([10, 40, 40], 0)).toEqual([]);
    expect(scalePattern([10, 25, 40], 1)).toEqual([10, 25, 40]);
    const half = scalePattern([40, 40, 40], 0.5);
    expect(half).toEqual([20, 40, 20]);
    // tiny PERFECT tap rounds up to the 8 ms floor instead of vanishing
    expect(scalePattern([10], 0.1)).toEqual([8]);
  });

  it('fires through an injected vibrator and never throws bare', () => {
    const seen: Array<number | number[]> = [];
    const vib = { vibrate: (p: number | number[]) => (seen.push(p), true) };
    expect(triggerHaptic('PERFECT', 1, vib)).toEqual([10]);
    expect(seen).toEqual([10]);
    expect(triggerHaptic('MISS', 1, vib)).toEqual([40, 40, 40]);
    expect(triggerHaptic('GREAT', 0, vib)).toEqual([]);
    expect(seen.length).toBe(2); // silent intensity sends nothing
    expect(() => triggerHaptic('PERFECT', 1, null)).not.toThrow();
  });
});

describe('SensorySettings', () => {
  it('clamps 0..1, patches partially, and resets', () => {
    const s = new SensorySettings();
    expect(s.get()).toEqual({ haptics: 1, shake: 1, bloom: 0.8, master: 1 });
    expect(s.set({ haptics: 2, shake: -1 })).toMatchObject({ haptics: 1, shake: 0 });
    expect(s.set({ bloom: 0.3 })).toMatchObject({ bloom: 0.3, haptics: 1 });
    expect(s.reset()).toMatchObject({ haptics: 1, shake: 1 });
    expect(sensorySettings.get().haptics).toBe(1);
  });
});

describe('trauma shake', () => {
  it('ranks trauma MISS > GOOD > GREAT > PERFECT', () => {
    expect(traumaFor('MISS')).toBeGreaterThan(traumaFor('GOOD'));
    expect(traumaFor('GOOD')).toBeGreaterThan(traumaFor('GREAT'));
    expect(traumaFor('GREAT')).toBeGreaterThan(traumaFor('PERFECT'));
    expect(traumaFor('PERFECT', 0)).toBeCloseTo(0.12, 6);
    expect(traumaFor('MISS')).toBeCloseTo(0.55, 6);
  });

  it('decays to rest and scales offsets with trauma²', () => {
    const sh = new TraumaShake();
    expect(sh.value).toBe(0);
    const zero = sh.update(0.016);
    expect(zero.x).toBe(0);
    sh.kick(1);
    expect(sh.value).toBe(1);
    const hard = sh.update(0);
    sh.reset();
    sh.kick(0.5);
    const soft = sh.update(0);
    expect(Math.abs(hard.x) + Math.abs(hard.y)).toBeGreaterThan(
      Math.abs(soft.x) + Math.abs(soft.y),
    );
    for (let i = 0; i < 200; i++) sh.update(0.016);
    expect(sh.value).toBe(0);
    const rest = sh.update(0.016);
    expect(rest.x).toBeCloseTo(0, 9);
    expect(rest.roll).toBeCloseTo(0, 9);
  });

  it('links hits to delta scores and honours intensity', () => {
    const sh = new TraumaShake();
    sh.hit('PERFECT', 5, 0);
    expect(sh.value).toBe(0);
    sh.hit('PERFECT', 5, 1);
    expect(sh.value).toBeGreaterThan(0);
    sh.reset();
    sh.hit('MISS', 0, 1);
    expect(sh.value).toBeCloseTo(0.55, 6);
    sh.kick(99);
    expect(sh.value).toBe(1); // clamped
  });

  it('reuses the output object and rejects bad options', () => {
    const sh = new TraumaShake();
    sh.kick(0.8);
    const out = { x: 0, y: 0, roll: 0, trauma: 0 };
    expect(sh.update(0.016, out)).toBe(out);
    expect(out.trauma).toBeGreaterThan(0);
    expect(() => new TraumaShake({ decay: 0 })).toThrow(RangeError);
    expect(() => new TraumaShake({ maxOffset: -1 })).toThrow(RangeError);
  });
});
