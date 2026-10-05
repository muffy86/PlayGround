/**
 * Drum session: pad strikes and kit configuration, published only through
 * {@link AsyncStateGate}. A strike that also logs a deviation does both
 * against the same draft, so a rolled-back strike does not leave a sample.
 */
import { AsyncStateGate } from './gate.js';
import { DeviationBuffer, type DeviationRating, type DeviationSample } from './deviation.js';
import { DRUM_IDS, isDrumId, isKitMode, type DrumId, type KitMode } from './drums.js';

export interface PadSnapshot {
  velocity: number;
  strikes: number;
  lastStrikeMs: number;
  armed: boolean;
}

export interface KitSnapshot {
  mode: KitMode;
  bpm: number;
  volume: number;
  muted: boolean;
}

export interface DrumState {
  revision: number;
  kit: KitSnapshot;
  pads: Record<DrumId, PadSnapshot>;
}

export interface KitPatch {
  mode?: KitMode;
  bpm?: number;
  volume?: number;
  muted?: boolean;
}

export interface StrikeResult {
  pad: DrumId;
  velocity: number;
  strikes: number;
  lastStrikeMs: number;
  revision: number;
}

export interface SessionOptions {
  bpm?: number;
  mode?: KitMode;
  volume?: number;
  muted?: boolean;
  deviationCapacity?: number;
}

function createPads(): Record<DrumId, PadSnapshot> {
  const pads = {} as Record<DrumId, PadSnapshot>;
  for (const id of DRUM_IDS) {
    pads[id] = { velocity: 0, strikes: 0, lastStrikeMs: 0, armed: true };
  }
  return pads;
}

export function createDrumState(opts: SessionOptions = {}): DrumState {
  const bpm = opts.bpm ?? 90;
  const volume = opts.volume ?? 1;
  const mode = opts.mode ?? 'acoustic';
  if (!isKitMode(mode)) throw new RangeError(`createDrumState: bad mode ${mode}`);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new RangeError(`createDrumState: bpm out of range ${bpm}`);
  }
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError(`createDrumState: volume out of range ${volume}`);
  }
  return {
    revision: 0,
    kit: { mode, bpm, volume, muted: opts.muted ?? false },
    pads: createPads(),
  };
}

export class DrumSession {
  readonly gate: AsyncStateGate<DrumState>;
  readonly deviations: DeviationBuffer;

  constructor(opts: SessionOptions = {}) {
    this.gate = new AsyncStateGate(createDrumState(opts));
    this.deviations = new DeviationBuffer(opts.deviationCapacity ?? 512);
  }

  snapshot(): DrumState {
    return this.gate.snapshot();
  }

  beginFrame(): void {
    this.gate.beginFrame();
  }

  commit(): number {
    return this.gate.commit();
  }

  /**
   * Record a pad strike. `deviation`, when present, is pushed in the same
   * mutation as the counter update.
   */
  strike(
    pad: DrumId,
    velocity: number,
    timeMs: number,
    deviation?: Pick<DeviationSample, 'offsetMs' | 'rating'>,
  ): Promise<StrikeResult> {
    return this.gate.mutate((draft) => {
      if (!isDrumId(pad)) throw new RangeError(`strike: unknown pad "${pad}"`);
      if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) {
        throw new RangeError(`strike: velocity must be 0..1, got ${velocity}`);
      }
      if (!Number.isFinite(timeMs)) throw new RangeError(`strike: timeMs must be finite, got ${timeMs}`);
      const slot = draft.pads[pad];
      if (!slot.armed) throw new Error(`strike: pad "${pad}" is disarmed`);
      let pushed = false;
      try {
        slot.velocity = velocity;
        slot.strikes += 1;
        slot.lastStrikeMs = timeMs;
        draft.revision += 1;
        if (deviation) {
          this.deviations.push({
            drum: pad,
            timeMs,
            offsetMs: deviation.offsetMs,
            rating: deviation.rating,
          });
          pushed = true;
        }
        return {
          pad,
          velocity,
          strikes: slot.strikes,
          lastStrikeMs: timeMs,
          revision: draft.revision,
        };
      } catch (error) {
        if (pushed) this.deviations.undoLast();
        throw error;
      }
    });
  }

  /** Apply a kit patch. Empty patches and out-of-range values throw and roll back. */
  configure(patch: KitPatch): Promise<KitSnapshot> {
    return this.gate.mutate((draft) => {
      const has =
        patch.mode !== undefined ||
        patch.bpm !== undefined ||
        patch.volume !== undefined ||
        patch.muted !== undefined;
      if (!has) throw new TypeError('configure: at least one kit field is required');
      if (patch.mode !== undefined) {
        if (!isKitMode(patch.mode)) throw new RangeError(`configure: bad mode "${patch.mode}"`);
        draft.kit.mode = patch.mode;
      }
      if (patch.bpm !== undefined) {
        if (!Number.isFinite(patch.bpm) || patch.bpm < 40 || patch.bpm > 240) {
          throw new RangeError(`configure: bpm out of range ${patch.bpm}`);
        }
        draft.kit.bpm = patch.bpm;
      }
      if (patch.volume !== undefined) {
        if (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 1) {
          throw new RangeError(`configure: volume out of range ${patch.volume}`);
        }
        draft.kit.volume = patch.volume;
      }
      if (patch.muted !== undefined) {
        if (typeof patch.muted !== 'boolean') throw new TypeError('configure: muted must be boolean');
        draft.kit.muted = patch.muted;
      }
      draft.revision += 1;
      return {
        mode: draft.kit.mode,
        bpm: draft.kit.bpm,
        volume: draft.kit.volume,
        muted: draft.kit.muted,
      };
    });
  }

  /** Arm or disarm one pad. Disarmed pads reject strikes. */
  setArmed(pad: DrumId, armed: boolean): Promise<boolean> {
    return this.gate.mutate((draft) => {
      if (!isDrumId(pad)) throw new RangeError(`setArmed: unknown pad "${pad}"`);
      draft.pads[pad].armed = armed;
      draft.revision += 1;
      return armed;
    });
  }
}

/** Live session shared by the page, the rAF loop, and the WebMCP bridge. */
export const drumSession = new DrumSession();
/** Same ring the session records into. Gameplay judgement writes here directly. */
export const practiceTelemetry = drumSession.deviations;

export function isDeviationRating(value: string): value is DeviationRating {
  return value === 'PERFECT' || value === 'GREAT' || value === 'GOOD' || value === 'MISS';
}
