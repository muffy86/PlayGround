/**
 * Phase 3 — 3D juice math: preallocated spark particles + reactive drum lights.
 *
 * Rendering stays in `kit3d.js` (three.js `InstancedMesh` + `PointLight`s);
 * this module owns the allocation-free simulation both sides share:
 *
 * - `SparkPool`: fixed-capacity struct-of-arrays. `burst()` releases 40–60
 *   physics-driven sparks per strike (deterministic RNG, gravity + drag);
 *   `update()` integrates and compacts the alive set in place. After
 *   construction nothing allocates — `writeInstances()` dumps directly into a
 *   caller-owned Float32Array the renderer uploads to the instance buffer.
 * - `DrumLightRig`: one intensity per drum head. `strike()` slams it to peak,
 *   `update()` applies exponential specular decay. The renderer maps
 *   intensities to PointLight.intensity (WebGL today, same uniforms port to
 *   WebGPU).
 */
import { DRUM_IDS, type DrumId } from './drums.js';

export interface SparkBurst {
  count?: number | undefined;
  speed?: number | undefined;
  up?: number | undefined;
  life?: number | undefined;
  spread?: number | undefined;
}

export interface SparkOrigin {
  x: number;
  y: number;
  z: number;
}

/** Deterministic LCG so bursts are reproducible in tests. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export class SparkPool {
  readonly capacity: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private count = 0;
  private cursor = 0;
  private readonly gravity: number;
  private readonly drag: number;

  constructor(capacity = 2048, gravity = -9.5, drag = 1.6) {
    if (!Number.isInteger(capacity) || capacity < 64) {
      throw new RangeError(`SparkPool: capacity must be an integer >= 64, got ${capacity}`);
    }
    this.capacity = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.gravity = gravity;
    this.drag = drag;
  }

  get alive(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
    this.cursor = 0;
    this.life.fill(0);
  }

  /**
   * Release a strike burst. Defaults to 48 sparks (spec: 40–60). `rng`
   * defaults to Math.random; pass `makeRng(seed)` for deterministic tests.
   * Returns sparks actually released (clamped by free slots).
   */
  burst(origin: SparkOrigin, opts: SparkBurst = {}, rng: () => number = Math.random): number {
    const count = opts.count ?? 48;
    const n = Math.max(0, Math.min(64, Math.floor(count)));
    if (n === 0) return 0;
    const speed = opts.speed ?? 4.2;
    const up = opts.up ?? 3.4;
    const life = opts.life ?? 0.7;
    const spread = opts.spread ?? 1;
    let released = 0;
    for (let k = 0; k < n; k++) {
      if (this.count >= this.capacity) break;
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      // Compact-alive invariant: cursor always points at a dead slot while
      // count < capacity because update() swap-compacts the alive prefix.
      const theta = rng() * Math.PI * 2;
      const r = (0.35 + rng() * 0.65) * spread;
      const s = speed * (0.5 + rng() * 0.9);
      this.px[i] = origin.x;
      this.py[i] = origin.y;
      this.pz[i] = origin.z;
      this.vx[i] = Math.cos(theta) * r * s;
      this.vz[i] = Math.sin(theta) * r * s;
      this.vy[i] = up * (0.6 + rng() * 0.9);
      const l = life * (0.6 + rng() * 0.7);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.size[i] = 0.05 + rng() * 0.09;
      this.count++;
      released++;
    }
    return released;
  }

  /**
   * Integrate physics (gravity + exponential drag), age sparks, and
   * swap-compact the dead. Returns alive count. No allocation.
   */
  update(dt: number): number {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
    if (step === 0 || this.count === 0) return this.count;
    const dragK = Math.exp(-this.drag * step);
    const g = this.gravity * step;
    let i = 0;
    while (i < this.count) {
      const remaining = this.life[i] as number;
      if (remaining <= step) {
        // Swap-remove with the last alive spark.
        const last = this.count - 1;
        if (i !== last) {
          this.px[i] = this.px[last] as number;
          this.py[i] = this.py[last] as number;
          this.pz[i] = this.pz[last] as number;
          this.vx[i] = this.vx[last] as number;
          this.vy[i] = this.vy[last] as number;
          this.vz[i] = this.vz[last] as number;
          this.life[i] = this.life[last] as number;
          this.maxLife[i] = this.maxLife[last] as number;
          this.size[i] = this.size[last] as number;
        }
        this.count--;
        continue;
      }
      this.life[i] = remaining - step;
      this.vx[i] = (this.vx[i] as number) * dragK;
      this.vz[i] = (this.vz[i] as number) * dragK;
      this.vy[i] = (this.vy[i] as number) * dragK + g;
      this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * step;
      this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * step;
      this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * step;
      if ((this.py[i] as number) < 0.02) {
        this.py[i] = 0.02;
        this.vy[i] = -((this.vy[i] as number) * 0.4);
      }
      i++;
    }
    return this.count;
  }

  /** 0..1 freshness of alive slot `i` (1 = just spawned). */
  freshness(i: number): number {
    if (i < 0 || i >= this.count) return 0;
    const max = this.maxLife[i] as number;
    return max > 0 ? Math.max(0, (this.life[i] as number) / max) : 0;
  }

  /**
   * Dump alive sparks into `out` as `[x,y,z,freshness,size]` stride-5 rows.
   * Returns rows written. The renderer uploads this straight to instancing.
   */
  writeInstances(out: Float32Array): number {
    const rows = Math.floor(out.length / 5);
    const n = Math.min(rows, this.count);
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      out[o] = this.px[i] as number;
      out[o + 1] = this.py[i] as number;
      out[o + 2] = this.pz[i] as number;
      out[o + 3] = this.freshness(i);
      out[o + 4] = this.size[i] as number;
    }
    return n;
  }

  /** Alive positions for tests/debug (allocates — not the render path). */
  snapshot(): Array<{ x: number; y: number; z: number; life: number }> {
    const out: Array<{ x: number; y: number; z: number; life: number }> = [];
    for (let i = 0; i < this.count; i++) {
      out.push({
        x: this.px[i] as number,
        y: this.py[i] as number,
        z: this.pz[i] as number,
        life: this.life[i] as number,
      });
    }
    return out;
  }
}

export interface LightRigOptions {
  drums: readonly DrumId[];
  peak?: number | undefined;
  decay?: number | undefined;
}

/**
 * Per-drum-head reactive intensities with exponential specular decay:
 * `I(t) = peak · e^(−decay·t)` integrated per-frame. Zero allocation after
 * construction; the renderer reads `intensityAt(i)` / `intensities()`.
 */
export class DrumLightRig {
  readonly size: number;
  private readonly drums: DrumId[];
  private readonly values: Float32Array;
  private readonly peak: number;
  private readonly decay: number;

  constructor(opts: LightRigOptions) {
    if (!opts.drums || opts.drums.length === 0) {
      throw new RangeError('DrumLightRig: drums must list at least one drum');
    }
    const peak = opts.peak ?? 60;
    const decay = opts.decay ?? 7;
    if (!(peak > 0)) throw new RangeError(`DrumLightRig: peak must be > 0, got ${peak}`);
    if (!(decay > 0)) throw new RangeError(`DrumLightRig: decay must be > 0, got ${decay}`);
    this.drums = [...opts.drums];
    this.size = this.drums.length;
    this.values = new Float32Array(this.size);
    this.peak = peak;
    this.decay = decay;
  }

  indexOf(drum: DrumId): number {
    return this.drums.indexOf(drum);
  }

  /** Slam a drum head to peak (scaled by velocity). Returns its index or -1. */
  strike(drum: DrumId, vel = 1): number {
    const i = this.drums.indexOf(drum);
    if (i < 0) return -1;
    const v = Number.isFinite(vel) ? Math.max(0, Math.min(1.2, vel)) : 1;
    this.values[i] = this.peak * (0.35 + 0.65 * Math.min(1, v));
    return i;
  }

  /** Exponential decay step. Returns total remaining intensity. */
  update(dt: number): number {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (step === 0) return this.total();
    const k = Math.exp(-this.decay * step);
    let total = 0;
    for (let i = 0; i < this.size; i++) {
      const v = (this.values[i] as number) * k;
      this.values[i] = v < 0.01 ? 0 : v;
      total += this.values[i] as number;
    }
    return total;
  }

  intensityAt(i: number): number {
    return i >= 0 && i < this.size ? (this.values[i] as number) : 0;
  }

  /** Live backing array — same reference forever. Do not resize. */
  intensities(): Float32Array {
    return this.values;
  }

  total(): number {
    let t = 0;
    for (let i = 0; i < this.size; i++) t += this.values[i] as number;
    return t;
  }

  reset(): void {
    this.values.fill(0);
  }
}

/** Live spark pool: the renderer uploads from this every frame. */
export const sparkPool = new SparkPool(2048);

/** Live per-drum reactive light intensities, indexed by DRUM_IDS order. */
export const drumLights = new DrumLightRig({ drums: DRUM_IDS });
