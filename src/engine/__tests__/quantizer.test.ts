import { describe, expect, it } from 'vitest';
import {
  PolyrhythmQuantizer,
  meterGrid,
  polyrhythm,
} from '../quantizer.js';
import { createQuantizeResult } from '../types.js';

const TPQ = 480;

/** Classic 4/4 semiquaver grid @120bpm: slot = 125ms = 120 ticks. */
function fourFour120(): PolyrhythmQuantizer {
  return new PolyrhythmQuantizer({
    bpm: 120,
    ticksPerQuarter: TPQ,
    slotsPerCycle: 16,
    quartersPerCycle: 4,
  });
}

describe('derived timing', () => {
  it('computes the 4/4 @120 grid exactly', () => {
    const q = fourFour120();
    expect(q.quarterMs).toBe(500);
    expect(q.cycleMs).toBe(2000);
    expect(q.slotMs).toBe(125);
    expect(q.ticksPerCycle).toBe(1920);
    expect(q.ticksPerSlot).toBe(120);
    expect(q.slotsPerCycle).toBe(16);
    expect(q.perfectMs).toBe(45);
    expect(q.greatMs).toBe(120);
  });

  it('preallocates grid tables with exact line positions', () => {
    const q = fourFour120();
    expect(q.gridMsTable).toBeInstanceOf(Float64Array);
    expect(q.gridMsTable.length).toBe(16);
    expect(q.gridMsTable[0]).toBe(0);
    expect(q.gridMsTable[4]).toBe(500);
    expect(q.gridTickTable[4]).toBe(480);
    expect(q.gridTickTable[15]).toBe(1800);
  });

  it('sizes a 7/8 semiquaver grid (odd meter)', () => {
    const q = new PolyrhythmQuantizer(meterGrid({ beats: 7, unit: 8 }, 2, { bpm: 120 }));
    expect(q.slotsPerCycle).toBe(14);
    expect(q.quartersPerCycle).toBe(3.5);
    expect(q.cycleMs).toBe(1750);
    expect(q.slotMs).toBe(125);
    expect(q.ticksPerCycle).toBe(1680);
    expect(q.label).toBe('7/8');
  });

  it('sizes 5/4 and 11/16 grids', () => {
    const five = new PolyrhythmQuantizer(meterGrid({ beats: 5, unit: 4 }, 2, { bpm: 100 }));
    expect(five.slotsPerCycle).toBe(10);
    expect(five.quartersPerCycle).toBe(5);
    expect(five.cycleMs).toBe(3000);
    const eleven = new PolyrhythmQuantizer(meterGrid({ beats: 11, unit: 16 }, 1, { bpm: 100 }));
    expect(eleven.slotsPerCycle).toBe(11);
    expect(eleven.quartersPerCycle).toBe(2.75);
  });

  it('sizes a 7-against-4/4 polyrhythm across the reference bar', () => {
    const q = new PolyrhythmQuantizer(polyrhythm(7, 4, { bpm: 120 }));
    expect(q.slotsPerCycle).toBe(7);
    expect(q.cycleMs).toBe(2000);
    expect(q.slotMs).toBeCloseTo(2000 / 7, 12);
    expect(q.ticksPerSlot).toBeCloseTo(1920 / 7, 12);
  });
});

describe('scoreTick on the 4/4 grid', () => {
  it('scores exact grid lines with zero offset', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    expect(q.scoreTick(0, out)).toBe(out);
    expect(out.slot).toBe(0);
    expect(out.cycle).toBe(0);
    expect(out.offsetTicks).toBe(0);
    expect(out.offsetMs).toBe(0);
    expect(out.absMs).toBe(0);
    expect(out.rating).toBe('PERFECT');

    q.scoreTick(120, out);
    expect(out.slot).toBe(1);
    expect(out.rating).toBe('PERFECT');
  });

  it('wraps bars: tick 1920 opens cycle 1 on slot 0', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    q.scoreTick(1920, out);
    expect(out.slot).toBe(0);
    expect(out.cycle).toBe(1);
    expect(out.offsetMs).toBe(0);
    q.scoreTick(1920 * 3 + 240, out);
    expect(out.cycle).toBe(3);
    expect(out.slot).toBe(2);
  });

  it('signs offsets: early hits negative, late hits positive', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    q.scoreTick(110, out); // 10 ticks before slot 1
    expect(out.slot).toBe(1);
    expect(out.offsetTicks).toBeCloseTo(-10, 9);
    expect(out.offsetMs).toBeCloseTo(-10.416666666666668, 9);
    expect(out.rating).toBe('PERFECT');
    q.scoreTick(130, out); // 10 ticks after slot 1
    expect(out.slot).toBe(1);
    expect(out.offsetTicks).toBeCloseTo(10, 9);
  });

  it('rounds exact half-slots towards the later slot', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    q.scoreTick(60, out); // exactly between slot 0 and 1
    expect(out.slot).toBe(1);
    expect(out.offsetTicks).toBeCloseTo(-60, 9);
    expect(out.offsetMs).toBeCloseTo(-62.5, 9);
  });

  it('handles negative ticks by wrapping into cycle -1', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    q.scoreTick(-1, out);
    expect(out.cycle).toBe(-1);
    expect(out.slot).toBe(0);
    expect(out.absMs).toBeCloseTo(1.0416666666666667, 6);
    expect(out.rating).toBe('PERFECT');
  });

  it('stays exact for very large ticks', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    const tick = 1_000_000_000;
    q.scoreTick(tick, out);
    expect(out.cycle).toBe(Math.floor(tick / 1920));
    expect(out.slot).toBe(q.nearestSlotForTick(tick));
    expect(Number.isFinite(out.offsetMs)).toBe(true);
  });
});

describe('millisecond ratings (8th-note grid @120: 250ms slots)', () => {
  const q = () =>
    new PolyrhythmQuantizer({ bpm: 120, slotsPerCycle: 8, quartersPerCycle: 4 });

  it('rates exact grid lines PERFECT', () => {
    const qu = q();
    const out = createQuantizeResult();
    qu.scoreMs(250, out);
    expect(out.slot).toBe(1);
    expect(out.offsetMs).toBe(0);
    expect(out.rating).toBe('PERFECT');
    qu.scoreMs(2000, out);
    expect(out.slot).toBe(0);
    expect(out.cycle).toBe(1);
    expect(out.rating).toBe('PERFECT');
  });

  it('applies the 45ms / 120ms windows around the line', () => {
    const qu = q();
    const out = createQuantizeResult();
    qu.scoreMs(206, out); // 44ms early of slot 1
    expect(out.slot).toBe(1);
    expect(out.absMs).toBeCloseTo(44, 6);
    expect(out.rating).toBe('PERFECT');
    qu.scoreMs(204, out); // 46ms early
    expect(out.absMs).toBeCloseTo(46, 6);
    expect(out.rating).toBe('GREAT');
    qu.scoreMs(131, out); // 119ms early
    expect(out.absMs).toBeCloseTo(119, 6);
    expect(out.rating).toBe('GREAT');
    qu.scoreMs(129, out); // 121ms early
    expect(out.absMs).toBeCloseTo(121, 6);
    expect(out.rating).toBe('MISS');
  });

  it('rates late hits symmetrically', () => {
    const qu = q();
    const out = createQuantizeResult();
    qu.scoreMs(371, out); // 121ms late of slot 1 (129ms before slot 2)
    expect(out.slot).toBe(1);
    expect(out.offsetMs).toBeCloseTo(121, 6);
    expect(out.rating).toBe('MISS');
    qu.scoreMs(360, out); // 110ms late
    expect(out.offsetMs).toBeCloseTo(110, 6);
    expect(out.rating).toBe('GREAT');
  });

  it('scores negative timestamps into cycle -1', () => {
    const qu = q();
    const out = createQuantizeResult();
    qu.scoreMs(-10, out);
    expect(out.cycle).toBe(-1);
    expect(out.slot).toBe(0);
    expect(out.offsetMs).toBeCloseTo(-10, 9);
    expect(out.rating).toBe('PERFECT');
  });
});

describe('odd-meter and polyrhythm scoring', () => {
  it('scores 7/8 grid lines and the bar wrap', () => {
    const q = new PolyrhythmQuantizer(meterGrid({ beats: 7, unit: 8 }, 2, { bpm: 120 }));
    const out = createQuantizeResult();
    q.scoreTick(840, out); // slot 7, the middle of the bar
    expect(out.slot).toBe(7);
    expect(out.offsetMs).toBe(0);
    expect(out.rating).toBe('PERFECT');
    q.scoreTick(1680, out);
    expect(out.slot).toBe(0);
    expect(out.cycle).toBe(1);
  });

  it('scores each of the 7 attacks against 4/4 with zero offset', () => {
    const q = new PolyrhythmQuantizer(polyrhythm(7, 4, { bpm: 120 }));
    const out = createQuantizeResult();
    for (let k = 0; k < 7; k++) {
      q.scoreTick((k * 1920) / 7, out);
      expect(out.slot).toBe(k);
      expect(out.offsetMs).toBeCloseTo(0, 9);
      expect(out.rating).toBe('PERFECT');
    }
  });

  it('rates the midpoint of a 7:4 cell as MISS (far from any line)', () => {
    const q = new PolyrhythmQuantizer(polyrhythm(7, 4, { bpm: 120 }));
    const out = createQuantizeResult();
    q.scoreMs(2000 / 7 / 2, out); // halfway between attack 0 and 1
    expect(out.absMs).toBeCloseTo(2000 / 14, 9);
    expect(out.rating).toBe('MISS');
  });

  it('keeps tick and ms scoring in agreement', () => {
    const q = new PolyrhythmQuantizer(polyrhythm(7, 4, { bpm: 120 }));
    const a = createQuantizeResult();
    const b = createQuantizeResult();
    const tick = 1000;
    q.scoreTick(tick, a);
    q.scoreMs((tick / q.ticksPerCycle) * q.cycleMs, b);
    expect(b.slot).toBe(a.slot);
    expect(b.offsetMs).toBeCloseTo(a.offsetMs, 6);
    expect(b.rating).toBe(a.rating);
  });
});

describe('live reconfiguration', () => {
  it('setBpm rescales ms timing while ticks stay put', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    q.scoreMs(125, out);
    expect(out.slot).toBe(1);
    expect(out.offsetMs).toBe(0);
    q.setBpm(60);
    expect(q.slotMs).toBe(250);
    expect(q.ticksPerSlot).toBe(120);
    q.scoreMs(125, out);
    expect(out.slot).toBe(1); // halfway between 0 and 250ms rounds up
    expect(out.offsetMs).toBe(-125);
    expect(out.rating).toBe('MISS');
    q.scoreTick(120, out);
    expect(out.slot).toBe(1);
    expect(out.offsetMs).toBe(0);
  });

  it('setWindows changes ratings immediately', () => {
    const q = fourFour120();
    const out = createQuantizeResult();
    q.scoreMs(100, out); // 25ms early of slot 1
    expect(out.rating).toBe('PERFECT');
    q.setWindows(10, 20);
    q.scoreMs(100, out);
    expect(out.rating).toBe('MISS');
    q.setWindows(45, 120);
    q.scoreMs(100, out);
    expect(out.rating).toBe('PERFECT');
  });

  it('configure reuses tables for same slot counts, grows for larger', () => {
    const q = fourFour120();
    const msTable = q.gridMsTable;
    q.configure({ bpm: 100, slotsPerCycle: 16, quartersPerCycle: 4 });
    expect(q.gridMsTable).toBe(msTable);
    expect(q.slotMs).toBe(150);
    q.configure({ bpm: 100, slotsPerCycle: 32, quartersPerCycle: 4 });
    expect(q.gridMsTable.length).toBe(32);
    expect(q.slotMs).toBe(75);
    const out = createQuantizeResult();
    q.scoreTick(60, out);
    expect(out.slot).toBe(1);
  });

  it('gridTimeMs / gridTimeTick agree with the cycle math', () => {
    const q = fourFour120();
    expect(q.gridTimeMs(2, 3)).toBe(3 * 2000 + 2 * 125);
    expect(q.gridTimeTick(2, 3)).toBe(3 * 1920 + 2 * 120);
  });
});

describe('zero-allocation contract', () => {
  it('returns the same result object and overwrites every field', () => {
    // 8th-note grid: MISS is reachable (max offset 125ms > 120ms window).
    const q = new PolyrhythmQuantizer({ bpm: 120, slotsPerCycle: 8, quartersPerCycle: 4 });
    const out = createQuantizeResult();
    q.scoreMs(129, out);
    expect(out.rating).toBe('MISS');
    const ret = q.scoreMs(250, out);
    expect(ret).toBe(out);
    expect(out.rating).toBe('PERFECT');
    expect(out.offsetMs).toBe(0);
    expect(out.slot).toBe(1);
  });

  it('never reallocates grid tables across thousands of scores', () => {
    const q = new PolyrhythmQuantizer(polyrhythm(7, 4, { bpm: 132 }));
    const msTable = q.gridMsTable;
    const tickTable = q.gridTickTable;
    const out = createQuantizeResult();
    for (let i = -5000; i < 5000; i++) {
      q.scoreTick(i * 37, out);
      q.scoreMs(i * 13.7, out);
    }
    expect(q.gridMsTable).toBe(msTable);
    expect(q.gridTickTable).toBe(tickTable);
    expect(q.gridMsTable.length).toBe(7);
  });
});

describe('validation', () => {
  it('rejects bad constructor options', () => {
    expect(() => new PolyrhythmQuantizer({ bpm: 0, slotsPerCycle: 16, quartersPerCycle: 4 })).toThrow(
      RangeError,
    );
    expect(() => new PolyrhythmQuantizer({ bpm: 120, slotsPerCycle: 0, quartersPerCycle: 4 })).toThrow(
      RangeError,
    );
    expect(() => new PolyrhythmQuantizer({ bpm: 120, slotsPerCycle: 16, quartersPerCycle: -1 })).toThrow(
      RangeError,
    );
    expect(
      () => new PolyrhythmQuantizer({ bpm: 120, slotsPerCycle: 16, quartersPerCycle: 4, ticksPerQuarter: 0 }),
    ).toThrow(RangeError);
    expect(
      () => new PolyrhythmQuantizer({ bpm: 120, slotsPerCycle: 16, quartersPerCycle: 4, perfectMs: 200, greatMs: 100 }),
    ).toThrow(RangeError);
  });

  it('rejects bad meter / poly factory input', () => {
    expect(() => meterGrid({ beats: 0, unit: 8 }, 2, { bpm: 120 })).toThrow(RangeError);
    expect(() => meterGrid({ beats: 7, unit: 8 }, 0, { bpm: 120 })).toThrow(RangeError);
    expect(() => polyrhythm(0, 4, { bpm: 120 })).toThrow(RangeError);
    expect(() => polyrhythm(7, 0, { bpm: 120 })).toThrow(RangeError);
  });

  it('rejects bad live updates', () => {
    const q = fourFour120();
    expect(() => q.setBpm(-5)).toThrow(RangeError);
    expect(() => q.setWindows(50, 40)).toThrow(RangeError);
  });
});
