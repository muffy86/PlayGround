import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { DRUMS, type DrumId } from '../lib/drums';
import { audio } from '../audio/AudioEngine';
import { midiService } from '../midi/MidiService';
import { useStudio, recordGlobalHit } from '../store/useStore';
import { spawnBurst } from './ParticleCanvas';
import NotationStrip from './NotationStrip';

export function useDrumHit(onExerciseHit?: (drumId: DrumId, audioTime: number, velocity: number) => void) {
  const pushHit = useStudio((s) => s.pushHit);
  const volume = useStudio((s) => s.volume);
  const cbRef = useRef(onExerciseHit);
  cbRef.current = onExerciseHit;

  const hit = useCallback((drumId: DrumId, velocity = 0.9, source: 'pad' | 'keyboard' | 'midi' | 'exercise' = 'pad', el?: HTMLElement | null) => {
    audio.ensure();
    if (audio.master) audio.master.gain.value = volume;
    const t = audio.now();
    audio.play(drumId, velocity, t);
    const wallTime = performance.now();
    pushHit({ id: `${wallTime}-${Math.random()}`, drumId, time: t, wallTime, velocity, source });
    recordGlobalHit();
    if (el) {
      const r = el.getBoundingClientRect();
      const def = DRUMS.find((d) => d.id === drumId);
      spawnBurst(r.left + r.width / 2, r.top + r.height / 2, def?.color ?? '#fff');
    }
    cbRef.current?.(drumId, t, velocity);
  }, [pushHit, volume]);

  return hit;
}

export default function DrumStudio({ exerciseHit }: { exerciseHit?: (drumId: DrumId, audioTime: number, velocity: number) => void }) {
  const hit = useDrumHit(exerciseHit);
  const setMidiStatus = useStudio((s) => s.setMidiStatus);
  const midiStatus = useStudio((s) => s.midiStatus);
  const kit = useStudio((s) => s.kit);
  const [flash, setFlash] = useState<Record<string, number>>({});

  const doHit = useCallback((id: DrumId, v = 0.85 + Math.random() * 0.15, src: 'pad' | 'keyboard' | 'midi' = 'pad') => {
    const el = document.querySelector<HTMLElement>(`[data-drum="${id}"]`);
    hit(id, v, src, el);
    setFlash((f) => ({ ...f, [id]: Date.now() }));
  }, [hit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const found = DRUMS.find((d) => d.key.toLowerCase() === k || (d.key === ' ' && e.key === ' '));
      if (found) { e.preventDefault(); doHit(found.id, 0.9, 'keyboard'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doHit]);

  useEffect(() => {
    midiService.onHit = (drumId, vel) => doHit(drumId, vel, 'midi');
    midiService.onStatus = (m) => setMidiStatus(m);
  }, [doHit, setMidiStatus]);

  const connectMidi = async () => {
    audio.ensure();
    const ok = await midiService.enable();
    if (!ok) setMidiStatus('MIDI unavailable — use Chrome/Edge + HTTPS/localhost.');
  };

  return (
    <div>
      <div className="controls" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={connectMidi}>⚡ Connect E-Kit (Web MIDI)</button>
        <span className="kbd-hint">{midiStatus} · Kit: {kit} · Keys: Q W E A S D F G + Space</span>
      </div>
      <div className="pad-grid">
        {DRUMS.map((d) => {
          const hot = flash[d.id] && Date.now() - flash[d.id] < 220;
          return (
            <motion.button
              key={d.id}
              data-drum={d.id}
              className="pad"
              whileTap={{ scale: 0.94 }}
              onPointerDown={(e) => {
                e.preventDefault();
                const v = 0.7 + Math.random() * 0.3;
                const el = e.currentTarget as HTMLElement;
                hit(d.id, v, 'pad', el);
                setFlash((f) => ({ ...f, [d.id]: Date.now() }));
              }}
              style={{
                boxShadow: hot
                  ? `0 0 24px ${d.color}, 0 0 64px ${d.color}, inset 0 0 24px ${d.color}55`
                  : `0 0 10px ${d.color}44, inset 0 0 18px ${d.color}22`,
                borderColor: d.color,
              }}
              aria-label={`${d.name} drum pad`}
            >
              <span className="key">{d.key === ' ' ? 'SPACE' : d.key}</span>
              <span className="name" style={{ color: d.color }}>{d.name}</span>
              <span className="midi">MIDI {d.midi} · {d.id === 'kick' ? 'bass' : 'voice'}</span>
            </motion.button>
          );
        })}
      </div>
      <div style={{ height: 12 }} />
      <NotationStrip />
    </div>
  );
}
