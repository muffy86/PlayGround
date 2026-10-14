import { create } from 'zustand';
import type { DrumId, HitEvent } from '../lib/drums';

export type Tab = 'studio' | 'playground' | 'lessons' | 'stats' | 'settings';

interface StudioState {
  tab: Tab;
  setTab: (t: Tab) => void;
  hits: HitEvent[];
  lastHitAt: number;
  pushHit: (h: HitEvent) => void;
  clearHits: () => void;
  bpm: number;
  setBpm: (b: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  kit: string;
  setKit: (k: string) => void;
  midiStatus: string;
  setMidiStatus: (s: string) => void;
  totalHits: number;
  bestStreak: number;
}

let counter = 0;

export const useStudio = create<StudioState>((set) => ({
  tab: 'studio',
  setTab: (tab) => set({ tab }),
  hits: [],
  lastHitAt: 0,
  pushHit: (h) =>
    set((s) => ({
      hits: [...s.hits.slice(-79), h],
      lastHitAt: h.wallTime,
      totalHits: (s.totalHits + 1) || 1,
    })),
  clearHits: () => set({ hits: [] }),
  bpm: 100,
  setBpm: (bpm) => set({ bpm: Math.min(220, Math.max(40, Math.round(bpm))) }),
  volume: 0.9,
  setVolume: (volume) => set({ volume }),
  kit: 'Neon V-Drums',
  setKit: (kit) => set({ kit }),
  midiStatus: 'MIDI not connected',
  setMidiStatus: (midiStatus) => set({ midiStatus }),
  totalHits: Number(localStorage.getItem('nds_total') ?? 0) || 0,
  bestStreak: Number(localStorage.getItem('nds_best') ?? 0) || 0,
}));

export function recordGlobalHit() {
  counter += 1;
  const total = Number(localStorage.getItem('nds_total') ?? 0) + 1;
  localStorage.setItem('nds_total', String(total));
  useStudio.setState({ totalHits: total });
  void counter;
}

export function saveBestStreak(n: number) {
  const prev = Number(localStorage.getItem('nds_best') ?? 0);
  if (n > prev) {
    localStorage.setItem('nds_best', String(n));
    useStudio.setState({ bestStreak: n });
  }
}

export type { DrumId, HitEvent };
