/**
 * Live MIDI tick input for the quantizer.
 *
 * Two pieces:
 * - `MidiClock` — pure tick/ms conversion for a tempo + resolution. Raw MIDI
 *   carries no timestamps, so arrival-time (ms) maps to ticks through the
 *   running tempo: `ticks = ms * bpm * tpq / 60000`. Fully deterministic,
 *   fully unit tested.
 * - `MidiTickSource` — thin Web MIDI glue. Feature-detected: `supported()`
 *   reports availability, `attach()` no-ops with `false` where the API is
 *   missing, and note-on bytes (`0x90`, velocity > 0) on any channel are
 *   converted to ticks through the clock and forwarded to one handler.
 *   Hot path allocates nothing beyond the Web MIDI event itself (no maps,
 *   no closures per message — dispatch is indexed array reads).
 */

export interface MidiNoteHandler {
  (tick: number, midiNote: number, velocity: number): void;
}

/** Minimal structural view of the Web MIDI surface we touch (test-fakeable). */
export interface MidiAccessLike {
  /**
   * Real Web MIDI exposes a `Map<string, MIDIInput>` here; test fakes (and
   * some polyfills) expose a plain iterable of inputs. `attach` handles both.
   */
  inputs:
    | Iterable<MidiInputLike>
    | { values(): Iterable<MidiInputLike> };
}
export interface MidiInputLike {
  onmidimessage: ((e: MidiMessageLike) => void) | null;
}
export interface MidiMessageLike {
  data: Uint8Array | number[] | null;
  timeStamp: number;
}

export class MidiClock {
  private _bpm: number;
  private _tpq: number;
  private _originMs: number;

  constructor(bpm: number, ticksPerQuarter = 480, originMs = 0) {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError(`MidiClock: bpm must be > 0, got ${bpm}`);
    }
    if (!Number.isInteger(ticksPerQuarter) || ticksPerQuarter <= 0) {
      throw new RangeError(`MidiClock: ticksPerQuarter must be a positive integer, got ${ticksPerQuarter}`);
    }
    this._bpm = bpm;
    this._tpq = ticksPerQuarter;
    this._originMs = originMs;
  }

  get bpm(): number {
    return this._bpm;
  }
  get ticksPerQuarter(): number {
    return this._tpq;
  }
  get originMs(): number {
    return this._originMs;
  }

  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError(`MidiClock.setBpm: bpm must be > 0, got ${bpm}`);
    }
    this._bpm = bpm;
  }

  /** Re-anchor tick 0 to `originMs` (e.g. transport start). */
  setOrigin(originMs: number): void {
    this._originMs = originMs;
  }

  /** Arrival ms → fractional MIDI tick. Pure arithmetic. */
  ticksAtMs(ms: number): number {
    return ((ms - this._originMs) * this._bpm * this._tpq) / 60000;
  }

  /** Fractional MIDI tick → arrival ms. Exact inverse of `ticksAtMs`. */
  msAtTick(tick: number): number {
    return this._originMs + (tick * 60000) / (this._bpm * this._tpq);
  }
}

/** Standard drum-map defaults: GM percussion note → game lane. */
export function defaultDrumLane(midiNote: number): number {
  switch (midiNote) {
    case 36:
      return 2; // kick
    case 38:
    case 40:
      return 1; // snare / rim
    case 42:
    case 44:
    case 46:
      return 0; // hats
    case 48:
    case 50:
      return 3; // toms
    default:
      return -1;
  }
}

export class MidiTickSource {
  readonly clock: MidiClock;
  private _handler: MidiNoteHandler | null = null;
  private _attached: MidiInputLike[] = [];

  constructor(clock: MidiClock) {
    this.clock = clock;
  }

  /** True when the runtime exposes Web MIDI input. */
  static supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'requestMIDIAccess' in navigator &&
      typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function'
    );
  }

  get attached(): boolean {
    return this._attached.length > 0;
  }

  onNote(handler: MidiNoteHandler | null): void {
    this._handler = handler;
  }

  /**
   * Request MIDI access and hook every input. Resolves true when at least one
   * input was wired; resolves false (never rejects for missing API) when the
   * browser has no Web MIDI. Genuine device errors still reject so callers
   * can surface them.
   */
  async attach(): Promise<boolean> {
    if (!MidiTickSource.supported()) return false;
    const nav = navigator as Navigator & {
      requestMIDIAccess: () => Promise<MidiAccessLike>;
    };
    const access = await nav.requestMIDIAccess();
    // `inputs` is a Map on the real API (iterate `.values()`), but may be a
    // plain iterable on fakes/polyfills. Resolved once here on the cold path.
    const raw = access.inputs as
      | Iterable<MidiInputLike>
      | { values(): Iterable<MidiInputLike> };
    const list: Iterable<MidiInputLike> =
      typeof (raw as { values?: unknown }).values === 'function'
        ? (raw as { values(): Iterable<MidiInputLike> }).values()
        : (raw as Iterable<MidiInputLike>);
    let n = 0;
    for (const input of list) {
      this.wire(input);
      n++;
    }
    return n > 0;
  }

  /** Wire one input (also the seam unit tests use with fakes). */
  wire(input: MidiInputLike): void {
    input.onmidimessage = (e: MidiMessageLike): void => {
      this.dispatch(e);
    };
    this._attached.push(input);
  }

  /** Unwire everything previously wired. */
  detach(): void {
    for (const input of this._attached) {
      try {
        input.onmidimessage = null;
      } catch {
        /* ignore teardown races */
      }
    }
    this._attached = [];
  }

  /**
   * Parse one MIDI message. Note-on with velocity 0 counts as note-off per
   * the MIDI spec and is ignored. Allocation-free dispatch.
   */
  dispatch(e: MidiMessageLike): void {
    const h = this._handler;
    if (h === null || e.data === null) return;
    const status = e.data[0] as number;
    if ((status & 0xf0) !== 0x90) return;
    const note = e.data[1] as number;
    const vel = e.data[2] as number;
    if (vel <= 0) return;
    h(this.clock.ticksAtMs(e.timeStamp), note, vel / 127);
  }
}
