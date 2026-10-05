/**
 * Phase 3 — sensory & haptics.
 *
 * - `vibrationPatternFor(rating)`: spec patterns — PERFECT 10 ms, GREAT 25 ms,
 *   MISS double 40 ms pulse. GOOD gets a soft 15 ms tap (spec-adjacent).
 * - `triggerHaptic(rating, intensity)`: scales/quantizes the pattern by the
 *   user-calibrated intensity (0 = silent) and calls `navigator.vibrate`
 *   when available. Never throws (mobile Safari / desktop safe).
 * - `SensorySettings`: shared calibration singleton (haptics / shake /
 *   bloom / master), clamped 0..1, mutated only through the validated
 *   `setFeedbackIntensity` tool path.
 */
import type { DeviationRating } from './deviation.js';

export type JuiceRating = DeviationRating | 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

const PATTERNS: Record<string, readonly number[]> = {
  PERFECT: [10],
  GREAT: [25],
  GOOD: [15],
  MISS: [40, 40, 40],
};

/** Base vibration pattern for a rating (copy — caller may scale it). */
export function vibrationPatternFor(rating: string): number[] {
  return [...(PATTERNS[rating] ?? [15])];
}

/**
 * Scale a pattern by intensity 0..1. Intensity 0 → [] (silent).
 * Pulses below 8 ms are dropped (most motors cannot render them); the MISS
 * gap pulses are preserved so the double-tap shape survives scaling.
 */
export function scalePattern(base: readonly number[], intensity: number): number[] {
  const k = !Number.isFinite(intensity) ? 1 : intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  if (k <= 0) return [];
  if (k >= 1) return [...base];
  const out: number[] = [];
  for (let i = 0; i < base.length; i++) {
    const v = base[i] as number;
    const isGap = i % 2 === 1 && base.length > 1;
    const scaled = Math.round(v * (isGap ? 1 : k));
    if (!isGap && scaled < 8) continue;
    out.push(scaled);
  }
  return out.length > 0 ? out : [8];
}

export interface Vibrator {
  vibrate(pattern: number | number[]): boolean;
}

function readVibrator(): Vibrator | null {
  try {
    const nav = (globalThis as unknown as { navigator?: Vibrator }).navigator;
    if (nav && typeof nav.vibrate === 'function') return nav;
  } catch {
    /* ignore */
  }
  return null;
}

/** Fire the rating pattern through `navigator.vibrate`. Returns what was sent. */
export function triggerHaptic(rating: string, intensity = 1, vib?: Vibrator | null): number[] {
  const pattern = scalePattern(vibrationPatternFor(rating), intensity);
  if (pattern.length === 0) return pattern;
  try {
    (vib ?? readVibrator())?.vibrate(pattern.length === 1 ? (pattern[0] as number) : pattern);
  } catch {
    /* haptics must never break gameplay */
  }
  return pattern;
}

export interface SensoryLevels {
  haptics: number;
  shake: number;
  bloom: number;
  master: number;
}

function clampLevel(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Shared, clamped calibration for vibration / shake / bloom / master. */
export class SensorySettings {
  private levels: SensoryLevels = { haptics: 1, shake: 1, bloom: 0.8, master: 1 };

  get(): SensoryLevels {
    return { ...this.levels };
  }

  set(patch: Partial<SensoryLevels>): SensoryLevels {
    const cur = this.levels;
    this.levels = {
      haptics: patch.haptics === undefined ? cur.haptics : clampLevel(patch.haptics, cur.haptics),
      shake: patch.shake === undefined ? cur.shake : clampLevel(patch.shake, cur.shake),
      bloom: patch.bloom === undefined ? cur.bloom : clampLevel(patch.bloom, cur.bloom),
      master: patch.master === undefined ? cur.master : clampLevel(patch.master, cur.master),
    };
    return this.get();
  }

  reset(): SensoryLevels {
    this.levels = { haptics: 1, shake: 1, bloom: 0.8, master: 1 };
    return this.get();
  }
}

/** Live calibration singleton the game and the sensory tools share. */
export const sensorySettings = new SensorySettings();
