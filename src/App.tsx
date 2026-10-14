import { useState } from 'react';
import { useStudio, type Tab } from './store/useStore';
import DrumStudio from './components/DrumStudio';
import MetronomePlayground from './components/MetronomePlayground';
import Lessons from './components/Lessons';
import Stats from './components/Stats';
import Settings from './components/Settings';
import ParticleCanvas from './components/ParticleCanvas';

const TABS: { id: Tab; label: string }[] = [
  { id: 'studio', label: '🥁 Drum Studio' },
  { id: 'playground', label: '🎯 Metronome Playground' },
  { id: 'lessons', label: '📚 Lessons' },
  { id: 'stats', label: '📊 Stats' },
  { id: 'settings', label: '⚙️ Settings' },
];

export default function App() {
  const tab = useStudio((s) => s.tab);
  const setTab = useStudio((s) => s.setTab);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('nds_onboard') === '1');

  return (
    <div className="app-shell">
      <ParticleCanvas />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">🥁</div>
          <div>
            <h1>NEON DRUM STUDIO</h1>
            <p>e-kit · notation · metronome playground</p>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      </header>

      <main className="main">
        {!onboarded && (
          <section className="panel" style={{ borderColor: '#b6ff2f' }}>
            <h2>⚡ Welcome, drummer</h2>
            <p className="sub">Tap pads (or keys Q–G + Space), connect your e-kit via Web MIDI, and watch notation scroll live. Then enter the Metronome Playground for gap-clicks, push/pull and polyrhythm trials with millisecond feedback.</p>
            <div className="controls">
              <button className="btn primary" onClick={() => { localStorage.setItem('nds_onboard', '1'); setOnboarded(true); }}>Let's play →</button>
            </div>
          </section>
        )}

        {tab === 'studio' && (
          <section className="panel">
            <h2>🥁 Electronic Drum Studio</h2>
            <p className="sub">Velocity-sensitive neon pads · zero-latency synth voices · live notation · particle bursts</p>
            <DrumStudio />
          </section>
        )}

        {tab === 'playground' && (
          <section className="panel">
            <h2>🎯 Metronome Playground</h2>
            <p className="sub">Gap clicks · push/pull micro-timing · displaced polyrhythms · instant ms + velocity feedback</p>
            <MetronomePlayground />
          </section>
        )}

        {tab === 'lessons' && (
          <section className="panel">
            <h2>📚 Guided lessons & routines</h2>
            <p className="sub">Six-step path from first hit to displaced accents</p>
            <Lessons />
          </section>
        )}

        {tab === 'stats' && (
          <section className="panel">
            <h2>📊 Progression tracking</h2>
            <p className="sub">Session history, streaks and lifetime hits</p>
            <Stats />
          </section>
        )}

        {tab === 'settings' && (
          <section className="panel">
            <h2>⚙️ Device, kit & backend</h2>
            <p className="sub">MIDI config, kit choice, Supabase sync</p>
            <Settings />
          </section>
        )}
      </main>

      <footer className="footer">Neon Drum Studio · WebAudio synth · Web MIDI · canvas particles + notation · React + Zustand · works offline, touch + phone/tablet ready</footer>
    </div>
  );
}
