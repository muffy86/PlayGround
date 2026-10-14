import { describe, it, expect } from 'vitest';
import { classify, GapClicksExercise, PushPullExercise, PolyrhythmExercise, SubdivisionExercise, AccentDisplacementExercise } from '../src/exercises/exercises';

describe('timing classification', () => {
  it('perfect within ±12ms', () => {
    expect(classify(0)).toBe('perfect');
    expect(classify(-12)).toBe('perfect');
    expect(classify(12)).toBe('perfect');
  });
  it('early/late within ±35ms', () => {
    expect(classify(-20)).toBe('early');
    expect(classify(20)).toBe('late');
  });
  it('miss beyond tolerance or null', () => {
    expect(classify(80)).toBe('miss');
    expect(classify(null)).toBe('miss');
  });
});

describe('exercises schedule + score', () => {
  it('gap clicks: 16 beats over 4 bars', () => {
    const ex = new GapClicksExercise();
    const g = ex.schedule(10, 120);
    expect(g).toHaveLength(16);
    expect(ex.audibleAt(g[0], 10, 120)).toBe(true);
    expect(ex.audibleAt(g[8], 10, 120)).toBe(false);
  });
  it('push/pull offsets targets', () => {
    const ex = new PushPullExercise(); ex.offsetMs = -20;
    const g = ex.schedule(0, 60);
    expect(g[0]).toBeCloseTo(-0.02);
  });
  it('polyrhythm 3:2 grid', () => {
    const ex = new PolyrhythmExercise(); ex.poly = 3; ex.base = 2; ex.bars = 1;
    const g = ex.schedule(0, 60);
    expect(g).toHaveLength(3);
  });
  it('subdivision 16ths = 32 hits over 2 bars', () => {
    const ex = new SubdivisionExercise(); ex.div = 4;
    expect(ex.schedule(0, 120)).toHaveLength(32);
  });
  it('accent displacement rotates', () => {
    const ex = new AccentDisplacementExercise(); ex.shift = 3;
    expect(ex.isAccent(0)).toBe(true);
    expect(ex.isAccent(16 + 3)).toBe(true);
  });
  it('registerHit scores perfect', () => {
    const ex = new PushPullExercise(); ex.offsetMs = 0;
    ex.schedule(100, 120);
    const att = ex.registerHit(100.005, 0.9);
    expect(att?.verdict).toBe('perfect');
    expect(ex.finalize().accuracy).toBe(100);
  });
});
