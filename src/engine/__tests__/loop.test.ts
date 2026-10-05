import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteHighway } from '../highway.js';
import { EngineLoop } from '../loop.js';

function rig() {
  const highway = new NoteHighway({ maxNotes: 16, laneCount: 2, hitS: 0, spawnS: -400, approachMs: 2000 });
  const frame = highway.createFrame();
  return { highway, frame };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deterministic step', () => {
  it('updates the frame and reports wall-clock dt', () => {
    const { highway, frame } = rig();
    highway.spawn(1000, 0);
    const seen: Array<{ now: number; dt: number; count: number }> = [];
    const loop = new EngineLoop(highway, frame, {
      onFrame: (f, nowMs, dtMs) => {
        seen.push({ now: nowMs, dt: dtMs, count: f.count });
      },
    });
    loop.step(0);
    loop.step(16);
    loop.step(500);
    expect(seen.length).toBe(3);
    expect(seen[1].dt).toBe(16);
    expect(seen[2].now).toBe(500);
    expect(seen[2].count).toBe(1);
    expect(loop.frames).toBe(3);
    expect(loop.timeMs).toBe(500);
  });

  it('clamps huge deltas so background tabs cannot teleport notes', () => {
    const { highway, frame } = rig();
    const dts: number[] = [];
    const loop = new EngineLoop(highway, frame, { maxDtMs: 100, onFrame: (_f, _n, dt) => dts.push(dt) });
    loop.step(1000);
    loop.step(1000 + 30_000);
    expect(dts[1]).toBe(100);
  });

  it('floors negative or non-monotonic stamps at zero', () => {
    const { highway, frame } = rig();
    const dts: number[] = [];
    const loop = new EngineLoop(highway, frame, { onFrame: (_f, _n, dt) => dts.push(dt) });
    loop.step(500);
    loop.step(100); // clock jumped backwards
    expect(dts[1]).toBe(0);
    expect(loop.frames).toBe(2);
  });

  it('drives continuous coordinates across ticks', () => {
    const { highway, frame } = rig();
    highway.spawn(1000, 1);
    const loop = new EngineLoop(highway, frame);
    loop.step(0);
    const y0 = frame.s[0];
    loop.step(250);
    expect(frame.s[0]).toBeGreaterThan(y0); // gliding towards the hit line
    expect(frame.s[0]).toBeCloseTo(-150, 9);
    loop.step(1000);
    expect(frame.s[0]).toBeCloseTo(0, 9);
  });

  it('works without a frame consumer', () => {
    const { highway, frame } = rig();
    highway.spawn(300, 0);
    const loop = new EngineLoop(highway, frame);
    loop.step(300);
    expect(frame.count).toBe(1);
    expect(loop.frames).toBe(1);
  });

  it('rejects bad options', () => {
    const { highway, frame } = rig();
    expect(() => new EngineLoop(highway, frame, { maxDtMs: 0 })).toThrow(RangeError);
  });
});

describe('rAF wiring', () => {
  it('throws outside a browser instead of silently idling', () => {
    const { highway, frame } = rig();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const loop = new EngineLoop(highway, frame);
    expect(() => loop.start()).toThrow(/requestAnimationFrame/);
  });

  it('schedules ticks and stops cleanly', () => {
    const { highway, frame } = rig();
    const scheduled: number[] = [];
    const cancelled: number[] = [];
    let nextId = 1;
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: (t: number) => void): number => {
        void cb;
        scheduled.push(nextId);
        return nextId++;
      },
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      cancelled.push(id);
    });
    const loop = new EngineLoop(highway, frame, { onFrame: () => undefined });
    loop.start(1000);
    expect(loop.running).toBe(true);
    expect(scheduled.length).toBe(1);
    loop.start(1000); // idempotent
    expect(scheduled.length).toBe(1);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(cancelled.length).toBe(1);
    loop.stop(); // idempotent
  });

  it('pumps frames through the stubbed rAF callback', () => {
    const { highway, frame } = rig();
    highway.spawn(1200, 0);
    let captured: Array<(t: number) => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void): number => {
      captured.push(cb);
      return captured.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (_id: number): void => undefined);
    let calls = 0;
    const loop = new EngineLoop(highway, frame, {
      onFrame: () => {
        calls++;
      },
    });
    loop.start(1000);
    expect(captured.length).toBe(1);
    captured[0](1016); // fake vsync tick
    expect(calls).toBe(1);
    expect(loop.frames).toBe(1);
    expect(frame.count).toBe(1);
    loop.stop();
  });
});
