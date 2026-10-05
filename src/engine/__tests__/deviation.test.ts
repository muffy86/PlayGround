import { describe, expect, it } from 'vitest';
import { DeviationBuffer, rateOffset } from '../deviation.js';
import { PolyrhythmQuantizer, meterGrid } from '../quantizer.js';
import { createQuantizeResult } from '../types.js';

describe('DeviationBuffer ring', () => {
  it('keeps the same storage across pushes and overwrites the oldest', () => {
    const buf = new DeviationBuffer(3);
    const storage = buf.offsetStorage;
    buf.push({ timeMs: 1, offsetMs: 1, drum: 'kick', rating: 'PERFECT' });
    buf.push({ timeMs: 2, offsetMs: 2, drum: 'snare', rating: 'GREAT' });
    buf.push({ timeMs: 3, offsetMs: 3, drum: 'hihat', rating: 'GOOD' });
    buf.push({ timeMs: 4, offsetMs: 4, drum: 'tom1', rating: 'MISS' });
    buf.push({ timeMs: 5, offsetMs: 5, drum: 'floor', rating: 'PERFECT' });
    expect(buf.offsetStorage).toBe(storage);
    expect(buf.length).toBe(3);
    expect(buf.at(0)).toMatchObject({ timeMs: 3, drum: 'hihat', rating: 'GOOD' });
    expect(buf.at(2)).toMatchObject({ timeMs: 5, drum: 'floor', offsetMs: 5 });
    expect(() => buf.at(3)).toThrow(RangeError);
  });

  it('undoLast drops only the newest sample', () => {
    const buf = new DeviationBuffer(4);
    buf.push({ timeMs: 1, offsetMs: -4, drum: 'kick', rating: 'PERFECT' });
    buf.push({ timeMs: 2, offsetMs: 12, drum: 'snare', rating: 'PERFECT' });
    buf.undoLast();
    expect(buf.length).toBe(1);
    expect(buf.at(0).offsetMs).toBeCloseTo(-4, 5);
    buf.undoLast();
    buf.undoLast();
    expect(buf.length).toBe(0);
  });

  it('rejects bad samples, bad capacity, and bad indexes', () => {
    expect(() => new DeviationBuffer(0)).toThrow(RangeError);
    expect(() => new DeviationBuffer(1.5)).toThrow(RangeError);
    const buf = new DeviationBuffer(2);
    expect(() => buf.push({ timeMs: NaN, offsetMs: 0, drum: 'kick', rating: 'MISS' })).toThrow(RangeError);
    expect(() => buf.push({ timeMs: 0, offsetMs: 0, drum: 'cowbell' as 'kick', rating: 'MISS' })).toThrow(RangeError);
    expect(() => buf.push({ timeMs: 0, offsetMs: 0, drum: 'kick', rating: 'OK' as 'MISS' })).toThrow(RangeError);
  });

  it('reset clears samples without reallocating', () => {
    const buf = new DeviationBuffer(4);
    const storage = buf.offsetStorage;
    buf.push({ timeMs: 1, offsetMs: 9, drum: 'ride', rating: 'GREAT' });
    buf.reset();
    expect(buf.length).toBe(0);
    expect(buf.offsetStorage).toBe(storage);
    buf.push({ timeMs: 2, offsetMs: 3, drum: 'crash', rating: 'PERFECT' });
    expect(buf.at(0).drum).toBe('crash');
  });
});

describe('latency heatmap', () => {
  it('bins signed offsets and reports bias, spread, and ratings', () => {
    const buf = new DeviationBuffer(8);
    const samples = [
      { timeMs: 0, offsetMs: -20, drum: 'kick' as const, rating: 'PERFECT' as const },
      { timeMs: 10, offsetMs: 0, drum: 'kick' as const, rating: 'PERFECT' as const },
      { timeMs: 20, offsetMs: 15, drum: 'snare' as const, rating: 'PERFECT' as const },
      { timeMs: 30, offsetMs: 40, drum: 'snare' as const, rating: 'PERFECT' as const },
      { timeMs: 40, offsetMs: 130, drum: 'kick' as const, rating: 'MISS' as const },
    ];
    for (const sample of samples) buf.push(sample);
    const heat = buf.heatmap({ binMs: 10, minMs: -50, maxMs: 50, onTimeMs: 45 });
    expect(heat.bins.length).toBe(10);
    expect(heat.bins[Math.floor((-20 - -50) / 10)]).toBe(1);
    expect(heat.bins[Math.floor((0 - -50) / 10)]).toBe(1);
    expect(heat.bins[Math.floor((15 - -50) / 10)]).toBe(1);
    expect(heat.bins[Math.floor((40 - -50) / 10)]).toBe(1);
    expect(heat.total).toBe(5);
    expect(heat.inRange).toBe(4);
    expect(heat.overflow).toBe(1);
    expect(heat.underflow).toBe(0);
    expect(heat.meanMs).toBeCloseTo((-20 + 0 + 15 + 40) / 4, 6);
    const inRange = [-20, 0, 15, 40];
    const mean = inRange.reduce((s, n) => s + n, 0) / inRange.length;
    const variance = inRange.reduce((s, n) => s + (n - mean) ** 2, 0) / (inRange.length - 1);
    expect(heat.stdevMs).toBeCloseTo(Math.sqrt(variance), 6);
    expect(heat.early).toBe(1);
    expect(heat.late).toBe(3);
    expect(heat.onTime).toBe(4);
    expect(heat.byRating).toEqual({ PERFECT: 4, GREAT: 0, GOOD: 0, MISS: 1 });
    expect(heat.minObserved).toBeCloseTo(-20, 5);
    expect(heat.maxObserved).toBeCloseTo(130, 5);
  });

  it('filters by drum and reports an empty window without dividing by zero', () => {
    const buf = new DeviationBuffer(4);
    buf.push({ timeMs: 1, offsetMs: 8, drum: 'tom2', rating: 'PERFECT' });
    const empty = buf.heatmap({ drum: 'kick' });
    expect(empty.total).toBe(0);
    expect(empty.meanMs).toBe(0);
    expect(empty.stdevMs).toBe(0);
    expect(empty.minObserved).toBeNull();
    expect(empty.maxObserved).toBeNull();
    const one = buf.heatmap({ drum: 'tom2', binMs: 10, minMs: -120, maxMs: 120 });
    expect(one.total).toBe(1);
    expect(one.meanMs).toBeCloseTo(8, 5);
    expect(one.stdevMs).toBe(0);
    expect(one.onTime).toBe(1);
  });

  it('counts underflow and rejects impossible histogram options', () => {
    const buf = new DeviationBuffer(2);
    buf.push({ timeMs: 1, offsetMs: -500, drum: 'kick', rating: 'MISS' });
    const heat = buf.heatmap({ binMs: 10, minMs: -100, maxMs: 100 });
    expect(heat.underflow).toBe(1);
    expect(heat.inRange).toBe(0);
    expect(() => buf.heatmap({ binMs: 0 })).toThrow(RangeError);
    expect(() => buf.heatmap({ minMs: 10, maxMs: 10 })).toThrow(RangeError);
    expect(() => buf.heatmap({ binMs: 1, minMs: 0, maxMs: 10000 })).toThrow(/cap/);
    expect(() => buf.heatmap({ drum: 'not-a-drum' as 'kick' })).toThrow(RangeError);
  });
});

describe('rateOffset and quantizer feed', () => {
  it('uses inclusive 45ms / 120ms windows', () => {
    expect(rateOffset(0)).toBe('PERFECT');
    expect(rateOffset(-45)).toBe('PERFECT');
    expect(rateOffset(46)).toBe('GREAT');
    expect(rateOffset(-120)).toBe('GREAT');
    expect(rateOffset(121)).toBe('MISS');
  });

  it('records a 7/8 quantizer offset into the heatmap', () => {
    const q = new PolyrhythmQuantizer(meterGrid({ beats: 7, unit: 8 }, 2, { bpm: 120 }));
    const out = createQuantizeResult();
    q.scoreMs(20, out);
    expect(out.slot).toBe(0);
    expect(out.rating).toBe('PERFECT');
    const buf = new DeviationBuffer(8);
    buf.push({ timeMs: 20, offsetMs: out.offsetMs, drum: 'kick', rating: out.rating });
    const heat = buf.heatmap({ binMs: 5, minMs: -30, maxMs: 30 });
    expect(heat.total).toBe(1);
    expect(heat.byRating.PERFECT).toBe(1);
    expect(heat.meanMs).toBeCloseTo(out.offsetMs, 4);
    expect(heat.late).toBe(1);
  });
});
