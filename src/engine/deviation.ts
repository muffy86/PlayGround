/**
 * Fixed-capacity timing-deviation ring and the accuracy latency heatmap.
 *
 * `push` is O(1) and allocation-free after construction (struct-of-arrays,
 * overwrite-oldest). `heatmap` is the query path: it walks the live window
 * and allocates only the result object.
 *
 * Offsets are signed milliseconds. Negative = early, positive = late.
 */
import { DRUM_IDS, type DrumId } from './drums.js';

export const DEVIATION_RATINGS = ['PERFECT', 'GREAT', 'GOOD', 'MISS'] as const;
export type DeviationRating = (typeof DEVIATION_RATINGS)[number];

const RATING_INDEX: Record<DeviationRating, number> = {
  PERFECT: 0,
  GREAT: 1,
  GOOD: 2,
  MISS: 3,
};

export interface DeviationSample {
  timeMs: number;
  offsetMs: number;
  drum: DrumId;
  rating: DeviationRating;
}

export interface HeatmapOptions {
  /** Bin width in milliseconds. Integer >= 1. */
  binMs?: number;
  /** Inclusive lower edge of the first bin. */
  minMs?: number;
  /** Exclusive upper edge of the last bin. */
  maxMs?: number;
  /** |offset| <= onTimeMs counts as on-time. Defaults to 45. */
  onTimeMs?: number;
  /** Restrict the histogram to one drum. */
  drum?: DrumId;
}

export interface RatingCounts {
  PERFECT: number;
  GREAT: number;
  GOOD: number;
  MISS: number;
}

export interface LatencyHeatmap {
  binMs: number;
  minMs: number;
  maxMs: number;
  onTimeMs: number;
  /** Counts per bin, oldest-to-newest samples, half-open `[min + i*bin, min + (i+1)*bin)`. */
  bins: number[];
  /** Samples considered (after the optional drum filter). */
  total: number;
  inRange: number;
  underflow: number;
  overflow: number;
  /** Signed mean of in-range offsets. 0 when none are in range. */
  meanMs: number;
  /** Sample standard deviation of in-range offsets. 0 when fewer than 2. */
  stdevMs: number;
  minObserved: number | null;
  maxObserved: number | null;
  early: number;
  late: number;
  /** |offset| <= onTimeMs. Overlaps early/late; it is a window, not a third side. */
  onTime: number;
  byRating: RatingCounts;
}

export function rateOffset(offsetMs: number, perfectMs = 45, greatMs = 120): DeviationRating {
  const abs = offsetMs < 0 ? -offsetMs : offsetMs;
  if (abs <= perfectMs) return 'PERFECT';
  if (abs <= greatMs) return 'GREAT';
  return 'MISS';
}

function drumIndex(drum: DrumId): number {
  const i = DRUM_IDS.indexOf(drum);
  if (i < 0) throw new RangeError(`DeviationBuffer: unknown drum "${drum}"`);
  return i;
}

function ratingIndex(rating: DeviationRating): number {
  const i = RATING_INDEX[rating];
  if (i === undefined) throw new RangeError(`DeviationBuffer: unknown rating "${rating}"`);
  return i;
}

const MAX_BINS = 4096;
const MAX_CAPACITY = 16384;

export class DeviationBuffer {
  readonly capacity: number;
  private readonly offsets: Float32Array;
  private readonly times: Float64Array;
  private readonly drums: Uint8Array;
  private readonly ratings: Uint8Array;
  private head = 0;
  private count = 0;

  constructor(capacity = 512) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      throw new RangeError(`DeviationBuffer: capacity must be an integer 1..${MAX_CAPACITY}, got ${capacity}`);
    }
    this.capacity = capacity;
    this.offsets = new Float32Array(capacity);
    this.times = new Float64Array(capacity);
    this.drums = new Uint8Array(capacity);
    this.ratings = new Uint8Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  /** Ring storage. Same array for the lifetime of the buffer. Do not mutate. */
  get offsetStorage(): Float32Array {
    return this.offsets;
  }

  /** Drop every sample. Storage is reused. */
  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Append one sample, overwriting the oldest when full. Returns the new length. */
  push(sample: DeviationSample): number {
    if (!Number.isFinite(sample.timeMs) || !Number.isFinite(sample.offsetMs)) {
      throw new RangeError('DeviationBuffer.push: timeMs and offsetMs must be finite');
    }
    const i = this.head;
    this.offsets[i] = sample.offsetMs;
    this.times[i] = sample.timeMs;
    this.drums[i] = drumIndex(sample.drum);
    this.ratings[i] = ratingIndex(sample.rating);
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    return this.count;
  }

  /**
   * Drop the newest sample. Rolls back a push when the surrounding mutation
   * throws. No-op when the buffer is empty.
   */
  undoLast(): void {
    if (this.count === 0) return;
    this.head = (this.head - 1 + this.capacity) % this.capacity;
    this.count--;
  }

  /** Sample at logical index 0 = oldest. Throws if out of range. */
  at(logical: number): DeviationSample {
    if (!Number.isInteger(logical) || logical < 0 || logical >= this.count) {
      throw new RangeError(`DeviationBuffer.at: index ${logical} outside 0..${this.count - 1}`);
    }
    const i = this.physical(logical);
    const drum = DRUM_IDS[this.drums[i]];
    const rating = DEVIATION_RATINGS[this.ratings[i]];
    if (drum === undefined || rating === undefined) {
      throw new RangeError('DeviationBuffer.at: corrupt sample');
    }
    return { timeMs: this.times[i], offsetMs: this.offsets[i], drum, rating };
  }

  /**
   * Accuracy latency heatmap over the live window.
   * Allocates the result only — the ring itself is not copied or resized.
   */
  heatmap(opts: HeatmapOptions = {}): LatencyHeatmap {
    const binMs = opts.binMs ?? 10;
    const minMs = opts.minMs ?? -120;
    const maxMs = opts.maxMs ?? 120;
    const onTimeMs = opts.onTimeMs ?? 45;
    if (!Number.isInteger(binMs) || binMs < 1) {
      throw new RangeError(`heatmap: binMs must be an integer >= 1, got ${binMs}`);
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || !(minMs < maxMs)) {
      throw new RangeError(`heatmap: require finite minMs < maxMs, got ${minMs}..${maxMs}`);
    }
    if (!Number.isFinite(onTimeMs) || onTimeMs < 0) {
      throw new RangeError(`heatmap: onTimeMs must be >= 0, got ${onTimeMs}`);
    }
    const span = maxMs - minMs;
    const nBins = Math.ceil(span / binMs);
    if (nBins > MAX_BINS) {
      throw new RangeError(`heatmap: ${nBins} bins exceeds the ${MAX_BINS} cap`);
    }
    const filter = opts.drum === undefined ? -1 : drumIndex(opts.drum);
    const counts = new Uint32Array(nBins);
    const byRating: RatingCounts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    let total = 0;
    let inRange = 0;
    let underflow = 0;
    let overflow = 0;
    let early = 0;
    let late = 0;
    let onTime = 0;
    let sum = 0;
    let sumSq = 0;
    let minObs: number | null = null;
    let maxObs: number | null = null;
    for (let n = 0; n < this.count; n++) {
      const i = this.physical(n);
      if (filter >= 0 && this.drums[i] !== filter) continue;
      const off = this.offsets[i];
      total++;
      const rating = DEVIATION_RATINGS[this.ratings[i]];
      if (rating !== undefined) byRating[rating]++;
      if (off < 0) early++;
      else if (off > 0) late++;
      if ((off < 0 ? -off : off) <= onTimeMs) onTime++;
      if (minObs === null || off < minObs) minObs = off;
      if (maxObs === null || off > maxObs) maxObs = off;
      if (off < minMs) {
        underflow++;
        continue;
      }
      if (off >= maxMs) {
        overflow++;
        continue;
      }
      const bin = Math.floor((off - minMs) / binMs);
      counts[bin] = (counts[bin] ?? 0) + 1;
      inRange++;
      sum += off;
      sumSq += off * off;
    }
    const mean = inRange > 0 ? sum / inRange : 0;
    const variance = inRange > 1 ? (sumSq - (sum * sum) / inRange) / (inRange - 1) : 0;
    return {
      binMs,
      minMs,
      maxMs,
      onTimeMs,
      bins: Array.from(counts),
      total,
      inRange,
      underflow,
      overflow,
      meanMs: mean,
      stdevMs: variance > 0 ? Math.sqrt(variance) : 0,
      minObserved: minObs,
      maxObserved: maxObs,
      early,
      late,
      onTime,
      byRating,
    };
  }

  private physical(logical: number): number {
    const start = this.count < this.capacity ? 0 : this.head;
    return (start + logical) % this.capacity;
  }
}
