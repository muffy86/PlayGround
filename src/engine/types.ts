/**
 * Shared value types for the Phase 1 drum engine.
 *
 * All hot-path structs are plain mutable objects allocated once by the caller
 * (see `createQuantizeResult` / `NoteHighway.createFrame`) and reused every
 * frame, which is what keeps the audio/rAF hot paths at zero allocations.
 */

/** Millisecond-accuracy hit rating. Thresholds are inclusive. */
export const HitRating = {
  PERFECT: 'PERFECT',
  GREAT: 'GREAT',
  MISS: 'MISS',
} as const;
export type HitRating = (typeof HitRating)[keyof typeof HitRating];

/** A musical meter signature, e.g. `{ beats: 7, unit: 8 }` for 7/8. */
export interface MeterSig {
  beats: number;
  unit: 2 | 4 | 8 | 16 | 32;
}

/**
 * Result of scoring one tick / timestamp against the grid.
 * Reuse a single instance across calls: every `score*` method writes all
 * fields and returns the same reference it was given.
 */
export interface QuantizeResult {
  /** Nearest grid slot index in `[0, slotsPerCycle)`. */
  slot: number;
  /** Which grid cycle (bar) the input fell into. May be negative. */
  cycle: number;
  /** Signed offset from the nearest grid line, in MIDI ticks. */
  offsetTicks: number;
  /** Signed offset from the nearest grid line, in milliseconds. */
  offsetMs: number;
  /** Absolute value of `offsetMs`. */
  absMs: number;
  rating: HitRating;
  /** Absolute time of the nearest grid line within its cycle, in ms. */
  gridMs: number;
  /** Absolute tick of the nearest grid line within its cycle. */
  gridTick: number;
}

/** Allocate one reusable result object (cold path — call once, reuse forever). */
export function createQuantizeResult(): QuantizeResult {
  return {
    slot: 0,
    cycle: 0,
    offsetTicks: 0,
    offsetMs: 0,
    absMs: 0,
    rating: HitRating.MISS,
    gridMs: 0,
    gridTick: 0,
  };
}

/** Result of a lane hit-test against live highway notes. Reusable. */
export interface HitTestResult {
  found: boolean;
  /** Internal note index, or -1 when nothing was in range. */
  index: number;
  /** Signed `nowMs - noteTimeMs`. Negative means the player was early. */
  offsetMs: number;
  /** Absolute note time that was matched, or NaN when `found` is false. */
  timeMs: number;
}

/** Allocate one reusable hit-test result (cold path). */
export function createHitTestResult(): HitTestResult {
  return { found: false, index: -1, offsetMs: 0, timeMs: NaN };
}
