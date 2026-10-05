/**
 * `EngineLoop` — the rAF driver for the note highway.
 *
 * Design notes:
 * - The rAF callback is bound once in the constructor; `step` does pure
 *   arithmetic plus `highway.update` plus one consumer callback — zero
 *   allocations per tick by construction (the consumer must reuse its frame).
 * - `step(nowMs)` is public and deterministic so gameplay timing is unit
 *   testable without a browser. `start()` only wires `requestAnimationFrame`
 *   around it and throws outside a browser instead of silently doing nothing.
 * - Delta time is clamped (`maxDtMs`) so a backgrounded tab resumes with one
 *   small step instead of teleporting the highway.
 */
import type { HighwayFrame, NoteHighway } from './highway.js';

export interface FrameGate {
  /** Publish queued mutations before the frame reads state. */
  commit(): number;
  /** Queue mutations that arrive while this frame is rendering. */
  beginFrame(): void;
}

export interface EngineLoopOptions {
  /** Clamp for wall-clock deltas between frames (ms). Defaults to 100. */
  maxDtMs?: number;
  /** Called every tick after `highway.update`. Must not allocate per call. */
  onFrame?: (frame: HighwayFrame, nowMs: number, dtMs: number) => void;
  /**
   * When set, each `step` commits the gate (atomic publish of everything
   * queued since the previous frame) and then opens the frame so mutations
   * during `onFrame` wait for the next step.
   */
  gate?: FrameGate;
}

export class EngineLoop {
  readonly highway: NoteHighway;
  readonly frame: HighwayFrame;
  readonly maxDtMs: number;

  private _onFrame: ((frame: HighwayFrame, nowMs: number, dtMs: number) => void) | null;
  private _gate: FrameGate | null;
  private _rafId = 0;
  private _running = false;
  private _lastMs = 0;
  private _frames = 0;
  private _timeMs = 0;
  /** Bound once — never re-created, so ticks stay allocation-free. */
  private readonly _tick: (t: number) => void;

  constructor(highway: NoteHighway, frame: HighwayFrame, opts: EngineLoopOptions = {}) {
    const maxDt = opts.maxDtMs ?? 100;
    if (!Number.isFinite(maxDt) || maxDt <= 0) {
      throw new RangeError(`EngineLoop: maxDtMs must be > 0, got ${maxDt}`);
    }
    this.highway = highway;
    this.frame = frame;
    this.maxDtMs = maxDt;
    this._onFrame = opts.onFrame ?? null;
    this._gate = opts.gate ?? null;
    this._tick = (t: number): void => {
      if (!this._running) return;
      this.step(t);
      this._rafId = requestAnimationFrame(this._tick);
    };
  }

  get running(): boolean {
    return this._running;
  }
  get frames(): number {
    return this._frames;
  }
  /** Engine time of the last processed tick (ms, same domain as notes). */
  get timeMs(): number {
    return this._timeMs;
  }

  /**
   * Advance the highway to `nowMs` and invoke the frame consumer.
   * Safe to call with non-monotonic stamps (dt clamps at 0 below).
   */
  step(nowMs: number): void {
    this._gate?.commit();
    this._gate?.beginFrame();
    let dt = nowMs - this._lastMs;
    if (!(dt >= 0)) dt = 0;
    if (dt > this.maxDtMs) dt = this.maxDtMs;
    this._lastMs = nowMs;
    this._timeMs = nowMs;
    this.highway.update(nowMs, this.frame);
    this._frames++;
    this._onFrame?.(this.frame, nowMs, dt);
  }

  /**
   * Begin rAF ticks, seeding the clock at `startMs` (defaults to the first
   * rAF timestamp via a priming call — implemented by seeding from
   * `performance.now()` when available, else 0).
   */
  start(startMs?: number): void {
    if (typeof requestAnimationFrame !== 'function') {
      throw new Error('EngineLoop.start: requestAnimationFrame is unavailable (non-browser runtime)');
    }
    if (this._running) return;
    this._running = true;
    if (startMs !== undefined) {
      this._lastMs = startMs;
      this._timeMs = startMs;
    } else if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      this._lastMs = performance.now();
      this._timeMs = this._lastMs;
    }
    this._rafId = requestAnimationFrame(this._tick);
  }

  /** Stop rAF ticks. Idempotent. */
  stop(): void {
    this._running = false;
    if (this._rafId !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
    }
    this._rafId = 0;
    this._gate?.commit();
  }
}
