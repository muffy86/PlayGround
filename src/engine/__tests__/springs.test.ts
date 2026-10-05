import { describe, expect, it } from 'vitest';
import { Spring1D, FloatTextPool, offsetStrip } from '../springs.js';
import { sparkUniforms, validateShaderSources } from '../shaders.js';

describe('Spring1D math', () => {
  it('rejects bad constants', () => {
    expect(() => new Spring1D(0, { stiffness: 0 })).toThrow(RangeError);
    expect(() => new Spring1D(0, { damping: -1 })).toThrow(RangeError);
    expect(() => new Spring1D(0, { mass: 0 })).toThrow(RangeError);
  });

  it('eases out toward the target and settles', () => {
    const s = new Spring1D(0);
    s.target = 100;
    expect(s.settled()).toBe(false);
    s.step(0.016);
    expect(s.value).toBeGreaterThan(0);
    expect(s.value).toBeLessThan(100); // ease-out, no teleport
    const v0 = s.velocity;
    for (let i = 0; i < 240; i++) s.step(0.016);
    expect(s.settled()).toBe(true);
    expect(s.value).toBeCloseTo(100, 0);
    expect(v0).toBeGreaterThan(0);
  });

  it('is stable at rest and clamps wild dt', () => {
    const s = new Spring1D(5);
    s.step(0);
    expect(s.value).toBe(5);
    s.target = 10;
    s.step(99);
    expect(Number.isFinite(s.value)).toBe(true);
    s.reset(3, 3);
    expect(s.settled()).toBe(true);
  });

  it('underdamped springs overshoot (pop feel)', () => {
    const s = new Spring1D(0.4, { stiffness: 260, damping: 8 });
    s.target = 1;
    let peak = 0.4;
    for (let i = 0; i < 200; i++) {
      s.step(0.008);
      peak = Math.max(peak, s.value);
    }
    expect(peak).toBeGreaterThan(1); // overshoot past the target
  });
});

describe('FloatTextPool', () => {
  it('spawns, animates, and frees rating popups', () => {
    const pool = new FloatTextPool(4);
    expect(pool.alive).toBe(0);
    const slot = pool.spawn({ text: 'PERFECT', color: '#38f0ff', x: 0.5 });
    expect(pool.alive).toBe(1);
    expect(slot.alive).toBe(true);
    expect(slot.pop.value).toBeCloseTo(0.4, 6);
    pool.update(0.016);
    expect(slot.pop.value).not.toBe(0.4);
    expect(slot.alpha).toBe(1);
    for (let i = 0; i < 300; i++) pool.update(0.016);
    expect(pool.alive).toBe(0);
    expect(slot.alive).toBe(false);
  });

  it('steals the oldest slot when full and keeps stable refs', () => {
    const pool = new FloatTextPool(2);
    const a = pool.spawn({ text: 'A' });
    pool.spawn({ text: 'B' });
    expect(pool.alive).toBe(2);
    const refs = [...pool.all];
    pool.spawn({ text: 'C' });
    expect(pool.alive).toBe(2);
    expect(pool.all.length).toBe(2);
    expect(pool.all).toEqual(refs); // same slot objects, reused
    expect(a.text).toBe('C'); // oldest slot recycled
    pool.reset();
    expect(pool.alive).toBe(0);
  });

  it('rejects bad capacity', () => {
    expect(() => new FloatTextPool(0)).toThrow(RangeError);
  });
});

describe('offsetStrip', () => {
  it('maps the deviation tail oldest→newest with clamped deflection', () => {
    const samples = [
      { offsetMs: -150, rating: 'MISS' },
      { offsetMs: -20, rating: 'PERFECT' },
      { offsetMs: 40, rating: 'GREAT' },
    ];
    const pts = offsetStrip(samples, { windowMs: 100, maxPoints: 48 });
    expect(pts.length).toBe(3);
    expect(pts[0]?.u).toBe(0);
    expect(pts[2]?.u).toBe(1);
    expect(pts[0]?.v).toBe(-1); // clamped
    expect(pts[1]?.v).toBeCloseTo(-0.2, 6);
    expect(pts[2]?.v).toBeCloseTo(0.4, 6);
  });

  it('caps points and validates options', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ offsetMs: i - 50, rating: 'GREAT' }));
    expect(offsetStrip(many, { maxPoints: 10 }).length).toBe(10);
    expect(offsetStrip([{ offsetMs: 5, rating: 'PERFECT' }])[0]?.u).toBe(1);
    expect(() => offsetStrip([], { windowMs: 0 })).toThrow(RangeError);
    expect(() => offsetStrip([], { maxPoints: 0 })).toThrow(RangeError);
  });
});

describe('shader contract', () => {
  it('builds clamped uniforms and validates all dialects', () => {
    const u = sparkUniforms(1.5, 2, 0.8, 2);
    expect(u).toEqual({ uTime: 1.5, uBloom: 0.8, uIntensity: 2, uPixelRatio: 2 });
    expect(sparkUniforms(NaN, -1, 9, 0)).toMatchObject({ uTime: 0, uIntensity: 0, uBloom: 1, uPixelRatio: 1 });
    expect(validateShaderSources()).toEqual([
      'SPARK_WGSL',
      'SPARK_GLSL',
      'SPARK_GLSL_FRAG',
      'RING_WGSL',
      'RING_GLSL',
    ]);
  });
});
