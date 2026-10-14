import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/AudioEngine';
import { useStudio, saveBestStreak } from '../store/useStore';
import type { DrumId } from '../lib/drums';
import {
  AccentDisplacementExercise, BaseExercise, GapClicksExercise, PolyrhythmExercise,
  PushPullExercise, SubdivisionExercise, type Attempt,
} from '../exercises/exercises';
import DrumStudio from './DrumStudio';

type Mode = 'gap' | 'pushpull' | 'poly' | 'subdiv' | 'accent';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'gap', label: '🕳️ Gap Clicks', hint: 'Click drops out — hold time in silence' },
  { id: 'pushpull', label: '⏮️ Push / Pull', hint: 'Ahead/behind-the-beat micro-timing' },
  { id: 'poly', label: '🔄 Polyrhythm', hint: 'Displaced 3:2 / 4:3 / 5:4' },
  { id: 'subdiv', label: '➗ Subdivisions', hint: '8ths · triplets · 16ths' },
  { id: 'accent', label: '↑↓ Accent Shift', hint: 'Accents rotate every bar' },
];

function makeExercise(mode: Mode): BaseExercise {
  switch (mode) {
    case 'gap': return new GapClicksExercise();
    case 'pushpull': return new PushPullExercise();
    case 'poly': return new PolyrhythmExercise();
    case 'subdiv': return new SubdivisionExercise();
    case 'accent': return new AccentDisplacementExercise();
  }
}

export default function MetronomePlayground() {
  const bpm = useStudio((s) => s.bpm);
  const setBpm = useStudio((s) => s.setBpm);
  const [mode, setMode] = useState<Mode>('gap');
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<Attempt[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [pushPullMs, setPushPullMs] = useState(-20);
  const [polySpec, setPolySpec] = useState('3:2');
  const [subdiv, setSubdiv] = useState<2 | 3 | 4>(4);
  const exRef = useRef<BaseExercise>(makeExercise('gap'));
  const timerRef = useRef<number[]>([]);
  const startAtRef = useRef(0);

  const ex = useMemo(() => makeExercise(mode), [mode]);
  useEffect(() => { exRef.current = ex; }, [ex]);

  const clearTimers = () => { timerRef.current.forEach((t) => clearTimeout(t)); timerRef.current = []; };

  useEffect(() => () => clearTimers(), []);

  const start = () => {
    audio.ensure();
    const ex = exRef.current;
    ex.reset();
    if (ex instanceof PushPullExercise) ex.offsetMs = pushPullMs;
    if (ex instanceof PolyrhythmExercise) {
      const [p, b] = polySpec.split(':').map(Number);
      ex.poly = p; ex.base = b;
    }
    if (ex instanceof SubdivisionExercise) ex.div = subdiv;
    const startAt = audio.now() + 0.6;
    startAtRef.current = startAt;
    const grid = ex.schedule(startAt, bpm);
    setFeed([]); setSummary('');
    setRunning(true);
    // schedule clicks with lookahead via setTimeout deltas
    const now = audio.now();
    const scheduleClick = (t: number, accent: boolean) => {
      const ms = Math.max(0, (t - audio.now()) * 1000);
      timerRef.current.push(window.setTimeout(() => audio.click(audio.now() + 0.01, accent), ms));
    };
    if (ex instanceof GapClicksExercise) {
      grid.forEach((t) => { if (ex.audibleAt(t, startAt, bpm)) scheduleClick(t, Math.abs((t - startAt) / (60 / bpm) % 4) < 0.01); });
    } else if (ex instanceof PolyrhythmExercise) {
      ex.clickGrid(startAt, bpm).forEach((t, i) => scheduleClick(t, i % ex.base === 0));
      grid.forEach((t) => { const ms = Math.max(0, (t - now) * 1000); timerRef.current.push(window.setTimeout(() => audio.play('rim', 0.25), ms)); });
    } else if (ex instanceof AccentDisplacementExercise) {
      grid.forEach((t, i) => {
        const ms = Math.max(0, (t - now) * 1000);
        const acc = ex.isAccent(i);
        timerRef.current.push(window.setTimeout(() => { audio.click(audio.now() + 0.01, acc); if (acc) audio.play('rim', 0.2); }, ms));
      });
    } else {
      grid.forEach((t, i) => scheduleClick(t, i % 4 === 0));
    }
    const totalMs = (grid[grid.length - 1] - now) * 1000 + 1500;
    timerRef.current.push(window.setTimeout(() => stop(true), totalMs));
  };

  const stop = (auto = false) => {
    clearTimers();
    setRunning(false);
    const res = exRef.current.finalize();
    saveBestStreak(res.bestStreak);
    if (auto || exRef.current.attempts.length > 0)
      setSummary(`Accuracy ${res.accuracy}% · avg |Δ| ${res.avgAbsMs}ms · best streak ${res.bestStreak} · ${res.attempts.length} notes`);
  };

  const onExerciseHit = (_d: DrumId, audioTime: number, velocity: number) => {
    if (!running) return;
    const att = exRef.current.registerHit(audioTime, velocity);
    if (att) setFeed((f) => [...f.slice(-11), att]);
  };

  const last = feed[feed.length - 1];
  const stats = (() => {
    const perfect = feed.filter((f) => f.verdict === 'perfect').length;
    const early = feed.filter((f) => f.verdict === 'early').length;
    const late = feed.filter((f) => f.verdict === 'late').length;
    const miss = feed.filter((f) => f.verdict === 'miss').length;
    return { perfect, early, late, miss, n: feed.length };
  })();

  return (
    <div>
      <div className="controls" style={{ marginBottom: 10 }}>
        {MODES.map((m) => (
          <button key={m.id} className={`tab ${mode === m.id ? 'active' : ''}`} disabled={running} onClick={() => setMode(m.id)} title={m.hint}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="kbd-hint" style={{ margin: '0 0 10px' }}>{ex.describe()} — strike any pad / key / e-kit drum on every target. Tolerance: ±12ms perfect, ±35ms good.</p>
      <div className="controls" style={{ marginBottom: 12 }}>
        <label className="ctl">Tempo (BPM)<span><input type="range" min={40} max={220} value={bpm} disabled={running} onChange={(e) => setBpm(Number(e.target.value))} /> <b>{bpm}</b></span></label>
        {mode === 'pushpull' && (
          <label className="ctl">Push (−) / Pull (+) ms
            <select value={pushPullMs} disabled={running} onChange={(e) => setPushPullMs(Number(e.target.value))}>
              <option value={-30}>−30ms push (ahead)</option>
              <option value={-20}>−20ms push</option>
              <option value={-10}>−10ms push</option>
              <option value={10}>+10ms pull (behind)</option>
              <option value={20}>+20ms pull</option>
              <option value={30}>+30ms pull</option>
            </select>
          </label>
        )}
        {mode === 'poly' && (
          <label className="ctl">Polyrhythm
            <select value={polySpec} disabled={running} onChange={(e) => setPolySpec(e.target.value)}>
              <option value="3:2">3 : 2</option>
              <option value="4:3">4 : 3</option>
              <option value="5:4">5 : 4</option>
              <option value="7:8">7 : 8</option>
            </select>
          </label>
        )}
        {mode === 'subdiv' && (
          <label className="ctl">Subdivision
            <select value={subdiv} disabled={running} onChange={(e) => setSubdiv(Number(e.target.value) as 2 | 3 | 4)}>
              <option value={2}>8th notes</option>
              <option value={3}>Triplets</option>
              <option value={4}>16th notes</option>
            </select>
          </label>
        )}
        {!running
          ? <button className="btn primary" onClick={start}>▶ Start challenge</button>
          : <button className="btn warn" onClick={() => stop()}>■ Stop & score</button>}
      </div>

      {last && (
        <div className="panel" style={{
          borderColor: last.verdict === 'perfect' ? '#b6ff2f' : last.verdict === 'miss' ? '#ff2fb3' : '#22e6ff',
          boxShadow: `0 0 28px ${last.verdict === 'perfect' ? '#b6ff2f66' : last.verdict === 'miss' ? '#ff2fb366' : '#22e6ff66'}`,
          marginBottom: 12,
        }}>
          <b style={{ fontSize: 22 }}>
            {last.verdict === 'perfect' ? `⚡ PERFECT ${last.deltaMs! >= 0 ? '+' : ''}${last.deltaMs!.toFixed(1)}ms` :
             last.verdict === 'miss' ? '✖ MISS' :
             last.verdict === 'early' ? `◀ EARLY ${last.deltaMs!.toFixed(1)}ms — push later` :
             `▶ LATE +${last.deltaMs!.toFixed(1)}ms — play ahead`} </b>
          <span className="kbd-hint"> · velocity {(last.velocity * 127).toFixed(0)}/127</span>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat"><b>{stats.n}</b><span>attempts</span></div>
        <div className="stat"><b style={{ color: '#b6ff2f' }}>{stats.perfect}</b><span>perfect ±12ms</span></div>
        <div className="stat"><b style={{ color: '#22e6ff' }}>{stats.early + stats.late}</b><span>early / late</span></div>
        <div className="stat"><b style={{ color: '#ff2fb3' }}>{stats.miss}</b><span>miss</span></div>
      </div>

      <div className="feedback-row" style={{ marginBottom: 12 }}>
        {feed.slice(-12).map((f, i) => (
          <span key={i} className={`chip ${f.verdict}`}>
            {f.verdict === 'perfect' ? `⚡${f.deltaMs!.toFixed(0)}` : f.verdict === 'miss' ? '✖' : `${f.deltaMs!.toFixed(0)}ms`} {f.verdict}
          </span>
        ))}
      </div>
      {summary && <p className="kbd-hint">🏁 {summary}</p>}

      <TimingTimeline feed={feed} />
      <div style={{ height: 12 }} />
      <DrumStudio exerciseHit={onExerciseHit} />
    </div>
  );
}

function TimingTimeline({ feed }: { feed: Attempt[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const w = (cv.width = cv.clientWidth * 2);
    const h = (cv.height = 74 * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, w, h);
    // center = on time
    ctx.strokeStyle = '#b6ff2f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w / 2, 8); ctx.lineTo(w / 2, h - 8); ctx.stroke();
    // tolerance bands ±12ms center, ±35 wide
    const pxPerMs = w / 2 / 100;
    const band = (ms: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(w / 2 - ms * pxPerMs, 8, ms * 2 * pxPerMs, h - 16);
    };
    band(12, 'rgba(182,255,47,0.18)');
    band(35, 'rgba(34,230,255,0.10)');
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '20px system-ui';
    ctx.fillText('−100ms early', 12, 30); ctx.fillText('+100ms late', w - 170, 30);
    feed.slice(-24).forEach((f, i) => {
      if (f.deltaMs === null) return;
      const x = w / 2 + Math.max(-100, Math.min(100, f.deltaMs)) * pxPerMs;
      const y = 30 + (i % 6) * 16;
      ctx.fillStyle = f.verdict === 'perfect' ? '#b6ff2f' : f.verdict === 'miss' ? '#ff2fb3' : f.verdict === 'early' ? '#22e6ff' : '#ffb02f';
      ctx.shadowBlur = 12; ctx.shadowColor = ctx.fillStyle as string;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });
  }, [feed]);
  return <canvas ref={ref} className="timeline" />;
}
