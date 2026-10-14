export type Verdict = 'perfect' | 'early' | 'late' | 'miss';

export interface Attempt {
  expectedAt: number; // audio-clock seconds
  hitAt: number | null;
  deltaMs: number | null;
  velocity: number;
  verdict: Verdict;
}

export interface ExerciseResult {
  accuracy: number; // 0..100
  avgAbsMs: number;
  bestStreak: number;
  attempts: Attempt[];
}

export function classify(deltaMs: number | null, tolerancePerfect = 12, toleranceGood = 35): Verdict {
  if (deltaMs === null) return 'miss';
  const a = Math.abs(deltaMs);
  if (a <= tolerancePerfect) return 'perfect';
  if (a > toleranceGood) return 'miss';
  return deltaMs < 0 ? 'early' : 'late';
}

export abstract class BaseExercise {
  attempts: Attempt[] = [];
  streak = 0;
  bestStreak = 0;
  expected: number[] = [];
  abstract name: string;
  abstract describe(): string;
  abstract schedule(startAt: number, bpm: number): number[];
  onAttempt(a: Attempt) {
    this.attempts.push(a);
    if (a.verdict === 'perfect' || a.verdict === 'early' || a.verdict === 'late') {
      if (Math.abs(a.deltaMs ?? 999) <= 35) {
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
      } else { this.streak = 0; }
    } else this.streak = 0;
  }
  registerHit(hitAt: number, velocity: number, tol = 35): Attempt | null {
    // match nearest unmatched expected
    let best: number | null = null; let bestAbs = Infinity;
    this.expected.forEach((e, i) => {
      if (this.attempts.some((a) => a.expectedAt === e)) return;
      void i;
      const d = (hitAt - e) * 1000;
      if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = e; }
    });
    if (best === null) return null;
    const deltaMs = (hitAt - best) * 1000;
    const verdict = Math.abs(deltaMs) > 120 ? 'miss' : classify(deltaMs);
    const att: Attempt = { expectedAt: best, hitAt, deltaMs, velocity, verdict };
    this.onAttempt(att);
    return att;
  }
  finalize(): ExerciseResult {
    const scored = this.attempts.filter((a) => a.hitAt !== null);
    const acc = this.attempts.length === 0 ? 0 :
      (this.attempts.filter((a) => a.verdict === 'perfect').length * 100 +
       this.attempts.filter((a) => a.verdict !== 'miss' && a.verdict !== 'perfect').length * 60) /
      this.attempts.length;
    const avg = scored.length === 0 ? 0 : scored.reduce((s, a) => s + Math.abs(a.deltaMs ?? 0), 0) / scored.length;
    return { accuracy: Math.round(acc), avgAbsMs: Math.round(avg * 10) / 10, bestStreak: this.bestStreak, attempts: this.attempts };
  }
  reset() { this.attempts = []; this.streak = 0; this.bestStreak = 0; this.expected = []; }
}

/** Gap clicks: metronome drops bars 2-3 of every 4; player must hold time through silence. */
export class GapClicksExercise extends BaseExercise {
  name = 'Gap Clicks';
  gapBars = 2;
  describe() { return 'Play through 2 silent bars of every 4. The click vanishes — your time must not.'; }
  schedule(startAt: number, bpm: number): number[] {
    const spb = 60 / bpm;
    this.expected = [];
    for (let bar = 0; bar < 4; bar++) for (let b = 0; b < 4; b++) this.expected.push(startAt + (bar * 4 + b) * spb);
    return this.expected;
  }
  audibleAt(t: number, startAt: number, bpm: number): boolean {
    const spb = 60 / bpm;
    const beat = Math.round((t - startAt) / spb);
    const bar = Math.floor(beat / 4) % 4;
    return bar < 2; // bars 0-1 audible, 2-3 gap
  }
}

/** Push/Pull: targets displaced ±ms ahead/behind the beat. */
export class PushPullExercise extends BaseExercise {
  name = 'Push / Pull';
  offsetMs = -20; // negative = push (ahead), positive = laid-back
  describe() { return 'Micro-timing drill: strike deliberately ahead (push) or behind (pull) the click.'; }
  schedule(startAt: number, bpm: number): number[] {
    const spb = 60 / bpm;
    this.expected = [];
    for (let i = 0; i < 16; i++) this.expected.push(startAt + i * spb + this.offsetMs / 1000);
    return this.expected;
  }
}

/** Polyrhythm: e.g. 3:2 — targets on poly grid while click stays in base meter. */
export class PolyrhythmExercise extends BaseExercise {
  name = 'Polyrhythm';
  poly = 3; base = 2; bars = 2;
  describe() { return 'Displaced polyrhythm: play 3 evenly across 2 beats while the click holds the base.'; }
  schedule(startAt: number, bpm: number): number[] {
    const spb = 60 / bpm;
    const total = (this.base * spb * this.bars);
    const n = this.poly * this.bars;
    this.expected = [];
    for (let i = 0; i < n; i++) this.expected.push(startAt + (total * i) / n);
    return this.expected;
  }
  clickGrid(startAt: number, bpm: number): number[] {
    const spb = 60 / bpm;
    const out: number[] = [];
    for (let i = 0; i < this.base * this.bars; i++) out.push(startAt + i * spb);
    return out;
  }
}

/** Subdivisions: 8ths / 16ths / triplets against quarter click. */
export class SubdivisionExercise extends BaseExercise {
  name = 'Subdivisions';
  div: 2 | 3 | 4 = 4;
  describe() { return 'Fill every click with even subdivisions — 8ths, triplets or 16ths.'; }
  schedule(startAt: number, bpm: number): number[] {
    const spb = 60 / bpm;
    this.expected = [];
    for (let bar = 0; bar < 2; bar++) for (let s = 0; s < 4 * this.div; s++)
      this.expected.push(startAt + bar * 4 * spb + (s * spb) / this.div);
    return this.expected;
  }
}

/** Accent displacement: accent rotates each bar across 16 steps. */
export class AccentDisplacementExercise extends BaseExercise {
  name = 'Accent Displacement';
  shift = 3;
  describe() { return 'Accents shift by 3 sixteenths every bar. Stay locked while the downbeat moves.'; }
  schedule(startAt: number, bpm: number): number[] {
    const spb = 60 / bpm;
    const six = spb / 4;
    this.expected = [];
    for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 16; s++)
      this.expected.push(startAt + bar * 16 * six + s * six);
    return this.expected;
  }
  isAccent(index: number): boolean {
    const bar = Math.floor(index / 16);
    return index % 16 === (bar * this.shift) % 16;
  }
}
