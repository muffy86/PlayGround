import { describe, expect, it } from 'vitest';
import { SparkPool, DrumLightRig, makeRng } from '../particles.js';
import { DRUM_IDS } from '../drums.js';

describe('SparkPool pooling', () => {
  it('rejects bad capacity and releases 40–60 sparks per strike', () => {
    expect(() => new SparkPool(8)).toThrow(RangeError);
    const pool = new SparkPool(256);
    expect(pool.burst({ x: 0, y: 1, z: 0 })).toBe(48);
    expect(pool.alive).toBe(48);
    expect(pool.burst({ x: 0, y: 1, z: 0 }, { count: 60 })).toBe(60);
    expect(pool.burst({ x: 0, y: 1, z: 0 }, { count: 0 })).toBe(0);
  });

  it('is deterministic with a seeded RNG', () => {
    const a = new SparkPool(256);
    const b = new SparkPool(256);
    a.burst({ x: 1, y: 2, z: 3 }, {}, makeRng(7));
    b.burst({ x: 1, y: 2, z: 3 }, {}, makeRng(7));
    expect(a.snapshot()).toEqual(b.snapshot());
    const c = new SparkPool(256);
    c.burst({ x: 1, y: 2, z: 3 }, {}, makeRng(8));
    expect(c.snapshot()).not.toEqual(a.snapshot());
  });

  it('integrates gravity + drag and compacts the dead without allocating storage', () => {
    const pool = new SparkPool(256);
    pool.burst({ x: 0, y: 2, z: 0 }, { count: 40, life: 0.4 }, makeRng(3));
    const before = pool.snapshot();
    pool.update(0.016);
    const after = pool.snapshot();
    expect(after.length).toBe(before.length); // nobody died yet
    expect(after[0]?.y).not.toBe(before[0]?.y);
    // Age everything out: alive must drain to exactly 0.
    for (let i = 0; i < 120; i++) pool.update(0.05);
    expect(pool.alive).toBe(0);
    expect(pool.snapshot()).toEqual([]);
    // Pool is reusable after draining.
    expect(pool.burst({ x: 0, y: 1, z: 0 }, { count: 44 })).toBe(44);
    expect(pool.alive).toBe(44);
  });

  it('clamps at capacity and bounces off the floor', () => {
    const pool = new SparkPool(64);
    expect(pool.burst({ x: 0, y: 1, z: 0 }, { count: 64 })).toBe(64);
    expect(pool.burst({ x: 0, y: 1, z: 0 }, { count: 10 })).toBe(0);
    pool.update(0.016);
    for (const s of pool.snapshot()) expect(s.y).toBeGreaterThanOrEqual(0.019);
  });

  it('dumps stride-5 instance rows and reports freshness', () => {
    const pool = new SparkPool(128);
    pool.burst({ x: 1, y: 1, z: 1 }, { count: 10 }, makeRng(1));
    const out = new Float32Array(10 * 5);
    expect(pool.writeInstances(out)).toBe(10);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[3]).toBeCloseTo(1, 5); // fresh
    expect(out[4]).toBeGreaterThan(0); // size
    expect(pool.freshness(0)).toBeCloseTo(1, 5);
    expect(pool.freshness(99)).toBe(0);
    const tiny = new Float32Array(2 * 5);
    expect(pool.writeInstances(tiny)).toBe(2);
  });

  it('reset clears without reallocating', () => {
    const pool = new SparkPool(128);
    pool.burst({ x: 0, y: 1, z: 0 }, { count: 50 });
    pool.reset();
    expect(pool.alive).toBe(0);
    expect(pool.update(0.016)).toBe(0);
  });
});

describe('DrumLightRig decay', () => {
  it('validates construction and unknown drums', () => {
    expect(() => new DrumLightRig({ drums: [] })).toThrow(RangeError);
    expect(() => new DrumLightRig({ drums: ['kick'], peak: 0 })).toThrow(RangeError);
    const rig = new DrumLightRig({ drums: [...DRUM_IDS] });
    expect(rig.size).toBe(DRUM_IDS.length);
    expect(rig.strike('cowbell' as 'kick')).toBe(-1);
  });

  it('slams to peak on strike and decays exponentially', () => {
    const rig = new DrumLightRig({ drums: ['kick', 'snare'], peak: 60, decay: 7 });
    expect(rig.strike('kick', 1)).toBe(0);
    expect(rig.intensityAt(0)).toBeCloseTo(60, 6);
    expect(rig.intensityAt(1)).toBe(0);
    rig.update(0.1);
    expect(rig.intensityAt(0)).toBeCloseTo(60 * Math.exp(-0.7), 3);
    const soft = new DrumLightRig({ drums: ['kick'], peak: 60, decay: 7 });
    soft.strike('kick', 0.2);
    expect(soft.intensityAt(0)).toBeLessThan(rig.intensityAt(0) + 30);
    for (let i = 0; i < 400; i++) rig.update(0.05);
    expect(rig.total()).toBe(0);
    expect(rig.intensities()).toBe(rig.intensities()); // stable reference
    rig.strike('snare', 1);
    expect(rig.total()).toBeGreaterThan(0);
    rig.reset();
    expect(rig.total()).toBe(0);
    expect(rig.intensityAt(99)).toBe(0);
  });
});
