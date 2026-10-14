import { useStudio } from '../store/useStore';

export default function Stats() {
  const total = useStudio((s) => s.totalHits);
  const best = useStudio((s) => s.bestStreak);
  const clear = useStudio((s) => s.clearHits);
  const reset = () => { localStorage.removeItem('nds_total'); localStorage.removeItem('nds_best'); useStudio.setState({ totalHits: 0, bestStreak: 0 }); clear(); };
  return (
    <div>
      <div className="stat-grid">
        <div className="stat"><b>{total}</b><span>lifetime hits</span></div>
        <div className="stat"><b>{best}</b><span>best streak</span></div>
        <div className="stat"><b>≤10ms</b><span>audio latency target</span></div>
        <div className="stat"><b>60fps</b><span>particle + notation</span></div>
      </div>
      <p className="kbd-hint">Progress persists locally (localStorage). Supabase sync keys can be added via Settings → Backend.</p>
      <div className="controls"><button className="btn warn" onClick={reset}>Reset local progress</button></div>
    </div>
  );
}
