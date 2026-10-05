/**
 * Phase 3 — HUD spring physics, floating-text pool, and the timing-offset strip.
 *
 * - `Spring1D`: semi-implicit Euler damped spring. Critically-damped defaults
 *   give the ease-out HUD feel; `settled()` gates pool recycling.
 * - `FloatTextPool`: fixed-capacity floating rating/combo notifications. Each
 *   slot owns two springs (rise + pop scale) and an alpha envelope. `spawn`
 *   reuses the oldest dead slot — never allocates after construction.
 * - `offsetStrip`: turns the Phase 2 deviation window into strip coordinates
 *   for the millisecond timing-offset canvas (no DOM here — pure mapping so
 *   Vitest can assert it and `main.js` can draw it).
 */

export interface SpringOptions {
  stiffness?: number | undefined;
  damping?: number | undefined;
  mass?: number | undefined;
}

/** Damped spring: `a = (k·(target−x) − c·v) / m`, semi-implicit Euler. */
export class Spring1D {
  value: number;
  velocity: number;
  target: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;

  constructor(initial = 0, opts: SpringOptions = {}) {
    const k = opts.stiffness ?? 170;
    const c = opts.damping ?? 2 * Math.sqrt(170);
    const m = opts.mass ?? 1;
    if (!(k > 0)) throw new RangeError(`Spring1D: stiffness must be > 0, got ${k}`);
    if (!(c >= 0)) throw new RangeError(`Spring1D: damping must be >= 0, got ${c}`);
    if (!(m > 0)) throw new RangeError(`Spring1D: mass must be > 0, got ${m}`);
    this.value = initial;
    this.velocity = 0;
    this.target = initial;
    this.stiffness = k;
    this.damping = c;
    this.mass = m;
  }

  reset(v: number, target?: number): void {
    this.value = v;
    this.velocity = 0;
    this.target = target ?? v;
  }

  /** Advance `dt` seconds (clamped). Returns the new value. */
  step(dt: number): number {
    const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
    if (h === 0) return this.value;
    const accel = (this.stiffness * (this.target - this.value) - this.damping * this.velocity) / this.mass;
    this.velocity += accel * h;
    this.value += this.velocity * h;
    return this.value;
  }

  settled(eps = 0.05): boolean {
    return Math.abs(this.target - this.value) < eps && Math.abs(this.velocity) < eps * 8;
  }
}

export type FloatKind = 'rating' | 'combo' | 'xp';

export interface FloatSlot {
  alive: boolean;
  kind: FloatKind;
  text: string;
  sub: string;
  color: string;
  x: number;
  age: number;
  ttl: number;
  rise: Spring1D;
  pop: Spring1D;
  alpha: number;
}

export interface FloatSpawn {
  text: string;
  sub?: string | undefined;
  kind?: FloatKind | undefined;
  color?: string | undefined;
  x?: number | undefined;
  ttl?: number | undefined;
}

/**
 * Fixed-capacity floating-text pool. Slots are preallocated `FloatSlot`
 * objects with owned springs; `update` steps them in place.
 */
export class FloatTextPool {
  readonly capacity: number;
  private readonly slots: FloatSlot[];
  private cursor = 0;
  private liveCount = 0;

  constructor(capacity = 12) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`FloatTextPool: capacity must be an integer >= 1, got ${capacity}`);
    }
    this.capacity = capacity;
    this.slots = [];
    for (let i = 0; i < capacity; i++) {
      this.slots.push({
        alive: false,
        kind: 'rating',
        text: '',
        sub: '',
        color: '#fff',
        x: 0,
        age: 0,
        ttl: 0.65,
        rise: new Spring1D(0, { stiffness: 140, damping: 2 * Math.sqrt(140) * 0.9 }),
        pop: new Spring1D(0.4, { stiffness: 260, damping: 2 * Math.sqrt(260) * 0.55 }),
        alpha: 0,
      });
    }
  }

  get alive(): number {
    return this.liveCount;
  }

  /** Slot array — stable references for the renderer. */
  get all(): readonly FloatSlot[] {
    return this.slots;
  }

  spawn(s: FloatSpawn): FloatSlot {
    let slot: FloatSlot | undefined;
    for (let n = 0; n < this.capacity; n++) {
      const cand = this.slots[((this.cursor + n) % this.capacity + this.capacity) % this.capacity];
      if (cand && !cand.alive) {
        slot = cand;
        this.cursor = (((this.cursor + n + 1) % this.capacity) + this.capacity) % this.capacity;
        break;
      }
    }
    if (!slot) {
      // Full: steal the cursor slot (oldest insertion point) to bound memory.
      slot = this.slots[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    if (!slot) throw new Error('FloatTextPool: no slot');
    if (!slot.alive) this.liveCount++;
    slot.alive = true;
    slot.kind = s.kind ?? 'rating';
    slot.text = s.text;
    slot.sub = s.sub ?? '';
    slot.color = s.color ?? '#fff';
    slot.x = s.x ?? 0;
    slot.age = 0;
    slot.ttl = s.ttl ?? (slot.kind === 'combo' ? 0.8 : 0.65);
    slot.rise.reset(14, 0);
    slot.pop.reset(0.4);
    slot.pop.target = 1;
    slot.alpha = 1;
    return slot;
  }

  /** Step every slot. Returns alive count. Frees settled/expired slots. */
  update(dt: number): number {
    const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      slot.age += h;
      slot.rise.step(h);
      slot.pop.step(h);
      const tail = Math.max(0, 1 - slot.age / slot.ttl);
      slot.alpha = tail < 0.35 ? tail / 0.35 : 1;
      if (slot.age >= slot.ttl && slot.rise.settled(0.6)) {
        slot.alive = false;
        slot.alpha = 0;
        this.liveCount--;
      }
    }
    return this.liveCount;
  }

  reset(): void {
    for (const slot of this.slots) {
      slot.alive = false;
      slot.alpha = 0;
    }
    this.liveCount = 0;
    this.cursor = 0;
  }
}

// ---- timing-offset strip (pure mapping, drawn by main.js) ---------------

export interface StripPoint {
  /** 0..1 across the strip (0 = oldest). */
  u: number;
  /** -1..1 vertical deflection (clamped window edge). */
  v: number;
  offsetMs: number;
  rating: string;
}

export interface StripOptions {
  windowMs?: number | undefined;
  maxPoints?: number | undefined;
}

/**
 * Map the newest `maxPoints` deviation samples (oldest→newest) to strip
 * coordinates. `v` is `offset / windowMs` clamped to ±1. Pure — allocates
 * only the returned array.
 */
export function offsetStrip(
  samples: ReadonlyArray<{ offsetMs: number; rating: string }>,
  opts: StripOptions = {},
): StripPoint[] {
  const windowMs = opts.windowMs ?? 150;
  const maxPoints = opts.maxPoints ?? 48;
  if (!(windowMs > 0)) throw new RangeError(`offsetStrip: windowMs must be > 0, got ${windowMs}`);
  if (!Number.isInteger(maxPoints) || maxPoints < 1) {
    throw new RangeError(`offsetStrip: maxPoints must be an integer >= 1, got ${maxPoints}`);
  }
  const tail = samples.slice(Math.max(0, samples.length - maxPoints));
  const n = tail.length;
  return tail.map((s, i) => ({
    u: n <= 1 ? 1 : i / (n - 1),
    v: Math.max(-1, Math.min(1, s.offsetMs / windowMs)),
    offsetMs: s.offsetMs,
    rating: s.rating,
  }));
}
