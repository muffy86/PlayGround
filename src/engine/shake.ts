/**
 * Phase 3 — camera micro-trauma shake.
 *
 * Trauma model (Juice-standard): hits add trauma 0..1, it decays linearly,
 * and the applied offset scales with trauma² so small hits whisper and big
 * misses slam. Position and roll each use deterministic multi-sine pseudo
 * noise (no per-frame allocation, fully unit-testable).
 *
 * `traumaFor(rating, deltaMs)` maps hit quality → trauma units so the game
 * loop links shake strength to hit delta scores with one call.
 */
export type ShakeRating = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export function traumaFor(rating: string, deltaMs = 0): number {
  const d = Number.isFinite(deltaMs) ? Math.min(200, Math.abs(deltaMs)) : 0;
  switch (rating) {
    case 'PERFECT':
      return 0.12 + (d / 200) * 0.08;
    case 'GREAT':
      return 0.22 + (d / 200) * 0.1;
    case 'GOOD':
      return 0.3 + (d / 200) * 0.1;
    case 'MISS':
      return 0.55;
    default:
      return 0.2;
  }
}

export interface ShakeSample {
  /** World-unit positional offset. */
  x: number;
  y: number;
  /** Radians of roll to apply to the camera. */
  roll: number;
  /** Current trauma after decay, 0..1. */
  trauma: number;
}

export interface TraumaOptions {
  decay?: number | undefined;
  maxOffset?: number | undefined;
  maxRoll?: number | undefined;
}

export class TraumaShake {
  private trauma = 0;
  private time = 0;
  private readonly decay: number;
  private readonly maxOffset: number;
  private readonly maxRoll: number;

  constructor(opts: TraumaOptions = {}) {
    const decay = opts.decay ?? 1.6;
    const maxOffset = opts.maxOffset ?? 0.22;
    const maxRoll = opts.maxRoll ?? 0.035;
    if (!(decay > 0)) throw new RangeError(`TraumaShake: decay must be > 0, got ${decay}`);
    if (!(maxOffset >= 0)) throw new RangeError(`TraumaShake: maxOffset must be >= 0, got ${maxOffset}`);
    if (!(maxRoll >= 0)) throw new RangeError(`TraumaShake: maxRoll must be >= 0, got ${maxRoll}`);
    this.decay = decay;
    this.maxOffset = maxOffset;
    this.maxRoll = maxRoll;
  }

  get value(): number {
    return this.trauma;
  }

  /** Add trauma (clamped 0..1). Scaled by the calibrated shake intensity. */
  kick(amount: number, intensity = 1): number {
    const k = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
    const a = Number.isFinite(amount) ? amount : 0;
    this.trauma = Math.max(0, Math.min(1, this.trauma + a * k));
    return this.trauma;
  }

  /** Convenience: kick from a hit rating + its ms delta. Returns new trauma. */
  hit(rating: string, deltaMs = 0, intensity = 1): number {
    return this.kick(traumaFor(rating, deltaMs), intensity);
  }

  reset(): void {
    this.trauma = 0;
  }

  /**
   * Advance `dt` seconds and write the spring-damped offset into `out`
   * (reused — no allocation). Returns `out`.
   */
  update(dt: number, out?: ShakeSample): ShakeSample {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    this.time += step;
    this.trauma = Math.max(0, this.trauma - this.decay * step);
    const s = this.trauma * this.trauma;
    const t = this.time;
    const x = s * this.maxOffset * (Math.sin(t * 39.7) * 0.6 + Math.sin(t * 23.3 + 1.7) * 0.4);
    const y = s * this.maxOffset * (Math.cos(t * 44.3) * 0.6 + Math.cos(t * 27.1 + 0.6) * 0.4);
    const roll = s * this.maxRoll * (Math.sin(t * 31.7 + 0.9) * 0.7 + Math.sin(t * 17.9) * 0.3);
    if (out) {
      out.x = x;
      out.y = y;
      out.roll = roll;
      out.trauma = this.trauma;
      return out;
    }
    return { x, y, roll, trauma: this.trauma };
  }
}

/** Live camera-trauma singleton: gameplay kicks it, the renderer reads it. */
export const cameraTrauma = new TraumaShake();
