import { MIDI_DEFAULT_MAP, type DrumId } from '../lib/drums';

export interface MidiDeviceInfo { id: string; name: string; type: 'input' | 'output'; }

/** Web MIDI e-kit integration with zero-latency note → drum mapping. */
export class MidiService {
  access: MIDIAccess | null = null;
  inputs: MidiDeviceInfo[] = [];
  enabled = false;
  filterChannel: number | null = null; // 0-15 or null = all
  minVelocity = 1;
  mapping: Record<number, DrumId> = { ...MIDI_DEFAULT_MAP };
  onHit: ((drumId: DrumId, velocity: number, note: number) => void) | null = null;
  onStatus: ((msg: string) => void) | null = null;

  get supported() { return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator; }

  async enable(): Promise<boolean> {
    if (!this.supported) { this.onStatus?.('Web MIDI not supported in this browser — use Chrome/Edge.'); return false; }
    try {
      const nav = navigator as Navigator & { requestMIDIAccess(opts?: unknown): Promise<MIDIAccess> };
      this.access = await nav.requestMIDIAccess({ sysex: false });
      this.refresh();
      this.access.onstatechange = () => this.refresh();
      this.enabled = true;
      this.onStatus?.(`MIDI ready — ${this.inputs.length} input(s) found.`);
      return true;
    } catch (e) {
      this.onStatus?.('MIDI access denied.');
      return false;
    }
  }

  refresh() {
    if (!this.access) return;
    this.inputs = [];
    this.access.inputs.forEach((port) => {
      this.inputs.push({ id: port.id, name: port.name ?? 'MIDI input', type: 'input' });
      port.onmidimessage = (ev: MIDIMessageEvent) => this.handle(ev);
    });
  }

  handle(ev: MIDIMessageEvent) {
    const data = ev.data;
    if (!data || data.length < 3) return;
    const [status, note, vel] = [data[0], data[1], data[2]];
    const cmd = status & 0xf0;
    const ch = status & 0x0f;
    if (this.filterChannel !== null && ch !== this.filterChannel) return;
    if (cmd === 0x90 && vel > 0 && vel >= this.minVelocity) {
      const drum = this.mapping[note];
      if (drum) this.onHit?.(drum, vel / 127, note);
    }
  }

  learnNote(note: number, drum: DrumId) { this.mapping[note] = drum; }
  resetMap() { this.mapping = { ...MIDI_DEFAULT_MAP }; }
}

export const midiService = new MidiService();
