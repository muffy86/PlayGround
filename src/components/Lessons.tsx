import { useStudio } from '../store/useStore';

export default function Lessons() {
  const setTab = useStudio((s) => s.setTab);
  const lessons = [
    { t: '1 · First contact — kick + hat pulse', d: 'Set 80 BPM, play kick on clicks, add closed hats on 8ths. Goal: 8 perfects in a row in Subdivisions mode.' },
    { t: '2 · Gap survival', d: '100 BPM Gap Clicks. Count out loud through the 2 silent bars. Goal: avg |Δ| under 25ms.' },
    { t: '3 · Push the beat', d: 'Push/Pull at −20ms. Feel rushing without flamming. Then flip to +20ms laid-back pocket.' },
    { t: '4 · 3:2 polyrhythm', d: 'Polyrhythm 3:2 at 90 BPM. Clap the poly while the click holds 2. Then move it to snare + kick.' },
    { t: '5 · Displaced accents', d: 'Accent Shift at 100 BPM. Accent only the glowing clicks; ghost everything else.' },
    { t: '6 · Groove etude', d: 'Free play in Studio: kick-snare-hat 4 bars, crash on bar 5. Record your best streak in Stats.' },
  ];
  return (
    <div className="lesson-list">
      {lessons.map((l) => (
        <div key={l.t} className="lesson"><b>{l.t}</b><p>{l.d}</p></div>
      ))}
      <div className="controls">
        <button className="btn primary" onClick={() => setTab('playground')}>Start training →</button>
      </div>
    </div>
  );
}
