/**
 * `AsyncStateGate` — event-loop mutex for drum-pad and kit mutations.
 *
 * JavaScript has one thread, but pointer events, MIDI, WebMCP tool calls, and
 * the rAF callback still interleave. The gate makes that interleaving explicit:
 *
 * - `beginFrame()` opens the frame. Mutations that arrive while it is open are
 *   queued and do not touch the published snapshot the frame is reading.
 * - `commit()` applies the whole queue to a draft, serially, without yielding.
 *   A throwing mutator rolls back to the pre-mutation draft; the rest of the
 *   batch continues. The published snapshot is swapped once, after the batch,
 *   so readers see either the previous state or the fully applied state —
 *   never a torn mid-batch mix.
 * - Outside a frame, `mutate()` still serializes: it drains immediately, and a
 *   second caller queues behind the in-flight drain.
 *
 * Mutators are synchronous on purpose. An async mutator would yield inside the
 * batch and break the atomic publish. Callers are async (they await the
 * commit); the mutation itself is not.
 */
export class GateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GateError';
    this.code = code;
  }
}

interface Job<S, R> {
  fn: (draft: S) => R;
  resolve: (value: R) => void;
  reject: (error: unknown) => void;
}

function isThenable(value: unknown): boolean {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function cloneState<S>(state: S): S {
  if (typeof structuredClone !== 'function') {
    throw new GateError('no_clone', 'AsyncStateGate requires structuredClone');
  }
  return structuredClone(state);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export class AsyncStateGate<S> {
  private published: S;
  private readonly queue: Array<Job<S, unknown>> = [];
  private frame = false;
  private draining = false;
  private _generation = 0;
  private applied = 0;
  private rejected = 0;

  constructor(initial: S) {
    if (initial === null || typeof initial !== 'object') {
      throw new GateError('bad_state', 'AsyncStateGate requires an object state');
    }
    this.published = deepFreeze(cloneState(initial));
  }

  /** Monotonic count of non-empty commits. Unchanged by empty flushes. */
  get generation(): number {
    return this._generation;
  }
  /** Mutations waiting for the next commit. */
  get pending(): number {
    return this.queue.length;
  }
  get frameOpen(): boolean {
    return this.frame;
  }
  /** Successful mutators applied since construction. */
  get appliedCount(): number {
    return this.applied;
  }
  /** Mutators that threw and were rolled back. */
  get rejectedCount(): number {
    return this.rejected;
  }

  /**
   * Published snapshot. Stable until the next commit; frozen so a reader
   * cannot tear it. During a commit, this is still the pre-batch state.
   */
  snapshot(): S {
    return this.published;
  }

  /**
   * Queue a synchronous mutation. Resolves with the mutator's return value
   * after the batch that contains it has been published.
   */
  mutate<R>(fn: (draft: S) => R): Promise<R> {
    if (typeof fn !== 'function') {
      return Promise.reject(new GateError('bad_mutator', 'mutate requires a function'));
    }
    return new Promise<R>((resolve, reject) => {
      this.queue.push({
        fn: fn as (draft: S) => unknown,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      if (!this.frame && !this.draining) this.commit();
    });
  }

  /** Open the frame. Further mutations queue until `commit()`. Idempotent. */
  beginFrame(): void {
    this.frame = true;
  }

  /**
   * Apply every queued mutation atomically and close the frame.
   * Returns the number of mutators processed (including rolled-back failures).
   * Re-entrant calls (from a mutator or a resolve callback) return 0; the
   * outer drain picks up anything they queued.
   */
  commit(): number {
    if (this.draining) return 0;
    this.draining = true;
    let total = 0;
    try {
      total = this.drainOnce();
    } finally {
      this.draining = false;
    }
    if (!this.frame && this.queue.length > 0) total += this.commit();
    return total;
  }

  private drainOnce(): number {
    const batch = this.queue.splice(0, this.queue.length);
    if (batch.length === 0) {
      this.frame = false;
      return 0;
    }
    let draft = cloneState(this.published);
    const results: Array<{ ok: true; job: Job<S, unknown>; value: unknown } | { ok: false; job: Job<S, unknown>; error: unknown }> = [];
    for (const job of batch) {
      const checkpoint = cloneState(draft);
      try {
        const value = job.fn(draft);
        if (isThenable(value)) {
          throw new GateError('async_mutator', 'AsyncStateGate mutators must be synchronous');
        }
        results.push({ ok: true, job, value });
        this.applied++;
      } catch (error) {
        draft = checkpoint;
        results.push({ ok: false, job, error });
        this.rejected++;
      }
    }
    this.published = deepFreeze(draft);
    this._generation++;
    this.frame = false;
    for (const result of results) {
      if (result.ok) result.job.resolve(result.value);
      else result.job.reject(result.error);
    }
    return batch.length;
  }
}
