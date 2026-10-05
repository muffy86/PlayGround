/** Drum and kit identifiers shared by the session, the bridge, and telemetry. */
export const DRUM_IDS = [
  'kick',
  'snare',
  'hihat',
  'hihatOpen',
  'tom1',
  'tom2',
  'floor',
  'crash',
  'ride',
] as const;
export type DrumId = (typeof DRUM_IDS)[number];

export const KIT_MODES = ['acoustic', 'electric'] as const;
export type KitMode = (typeof KIT_MODES)[number];

export function isDrumId(value: string): value is DrumId {
  return (DRUM_IDS as readonly string[]).includes(value);
}

export function isKitMode(value: string): value is KitMode {
  return value === 'acoustic' || value === 'electric';
}
