import { describe, expect, it } from 'vitest';
import {
  NoteHighway,
  NOTE_PENDING,
  NOTE_HIT,
  NOTE_MISSED,
} from '../highway.js';
import { createHitTestResult } from '../types.js';

function highway(): NoteHighway {
  // hitS 0, spawnS -400, approach 2000ms → 0.2 px/ms.
  return new NoteHighway({ maxNotes: 8, laneCount: 4, hitS: 0, spawnS: -400, approachMs: 2000, missMs: 150 });
}

describe('coordinates', () => {
  it('maps time to the travel axis exactly', () => {
    const h = highway();
    expect(h.pxPerMs).toBe(0.2);
    expect(h.timeToAxis(1000, 0)).toBe(-200); // due in 1s: halfway down
    expect(h.timeToAxis(1000, 1000)).toBe(0); // arrival == hit line
    expect(h.timeToAxis(1000, 1100)).toBe(20); // 100ms late: past the line
    expect(h.timeToAxis(3000, 0)).toBe(-600); // beyond spawn: still linear
  });

  it('update writes a reusable frame with continuous coordinates', () => {
    const h = highway();
    h.spawn(1000, 0, 4);
    h.spawn(2000, 2, 8);
    const frame = h.createFrame();
    const sRef = frame.s;
    h.update(500, frame);
    expect(frame.nowMs).toBe(500);
    expect(frame.count).toBe(2);
    expect(frame.s[0]).toBeCloseTo(-100, 9);
    expect(frame.s[1]).toBeCloseTo(-300, 9);
    expect(frame.time[0]).toBe(1000);
    expect(frame.lane[1]).toBe(2);
    expect(frame.slot[1]).toBe(8);
    // Same buffers reused on the next tick — zero allocation.
    h.update(600, frame);
    expect(frame.s).toBe(sRef);
    expect(frame.s[0]).toBeCloseTo(-80, 9);
    expect(frame.count).toBe(2);
  });

  it('hides notes outside the approach window', () => {
    const h = highway();
    h.spawn(10000, 1);
    const frame = h.createFrame();
    h.update(0, frame);
    expect(frame.count).toBe(0);
    h.update(8000, frame); // exactly at the window edge (10000 - 8000 = 2000)
    expect(frame.count).toBe(1);
  });
});

describe('spawning', () => {
  it('spawns grid patterns and skips negative lanes', () => {
    const h = highway();
    const n = h.spawnGrid(0, 4, 125, [0, -1, 1, 2]);
    expect(n).toBe(3);
    expect(h.count).toBe(3);
    expect(h.timeAt(0)).toBe(0);
    expect(h.laneAt(1)).toBe(1);
    expect(h.timeAt(1)).toBe(250);
    expect(h.slotAt(2)).toBe(3);
    expect(h.stateAt(0)).toBe(NOTE_PENDING);
  });

  it('refuses to grow past capacity', () => {
    const h = new NoteHighway({ maxNotes: 2, laneCount: 2 });
    expect(h.spawn(0, 0)).toBe(true);
    expect(h.spawn(100, 1)).toBe(true);
    expect(h.spawn(200, 0)).toBe(false);
    expect(h.count).toBe(2);
    expect(h.spawnGrid(1000, 4, 100, [0, 0, 0, 0])).toBe(0);
  });

  it('rejects invalid lanes fast', () => {
    const h = highway();
    expect(() => h.spawn(0, 4)).toThrow(RangeError);
    expect(() => h.spawn(0, -1)).toThrow(RangeError);
  });

  it('ignores degenerate grid input', () => {
    const h = highway();
    expect(h.spawnGrid(0, 0, 125, [0])).toBe(0);
    expect(h.spawnGrid(0, 4, 0, [0, 0, 0, 0])).toBe(0);
    expect(h.spawn(NaN, 0)).toBe(false);
    expect(h.count).toBe(0);
  });

  it('reset clears notes and counters while reusing buffers', () => {
    const h = highway();
    h.spawn(0, 0);
    h.markHit(0);
    h.reset();
    expect(h.count).toBe(0);
    expect(h.hits).toBe(0);
    expect(h.spawn(500, 1)).toBe(true);
    expect(h.stateAt(0)).toBe(NOTE_PENDING);
  });

  it('rejects bad constructor options', () => {
    expect(() => new NoteHighway({ maxNotes: 0 })).toThrow(RangeError);
    expect(() => new NoteHighway({ laneCount: 0 })).toThrow(RangeError);
    expect(() => new NoteHighway({ hitS: 5, spawnS: 5 })).toThrow(RangeError);
    expect(() => new NoteHighway({ approachMs: -1 })).toThrow(RangeError);
    expect(() => new NoteHighway({ missMs: -1 })).toThrow(RangeError);
  });
});

describe('settling (hit / miss)', () => {
  it('auto-misses notes past the miss window and counts them', () => {
    const h = highway();
    h.spawn(1000, 0);
    const frame = h.createFrame();
    h.update(1000 + 151, frame);
    expect(h.stateAt(0)).toBe(NOTE_MISSED);
    expect(h.misses).toBe(1);
    expect(frame.count).toBe(0);
  });

  it('keeps boundary notes alive (inclusive window)', () => {
    const h = highway();
    h.spawn(1000, 0);
    const frame = h.createFrame();
    h.update(1000 + 150, frame);
    expect(h.stateAt(0)).toBe(NOTE_PENDING);
    expect(frame.count).toBe(1);
  });

  it('marks hits and hides them from later frames', () => {
    const h = highway();
    h.spawn(1000, 1);
    expect(h.markHit(0)).toBe(true);
    expect(h.stateAt(0)).toBe(NOTE_HIT);
    expect(h.hits).toBe(1);
    expect(h.markHit(0)).toBe(false);
    expect(h.markHit(99)).toBe(false);
    const frame = h.createFrame();
    h.update(1000, frame);
    expect(frame.count).toBe(0);
  });
});

describe('hitTest', () => {
  it('finds the nearest pending note in-lane with signed offset', () => {
    const h = highway();
    h.spawn(1000, 1);
    h.spawn(1200, 1);
    const out = createHitTestResult();
    const ret = h.hitTest(1, 1050, 200, out);
    expect(ret).toBe(out);
    expect(out.found).toBe(true);
    expect(out.timeMs).toBe(1000);
    expect(out.offsetMs).toBe(50); // player late by 50ms
  });

  it('reports early hits with negative offsets', () => {
    const h = highway();
    h.spawn(1000, 0);
    const out = createHitTestResult();
    h.hitTest(0, 970, 200, out);
    expect(out.found).toBe(true);
    expect(out.offsetMs).toBe(-30);
  });

  it('ignores other lanes, settled notes, and out-of-window notes', () => {
    const h = highway();
    h.spawn(1000, 0);
    h.spawn(1000, 2);
    h.markHit(1);
    const out = createHitTestResult();
    h.hitTest(1, 1000, 200, out);
    expect(out.found).toBe(false);
    expect(out.index).toBe(-1);
    h.hitTest(2, 1000, 200, out);
    expect(out.found).toBe(false); // settled
    h.hitTest(0, 1300, 200, out);
    expect(out.found).toBe(false); // 300ms away
  });

  it('breaks distance ties towards the earlier note', () => {
    const h = highway();
    h.spawn(0, 3);
    h.spawn(200, 3);
    const out = createHitTestResult();
    h.hitTest(3, 100, 150, out);
    expect(out.found).toBe(true);
    expect(out.timeMs).toBe(0);
  });

  it('rejects bad lanes and windows without throwing', () => {
    const h = highway();
    h.spawn(1000, 0);
    const out = createHitTestResult();
    h.hitTest(-1, 1000, 200, out);
    expect(out.found).toBe(false);
    h.hitTest(0, 1000, -5, out);
    expect(out.found).toBe(false);
  });

  it('reuses one result object across a full judging pass', () => {
    const h = highway();
    h.spawnGrid(0, 8, 250, [0, 1, 2, 3, 0, 1, 2, 3]);
    const out = createHitTestResult();
    let hits = 0;
    for (let k = 0; k < 8; k++) {
      h.hitTest(k % 4, k * 250, 60, out);
      if (out.found && h.markHit(out.index)) hits++;
    }
    expect(hits).toBe(8);
    expect(h.hits).toBe(8);
  });
});
