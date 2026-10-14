export type DrumId =
  | 'kick' | 'snare' | 'rim' | 'hihatClosed' | 'hihatOpen'
  | 'tomLow' | 'tomMid' | 'crash' | 'ride';

export interface DrumDef {
  id: DrumId;
  name: string;
  key: string;
  midi: number;
  color: string;
  notationLine: number; // 0..4 staff position
}

export const DRUMS: DrumDef[] = [
  { id: 'crash', name: 'Crash', key: 'Q', midi: 49, color: '#ffb02f', notationLine: 0 },
  { id: 'ride', name: 'Ride', key: 'W', midi: 51, color: '#22e6ff', notationLine: 0 },
  { id: 'hihatClosed', name: 'Hat', key: 'E', midi: 42, color: '#b6ff2f', notationLine: 1 },
  { id: 'snare', name: 'Snare', key: 'A', midi: 38, color: '#ff2fb3', notationLine: 2 },
  { id: 'rim', name: 'Clap', key: 'S', midi: 39, color: '#ff7ad9', notationLine: 2 },
  { id: 'tomMid', name: 'Tom H', key: 'D', midi: 47, color: '#8b5bff', notationLine: 3 },
  { id: 'tomLow', name: 'Tom L', key: 'F', midi: 43, color: '#7a3bff', notationLine: 3 },
  { id: 'hihatOpen', name: 'OpenHat', key: 'G', midi: 46, color: '#d7ff5e', notationLine: 1 },
  { id: 'kick', name: 'Kick', key: ' ', midi: 36, color: '#ff4d4d', notationLine: 4 },
];

export const MIDI_DEFAULT_MAP: Record<number, DrumId> = {
  36: 'kick', 38: 'snare', 39: 'rim', 40: 'snare',
  42: 'hihatClosed', 46: 'hihatOpen', 47: 'tomMid', 43: 'tomLow', 45: 'tomLow',
  49: 'crash', 51: 'ride', 53: 'ride',
};

export interface HitEvent {
  id: string;
  drumId: DrumId;
  time: number; // audio clock seconds
  wallTime: number; // performance.now ms
  velocity: number; // 0..1
  source: 'pad' | 'keyboard' | 'midi' | 'exercise';
}
