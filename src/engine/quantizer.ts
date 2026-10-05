/**
 * `PolyrhythmQuantizer` — zero-allocation grid scorer for the drum engine.
 *
 * The grid is a uniform division of one repeating cycle:
 * - `slotsPerCycle` equal slots (e.g. 16 for 4/4 semiquavers, 14 for 7/8
 *   semiquavers, 7 for a 7-against-4/4 polyrhythm),
 * - `quartersPerCycle` cycle length in quarter notes (4 for 4/4, 3.5 for 7/8,
 *   4 for 7-against-4/4).
 *
 * Two factory styles cover both musical cases with the same O(1) core:
 * - `fromMeter(meter, subdivPerBeat, ...)` — odd-meter subdivisions such as
 *   7/8, 5/4, 11/16 against their own bar,
 * - `polyrhythm(divisions, refQuarters, ...)` — N equal attacks laid across a
 *   reference span, e.g. 7 hits against one 4/4 bar.
 *
 * Hot-path contract: `scoreTick` / `scoreMs` perform pure arithmetic into a
 * caller-owned {@link QuantizeResult} and return that same reference. They
 * allocate nothing — no objects, arrays, closures, or iterators. Grid
 * line tables are preallocated `Float64Array`s refreshed only by the cold
 * paths (`constructor`, `configure`, `setBpm`, `setWindows`).
 */
import { HitRating, type MeterSig, type QuantizeResult } from './types.js';

export interface QuantizerOptions {
  /** Tempo in beats (quarter notes) per minute. Must be > 0. */
  bpm: number;
  /** MIDI ticks per quarter note. Integer > 0. Defaults to 480. */
  ticksPerQuarter?: number;
  /** Equal grid divisions per cycle. Integer >= 1. */
  slotsPerCycle: number;
  /** Cycle length in quarter notes. Must be > 0. */
  quartersPerCycle: number;
  /** |offset| <= perfectMs rates PERFECT. Defaults to 45. */
  perfectMs?: number;
  /** |offset| <= greatMs rates GREAT, otherwise MISS. Defaults to 120. */
  greatMs?: number;
  /** Human label kept for HUD/debug, e.g. '7/8' or '7:4'. */
  label?: string;
}

export interface MeterGridOptions {
  bpm: number;
  ticksPerQuarter?: number;
  perfectMs?: number;
  greatMs?: number;
  label?: string;
}

const DEFAULT_TPQ = 480;
const DEFAULT_PERFECT_MS = 45;
const DEFAULT_GREAT_MS = 120;

function assertOptions(o: QuantizerOptions): void {
  if (!Number.isFinite(o.bpm) || o.bpm <= 0) {
    throw new RangeError(`PolyrhythmQuantizer: bpm must be > 0, got ${o.bpm}`);
  }
  const tpq = o.ticksPerQuarter ?? DEFAULT_TPQ;
  if (!Number.isInteger(tpq) || tpq <= 0) {
    throw new RangeError(`PolyrhythmQuantizer: ticksPerQuarter must be a positive integer, got ${tpq}`);
  }
  if (!Number.isInteger(o.slotsPerCycle) || o.slotsPerCycle < 1) {
    throw new RangeError(`PolyrhythmQuantizer: slotsPerCycle must be an integer >= 1, got ${o.slotsPerCycle}`);
  }
  if (!Number.isFinite(o.quartersPerCycle) || o.quartersPerCycle <= 0) {
    throw new RangeError(`PolyrhythmQuantizer: quartersPerCycle must be > 0, got ${o.quartersPerCycle}`);
  }
  const perfect = o.perfectMs ?? DEFAULT_PERFECT_MS;
  const great = o.greatMs ?? DEFAULT_GREAT_MS;
  if (!(perfect >= 0) || !(great >= perfect)) {
    throw new RangeError(
      `PolyrhythmQuantizer: require 0 <= perfectMs <= greatMs, got ${perfect}/${great}`,
    );
  }
}

/**
 * Build grid dimensions for a meter with `subdivPerBeat` subdivisions of each
 * beat unit. Examples:
 * - 4/4 semiquavers: `fromMeter({4,4}, 4, ...)` → 16 slots, 4 quarters.
 * - 7/8 semiquavers: `fromMeter({7,8}, 2, ...)` → 14 slots, 3.5 quarters.
 * - 5/4 quavers:     `fromMeter({5,4}, 2, ...)` → 10 slots, 5 quarters.
 */
export function meterGrid(
  meter: MeterSig,
  subdivPerBeat: number,
  opts: MeterGridOptions,
): QuantizerOptions {
  if (!Number.isInteger(meter.beats) || meter.beats < 1) {
    throw new RangeError(`meterGrid: beats must be an integer >= 1, got ${meter.beats}`);
  }
  if (![2, 4, 8, 16, 32].includes(meter.unit)) {
    throw new RangeError(`meterGrid: unit must be 2|4|8|16|32, got ${meter.unit}`);
  }
  if (!Number.isInteger(subdivPerBeat) || subdivPerBeat < 1) {
    throw new RangeError(`meterGrid: subdivPerBeat must be an integer >= 1, got ${subdivPerBeat}`);
  }
  return {
    bpm: opts.bpm,
    ticksPerQuarter: opts.ticksPerQuarter ?? DEFAULT_TPQ,
    slotsPerCycle: meter.beats * subdivPerBeat,
    quartersPerCycle: (meter.beats * 4) / meter.unit,
    perfectMs: opts.perfectMs ?? DEFAULT_PERFECT_MS,
    greatMs: opts.greatMs ?? DEFAULT_GREAT_MS,
    label: opts.label ?? `${meter.beats}/${meter.unit}`,
  };
}

/**
 * Build grid dimensions for an N-against-M polyrhythm: `divisions` equal
 * attacks spread over `refQuarters` quarter notes. Example: 7 hits against
 * one 4/4 bar is `polyrhythm(7, 4, ...)` → 7 slots, 4 quarters.
 */
export function polyrhythm(
  divisions: number,
  refQuarters: number,
  opts: MeterGridOptions,
): QuantizerOptions {
  if (!Number.isInteger(divisions) || divisions < 1) {
    throw new RangeError(`polyrhythm: divisions must be an integer >= 1, got ${divisions}`);
  }
  if (!Number.isFinite(refQuarters) || refQuarters <= 0) {
    throw new RangeError(`polyrhythm: refQuarters must be > 0, got ${refQuarters}`);
  }
  return {
    bpm: opts.bpm,
    ticksPerQuarter: opts.ticksPerQuarter ?? DEFAULT_TPQ,
    slotsPerCycle: divisions,
    quartersPerCycle: refQuarters,
    perfectMs: opts.perfectMs ?? DEFAULT_PERFECT_MS,
    greatMs: opts.greatMs ?? DEFAULT_GREAT_MS,
    label: opts.label ?? `${divisions}:${refQuarters}`,
  };
}

export class PolyrhythmQuantizer {
  private _bpm: number;
  private _tpq: number;
  private _slots: number;
  private _quarters: number;
  private _perfectMs: number;
  private _greatMs: number;
  readonly label: string;

  private _quarterMs = 0;
  private _cycleMs = 0;
  private _slotMs = 0;
  private _ticksPerCycle = 0;
  private _ticksPerSlot = 0;
  private _gridMs: Float64Array;
  private _gridTick: Float64Array;

  constructor(opts: QuantizerOptions) {
    assertOptions(opts);
    this._bpm = opts.bpm;
    this._tpq = opts.ticksPerQuarter ?? DEFAULT_TPQ;
    this._slots = opts.slotsPerCycle;
    this._quarters = opts.quartersPerCycle;
    this._perfectMs = opts.perfectMs ?? DEFAULT_PERFECT_MS;
    this._greatMs = opts.greatMs ?? DEFAULT_GREAT_MS;
    this.label = opts.label ?? `${this._slots}/${this._quarters}q`;
    this._gridMs = new Float64Array(this._slots);
    this._gridTick = new Float64Array(this._slots);
    this.recompute();
  }

  // ---- cold-path configuration (may allocate only when growing tables) ----

  /** Recompute derived timing and refill the grid tables. No growth here. */
  private recompute(): void {
    this._quarterMs = 60000 / this._bpm;
    this._cycleMs = this._quarters * this._quarterMs;
    this._slotMs = this._cycleMs / this._slots;
    this._ticksPerCycle = this._quarters * this._tpq;
    this._ticksPerSlot = this._ticksPerCycle / this._slots;
    const gms = this._gridMs;
    const gtk = this._gridTick;
    for (let i = 0; i < this._slots; i++) {
      gms[i] = i * this._slotMs;
      gtk[i] = i * this._ticksPerSlot;
    }
  }

  /**
   * Full reconfiguration. Reallocates the grid tables only when the new slot
   * count exceeds current capacity; otherwise it reuses them (cold path, but
   * still allocation-conscious for live meter changes between songs).
   */
  configure(opts: QuantizerOptions): void {
    assertOptions(opts);
    this._bpm = opts.bpm;
    this._tpq = opts.ticksPerQuarter ?? DEFAULT_TPQ;
    this._perfectMs = opts.perfectMs ?? DEFAULT_PERFECT_MS;
    this._greatMs = opts.greatMs ?? DEFAULT_GREAT_MS;
    this._quarters = opts.quartersPerCycle;
    if (opts.slotsPerCycle !== this._slots) {
      this._slots = opts.slotsPerCycle;
      this._gridMs = new Float64Array(this._slots);
      this._gridTick = new Float64Array(this._slots);
    }
    this.recompute();
  }

  /** Live tempo change. Recalculates the ms side; tick side is tempo-free. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError(`PolyrhythmQuantizer.setBpm: bpm must be > 0, got ${bpm}`);
    }
    this._bpm = bpm;
    this.recompute();
  }

  /** Live judgement-window change. Thresholds are inclusive. */
  setWindows(perfectMs: number, greatMs: number): void {
    if (!(perfectMs >= 0) || !(greatMs >= perfectMs)) {
      throw new RangeError(
        `PolyrhythmQuantizer.setWindows: require 0 <= perfectMs <= greatMs, got ${perfectMs}/${greatMs}`,
      );
    }
    this._perfectMs = perfectMs;
    this._greatMs = greatMs;
  }

  // ---- read-only derived state ----

  get bpm(): number {
    return this._bpm;
  }
  get ticksPerQuarter(): number {
    return this._tpq;
  }
  get slotsPerCycle(): number {
    return this._slots;
  }
  get quartersPerCycle(): number {
    return this._quarters;
  }
  get perfectMs(): number {
    return this._perfectMs;
  }
  get greatMs(): number {
    return this._greatMs;
  }
  get quarterMs(): number {
    return this._quarterMs;
  }
  get cycleMs(): number {
    return this._cycleMs;
  }
  get slotMs(): number {
    return this._slotMs;
  }
  get ticksPerCycle(): number {
    return this._ticksPerCycle;
  }
  get ticksPerSlot(): number {
    return this._ticksPerSlot;
  }
  /** Preallocated grid-line times within one cycle, in ms. Do not mutate. */
  get gridMsTable(): Float64Array {
    return this._gridMs;
  }
  /** Preallocated grid-line positions within one cycle, in ticks. Do not mutate. */
  get gridTickTable(): Float64Array {
    return this._gridTick;
  }

  /** Absolute ms time of grid slot `slot` at the given cycle index. */
  gridTimeMs(slot: number, cycle: number): number {
    return (cycle * this._slots + slot) * this._slotMs;
  }

  /** Absolute tick of grid slot `slot` at the given cycle index. */
  gridTimeTick(slot: number, cycle: number): number {
    return (cycle * this._slots + slot) * this._ticksPerSlot;
  }

  // ---- hot path: zero-allocation scoring (O(1), pure arithmetic) ----

  /**
   * Score a raw MIDI tick against the grid.
   *
   * Writes every field of `out` and returns the same reference. Positive
   * offsets mean the hit landed late (after the grid line); negative means
   * early. Exact-half-slot inputs round towards the later slot.
   */
  scoreTick(tick: number, out: QuantizeResult): QuantizeResult {
    const tpc = this._ticksPerCycle;
    const slots = this._slots;
    let c = tick % tpc;
    if (c < 0) c += tpc;
    const exact = (c / tpc) * slots;
    let nearest = Math.round(exact);
    let delta: number;
    if (nearest >= slots) {
      nearest = 0;
      delta = exact - slots;
    } else {
      delta = exact - nearest;
    }
    const offsetTicks = delta * this._ticksPerSlot;
    const offsetMs = delta * this._slotMs;
    const abs = offsetMs < 0 ? -offsetMs : offsetMs;
    out.slot = nearest;
    out.cycle = Math.floor(tick / tpc);
    out.offsetTicks = offsetTicks;
    out.offsetMs = offsetMs;
    out.absMs = abs;
    out.rating =
      abs <= this._perfectMs ? HitRating.PERFECT : abs <= this._greatMs ? HitRating.GREAT : HitRating.MISS;
    out.gridMs = nearest * this._slotMs;
    out.gridTick = nearest * this._ticksPerSlot;
    return out;
  }

  /**
   * Score an absolute millisecond timestamp against the grid. Same
   * zero-allocation contract as {@link scoreTick}.
   */
  scoreMs(timeMs: number, out: QuantizeResult): QuantizeResult {
    const cms = this._cycleMs;
    const slots = this._slots;
    let c = timeMs % cms;
    if (c < 0) c += cms;
    const exact = (c / cms) * slots;
    let nearest = Math.round(exact);
    let delta: number;
    if (nearest >= slots) {
      nearest = 0;
      delta = exact - slots;
    } else {
      delta = exact - nearest;
    }
    const offsetMs = delta * this._slotMs;
    const abs = offsetMs < 0 ? -offsetMs : offsetMs;
    out.slot = nearest;
    out.cycle = Math.floor(timeMs / cms);
    out.offsetTicks = delta * this._ticksPerSlot;
    out.offsetMs = offsetMs;
    out.absMs = abs;
    out.rating =
      abs <= this._perfectMs ? HitRating.PERFECT : abs <= this._greatMs ? HitRating.GREAT : HitRating.MISS;
    out.gridMs = nearest * this._slotMs;
    out.gridTick = nearest * this._ticksPerSlot;
    return out;
  }

  /** Nearest slot for a tick without rating (still allocation-free). */
  nearestSlotForTick(tick: number): number {
    const tpc = this._ticksPerCycle;
    const slots = this._slots;
    let c = tick % tpc;
    if (c < 0) c += tpc;
    const nearest = Math.round((c / tpc) * slots);
    return nearest >= slots ? 0 : nearest;
  }

  /** Nearest slot for a millisecond timestamp without rating. */
  nearestSlotForMs(timeMs: number): number {
    const cms = this._cycleMs;
    const slots = this._slots;
    let c = timeMs % cms;
    if (c < 0) c += cms;
    const nearest = Math.round((c / cms) * slots);
    return nearest >= slots ? 0 : nearest;
  }
}
