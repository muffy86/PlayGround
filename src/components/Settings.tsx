import { useState } from 'react';
import { midiService } from '../midi/MidiService';
import { useStudio } from '../store/useStore';
import { MIDI_DEFAULT_MAP } from '../lib/drums';

export default function Settings() {
  const bpm = useStudio((s) => s.bpm);
  const setBpm = useStudio((s) => s.setBpm);
  const volume = useStudio((s) => s.volume);
  const setVolume = useStudio((s) => s.setVolume);
  const kit = useStudio((s) => s.kit);
  const setKit = useStudio((s) => s.setKit);
  const [supabaseUrl, setSupabaseUrl] = useState(localStorage.getItem('nds_sb_url') ?? '');
  const [channel, setChannel] = useState('all');
  const save = () => {
    localStorage.setItem('nds_sb_url', supabaseUrl);
    midiService.filterChannel = channel === 'all' ? null : Number(channel) - 1;
    alert('Settings saved locally.');
  };
  return (
    <div>
      <div className="controls">
        <label className="ctl">Tempo (BPM)<input type="number" min={40} max={220} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} /></label>
        <label className="ctl">Volume<input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
        <label className="ctl">Kit
          <select value={kit} onChange={(e) => setKit(e.target.value)}>
            <option>Neon V-Drums</option>
            <option>Midnight Trap</option>
            <option>Hyperpop Chrome</option>
          </select>
        </label>
        <label className="ctl">MIDI channel
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All</option>
            {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </label>
        <label className="ctl">Supabase URL (optional backend sync)<input type="text" placeholder="https://xyz.supabase.co" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} style={{ minWidth: 240 }} /></label>
        <button className="btn primary" onClick={save}>Save</button>
        <button className="btn" onClick={() => midiService.resetMap()}>Reset MIDI map ({Object.keys(MIDI_DEFAULT_MAP).length} notes)</button>
      </div>
      <p className="kbd-hint">Roland V-Drums default map: 36 kick · 38 snare · 42 hat · 46 open-hat · 47/43 toms · 49 crash · 51 ride. Remap in code via MidiService.learnNote(). Works on touch, mouse, keyboard, and e-kits.</p>
    </div>
  );
}
