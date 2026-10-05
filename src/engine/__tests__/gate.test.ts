import { describe, expect, it } from 'vitest';
import { AsyncStateGate, GateError } from '../gate.js';
import { DrumSession } from '../session.js';
import { EngineLoop } from '../loop.js';
import { NoteHighway } from '../highway.js';

interface Mini {
  revision: number;
  mode: string;
  bpm: number;
  hits: number;
}

function gate(extra: Partial<Mini> = {}): AsyncStateGate<Mini> {
  return new AsyncStateGate({ revision: 0, mode: 'acoustic', bpm: 90, hits: 0, ...extra });
}

describe('AsyncStateGate atomic publish', () => {
  it('applies an idle mutation immediately and freezes the published snapshot', async () => {
    const g = gate();
    const before = g.snapshot();
    const rev = await g.mutate((d) => {
      d.revision = 4;
      d.hits = 2;
      return d.revision;
    });
    expect(rev).toBe(4);
    expect(before.revision).toBe(0);
    expect(Object.isFrozen(before)).toBe(true);
    expect(g.snapshot()).not.toBe(before);
    expect(g.snapshot().hits).toBe(2);
    expect(g.generation).toBe(1);
    expect(g.appliedCount).toBe(1);
    expect(() => {
      g.snapshot().hits = 9;
    }).toThrow();
  });

  it('hides queued mutations from readers until commit', async () => {
    const g = gate();
    g.beginFrame();
    const pending = g.mutate((d) => {
      d.mode = 'electric';
      d.bpm = 140;
      return d.mode;
    });
    expect(g.frameOpen).toBe(true);
    expect(g.pending).toBe(1);
    expect(g.snapshot().mode).toBe('acoustic');
    expect(g.snapshot().bpm).toBe(90);
    expect(g.commit()).toBe(1);
    await expect(pending).resolves.toBe('electric');
    expect(g.frameOpen).toBe(false);
    expect(g.snapshot().mode).toBe('electric');
    expect(g.snapshot().bpm).toBe(140);
    expect(g.generation).toBe(1);
  });

  it('serializes read-modify-write so concurrent callers cannot lose updates', async () => {
    const g = gate();
    g.beginFrame();
    const first = g.mutate((d) => {
      d.hits = d.hits + 1;
      return d.hits;
    });
    const second = g.mutate((d) => {
      d.hits = d.hits + 1;
      return d.hits;
    });
    expect(g.snapshot().hits).toBe(0);
    g.commit();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(g.snapshot().hits).toBe(2);
  });

  it('shows mutators the pre-batch snapshot, then publishes once', async () => {
    const g = gate();
    g.beginFrame();
    let seen = -1;
    const pending = g.mutate((d) => {
      seen = g.snapshot().revision;
      d.revision = 99;
      return d.revision;
    });
    g.commit();
    expect(await pending).toBe(99);
    expect(seen).toBe(0);
    expect(g.snapshot().revision).toBe(99);
  });

  it('rolls back a throwing mutator without discarding the rest of the batch', async () => {
    const g = gate();
    g.beginFrame();
    const bad = g.mutate((d) => {
      d.mode = 'electric';
      d.revision = 7;
      throw new Error('boom');
    });
    const good = g.mutate((d) => {
      d.bpm = 110;
      return d.revision;
    });
    expect(g.commit()).toBe(2);
    await expect(bad).rejects.toThrow('boom');
    expect(await good).toBe(0);
    expect(g.snapshot().mode).toBe('acoustic');
    expect(g.snapshot().revision).toBe(0);
    expect(g.snapshot().bpm).toBe(110);
    expect(g.rejectedCount).toBe(1);
    expect(g.appliedCount).toBe(1);
  });

  it('rejects async mutators and leaves state unchanged', async () => {
    const g = gate();
    await expect(
      g.mutate(async (d) => {
        d.revision = 5;
        return 1;
      }),
    ).rejects.toBeInstanceOf(GateError);
    expect(g.snapshot().revision).toBe(0);
    expect(g.rejectedCount).toBe(1);
  });

  it('drains a mutation queued from inside a running drain', async () => {
    const g = gate();
    let nested: Promise<number> | null = null;
    const outer = g.mutate((d) => {
      d.revision = 1;
      nested = g.mutate((d2) => {
        d2.revision = 2;
        return d2.revision;
      });
      return d.revision;
    });
    expect(await outer).toBe(1);
    expect(await nested).toBe(2);
    expect(g.snapshot().revision).toBe(2);
    expect(g.generation).toBe(2);
  });

  it('does not bump generation on an empty commit and closes the frame', () => {
    const g = gate();
    g.beginFrame();
    g.beginFrame();
    expect(g.commit()).toBe(0);
    expect(g.frameOpen).toBe(false);
    expect(g.generation).toBe(0);
  });

  it('rejects a non-function mutator and a non-object initial state', async () => {
    const g = gate();
    await expect(g.mutate(undefined as unknown as (d: Mini) => number)).rejects.toBeInstanceOf(GateError);
    expect(() => new AsyncStateGate(null as unknown as Mini)).toThrow(GateError);
  });
});

describe('DrumSession pad and kit mutations', () => {
  it('batches a strike and a kit change into one published revision pair', async () => {
    const session = new DrumSession();
    session.beginFrame();
    const strike = session.strike('kick', 0.8, 12, { offsetMs: -8, rating: 'PERFECT' });
    const kit = session.configure({ mode: 'electric', bpm: 128, volume: 0.5 });
    expect(session.snapshot().pads.kick.strikes).toBe(0);
    expect(session.snapshot().kit.mode).toBe('acoustic');
    expect(session.deviations.length).toBe(0);
    expect(session.commit()).toBe(2);
    const struck = await strike;
    const configured = await kit;
    expect(struck.strikes).toBe(1);
    expect(struck.revision).toBe(1);
    expect(configured.mode).toBe('electric');
    expect(configured.bpm).toBe(128);
    expect(session.snapshot().revision).toBe(2);
    expect(session.snapshot().pads.kick.velocity).toBe(0.8);
    expect(session.snapshot().pads.snare.strikes).toBe(0);
    expect(session.deviations.length).toBe(1);
    expect(session.deviations.at(0).offsetMs).toBeCloseTo(-8, 5);
  });

  it('rolls the deviation back when the same strike mutation fails', async () => {
    const session = new DrumSession();
    await session.setArmed('snare', false);
    await expect(session.strike('snare', 1, 0, { offsetMs: 4, rating: 'PERFECT' })).rejects.toThrow(/disarmed/);
    expect(session.snapshot().pads.snare.strikes).toBe(0);
    expect(session.deviations.length).toBe(0);
  });

  it('rolls back a kit patch when a later field in the same patch is invalid', async () => {
    const session = new DrumSession();
    await expect(session.configure({ mode: 'electric', bpm: 999 })).rejects.toThrow(RangeError);
    expect(session.snapshot().kit.mode).toBe('acoustic');
    expect(session.snapshot().kit.bpm).toBe(90);
    expect(session.snapshot().revision).toBe(0);
    await expect(session.configure({})).rejects.toThrow(/at least one/);
    await expect(session.strike('kick', 2, 0)).rejects.toThrow(RangeError);
    expect(session.snapshot().pads.kick.strikes).toBe(0);
  });
});

describe('EngineLoop gate hook', () => {
  it('commits queued strikes at the next step and flushes on stop', async () => {
    const session = new DrumSession();
    const highway = new NoteHighway({ maxNotes: 4, laneCount: 1 });
    const frame = highway.createFrame();
    const loop = new EngineLoop(highway, frame, { gate: session.gate });
    loop.step(0);
    expect(session.gate.frameOpen).toBe(true);
    const pending = session.strike('floor', 1, 10);
    expect(session.snapshot().pads.floor.strikes).toBe(0);
    loop.step(16);
    await pending;
    expect(session.snapshot().pads.floor.strikes).toBe(1);
    expect(session.gate.frameOpen).toBe(true);
    const leftover = session.configure({ muted: true });
    loop.stop();
    await leftover;
    expect(session.snapshot().kit.muted).toBe(true);
    expect(session.gate.frameOpen).toBe(false);
    expect(session.gate.pending).toBe(0);
  });
});
