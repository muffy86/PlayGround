import { describe, expect, it } from 'vitest';
import {
  MidiClock,
  MidiTickSource,
  defaultDrumLane,
  type MidiInputLike,
} from '../midi.js';

function fakeInput(): MidiInputLike & { sent: number } {
  return { onmidimessage: null, sent: 0 };
}

describe('MidiClock', () => {
  it('converts arrival ms to ticks and back exactly', () => {
    const clock = new MidiClock(120, 480, 0);
    expect(clock.ticksAtMs(500)).toBe(480); // one quarter at 120bpm
    expect(clock.msAtTick(480)).toBe(500);
    expect(clock.msAtTick(clock.ticksAtMs(1234.5))).toBeCloseTo(1234.5, 9);
  });

  it('honours tempo, resolution, and origin', () => {
    const clock = new MidiClock(60, 960, 1000);
    expect(clock.ticksAtMs(1000)).toBe(0);
    expect(clock.ticksAtMs(2000)).toBe(960);
    clock.setBpm(120);
    expect(clock.ticksAtMs(2000)).toBe(1920);
    clock.setOrigin(500);
    expect(clock.ticksAtMs(500)).toBe(0);
  });

  it('rejects bad construction and updates', () => {
    expect(() => new MidiClock(0)).toThrow(RangeError);
    expect(() => new MidiClock(120, 0)).toThrow(RangeError);
    const clock = new MidiClock(120);
    expect(() => clock.setBpm(-1)).toThrow(RangeError);
  });
});

describe('defaultDrumLane', () => {
  it('maps GM percussion to game lanes', () => {
    expect(defaultDrumLane(36)).toBe(2); // kick
    expect(defaultDrumLane(38)).toBe(1); // snare
    expect(defaultDrumLane(40)).toBe(1); // rim
    expect(defaultDrumLane(42)).toBe(0); // closed hat
    expect(defaultDrumLane(46)).toBe(0); // open hat
    expect(defaultDrumLane(48)).toBe(3); // tom
    expect(defaultDrumLane(60)).toBe(-1); // not a drum
  });
});

describe('MidiTickSource.dispatch', () => {
  it('forwards note-on as ticks with normalized velocity', () => {
    const clock = new MidiClock(120, 480, 0);
    const src = new MidiTickSource(clock);
    const got: Array<{ tick: number; note: number; vel: number }> = [];
    src.onNote((tick, note, vel) => got.push({ tick, note, vel }));
    src.dispatch({ data: [0x99, 38, 100], timeStamp: 500 });
    expect(got.length).toBe(1);
    expect(got[0].tick).toBe(480);
    expect(got[0].note).toBe(38);
    expect(got[0].vel).toBeCloseTo(100 / 127, 9);
  });

  it('ignores note-off, zero-velocity note-on, CC, and empty data', () => {
    const clock = new MidiClock(120, 480, 0);
    const src = new MidiTickSource(clock);
    let calls = 0;
    src.onNote(() => calls++);
    src.dispatch({ data: [0x80, 38, 64], timeStamp: 10 }); // note-off
    src.dispatch({ data: [0x90, 38, 0], timeStamp: 10 }); // vel 0 == off
    src.dispatch({ data: [0xb0, 7, 100], timeStamp: 10 }); // control change
    src.dispatch({ data: null, timeStamp: 10 });
    expect(calls).toBe(0);
  });

  it('accepts any MIDI channel (masks the low nibble)', () => {
    const clock = new MidiClock(120, 480, 0);
    const src = new MidiTickSource(clock);
    const notes: number[] = [];
    src.onNote((_t, n) => notes.push(n));
    for (let ch = 0; ch < 16; ch++) {
      src.dispatch({ data: [0x90 | ch, 36, 127], timeStamp: 0 });
    }
    expect(notes.length).toBe(16);
  });

  it('drops messages silently when no handler is set', () => {
    const src = new MidiTickSource(new MidiClock(120));
    expect(() => src.dispatch({ data: [0x90, 36, 100], timeStamp: 0 })).not.toThrow();
  });
});

describe('MidiTickSource wiring', () => {
  it('wires inputs through onmidimessage and unwires on detach', () => {
    const src = new MidiTickSource(new MidiClock(120));
    const a = fakeInput();
    const b = fakeInput();
    src.wire(a);
    src.wire(b);
    expect(src.attached).toBe(true);
    expect(typeof a.onmidimessage).toBe('function');
    const got: number[] = [];
    src.onNote((t) => got.push(t));
    a.onmidimessage?.({ data: [0x90, 36, 127], timeStamp: 250 });
    expect(got.length).toBe(1);
    expect(got[0]).toBe(240); // 250ms @120bpm/480tpq
    src.detach();
    expect(src.attached).toBe(false);
    expect(a.onmidimessage).toBe(null);
    expect(b.onmidimessage).toBe(null);
  });

  it('reports unsupported runtimes and refuses to attach there', async () => {
    expect(MidiTickSource.supported()).toBe(false); // node has no Web MIDI
    const src = new MidiTickSource(new MidiClock(120));
    await expect(src.attach()).resolves.toBe(false);
  });
});
