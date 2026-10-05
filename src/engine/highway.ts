/**
 * Note highway: continuous, allocation-free note coordinates for the rAF loop.
 *
 * Storage is struct-of-arrays sized once in the constructor (`maxNotes`
 * notes, `createFrame` sized likewise). Per-frame work — `update`, `hitTest`,
 * `timeToAxis` — is index arithmetic over those buffers and never allocates.
 *
 * Coordinate model: one scalar travel axis `s`. A note due at `noteMs` sits at
 * `s = hitS - (noteMs - nowMs) * pxPerMs`, so notes glide towards the hit
 * line at `hitS` at a constant, tempo-independent speed and arrive exactly
 * when `nowMs === noteMs`. The game maps `s` to canvas x (horizontal rush
 * view) or y (vertical view) — the engine stays axis-agnostic on purpose.
 */
import type { HitTestResult } from './types.js';

export const NOTE_PENDING = 0;
export const NOTE_HIT = 1;
export const NOTE_MISSED = 2;

export interface HighwayOptions {
  /** Maximum live notes. `spawn` returns false instead of growing. */
  maxNotes?: number;
  /** Number of lanes (drums). Lane ids are `0..laneCount-1`. */
  laneCount?: number;
  /** Axis coordinate of the hit line (px). */
  hitS?: number;
  /** Axis coordinate where notes spawn (px, must differ from `hitS`). */
  spawnS?: number;
  /** How far ahead of the hit line notes become visible (ms, > 0). */
  approachMs?: number;
  /** Pending notes older than this go MISSED automatically (ms, >= 0). */
  missMs?: number;
}

/** Caller-owned per-frame snapshot. Allocate once via `createFrame`. */
export interface HighwayFrame {
  /** Axis coordinate per visible note (px). Valid for `[0, count)`. */
  s: Float32Array;
  /** Absolute note time per visible note (ms). */
  time: Float64Array;
  /** Lane per visible note. */
  lane: Uint8Array;
  /** Grid slot carried from `spawn` (or -1). */
  slot: Int32Array;
  /** Internal note index per visible note (for hit marking). */
  index: Int32Array;
  /** Number of visible notes written this frame. */
  count: number;
  /** The `nowMs` this frame was computed for. */
  nowMs: number;
}

function assertHighwayOptions(o: Required<HighwayOptions>): void {
  if (!Number.isInteger(o.maxNotes) || o.maxNotes < 1) {
    throw new RangeError(`NoteHighway: maxNotes must be an integer >= 1, got ${o.maxNotes}`);
  }
  if (!Number.isInteger(o.laneCount) || o.laneCount < 1) {
    throw new RangeError(`NoteHighway: laneCount must be an integer >= 1, got ${o.laneCount}`);
  }
  if (!Number.isFinite(o.hitS) || !Number.isFinite(o.spawnS) || o.hitS === o.spawnS) {
    throw new RangeError(`NoteHighway: hitS and spawnS must be distinct finite numbers, got ${o.hitS}/${o.spawnS}`);
  }
  if (!Number.isFinite(o.approachMs) || o.approachMs <= 0) {
    throw new RangeError(`NoteHighway: approachMs must be > 0, got ${o.approachMs}`);
  }
  if (!Number.isFinite(o.missMs) || o.missMs < 0) {
    throw new RangeError(`NoteHighway: missMs must be >= 0, got ${o.missMs}`);
  }
}

export class NoteHighway {
  readonly maxNotes: number;
  readonly laneCount: number;
  readonly hitS: number;
  readonly spawnS: number;
  readonly approachMs: number;
  readonly missMs: number;
  /** Pixels travelled per millisecond along the axis. */
  readonly pxPerMs: number;

  private _time: Float64Array;
  private _lane: Uint8Array;
  private _slot: Int32Array;
  private _state: Uint8Array;
  private _count = 0;
  private _hits = 0;
  private _misses = 0;

  constructor(opts: HighwayOptions = {}) {
    const o: Required<HighwayOptions> = {
      maxNotes: opts.maxNotes ?? 256,
      laneCount: opts.laneCount ?? 4,
      hitS: opts.hitS ?? 0,
      spawnS: opts.spawnS ?? -400,
      approachMs: opts.approachMs ?? 2000,
      missMs: opts.missMs ?? 150,
    };
    assertHighwayOptions(o);
    this.maxNotes = o.maxNotes;
    this.laneCount = o.laneCount;
    this.hitS = o.hitS;
    this.spawnS = o.spawnS;
    this.approachMs = o.approachMs;
    this.missMs = o.missMs;
    this.pxPerMs = (o.hitS - o.spawnS) / o.approachMs;
    this._time = new Float64Array(o.maxNotes);
    this._lane = new Uint8Array(o.maxNotes);
    this._slot = new Int32Array(o.maxNotes);
    this._state = new Uint8Array(o.maxNotes);
  }

  /** Live (spawned, never reset) note count, including hit/missed history. */
  get count(): number {
    return this._count;
  }
  get hits(): number {
    return this._hits;
  }
  get misses(): number {
    return this._misses;
  }

  /** Drop every note and counter. The buffers are reused, never reallocated. */
  reset(): void {
    this._count = 0;
    this._hits = 0;
    this._misses = 0;
    this._state.fill(NOTE_PENDING);
  }

  /** Allocate one reusable frame (cold path — call once per consumer). */
  createFrame(): HighwayFrame {
    return {
      s: new Float32Array(this.maxNotes),
      time: new Float64Array(this.maxNotes),
      lane: new Uint8Array(this.maxNotes),
      slot: new Int32Array(this.maxNotes),
      index: new Int32Array(this.maxNotes),
      count: 0,
      nowMs: 0,
    };
  }

  /**
   * Spawn one note. Returns false when the highway is full (never grows).
   * Lanes outside `0..laneCount-1` throw — fail fast instead of mis-choreographing.
   */
  spawn(timeMs: number, lane: number, slot = -1): boolean {
    if (!Number.isFinite(timeMs)) return false;
    if (!Number.isInteger(lane) || lane < 0 || lane >= this.laneCount) {
      throw new RangeError(`NoteHighway.spawn: lane must be 0..${this.laneCount - 1}, got ${lane}`);
    }
    if (this._count >= this.maxNotes) return false;
    const i = this._count++;
    this._time[i] = timeMs;
    this._lane[i] = lane;
    this._slot[i] = slot | 0;
    this._state[i] = NOTE_PENDING;
    return true;
  }

  /**
   * Spawn a uniform grid: `slotCount` notes starting at `baseMs`, spaced
   * `slotMs` apart, lanes read from `lanes[slotOffset + k]`. Lanes are raw
   * lane ids, so any pattern (drum steps, polyrhythms, fills) works.
   * Returns the number actually spawned (stops at capacity).
   */
  spawnGrid(
    baseMs: number,
    slotCount: number,
    slotMs: number,
    lanes: ArrayLike<number>,
    slotOffset = 0,
  ): number {
    if (!Number.isFinite(baseMs) || !Number.isFinite(slotMs) || slotMs <= 0) return 0;
    if (!Number.isInteger(slotCount) || slotCount <= 0) return 0;
    let n = 0;
    for (let k = 0; k < slotCount; k++) {
      if (this._count >= this.maxNotes) break;
      const lane = lanes[k + slotOffset];
      if (lane === undefined || lane < 0) continue;
      const li = lane | 0;
      if (li >= this.laneCount) continue;
      const i = this._count++;
      this._time[i] = baseMs + k * slotMs;
      this._lane[i] = li;
      this._slot[i] = k + slotOffset;
      this._state[i] = NOTE_PENDING;
      n++;
    }
    return n;
  }

  /** Raw note time / lane / state accessors for scoring code (no allocation). */
  timeAt(index: number): number {
    return this._time[index];
  }
  laneAt(index: number): number {
    return this._lane[index];
  }
  stateAt(index: number): number {
    return this._state[index];
  }
  slotAt(index: number): number {
    return this._slot[index];
  }

  /** Mark a note hit by internal index. Returns false for bad/already-settled ids. */
  markHit(index: number): boolean {
    if (index < 0 || index >= this._count || this._state[index] !== NOTE_PENDING) return false;
    this._state[index] = NOTE_HIT;
    this._hits++;
    return true;
  }

  /**
   * Pure axis coordinate for any timestamp at `nowMs`. Notes due in the
   * future sit between spawn and hit; late notes continue past the line.
   */
  timeToAxis(noteMs: number, nowMs: number): number {
    return this.hitS - (noteMs - nowMs) * this.pxPerMs;
  }

  /**
   * Recompute every visible note coordinate for `nowMs` into `frame`.
   * Auto-marks pending notes older than `missMs` as MISSED. Visible means
   * pending and within `[nowMs - missMs, nowMs + approachMs]`. Writes
   * `frame.count` / `frame.nowMs` and returns nothing (no allocation).
   */
  update(nowMs: number, frame: HighwayFrame): void {
    let w = 0;
    const ahead = nowMs + this.approachMs;
    const behind = nowMs - this.missMs;
    for (let i = 0; i < this._count; i++) {
      if (this._state[i] !== NOTE_PENDING) continue;
      const t = this._time[i];
      if (t < behind) {
        this._state[i] = NOTE_MISSED;
        this._misses++;
        continue;
      }
      if (t > ahead) continue;
      frame.s[w] = this.hitS - (t - nowMs) * this.pxPerMs;
      frame.time[w] = t;
      frame.lane[w] = this._lane[i];
      frame.slot[w] = this._slot[i];
      frame.index[w] = i;
      w++;
    }
    frame.count = w;
    frame.nowMs = nowMs;
  }

  /**
   * Find the nearest pending note in `lane` within `±windowMs` of `nowMs`
   * and write the outcome into `out` (allocation-free). Does not settle the
   * note — call `markHit(out.index)` once the game accepts the hit.
   */
  hitTest(lane: number, nowMs: number, windowMs: number, out: HitTestResult): HitTestResult {
    out.found = false;
    out.index = -1;
    out.offsetMs = 0;
    out.timeMs = NaN;
    if (lane < 0 || lane >= this.laneCount || windowMs < 0) return out;
    let best = -1;
    let bestAbs = windowMs;
    let bestOff = 0;
    // Strictly-inside wins over boundary: ties keep the earlier note.
    for (let i = 0; i < this._count; i++) {
      if (this._state[i] !== NOTE_PENDING || this._lane[i] !== lane) continue;
      const off = nowMs - this._time[i];
      const abs = off < 0 ? -off : off;
      if (abs <= bestAbs && (best < 0 || abs < bestAbs || this._time[i] < this._time[best])) {
        best = i;
        bestAbs = abs;
        bestOff = off;
      }
    }
    if (best >= 0) {
      out.found = true;
      out.index = best;
      out.offsetMs = bestOff;
      out.timeMs = this._time[best];
    }
    return out;
  }
}
